"""Bounded native file I/O for paired, encrypted, bidirectional transfers."""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from uuid import uuid4
from urllib.request import Request,build_opener
from urllib.error import HTTPError,URLError
from packages.providers.live_voice import NoRedirect
from packages.runtime_paths import DATA_ROOT
from services.private_store import PrivateStore
from .workspace_files import MAX_FILE_BYTES,MAX_FILES,MAX_TOTAL_BYTES,BLOCK_BYTES

ORIGIN='https://brivany.vetsa.es'
BASE=ORIGIN+'/transfer/drop'
INVITE_TTL=600
SESSION_TTL=24*3600

def valid_name(name):
    return (isinstance(name,str) and 1<=len(name)<=180 and not name.startswith('.')
        and not name.endswith((' ','.')) and not any(ord(c)<32 or c in '/\\<>:"|?*' for c in name)
        and name.split('.')[0].upper() not in {'CON','PRN','AUX','NUL',*('COM'+str(i) for i in range(1,10)),*('LPT'+str(i) for i in range(1,10))})

def downloads_directory():
    root=Path.home()/'Downloads'
    if os.name=='nt':
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
                root=Path(os.path.expandvars(winreg.QueryValueEx(key,'{374DE290-123F-4565-9164-39C4925E467B}')[0]))
        except OSError:pass
    return root/'Brivany'

def safe_directory(path):
    path=Path(path).absolute()
    for parent in (path,*path.parents):
        if parent.is_symlink() or getattr(parent,'is_junction',lambda:False)():raise ValueError('La carpeta de recepción no es válida.')
    path.mkdir(parents=True,exist_ok=True);return path

class FileSource:
    def __init__(self,item,*,deferred=False):
        self.path=Path(item['path']);self.size=item['size'];self.mtime=item['mtime_ns'];self.name=item['name'];self.identifier=uuid4().hex
        if not valid_name(self.name) or type(self.size) is not int or not 0<=self.size<=MAX_FILE_BYTES:raise ValueError('El archivo admite hasta 20 GB.')
        self.stream=None;self.lock=threading.Lock()
        try:
            self.check()
            if not deferred:self.open()
        except Exception:
            if self.stream is not None:self.stream.close()
            raise
    def open(self):
        if self.stream is None:
            self.stream=self.path.open('rb')
            try:self.check()
            except Exception:self.stream.close();raise
    def check(self):
        stat=os.fstat(self.stream.fileno()) if self.stream is not None else self.path.stat()
        if stat.st_size!=self.size or stat.st_mtime_ns!=self.mtime:raise ValueError('El archivo cambió. Vuelve a añadirlo.')
    def metadata(self):return {'id':self.identifier,'name':self.name,'size':self.size}
    def read_raw(self,offset,length):
        if type(offset) is not int or type(length) is not int or not 0<=offset<=self.size or not 1<=length<=BLOCK_BYTES or offset+length>self.size:raise ValueError('Bloque de archivo no válido.')
        with self.lock:
            self.open()
            self.check();self.stream.seek(offset);data=self.stream.read(length);self.check()
            if len(data)!=length:raise ValueError('El archivo está incompleto.')
            return data
    def read(self,offset,length):return base64.b64encode(self.read_raw(offset,length)).decode('ascii')
    def close(self):
        with self.lock:
            if self.stream is not None:self.stream.close()

