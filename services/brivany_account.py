"""Account sign-in and outbound desktop host; no inbound port or shell endpoint."""
from __future__ import annotations
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import threading
import time
from urllib import request,error,parse
from uuid import UUID,uuid4
from services.orchestration.research_delivery import research_output

BASE='https://mobile.brivany.example'
KINDS={'desktop','terminal','model','document','personal','edits','motion','media','support','skill','schedule','image','research','orchestrator'}


class AccountFailure(ValueError):pass


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


class AccountHTTP:
    def __init__(self,base=BASE,*,test=False):
        target=parse.urlsplit(base)
        if base!=BASE and not (test and target.scheme=='http' and target.hostname=='127.0.0.1' and target.port and not target.path):raise ValueError('Servicio Brivany no válido.')
        self.base=base
    def call(self,path,body=None,token=None,*,timeout=12):
        if not path.startswith('/v1/') or '?' in path or '..' in path:raise ValueError('Ruta no válida.')
        headers={'Content-Type':'application/json','Accept':'application/json','Cache-Control':'no-store','User-Agent':'Brivany-Desktop/0.1'}
        if token:headers['Authorization']='Bearer '+token
        payload=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
        req=request.Request(self.base+path,data=payload,headers=headers,method='POST' if body is not None else 'GET')
        try:
            with request.build_opener(NoRedirect()).open(req,timeout=timeout) as response:
                raw=response.read(131073)
                if len(raw)>131072:raise AccountFailure('Brivany devolvió una respuesta demasiado grande.')
                return json.loads(raw)
        except error.HTTPError as exc:
            code=exc.code;exc.close()
            raise AccountFailure('El correo o la contraseña no son correctos.' if code in (401,403) else 'Espera un momento y vuelve a intentarlo.' if code==429 else 'No se pudo completar la solicitud de Brivany.') from None
        except (OSError,error.URLError,ValueError) as exc:
            if isinstance(exc,AccountFailure):raise
            raise AccountFailure('No se pudo conectar con Brivany.') from None
    def chat(self,messages,token,*,source='chat',cancelled=None,conversation_id=None):
        payload=json.dumps({'messages':messages[-12:],'source':source,'nonce':str(uuid4()),**({'conversation_id':conversation_id} if conversation_id else {})},ensure_ascii=False).encode()
        req=request.Request(self.base+'/v1/chat',data=payload,method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/x-ndjson','User-Agent':'Brivany-Desktop/0.1'})
        from packages.providers.conversation import cancellable_reply
        try:
            response=request.build_opener(NoRedirect()).open(req,timeout=35)
            with response,cancellable_reply(response,cancelled):
                total=0
                while cancelled is None or not cancelled.is_set():
                    line=response.readline(65537)
                    if not line:break
                    total+=len(line)
                    if len(line)>65536 or total>262144:raise AccountFailure('La respuesta superó su límite.')
                    if line.strip():yield json.loads(line)
        except (error.URLError,OSError,ValueError):
            if cancelled is None or not cancelled.is_set():raise AccountFailure('No se pudo completar la respuesta de tu cuenta Brivany.') from None


class SecureAccountFile:
    def __init__(self,path,protector=None):
        from services.google_oauth import WindowsDPAPIProtector
        self.path=Path(path);self.protector=protector or WindowsDPAPIProtector()
    def load(self):
        if not self.path.exists():return None
        if not self.protector.available:raise AccountFailure('No está disponible el almacén seguro del sistema.')
        return json.loads(self.protector.unprotect(self.path.read_bytes()))
    def save(self,value):
        if not self.protector.available:raise AccountFailure('No está disponible el almacén seguro del sistema.')
        raw=json.dumps(value,ensure_ascii=False).encode();protected=self.protector.protect(raw)
        self.path.parent.mkdir(parents=True,exist_ok=True);temp=self.path.with_suffix('.tmp');temp.write_bytes(protected);temp.replace(self.path)
    def clear(self):self.path.unlink(missing_ok=True)


class DesktopAccount:
    def __init__(self,root,computer_factory,*,http=None,store=None,connector=None):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True);self.computer_factory=computer_factory
        self.http=http or AccountHTTP();self.store=store or SecureAccountFile(self.root/'session.dpapi')
        if connector is None:
            from websockets.sync.client import connect
            connector=lambda url,token:connect(url,additional_headers={'Authorization':'Bearer '+token},open_timeout=8,close_timeout=1,max_size=16384,proxy=None)
        self.connector=connector;self.lock=threading.RLock();self.send_lock=threading.Lock();self.session=None;self.socket=None;self.thread=None;self.stop_event=threading.Event();self.connected=False;self.error='';self.pending={};self.jobs={};self.sent={};self.closed=False
        device=self.root/'device.json'
        if device.exists():self.device_id=json.loads(device.read_text())['id']
        else:self.device_id=str(uuid4());device.write_text(json.dumps({'id':self.device_id}),encoding='utf-8')
        self.receipts=self.root/'receipts';self.receipts.mkdir(exist_ok=True)
        self.seen={file.stem for file in self.receipts.glob('*.json')}
        try:self.session=self.store.load()
        except Exception:self.error='Inicia sesión para volver a conectar este ordenador.'
    def start(self):
        with self.lock:
            if self.closed or self.thread and self.thread.is_alive():return
            self.stop_event.clear();self.thread=threading.Thread(target=self._run,daemon=True,name='brivany-account-host');self.thread.start()
    def login(self,email,password,name=None):
        system={'Windows':'windows','Darwin':'macos','Linux':'linux'}.get(platform.system(),'linux')
        value=self.http.call('/v1/account/login',{'email':email,'password':password,'device_id':self.device_id,'device_name':name or platform.node()[:80] or 'Mi ordenador','kind':'desktop','platform':system})
        self.store.save(value)
        with self.lock:self.session=value;self.error='';old=self.socket
        if old:
            try:old.close()
            except Exception:pass
        self.start();return self.status()
    def token(self):
        with self.lock:return (self.session or {}).get('session',{}).get('token')
    def status(self):
        with self.lock:return {'signed_in':bool(self.session),'account':self.session.get('account') if self.session else None,'device_id':self.device_id,'connected':self.connected,'remote_enabled':bool(self.session),'error':self.error}
    def devices(self):
        token=self.token();return self.http.call('/v1/devices',token=token) if token else {'devices':[]}
    def command_status(self,identifier):
        try:valid=str(UUID(identifier))==identifier
        except (ValueError,TypeError,AttributeError):valid=False
        if not valid:raise AccountFailure('Tarea no válida.')
        token=self.token()
        if not token:raise AccountFailure('Inicia sesión en Brivany.')
        return self.http.call('/v1/commands/'+identifier,token=token)
    def chat_turn(self,value,cancelled=None):
        token=self.token()
        if not token:raise AccountFailure('Inicia sesión en Brivany.')
        history=[{'role':m.role,'content':m.content[:1000]} for m in value.history][-11:]
        history.append({'role':'user','content':value.text});text='';completed=False
        for event in self.http.chat(history,token,cancelled=cancelled,source=getattr(value,'source','chat'),conversation_id=getattr(value,'conversation_id',None)):
            if event.get('type')=='delta':text+=event.get('text','');yield event
            elif event.get('type') in {'computer_choice','computer_job'}:yield event
            elif event.get('type')=='error':raise AccountFailure('Melodi no pudo preparar la solicitud.')
            elif event.get('type')=='done':
                if text:yield {'type':'sentence','text':text}
                yield {'type':'done','text':text,'await_user':True};completed=True
        if not completed and not (cancelled and cancelled.is_set()):raise AccountFailure('La respuesta no se completó.')
    def logout(self):
        token=self.token()
        if token:
            try:self.http.call('/v1/account/logout',{},token,timeout=5)
            except AccountFailure:pass
        with self.lock:self.session=None;socket=self.socket;self.connected=False;self.pending.clear()
        self.store.clear()
        if socket:
            try:socket.close()
            except Exception:pass
        with self.lock:
            owned_jobs=list(self.jobs.values());self.jobs.clear();self.sent.clear()
        for item in owned_jobs:
            try:self.computer_factory().cancel(item['local_id'])
            except Exception:pass
        return self.status()
    def _receipt(self,id,value):
        temp=self.receipts/(id+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');temp.replace(self.receipts/(id+'.json'))
    def _send(self,value):
        with self.send_lock:
            if self.socket:self.socket.send(json.dumps(value,ensure_ascii=False,separators=(',',':')))
    def _receive(self,event):
        # Serialize delivery/ack with sign-out: a late receipt cannot start a
        # new task after the local account has been removed.
        with self.lock:
            if not self.session:return
            self._receive_authenticated(event)
    def _receive_authenticated(self,event):
        if event.get('type')=='command':
            identifier=event.get('id')
            try:valid=str(UUID(identifier))==identifier
            except (ValueError,TypeError,AttributeError):return
            if not valid or identifier in self.seen:return
            if event.get('user_request') is not None and (not isinstance(event['user_request'],str) or not 1<=len(event['user_request'])<=2000):return
            if event.get('kind') not in KINDS or not isinstance(event.get('instruction'),str) or not 1<=len(event['instruction'])<=1200 or not isinstance(event.get('issued_at'),(int,float)) or abs(time.time()*1000-event['issued_at'])>60000:return
            self._receipt(identifier,{'state':'received','local_id':None});self.seen.add(identifier);self.pending[identifier]=event
            # Execution starts only after the account broker acknowledges receipt.
            self._send({'type':'update','id':identifier,'state':'accepted'})
        elif event.get('type')=='ack':
            identifier=event.get('id');command=self.pending.pop(identifier,None)
            if not command or event.get('ok') is not True:return
            try:
                computer=self.computer_factory()
                if not computer.authorized(computer.grant):computer.arm()
                job=computer.enqueue(command['kind'],command['instruction'],computer.grant,**({'user_request':command['user_request']} if command.get('user_request') else {}))
                self.jobs[identifier]={'local_id':job['id']};self._receipt(identifier,{'state':'accepted','local_id':job['id']});self._update(identifier,job)
            except Exception:
                self._receipt(identifier,{'state':'failed','local_id':None});self._send({'type':'update','id':identifier,'state':'failed','result':{'summary':'El ordenador no pudo iniciar esta tarea.'}})
    def _update(self,identifier,job):
        state=job.get('state');mapped=state if state in {'succeeded','failed','cancelled','awaiting_approval'} else 'failed' if state in {'interrupted','awaiting_user'} else 'running'
        result={'phase':str(job.get('phase') or '')[:300],'approval_required':state=='awaiting_approval','external_calls':job.get('external_calls')}
        continuation=job['id'] if state=='waiting_for_user' else job.get('continuation_id')
        if continuation:result.update(continuation_id=continuation,intervention_revision=job.get('intervention_revision'))
        if mapped in {'failed','cancelled'}:result['summary']=str(job.get('error') or job.get('phase') or 'No pude completar la tarea.')[:400]
        if mapped=='succeeded' and job.get('result') is not None:
            research=research_output(job['result'])
            payload=json.dumps(job['result'],ensure_ascii=False)
            if research:result['output']=research
            elif len(payload)<=5000:result['output']=job['result']
            elif job['result'].get('verified') is True and isinstance(job['result'].get('message'),str):result['output']={'verified':True,'message':job['result']['message'][:2400],'details_in_desktop':True}
            else:result['summary']='Resultado disponible en el ordenador.'
        value={'type':'update','id':identifier,'state':mapped,'local_id':job['id'],'result':result}
        signature=json.dumps(value,sort_keys=True,ensure_ascii=False)
        if self.sent.get(identifier)==signature:return
        self._send(value);self.sent[identifier]=signature;self._receipt(identifier,{'state':mapped,'local_id':job['id']})
        if mapped in {'succeeded','failed','cancelled'}:self.jobs.pop(identifier,None)
    def _run(self):
        delay=1
        while not self.stop_event.is_set():
            token=self.token()
            if not token:self.stop_event.wait(.5);continue
            try:
                url=self.http.base.replace('https://','wss://',1).replace('http://','ws://',1)+'/v1/host'
                with self.connector(url,token) as socket:
                    with self.lock:self.socket=socket;self.connected=True;self.error=''
                    self.sent.clear();last_ping=time.monotonic();delay=1
                    while not self.stop_event.is_set() and self.token()==token:
                        try:
                            # Local wait only: promptly publish active task results
                            # without increasing HTTP polling or provider calls.
                            raw=socket.recv(timeout=.1 if self.jobs else .5)
                            if raw!='pong':self._receive(json.loads(raw))
                        except TimeoutError:pass
                        if time.monotonic()-last_ping>=20:socket.send('ping');last_ping=time.monotonic()
                        for identifier,item in list(self.jobs.items()):
                            computer=self.computer_factory();job=computer.jobs.get(item['local_id'])
                            if job:self._update(identifier,computer.public(job))
            except Exception as exc:
                if getattr(getattr(exc,'response',None),'status_code',None) in (401,403):
                    self.logout()
                    with self.lock:self.error='La sesión fue revocada. Inicia sesión de nuevo.'
                else:
                    with self.lock:self.error='Reconectando con tu cuenta Brivany…' if self.session else ''
            finally:
                with self.lock:self.socket=None;self.connected=False;self.pending.clear()
            self.stop_event.wait(delay);delay=min(30,delay*2)
    def close(self):
        self.closed=True;self.stop_event.set();socket=self.socket
        if socket:
            try:socket.close()
            except Exception:pass
        if self.thread and self.thread is not threading.current_thread():self.thread.join(timeout=3)
