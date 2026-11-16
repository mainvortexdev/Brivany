"""Outbound WhatsApp host. No inbound port and no provider secrets in the UI."""
from __future__ import annotations
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path
import platform
import re
import secrets
import threading
import time
import warnings
from urllib import request,error
from uuid import UUID,uuid4
from services.brivany_account import AccountFailure,NoRedirect,SecureAccountFile

ORIGIN='https://brivany.vetsa.es/api/brivany/whatsapp/desktop/'
TERMINAL={'succeeded','failed','cancelled','interrupted'}

def identifier(value):
    try:return isinstance(value,str) and str(UUID(value,version=4))==value
    except (ValueError,TypeError,AttributeError):return False

class DesktopHTTP:
    def reference(self,body):
        raw=json.dumps(body,separators=(',',':')).encode()
        if len(raw)>10000:raise AccountFailure('Referencia no válida.')
        headers={'Content-Type':'application/json','Accept':'image/*,video/*','Cache-Control':'no-store'}
        try:
            with request.build_opener(NoRedirect()).open(request.Request(ORIGIN+'reference',data=raw,headers=headers,method='POST'),timeout=40) as response:
                data=response.read(50000001);mime=response.headers.get('Content-Type','').split(';')[0]
                if not data or len(data)>50000000:raise ValueError()
                return data,mime
        except (OSError,ValueError,error.URLError):raise AccountFailure('No se pudo descargar el adjunto privado de esta tarea (máximo 50 MB).') from None
    def call(self,action,body,token=None):
        if action not in {'register','poll','update','disable','artifact'}:raise AccountFailure('Acción remota no válida.')
        headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'Brivany-Desktop/0.1','Cache-Control':'no-store'}
        if token:headers['Authorization']='Bearer '+token
        raw=json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()
        if len(raw)>(7100000 if action=='artifact' else 18000):raise AccountFailure('El resultado supera el límite remoto.')
        try:
            with request.build_opener(NoRedirect()).open(request.Request(ORIGIN+action,data=raw,headers=headers,method='POST'),timeout=20) as response:
                data=response.read(65537)
                if len(data)>65536:raise ValueError()
                value=json.loads(data)
                if not isinstance(value,dict):raise ValueError()
                return value
        except error.HTTPError as exc:
            status=exc.code;exc.close();failure=AccountFailure('El vínculo remoto fue revocado.' if status in (401,403) else 'No se pudo comunicar con Melodi en WhatsApp.')
            failure.unauthorized=status in (401,403);raise failure from None
        except (OSError,ValueError,error.URLError):raise AccountFailure('Sin conexión con Melodi en WhatsApp.') from None