class FileReceiver:
    def __init__(self,meta,folder):
        if not isinstance(meta,dict) or not re.fullmatch(r'[a-f0-9]{32}',str(meta.get('id',''))) or not valid_name(meta.get('name')) or type(meta.get('size')) is not int or not 0<=meta['size']<=MAX_FILE_BYTES:raise ValueError('El archivo recibido no es válido.')
        self.meta=dict(meta);self.folder=safe_directory(folder);self.part=self.folder/('.brivany-'+uuid4().hex+'.part');self.stream=self.part.open('x+b');self.offset=0;self.lock=threading.Lock();self.finished=False
    def write(self,offset,payload,digest):
        if not isinstance(payload,str) or len(payload)>((BLOCK_BYTES+2)//3)*4:raise ValueError('Bloque de archivo no válido.')
        try:data=base64.b64decode(payload,validate=True)
        except (ValueError,binascii.Error):raise ValueError('No se pudo leer el bloque recibido.') from None
        return self.write_raw(offset,data,digest)
    def write_raw(self,offset,data,digest):
        with self.lock:
            if self.finished or type(offset) is not int or offset!=self.offset or not isinstance(data,bytes):raise ValueError('La recepción perdió su posición.')
            if not 1<=len(data)<=BLOCK_BYTES or self.offset+len(data)>self.meta['size'] or not re.fullmatch(r'[a-f0-9]{64}',str(digest)) or not secrets.compare_digest(hashlib.sha256(data).hexdigest(),str(digest)):raise ValueError('No se pudo verificar el bloque recibido.')
            self.stream.write(data);self.offset+=len(data);return {'offset':self.offset}
    def commit(self):
        with self.lock:
            if self.finished or self.offset!=self.meta['size']:raise ValueError('El archivo recibido está incompleto.')
            self.stream.flush();os.fsync(self.stream.fileno());self.stream.close()
            name=Path(self.meta['name'])
            for index in range(10000):
                candidate=self.folder/(name.name if not index else name.stem+' ('+str(index)+')'+name.suffix)
                try:
                    if os.name=='nt':os.rename(self.part,candidate)
                    else:os.link(self.part,candidate);self.part.unlink()
                    self.finished=True;return {'saved':True,'path':str(candidate),'name':candidate.name,'size':self.offset}
                except FileExistsError:continue
            raise ValueError('No se pudo guardar el archivo sin sobrescribir otro.')
    def close(self):
        with self.lock:
            if not self.stream.closed:self.stream.close()
            if not self.finished:self.part.unlink(missing_ok=True)

class OfficialDrop:
    FAILURE_CODES={'storage_unavailable','storage_full','storage_timeout','storage_failed','receiver_failed'}
    def __init__(self,folder=None,*,vault=None,publish=None,request=None,receive_folder=None,clock=time.monotonic):
        self.folder=Path(folder) if folder else DATA_ROOT/'.local/phone';self.vault=vault or PrivateStore(self.folder/'official.dpapi');self.publish=publish or (lambda value:None);self.transport=request or self._http;self.receive_folder=receive_folder or downloads_directory();self.clock=clock
        self.lock=threading.RLock();self.revision=0;self.active=False;self.closed=False;self.identifier=self.owner=self.key=self.qr=self.link=None;self.state='idle';self.failure=None;self.deadline=0;self.source=None;self.receivers={};self.saved={};self.progress=None;self.timer=None
        self.outbox=[];self.source_pending=False;self.offer_pending=False
    def _demo(self):
        from services.demo_account import current
        account=current()
        return account if account and account.status().get('demo') else None
    def configuration(self):return {'official_https':True,'local_https':False,'origin':ORIGIN,'configured':bool(self.vault.read().get('issuer_token') or self._demo()),'active':self.active,'ttl_seconds':INVITE_TTL,'max_file_bytes':MAX_FILE_BYTES,'max_files':MAX_FILES,'max_total_bytes':MAX_TOTAL_BYTES,'bidirectional':True}
    def snapshot(self):
        with self.lock:
            value={'official_https':True,'local_https':False,'origin':ORIGIN,'revision':self.revision,'active':self.active,'state':self.state,'failure':self.failure if self.state=='failed' else None,'name':self.source.name if self.source else None,'size':self.source.size if self.source else None,'expires_in':max(0,round(self.deadline-self.clock())),'qr':self.qr if self.state=='waiting' else None,'link':self.link if self.state=='waiting' else None,'transport':'drop-v2','progress':self.progress,'fingerprint':None}
            value['queued']=len(self.outbox)+int(self.source_pending)
            value['offer_pending']=self.offer_pending
            if self.active and self.state not in {'cancel_pending','cancelling','preparing'}:value['session']={'id':self.identifier,'owner':self.owner,'key':self.key,'socket':BASE.replace('https:','wss:')+'/api/'+self.identifier+'/socket','local_url':'/api/desktop/drop/'+self.identifier,'source':self.source.metadata() if self.source else None}
            return value
    def _emit(self):
        try:self.publish(self.snapshot())
        except Exception:pass
    def _http(self,method,identifier,*,token='',data=None):
        headers={'User-Agent':'BrivanyDesktop/0.1.0','Authorization':'Bearer '+token,'Cache-Control':'no-store'}
        if data is not None:data=json.dumps(data).encode();headers['Content-Type']='application/json'
        try:
            with build_opener(NoRedirect()).open(Request(BASE+'/api/'+identifier,method=method,data=data,headers=headers),timeout=5 if method=='DELETE' else 20) as response:return json.loads(response.read(4097))
        except HTTPError as error:
            if error.code==410:return {'state':'expired'}
            raise ValueError('No se pudo conectar con la transferencia de Brivany.') from None
        except (URLError,OSError,ValueError):raise ValueError('Comprueba la conexión a Internet y vuelve a intentarlo.') from None
    def _arm(self,ttl):
        if self.timer:self.timer.cancel()
        self.deadline=self.clock()+ttl;identifier=self.identifier
        def expire():
            with self.lock:
                if self.identifier!=identifier:return
            self.stop()
        self.timer=threading.Timer(ttl,expire);self.timer.daemon=True;self.timer.start()
    def share_path(self,item=None,*,locale='es'):
        from .workspace_preferences import WORKSPACE_LOCALES
        if locale not in WORKSPACE_LOCALES:raise ValueError('Elige un idioma disponible.')
        with self.lock:
            if self.active and item and (self.source_pending or self.outbox or self.offer_pending):raise ValueError('Termina o cancela el archivo actual.')
            if self.active and item and (self.state in {'sending','receiving'} or self.receivers or self.progress and self.progress['done']<self.progress['size']):raise ValueError('Termina o cancela el archivo actual.')
            if self.active and item and self.state in {'connected','sent','received','declined','failed'}:
                source=FileSource(item)
                if self.source:self.source.close()
                self.source=source;self.source_pending=True;self.progress=None;self.state='connected';self.revision+=1;self._emit();return self.snapshot()
        if self.stop()['active']:raise ValueError('Vuelve a intentar la cancelación anterior.')
        with self.lock:
            if self.closed:raise ValueError('La transferencia está cerrada.')
            issuer=self.vault.read().get('issuer_token')
            demo=self._demo() if not issuer else None
            if not issuer and not demo:raise ValueError('Falta la conexión privada con brivany.vetsa.es.')
            source=FileSource(item) if item else None;identifier=secrets.token_urlsafe(16);owner=secrets.token_urlsafe(32);claim=secrets.token_urlsafe(32);key=secrets.token_urlsafe(32)
            self.identifier=identifier;self.owner=owner;self.key=key;self.source=source;self.source_pending=source is not None;self.active=True;self.state='preparing';self.revision+=1
        self._emit()
        try:
            data={'owner_hash':hashlib.sha256(owner.encode()).hexdigest(),'claim_hash':hashlib.sha256(claim.encode()).hexdigest()}
            result=demo.call('/v1/transfers',{'id':identifier,**data}) if demo else self.transport('POST',identifier,token=issuer,data=data)
            if result.get('protocol')!=2:raise ValueError('El servicio necesita actualizarse.')
            with self.lock:
                if self.identifier!=identifier or self.closed:
                    self.transport('DELETE',identifier,token=owner);return self.snapshot()
                import segno
                self.link=BASE+'/?lang='+locale+'#'+identifier+'.'+claim+'.'+key;self.qr=segno.make_qr(self.link,error='m').png_data_uri(scale=5,border=4);self.state='waiting';self._arm(INVITE_TTL);self.revision+=1
            self._emit();return self.snapshot()
        except Exception:
            self.stop();raise ValueError('No se pudo preparar el QR de transferencia. El archivo original se conserva.') from None
    def _session(self,identifier):
        if not self.active or self.identifier!=identifier or self.state in {'cancel_pending','cancelling'}:raise ValueError('La transferencia ya terminó.')
    def enqueue(self,identifier,items):
        """Stage one bounded batch atomically; no whole-file reads or new QR."""
        if not isinstance(items,list) or not 1<=len(items)<=MAX_FILES:raise ValueError('Elige entre uno y 1.000 archivos.')
        sources=[]
        try:
            with self.lock:
                self._session(identifier)
                if self.state not in {'connected','sent','received','declined','failed'} or self.source_pending or self.outbox or self.receivers or self.offer_pending:raise ValueError('Termina o cancela el archivo actual.')
                for item in items:sources.append(FileSource(item,deferred=True))
                if sum(source.size for source in sources)>MAX_TOTAL_BYTES:raise ValueError('El envío admite hasta 20 GB en total.')
                sources[0].open()
                if self.source:self.source.close()
                self.source,*self.outbox=sources;self.source_pending=True;self.progress=None;self.state='connected';self.revision+=1
                sources=[]
        finally:
            for source in sources:source.close()
        self._emit();return self.snapshot()
    def next_source(self,identifier,source_id):
        with self.lock:
            self._session(identifier)
            if not self.source or self.source.identifier!=source_id:return self.snapshot()
            self.source.close();self.source=self.outbox.pop(0) if self.outbox else None;self.source_pending=self.source is not None
            self.state='connected' if self.source else 'sent';self.progress=None;self.revision+=1
        self._emit();return self.snapshot()
    def clear_outbox(self,identifier):
        with self.lock:
            self._session(identifier)
            if self.source:self.source.close();self.source=None
            for source in self.outbox:source.close()
            self.outbox.clear();self.source_pending=False;self.progress=None;self.revision+=1
        self._emit();return self.snapshot()
    def read(self,identifier,source,offset,length):
        with self.lock:
            self._session(identifier)
            if not self.source or self.source.identifier!=source:raise ValueError('El archivo no pertenece a esta transferencia.')
            return {'data':self.source.read(offset,length)}
    def authenticate_local(self,identifier,token):
        with self.lock:return bool(self.active and self.identifier==identifier and isinstance(token,str) and isinstance(self.owner,str) and secrets.compare_digest(token,self.owner) and self.state not in {'cancel_pending','cancelling'})
    def read_raw(self,identifier,source,offset,length):
        with self.lock:
            self._session(identifier)
            if not self.source or self.source.identifier!=source:raise ValueError('El archivo no pertenece a esta transferencia.')
            return self.source.read_raw(offset,length)
    def update(self,identifier,event):
        with self.lock:
            self._session(identifier)
            if not isinstance(event,dict):raise ValueError('Estado no válido.')
            state=event.get('state')
            if state not in {'connecting','connected','reconnecting','sending','receiving','sent','received','declined','failed'}:raise ValueError('Estado no válido.')
            if state in {'connected','sending','receiving','sent','received'} and self.state in {'waiting','connecting'}:self.qr=self.link=None;self._arm(SESSION_TTL)
            previous=self.state;self.state=state;failure=event.get('failure');self.failure=failure if state=='failed' and isinstance(failure,str) and failure in self.FAILURE_CODES else None
            if type(event.get('offer_pending')) is bool:self.offer_pending=event['offer_pending']
            elif state in {'sending','receiving','sent','received','declined','failed'}:self.offer_pending=False
            if state in {'sent','declined','failed'}:self.source_pending=False
            if state in {'declined','failed'} or state=='connected' and previous!='reconnecting':self.progress=None
            if isinstance(event.get('progress'),dict):
                p=event['progress'];size=p.get('size');done=p.get('done')
                if type(size) is int and type(done) is int and 0<=done<=size<=MAX_FILE_BYTES:self.progress={'size':size,'done':done,'name':str(p.get('name',''))[:180],'direction':'receiving' if p.get('direction')=='receiving' else 'sending'}
            self.revision+=1
        self._emit();return {'ok':True}
    def begin_receive(self,identifier,meta):
        with self.lock:
            self._session(identifier)
            if not isinstance(meta,dict):raise ValueError('El archivo recibido no es válido.')
            if meta.get('id') in self.receivers:
                receiver=self.receivers[meta['id']]
                if receiver.meta!=meta:raise ValueError('Cambió el archivo recibido.')
                return {'offset':receiver.offset}
            if len(self.receivers)>=1:raise ValueError('Termina el archivo que estás recibiendo.')
            receiver=FileReceiver(meta,self.receive_folder);self.receivers[meta['id']]=receiver;return {'offset':0}
    def write_receive(self,identifier,file_id,offset,payload,digest):
        with self.lock:
            self._session(identifier);receiver=self.receivers.get(file_id)
            if not receiver:raise ValueError('Acepta el archivo antes de recibirlo.')
            return receiver.write(offset,payload,digest)
    def finish_receive(self,identifier,file_id):
        with self.lock:
            self._session(identifier);receiver=self.receivers.get(file_id)
            if not receiver:raise ValueError('El archivo recibido ya no está disponible.')
            value=receiver.commit();self.receivers.pop(file_id);self.saved[file_id]=value['path']
            if len(self.saved)>16:self.saved.pop(next(iter(self.saved)))
            return value
    def write_receive_raw(self,identifier,file_id,offset,data,digest):
        with self.lock:
            self._session(identifier);receiver=self.receivers.get(file_id)
            if not receiver:raise ValueError('Acepta el archivo antes de recibirlo.')
            return receiver.write_raw(offset,data,digest)
    def reveal_received(self,identifier,file_id):
        with self.lock:
            self._session(identifier);path=self.saved.get(file_id)
            if not path:raise ValueError('El archivo recibido ya no está disponible.')
            from .reveal_file import reveal_file
            return reveal_file(path)
    def abort_receive(self,identifier,file_id):
        with self.lock:
            self._session(identifier);receiver=self.receivers.pop(file_id,None)
            if receiver:receiver.close()
            return {'cancelled':True}
    def stop(self):
        with self.lock:
            identifier,owner=self.identifier,self.owner
            if self.timer:self.timer.cancel();self.timer=None
            self.qr=self.link=None;self.state='cancelling';self.revision+=1
            if self.source:self.source.close();self.source=None
            for source in self.outbox:source.close()
            self.outbox.clear();self.source_pending=False;self.offer_pending=False
            for receiver in self.receivers.values():receiver.close()
            self.receivers.clear();self.progress=None
        self._emit()
        revoked=True
        if identifier:
            try:revoked=self.transport('DELETE',identifier,token=owner).get('state') in {'cancelled','expired'}
            except Exception:revoked=False
        with self.lock:
            if self.identifier!=identifier:return self.snapshot()
            self.active=not revoked;self.state='cancelled' if revoked else 'cancel_pending'
            if revoked:self.identifier=self.owner=self.key=None
            self.revision+=1
        self._emit();return self.snapshot()
    def close(self):
        with self.lock:self.closed=True
        self.stop()
