"""Official-domain file delivery. Plaintext and AES key never reach the relay."""
import base64
import hashlib
import json
from pathlib import Path
import secrets
import threading
import time
from urllib.error import HTTPError,URLError
from urllib.request import Request,build_opener
from packages.runtime_paths import DATA_ROOT
from packages.providers.live_voice import NoRedirect
from services.private_store import PrivateStore
from .workspace_files import INLINE_BYTES as MAX_FILE_BYTES

ORIGIN='https://brivany.vetsa.es'
BASE=ORIGIN+'/transfer'
TTL=300


def seal(identifier,name,data,key=None,nonce=None):
 from cryptography.hazmat.primitives.ciphers.aead import AESGCM
 key=key or AESGCM.generate_key(bit_length=256);nonce=nonce or secrets.token_bytes(12);label=name.encode('utf-8')
 if not 1<=len(label)<=720 or len(data)>MAX_FILE_BYTES:raise ValueError('El archivo supera los límites del envío.')
 plain=len(label).to_bytes(2,'big')+label+data
 return key,nonce+AESGCM(key).encrypt(nonce,plain,('Brivany-transfer-v1:'+identifier).encode('ascii'))


class OfficialTransfer:
 def __init__(self,folder=None,*,publish=None,clock=time.monotonic,request=None,vault=None,ttl=TTL,poll_interval=3):
  self.folder=Path(folder) if folder else DATA_ROOT/'.local/phone';self.vault=vault or PrivateStore(self.folder/'official.dpapi')
  self.publish=publish or (lambda value:None);self.clock=clock;self.ttl=min(ttl,TTL);self.poll_interval=poll_interval;self.transport=request or self._http
  self.lock=threading.RLock();self.revision=0;self.generation=0;self.closed=False;self.active=False;self.state='idle';self.timer=None;self.stop_poll=threading.Event()
  self.identifier=self.owner=self.claim=self.key=self.qr=self.link=self.name=None;self.size=0;self.deadline=0
 def configuration(self):
  value=self.vault.read();return {'official_https':True,'local_https':False,'origin':ORIGIN,'configured':bool(value.get('issuer_token')),'active':self.active,'ttl_seconds':self.ttl}
 def snapshot(self):
  with self.lock:return {'official_https':True,'local_https':False,'origin':ORIGIN,'revision':self.revision,'active':self.active,'state':self.state,'name':self.name if self.active else None,'size':self.size if self.active else None,'expires_in':max(0,round(self.deadline-self.clock())) if self.active else 0,'qr':self.qr if self.active and self.state=='waiting' else None,'link':self.link if self.active and self.state=='waiting' else None,'fingerprint':None}
 def _emit(self):
  try:self.publish(self.snapshot())
  except Exception:pass
 def _http(self,method,identifier,action='',*,token='',data=None):
  headers={'User-Agent':'BrivanyDesktop/0.1.0','Authorization':'Bearer '+token,'Cache-Control':'no-store'}
  if isinstance(data,dict):data=json.dumps(data,separators=(',',':')).encode();headers['Content-Type']='application/json'
  elif data is not None:headers['Content-Type']='application/octet-stream'
  try:
   with build_opener(NoRedirect()).open(Request(BASE+'/api/'+identifier+('/'+action if action else ''),method=method,data=data,headers=headers),timeout=5 if method=='DELETE' else 25) as response:
    if response.geturl()!=BASE+'/api/'+identifier+('/'+action if action else ''):raise ValueError('La transferencia cambió de destino.')
    return json.loads(response.read(4097))
  except HTTPError as error:
   if error.code==410:return {'state':'expired'}
   raise ValueError('No se pudo completar el envío en brivany.vetsa.es. Vuelve a intentarlo.') from None
  except (URLError,OSError,ValueError):raise ValueError('No se pudo conectar con brivany.vetsa.es. Comprueba Internet y vuelve a intentarlo.') from None
 def _current(self,generation):
  with self.lock:return self.active and not self.closed and self.generation==generation
 def _revoke(self,identifier,owner):
  if identifier and owner:
   try:return self.transport('DELETE',identifier,token=owner).get('state') in {'cancelled','expired'}
   except Exception:return False
  return True
 def share(self,name,data,*,locale='es'):
  if not isinstance(name,str) or not 1<=len(name)<=180 or any(ord(char)<32 or char in '/\\"' for char in name) or not isinstance(data,bytes) or len(data)>MAX_FILE_BYTES:raise ValueError('Elige un archivo de hasta 8 MiB.')
  from .workspace_preferences import WORKSPACE_LOCALES
  if locale not in WORKSPACE_LOCALES:raise ValueError('Elige un idioma disponible.')
  if self.stop()['active']:raise ValueError('No pude confirmar la cancelación anterior. Vuelve a intentarlo antes de generar otro QR.')
  value=self.vault.read();issuer=value.get('issuer_token')
  if not issuer:raise ValueError('La conexión de archivos con brivany.vetsa.es todavía no está configurada.')
  identifier=secrets.token_urlsafe(16);owner=secrets.token_urlsafe(32);claim=secrets.token_urlsafe(32);key,box=seal(identifier,name,data)
  with self.lock:
   if self.closed:raise ValueError('La transferencia está cerrada.')
   self.generation+=1;generation=self.generation;self.active=True;self.state='uploading';self.identifier,self.owner,self.name,self.size=identifier,owner,name,len(data);self.deadline=self.clock()+self.ttl;self.stop_poll=threading.Event();self.revision+=1
  self._emit()
  try:
   result=self.transport('POST',identifier,token=issuer,data={'claim_hash':hashlib.sha256(claim.encode()).hexdigest(),'owner_hash':hashlib.sha256(owner.encode()).hexdigest()})
   if not self._current(generation):self._revoke(identifier,owner);return self.snapshot()
   with self.lock:self.deadline=self.clock()+self.ttl
   result=self.transport('PUT',identifier,'payload',token=owner,data=box)
   if result.get('state')!='waiting':raise ValueError('El enlace de descarga ya no está disponible.')
   with self.lock:
    if not self._current(generation):self._revoke(identifier,owner);return self.snapshot()
    remaining=self.deadline-self.clock()
    if remaining<=0:raise ValueError('La preparación tardó demasiado. Vuelve a generar el QR.')
    import segno
    encoded=base64.urlsafe_b64encode(key).decode().rstrip('=');self.link=BASE+'/?lang='+locale+'#'+identifier+'.'+claim+'.'+encoded
    self.qr=segno.make_qr(self.link,error='m').png_data_uri(scale=5,border=4);self.state='waiting';self.revision+=1
    self.timer=threading.Timer(remaining,lambda:self.expire(generation));self.timer.daemon=True;self.timer.start();signal=self.stop_poll
   self._emit();threading.Thread(target=self._poll,args=(generation,identifier,owner,signal),daemon=True,name='brivany-official-transfer').start();return self.snapshot()
  except Exception:
   self._revoke(identifier,owner)
   if self._current(generation):self.stop();raise ValueError('No se pudo preparar el QR en brivany.vetsa.es. El archivo original se conserva.') from None
   return self.snapshot()
 def _poll(self,generation,identifier,owner,signal):
  while not signal.wait(self.poll_interval) and self._current(generation):
   try:result=self.transport('GET',identifier,token=owner)
   except ValueError:continue
   state=result.get('state')
   if state=='expired':self.expire(generation,force=True);return
   if state not in {'waiting','connected','sent'}:continue
   with self.lock:
    if not self._current(generation):return
    changed=state!=self.state
    if changed:self.state=state;self.revision+=1
    if state!='waiting':self.link=self.qr=None
   if changed:self._emit()
   if state=='sent':return
 def stop(self):
  with self.lock:
   identifier,owner=self.identifier,self.owner;self.active=bool(identifier);self.state='cancelling' if identifier else 'cancelled';self.generation+=1;generation=self.generation;self.revision+=1;self.stop_poll.set()
   self.claim=self.key=self.qr=self.link=None
   timer,self.timer=self.timer,None
  if timer:timer.cancel()
  self._emit();revoked=self._revoke(identifier,owner)
  with self.lock:
   if generation!=self.generation:return self.snapshot()
   if revoked:
    self.identifier=self.owner=self.name=None;self.size=0;self.active=False;self.state='cancelled'
   else:
    self.state='cancel_pending';self.timer=threading.Timer(max(1,self.deadline-self.clock()+1),lambda:self.expire(generation));self.timer.daemon=True;self.timer.start()
   self.revision+=1
  self._emit();return self.snapshot()
 def expire(self,generation,force=False):
  with self.lock:
   if self.generation!=generation or not self.active or not force and self.clock()<self.deadline:return
  self.stop()
  with self.lock:
   if self.timer:self.timer.cancel();self.timer=None
   self.active=False;self.identifier=self.owner=self.name=None;self.size=0;self.state='expired';self.revision+=1
  self._emit()
 def close(self):
  with self.lock:self.closed=True
  self.stop()
