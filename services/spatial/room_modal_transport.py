"""Spawn a configured room FunctionCall once, then observe/cancel that identity."""
from contextlib import contextmanager
import hashlib
import importlib.metadata
from pathlib import Path
import re
import sqlite3
import time

from services.spatial.room_dispatch import RoomDispatchError,RoomDispatchResult,identifier,request_identity,validate_surface,validate_room_glb
from workers.spatial_room import canonical,readiness,validate_room_request,MAX_GLB
from workers.spatial_runtime import validate_glb


class RoomModalTransport:
    simulation=False

    def __init__(self,root,lock,*,sdk=None,sdk_version=None,wait_seconds=900):
        self.root=Path(root).absolute();self.path=self.root/'room-modal-calls.sqlite3';self.lock=lock
        if self.root.resolve()!=self.root or self.path.resolve()!=self.path:raise RoomDispatchError('room_modal_storage','El diario Modal multivista no admite redirecciones.')
        if type(wait_seconds) is not int or not 1<=wait_seconds<=900:raise RoomDispatchError('room_modal_wait','El plazo de observación debe ser de 1 a 900 segundos.')
        self.sdk,self.sdk_version,self.wait_seconds=sdk,sdk_version,wait_seconds

    def preflight(self):
        pending=list(readiness(self.lock)['pending'])
        try:version=self.sdk_version if self.sdk is not None else importlib.metadata.version('modal')
        except importlib.metadata.PackageNotFoundError:version=None
        if version!=self.lock.get('modal',{}).get('sdk_version'):pending.append('modal_sdk_version_pending')
        return {'transport':'modal','adapter_implemented':True,'configured':not pending,'pending':pending,
            'deployment_access_verified':False,'gpu_execution_verified':False,'actual_cost_known':False,
            'sdk_version':version,'external_calls':0,'automatic_retries':0}

    def _sdk(self):
        if self.preflight()['pending']:raise RoomDispatchError('room_modal_not_configured','Completa el despliegue y SDK multivista antes de invocar Modal.')
        if self.sdk is not None:return self.sdk
        import modal
        return modal

    @contextmanager
    def _db(self):
        self.root.mkdir(parents=True,exist_ok=True);db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE');db.execute('CREATE TABLE IF NOT EXISTS modal_calls(job_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,call_id TEXT,state TEXT NOT NULL)')
            yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def inspect(self,job_id):
        from services.spatial.room_dispatch import read_database
        identifier(job_id)
        with read_database(self.root,'room-modal-calls.sqlite3') as db:row=db.execute('SELECT * FROM modal_calls WHERE job_id=?',(job_id,)).fetchone()
        if row is None:raise RoomDispatchError('room_modal_call_missing','No existe una llamada Modal multivista registrada.',404)
        return {**dict(row),'replay_allowed':False,'actual_cost_known':False,'remote_stop_verified':False}

    def _state(self,job_id,state,call_id=None):
        with self._db() as db:
            if call_id is None:db.execute('UPDATE modal_calls SET state=? WHERE job_id=?',(state,job_id))
            else:db.execute('UPDATE modal_calls SET state=?,call_id=? WHERE job_id=?',(state,call_id,job_id))

    def cancel(self,job_id):
        sdk=self._sdk();current=self.inspect(job_id)
        if current['call_id'] is None:return {**current,'cancel_attempted':False}
        if not re.fullmatch('fc-[A-Za-z0-9_-]{1,100}',current['call_id']):raise RoomDispatchError('room_modal_call_invalid','La identidad de llamada no es válida.')
        self._state(job_id,'cancel_requested')
        try:sdk.FunctionCall.from_id(current['call_id']).cancel(terminate_containers=False)
        except Exception:raise RoomDispatchError('room_modal_cancel_unknown','La cancelación remota no se pudo confirmar; consumo y parada siguen desconocidos.') from None
        return {**self.inspect(job_id),'cancel_attempted':True,'cancel_request_acknowledged':True}

    def execute(self,request,*,cancelled=lambda:False):
        validate_room_request(request);sdk=self._sdk();job=request['job_id'];identity=request_identity(request)
        with self._db() as db:
            if db.execute('SELECT 1 FROM modal_calls WHERE job_id=?',(job,)).fetchone():raise RoomDispatchError('room_modal_no_replay','Este trabajo conserva su intención original y no se enviará de nuevo.')
            db.execute('INSERT INTO modal_calls VALUES(?,?,NULL,?)',(job,identity,'submitting'))
        if cancelled():self._state(job,'cancelled_before_spawn');raise RoomDispatchError('room_modal_cancelled','Cancelado antes de enviar.')
        try:
            function=sdk.Function.from_name('brivany-spatial-room','reconstruct_room')
            call=function.spawn(request,expected_lock_sha256=hashlib.sha256(canonical(self.lock)).hexdigest());call_id=call.object_id
            if not isinstance(call_id,str) or not re.fullmatch('fc-[A-Za-z0-9_-]{1,100}',call_id):raise ValueError()
            self._state(job,'started',call_id)
        except Exception:
            self._state(job,'submission_unknown');raise RoomDispatchError('room_modal_submission_unknown','No se pudo confirmar la entrega multivista; no se repetirá.') from None
        deadline=time.monotonic()+self.wait_seconds
        while True:
            if cancelled():self.cancel(job);raise RoomDispatchError('room_modal_cancelled','Se solicitó cancelar la llamada original; parada sin verificar.')
            remaining=deadline-time.monotonic()
            if remaining<=0:self._state(job,'observation_timeout');raise RoomDispatchError('room_modal_timeout','La observación terminó; la llamada original puede seguir activa y no se reenvía.')
            try:result=call.get(timeout=min(10,remaining));break
            except sdk.exception.TimeoutError:continue
            except Exception:
                self._state(job,'result_unknown');raise RoomDispatchError('room_modal_result_unknown','No se obtuvo un resultado completo; conserva la llamada original.') from None
        try:
            if (not isinstance(result,dict) or result.get('status')!='preview_unverified' or result.get('provenance')!='inferred' or
                result.get('pipeline_version')!=self.lock['pipeline_version'] or result.get('source_capture_id')!=request['capture_id'] or
                result.get('source_sha256')!=request['source_sha256'] or result.get('source_frames')!=[{key:value for key,value in frame.items() if key!='image_png'} for frame in request['frames']] or
                type(result.get('cache_hit')) is not bool or type(result.get('model_executed_this_call')) is not bool or result['cache_hit']==result['model_executed_this_call']):raise ValueError()
            raw=result.get('artifact_bytes')
            if not isinstance(raw,bytes) or len(raw)>MAX_GLB or result.get('artifact')!=validate_glb(raw):raise ValueError()
            surface=validate_surface(result.get('surface'),request['frames'])
            validate_room_glb(raw,surface)
            if surface['parameters']!=request['parameters']:raise ValueError()
            value=RoomDispatchResult(raw,surface,None,result['model_executed_this_call'])
        except Exception:
            self._state(job,'invalid_result');raise RoomDispatchError('room_modal_result_invalid','El resultado no corresponde a las vistas, geometría o cámaras autorizadas.') from None
        self._state(job,'completed');return value
