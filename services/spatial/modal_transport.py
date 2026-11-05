"""Explicit Modal SDK invocation; importing never authenticates or spends.

Deployed Function lookup -> spawn once -> wait on that same FunctionCall. An
uncertain submission is never replayed. The SDK/provider can perform internal
retries/rescheduling; this journal is not an exactly-once guarantee remotely.
Sources: https://modal.com/docs/guide/trigger-deployed-functions
https://modal.com/docs/reference/modal.FunctionCall
"""
from contextlib import contextmanager
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sqlite3
import time
from uuid import UUID

from services.spatial.dispatch import DispatchError, DispatchResult, _canonical
from workers.spatial_runtime import readiness, validate_request, validate_glb


class ModalTransport:
    simulation=False

    def __init__(self,root,lock,*,sdk=None,sdk_version=None,wait_seconds=900):
        self.root=Path(root).absolute();self.path=self.root/'modal-calls.sqlite3';self.lock=lock
        if self.root.resolve()!=self.root or self.path.resolve()!=self.path:
            raise DispatchError('modal_storage','El diario Modal necesita almacenamiento local sin redirecciones.')
        if type(wait_seconds) is not int or not 1<=wait_seconds<=900:
            raise DispatchError('modal_wait','El plazo de observación Modal debe ser de 1 a 900 segundos.')
        self.sdk=sdk;self.sdk_version=sdk_version;self.wait_seconds=wait_seconds

    def preflight(self):
        pending=list(readiness(self.lock)['pending'])
        if self.lock.get('deployment_verified') is not True:pending.append('modal_deployment_verification_pending')
        try:version=self.sdk_version if self.sdk is not None else importlib.metadata.version('modal')
        except importlib.metadata.PackageNotFoundError:version=None
        if version!=self.lock.get('modal',{}).get('sdk_version'):pending.append('modal_sdk_version_pending')
        return {'transport':'modal','adapter_implemented':True,'configured':not pending,'pending':pending,
            'deployment_access_verified':False,'gpu_execution_verified':False,'automatic_retries':0,
            'actual_cost_known':False,'sdk_version':version,'external_calls':0}

    def _sdk(self):
        if self.preflight()['pending']:raise DispatchError('modal_not_configured','Completa despliegue, SDK, pesos, licencias y presupuesto antes de usar Modal.')
        if self.sdk is not None:return self.sdk
        import modal
        return modal

    @contextmanager
    def _db(self):
        self.root.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS modal_calls(job_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,call_id TEXT,state TEXT NOT NULL)')
            yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    @staticmethod
    def _job(job_id):
        try:
            if not isinstance(job_id,str) or str(UUID(job_id))!=job_id:raise ValueError()
        except (ValueError,AttributeError,TypeError):raise DispatchError('modal_job','Identificador de trabajo inválido.') from None

    def inspect(self,job_id):
        self._job(job_id)
        if not self.path.is_file():raise DispatchError('modal_call_missing','No hay llamada Modal registrada.',404)
        with self._db() as db:row=db.execute('SELECT * FROM modal_calls WHERE job_id=?',(job_id,)).fetchone()
        if row is None:raise DispatchError('modal_call_missing','No hay llamada Modal registrada.',404)
        return {**dict(row),'replay_allowed':False,'actual_cost_known':False,'actual_billed_usd':None,
            'remote_stop_verified':False}

    def _state(self,job_id,state,call_id=None):
        with self._db() as db:
            if call_id is None:db.execute('UPDATE modal_calls SET state=? WHERE job_id=?',(state,job_id))
            else:db.execute('UPDATE modal_calls SET state=?,call_id=? WHERE job_id=?',(state,call_id,job_id))

    def cancel(self,job_id):
        sdk=self._sdk();current=self.inspect(job_id)
        if current['call_id'] is None:return {**current,'cancel_attempted':False}
        if not re.fullmatch(r'fc-[A-Za-z0-9_-]{1,100}',current['call_id']):raise DispatchError('modal_call_integrity','El identificador de llamada Modal no es válido.')
        self._state(job_id,'cancel_requested')
        try:sdk.FunctionCall.from_id(current['call_id']).cancel(terminate_containers=False)
        except Exception:raise DispatchError('modal_cancel_unknown','No se pudo confirmar la petición de cancelación. El consumo sigue desconocido.') from None
        return {**self.inspect(job_id),'cancel_attempted':True,'cancel_request_acknowledged':True}

    def execute(self,request,*,cancelled=lambda:False):
        validate_request(request);sdk=self._sdk();job_id=request['job_id'];self._job(job_id)
        identity={key:value for key,value in request.items() if key not in {'image_png','mask_png'}}
        digest=hashlib.sha256(json.dumps(identity,sort_keys=True,allow_nan=False).encode()).hexdigest()
        with self._db() as db:
            if db.execute('SELECT 1 FROM modal_calls WHERE job_id=?',(job_id,)).fetchone():
                raise DispatchError('modal_no_replay','Este trabajo ya tiene una intención Modal; consulta su llamada original.')
            db.execute('INSERT INTO modal_calls VALUES(?,?,NULL,?)',(job_id,digest,'submitting'))
        if cancelled():self._state(job_id,'cancelled_before_spawn');raise DispatchError('modal_cancelled','Trabajo cancelado antes de enviar.')
        try:
            function=sdk.Function.from_name('brivany-spatial','reconstruct_single_object')
            call=function.spawn(request,expected_lock_sha256=hashlib.sha256(_canonical(self.lock)).hexdigest());call_id=call.object_id
            if not isinstance(call_id,str) or not re.fullmatch(r'fc-[A-Za-z0-9_-]{1,100}',call_id):raise ValueError()
            self._state(job_id,'started',call_id)
        except Exception:
            self._state(job_id,'submission_unknown')
            raise DispatchError('modal_submission_unknown','La entrega a Modal no se pudo confirmar. No se repetirá.') from None
        deadline=time.monotonic()+self.wait_seconds
        while True:
            if cancelled():
                self.cancel(job_id)
                raise DispatchError('modal_cancelled','Se pidió cancelar la llamada; consumo y parada remota sin verificar.')
            remaining=deadline-time.monotonic()
            if remaining<=0:
                self._state(job_id,'observation_timeout')
                raise DispatchError('modal_observation_timeout','Terminó la observación local. La llamada original puede seguir activa; no se volvió a enviar.')
            try:
                result=call.get(timeout=min(10,remaining));break
            except sdk.exception.TimeoutError:continue
            except Exception:
                self._state(job_id,'result_unknown')
                raise DispatchError('modal_result_unknown','La llamada no devolvió un resultado completo. No se repetirá.') from None
        try:
            if (not isinstance(result,dict) or result.get('status')!='preview_unverified' or result.get('provenance')!='inferred' or
                result.get('pipeline_version')!=self.lock['pipeline_version'] or
                result.get('source_capture_id')!=request['capture_id'] or result.get('source_frame_id')!=request['frame_id'] or
                type(result.get('model_executed_this_call')) is not bool or type(result.get('cache_hit')) is not bool or
                result['model_executed_this_call']==result['cache_hit']):raise ValueError()
            checked=validate_glb(result.get('artifact_bytes'))
            if any(result.get('artifact',{}).get(key)!=value for key,value in checked.items()):raise ValueError()
            value=DispatchResult(result['artifact_bytes'],None,model_executed=result['model_executed_this_call'])
        except Exception:
            self._state(job_id,'invalid_result');raise DispatchError('modal_result_invalid','El resultado Modal no coincide con el contrato o su procedencia.') from None
        self._state(job_id,'completed');return value