class WhatsAppDesktop:
    def __init__(self,root,computer_factory,account,*,http=None,store=None,now=None):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.computer_factory=computer_factory;self.account=account;self.http=http or DesktopHTTP();self.now=now or time.time
        self.store=store or SecureAccountFile(self.root/'host.dpapi')
        self.lock=threading.RLock();self.stop=threading.Event();self.thread=None;self.profile=None;self.error='';self.connected=False;self.generation=0
        self.jobs={};self.pull=None;self.last_seen=0;self.closed=False
        try:
            saved=self.store.load()
            if saved and identifier(saved.get('deviceId')) and re.fullmatch('[a-f0-9]{64}',saved.get('deviceKey','')):
                self.profile={k:saved[k] for k in ('deviceId','deviceKey','userId','enabled','name')}
                for key in ('operator_enrolled','account_observed'):
                    if key in saved:self.profile[key]=saved[key]
                self.jobs=saved.get('jobs',{});self.pull=saved.get('pull')
                # Restarted actions are reconciled with local receipts, never
                # re-enqueued from an instruction or a stale server lease.
                for item in self.jobs.values():item['recovering']=True
        except Exception:self.error='No se pudo abrir el vínculo cifrado de WhatsApp.'
    def _save(self):
        if self.profile:self.store.save({**self.profile,'jobs':self.jobs,'pull':self.pull})
    def status(self):
        with self.lock:
            return {'enabled':bool(self.profile and self.profile['enabled']),'connected':self.connected,
                    'device_name':self.profile['name'] if self.profile else platform.node()[:80],
                    'device_id':self.profile['deviceId'] if self.profile else None,'error':self.error,
                    'last_seen':self.last_seen or None,'active_jobs':len(self.jobs),'requires_open_app':True}
    def configure(self,enabled):
        if type(enabled) is not bool:raise AccountFailure('Estado de control no válido.')
        if not enabled:
            with self.lock:
                previous=dict(self.profile) if self.profile else None;self.generation+=1
                if self.profile:self.profile['enabled']=False
                self.connected=False;self._cancel_jobs();self._save()
            if previous:
                try:self.http.call('disable',{'deviceId':previous['deviceId'],'deviceKey':previous['deviceKey']})
                except AccountFailure:pass
            return self.status()
        with self.lock:
            if self.closed:raise AccountFailure('Brivany se está cerrando.')
            session=self.account.status() if self.account else {}
            user=(session.get('account') or {}).get('id')
            if not user:raise AccountFailure('Inicia sesión en Cuenta Vetsa y vincula tu WhatsApp primero.')
            if not self.profile or self.profile['userId']!=user:
                self._cancel_jobs();self.jobs={};self.profile={'deviceId':str(uuid4()),'deviceKey':secrets.token_hex(32),'userId':user,'name':platform.node()[:80] or 'Mi ordenador','enabled':False};self.pull=None
            profile=dict(self.profile);generation=self.generation
        from services.whatsapp_cloud import WhatsAppCloudHTTP
        # The account object checks its generation after the authenticated request.
        body={'deviceId':profile['deviceId'],'deviceKey':profile['deviceKey'],'name':profile['name']}
        from services.demo_account import current as demo_account
        demo=demo_account()
        if demo is not None:
            with demo.lock:body['demoToken']=(demo.session or {}).get('token','')
            if not body['demoToken']:raise AccountFailure('Activa la cuenta de demostración antes de vincular el ordenador.')
        result=self.account.call_whatsapp('/desktop/register',body,http=WhatsAppCloudHTTP())
        if result.get('registered') is not True:raise AccountFailure('No se pudo vincular este ordenador.')
        with self.lock:
            if generation!=self.generation:raise AccountFailure('El permiso cambió durante la vinculación.')
            self.profile['enabled']=True;self.error='';self.generation+=1;self._save()
        self.start();return self.status()
    def start(self):
        with self.lock:
            if self.closed or self.thread and self.thread.is_alive():return
            self.thread=threading.Thread(target=self._run,daemon=True,name='melodi-whatsapp-host');self.thread.start()
    def _credential(self):return {k:self.profile[k] for k in ('deviceId','deviceKey')}
    def _call(self,action,body):return self.http.call(action,{**self._credential(),**body})
    def _valid_account(self):
        if self.profile.get('operator_enrolled'):
            status=self.account.status() if self.account else {}
            if status.get('signed_in'):
                self.profile['account_observed']=True;self._save()
                return (status.get('account') or {}).get('id')==self.profile['userId']
            return not self.profile.get('account_observed',False)
        if self.profile['userId'].startswith('legacy-owner:'):
            # Private one-computer migration enrollment; never available in an
            # HTTP registration request. A later sign-in cannot inherit it.
            return not self.account or not self.account.status().get('signed_in')
        status=self.account.status() if self.account else {}
        return status.get('signed_in') and (status.get('account') or {}).get('id')==self.profile['userId']
    def tick(self):
        with self.lock:
            if not self.profile or not self.profile['enabled']:return 5
            if not self._valid_account():
                self._cancel_jobs();self.connected=False;self.error='La cuenta cambió o cerró sesión; el control está detenido.';return 5
            generation=self.generation
            if not self.pull:self.pull={'pullId':str(uuid4()),'lease':secrets.token_hex(32)};self._save()
            pull=dict(self.pull)
        response=self._call('poll',pull)
        with self.lock:
            if generation!=self.generation or not self.profile['enabled'] or not self._valid_account():return 5
            if response.get('enabled') is not True:raise AccountFailure('El control remoto está desactivado.')
            self.connected=True;self.error='';self.last_seen=self.now()
            for control in response.get('controls',[]):self._control(control)
            command=response.get('command')
            if command:self._receive(command,pull)
            self.pull=None;self._save()
            for remote,item in list(self.jobs.items()):self._publish(remote,item)
        return 2 if self.jobs else 5
    def _receive(self,command,pull):
        remote=command.get('id')
        if not identifier(remote) or command.get('deviceId')!=self.profile['deviceId'] or command.get('type') not in {'instruction','instruction_reference','screenshot'} or not isinstance(command.get('instruction'),str) or not 0<len(command['instruction'])<=2000 or not isinstance(command.get('expiresAt'),(int,float)) or not self.now()*1000<command['expiresAt']<=self.now()*1000+600001:raise AccountFailure('La orden recibida no pudo verificarse.')
        if remote in self.jobs:return
        # Persist before asking the broker to start; duplicate HTTP responses
        # cannot execute this identifier twice, including across restarts.
        item={'lease':pull['lease'],'local_id':None,'state':'received','revision':0};self.jobs[remote]=item;self._save()
        ack=self._call('update',{'id':remote,'lease':item['lease'],'state':'accepted'})
        if ack.get('accepted') is not True:
            self.jobs.pop(remote,None);self._save();return
        item['state']='starting';self._save()
        try:
            computer=self.computer_factory()
            if command['type']=='screenshot':
                capture=computer.runtime.call('desktop_capture',timeout=15)
                item['capture']=capture['png_base64'];item.update(state='succeeded',summary='Captura de la pantalla principal tomada por el ordenador.');self._save();return
            references=[];selected=[];payload=command.get('payload',{})
            if command['type']=='instruction_reference':
                raw,mime=self.http.reference({**self._credential(),'id':remote,'lease':item['lease'],'kind':'image'})
                from PIL import Image,ImageOps
                with warnings.catch_warnings():
                    warnings.simplefilter('error',Image.DecompressionBombWarning)
                    with Image.open(BytesIO(raw)) as picture:
                        if picture.format not in {'PNG','JPEG','WEBP'} or picture.width*picture.height>16000000:raise AccountFailure('La imagen supera las dimensiones admitidas.')
                        picture.load();picture=ImageOps.exif_transpose(picture).convert('RGB');picture.thumbnail((1400,1400));output=BytesIO();picture.save(output,'JPEG',quality=85)
                added=computer.references.add('data:image/jpeg;base64,'+base64.b64encode(output.getvalue()).decode())
                references=computer.references.get_many([added['id']]);item['reference_id']=added['id']
            if payload.get('sourceVideo'):
                raw,mime=self.http.reference({**self._credential(),'id':remote,'lease':item['lease'],'kind':'video'})
                extension={'video/mp4':'.mp4','video/quicktime':'.mov','video/webm':'.webm'}.get(mime)
                if not extension:raise AccountFailure('El adjunto no es un video admitido.')
                folder=computer.workspace/'whatsapp-inputs'/remote;folder.mkdir(parents=True,exist_ok=True)
                if any(p.is_symlink() or getattr(p,'is_junction',lambda:False)() for p in (folder,*folder.parents)):raise AccountFailure('Carpeta de adjuntos no válida.')
                path=folder/('entrada'+extension)
                with path.open('xb') as output:output.write(raw)
                selected=[str(path)];item['input_path']=str(path)
            grant=secrets.token_urlsafe(32);kind='orchestrator';goal=command['instruction']
            computer.schedule_authorities[grant]={'expires':time.monotonic()+900,'kind':kind,'goal':goal}
            job=computer.enqueue(kind,goal,grant,user_request=goal,references=references,active_reference_id=references[-1].id if references else None,selected=selected)
            item.update(local_id=job['id'],grant=grant,state='running',return_artifact=payload.get('returnArtifact') is True);self._save()
        except Exception as exc:
            from services.telephony.common import TelephonyError
            item.update(state='failed',summary=str(exc)[:500] if isinstance(exc,(AccountFailure,TelephonyError)) else 'El ordenador no pudo iniciar la tarea; no se reintentará.');self._save()
    def _control(self,value):
        item=self.jobs.get(value.get('id'));revision=value.get('revision')
        if not item or type(revision) is not int or revision<=item.get('revision',0):return
        computer=self.computer_factory();local=item.get('local_id')
        # Record consumption before performing the exact one-use response.
        item['revision']=revision;self._save()
        if value.get('action')=='cancelar':
            if local:computer.cancel(local)
            else:item.update(state='cancelled',summary='Tarea cancelada antes de iniciarse.');self._save()
        elif local and value.get('action')=='approval' and type(value.get('accepted')) is bool:
            try:computer.approve_file_action(local,value.get('approvalId'),value['accepted'])
            except (ValueError,PermissionError):pass
        elif local and value.get('action')=='continuar':
            try:computer.continue_assistant_job(local)
            except (ValueError,PermissionError):pass
    def _publish(self,remote,item):
        computer=self.computer_factory();job=computer.jobs.get(item.get('local_id'))
        state=item['state'];summary=item.get('summary','');result={}
        if item.pop('recovering',False) and not job:
            item.update(state='interrupted',summary='Brivany se reinició y no se repetirá la orden anterior.');state=item['state'];summary=item['summary'];self._save()
        if job:
            public=computer.public(job);state=public['state']
            if state=='awaiting_user':state='waiting_for_user'
            if state not in TERMINAL|{'awaiting_approval','waiting_for_user'}:state='running'
            summary=str(public.get('error') or (public.get('result') or {}).get('message') or public.get('phase') or 'Estado confirmado por el ordenador.')[:2800]
            approval=public.get('approval')
            if state=='awaiting_approval' and approval:
                result['approval']={'id':approval['id'],'description':json.dumps({k:v for k,v in approval.items() if k not in {'id','expires_at'}},ensure_ascii=False)[:2000]}
            result['externalCalls']=public.get('external_calls')
        elif state in {'received','starting'}:state='interrupted';summary='No se confirmó el inicio; no se repetirá automáticamente.'
        if state=='succeeded' and job and item.get('return_artifact') and not item.get('artifact_checked'):
            try:
                produced=self._result_artifact(computer,job)
                if produced:
                    path,mime,kind=produced
                    self._call('artifact',{'id':remote,'lease':item['lease'],'mimeType':mime,'base64':base64.b64encode(path.read_bytes()).decode()})
                    item['artifact']={'kind':kind,'fileName':re.sub(r'[^\w .()-]','_',path.name,flags=re.UNICODE)[:120]}
                else:item['artifact_note']=' El archivo no se adjuntó: no hay un resultado compatible de hasta 5 MB en el espacio de trabajo.'
                item['artifact_checked']=True;self._save()
            except (ValueError,OSError):
                item['artifact_checked']=True;item['artifact_note']=' No pude verificar el archivo de salida para adjuntarlo.';self._save()
        if item.get('artifact'):result['artifact']=item['artifact']
        summary+=item.get('artifact_note','')
        signature=hashlib.sha256(json.dumps([state,summary,result],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        if item.get('sent')==signature:return
        if state=='succeeded' and item.get('capture'):
            self._call('artifact',{'id':remote,'lease':item['lease'],'mimeType':'image/png','base64':item['capture']});result['artifact']={'kind':'image','fileName':'pantalla.png'}
        response=self._call('update',{'id':remote,'lease':item['lease'],'state':state,'result':{'summary':summary,**result}})
        if response.get('accepted') is not True:
            if response.get('state') in TERMINAL|{'expired'}:
                if item.get('grant'):computer.schedule_authorities.pop(item['grant'],None)
                self.jobs.pop(remote,None);self._save();return
            raise AccountFailure('No se confirmó el recibo de la tarea.')
        item['sent']=signature
        if state in TERMINAL:
            if item.get('grant'):computer.schedule_authorities.pop(item['grant'],None)
            if item.get('reference_id'):computer.references.remove(item['reference_id'])
            self.jobs.pop(remote,None)
        self._save()
    @staticmethod
    def _result_artifact(computer,job):
        from services.orchestration.team import artifact
        formats={'.png':('image/png','image'),'.jpg':('image/jpeg','image'),'.jpeg':('image/jpeg','image'),
                 '.pdf':('application/pdf','document'),'.txt':('text/plain','document'),
                 '.docx':('application/vnd.openxmlformats-officedocument.wordprocessingml.document','document'),'.mp4':('video/mp4','video')}
        jobs=[job]+[child for child in computer.jobs.values() if child.get('parent_id')==job['id'] and child.get('state')=='succeeded']
        for value in jobs:
            result=value.get('result') or {}
            for raw in [result.get('path'),result.get('video_path'),*[image.get('path') for image in result.get('images',[]) if isinstance(image,dict)]]:
                if not isinstance(raw,str) or Path(raw).suffix.lower() not in formats:continue
                try:path=artifact(raw,computer.workspace,5000000)
                except ValueError:continue
                return path,*formats[path.suffix.lower()]
        return None
    def _cancel_jobs(self):
        if not self.jobs:return
        computer=self.computer_factory()
        for remote,item in self.jobs.items():
            if item.get('local_id'):computer.cancel(item['local_id'])
            if item.get('grant'):computer.schedule_authorities.pop(item['grant'],None)
            if item.get('reference_id'):computer.references.remove(item.pop('reference_id'))
            item.update(state='cancelled',summary='El control remoto se detuvo. La tarea no se repetirá.')
    def _run(self):
        delay=5
        while not self.stop.is_set():
            try:delay=self.tick()
            except Exception as exc:
                with self.lock:
                    self.connected=False;self.error=str(exc) if isinstance(exc,AccountFailure) else 'El control se detuvo por un fallo de comunicación.'
                    if getattr(exc,'unauthorized',False):self._cancel_jobs();self.profile['enabled']=False;self._save()
                delay=min(60,max(5,delay*2))
            self.stop.wait(delay)
    def close(self):
        self.closed=True;self.stop.set()
        with self.lock:self.generation+=1;self._cancel_jobs();self._save()
        if self.thread and self.thread is not threading.current_thread():self.thread.join(1)
