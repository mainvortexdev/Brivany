"""Optional private-install demo entitlement, isolated from personal Vetsa login.

The bootstrap has a limited invitation, never Meta/Cartesia/Deepgram keys.
Session tokens are protected by Windows DPAPI and never exposed to the renderer.
"""
from pathlib import Path
import json
import os
import re
import threading
from urllib.request import Request,build_opener
from urllib.error import HTTPError,URLError
from uuid import uuid4
from services.brivany_account import NoRedirect,SecureAccountFile
from packages.providers.provider_access import DEMO_ORIGIN

class DemoError(ValueError):pass

class DemoHTTP:
    def call(self,path,body=None,token=None):
        if path not in {'/v1/activate','/v1/account','/v1/telnyx/connect','/v1/telnyx/status','/v1/calls'} and not re.fullmatch(r'/v1/calls/[a-f0-9-]{36}(?:/cancel)?',path):raise DemoError('Solicitud de demostración no válida.')
        headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'Brivany-Desktop/0.2.1','Cache-Control':'no-store'}
        if token:headers['Authorization']='Bearer '+token
        request=Request(DEMO_ORIGIN+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method='GET' if body is None else 'POST')
        try:
            with build_opener(NoRedirect()).open(request,timeout=30) as response:
                raw=response.read(65537)
                if len(raw)>65536:raise DemoError('La respuesta de la demostración excedió el límite.')
                return json.loads(raw)
        except HTTPError as error:
            status=error.code
            try:value=json.loads(error.read(8192))
            except (ValueError,OSError):value={}
            finally:error.close()
            code=value.get('error','');message=value.get('message','')
            safe=code.startswith('telnyx_') or code in {'call_active','demo_budget_exhausted'}
            failure=DemoError(message[:300] if safe and isinstance(message,str) and message else 'El acceso de demostración no está disponible. Contacta con Daniel.');failure.http_status=status
            raise failure from None
        except (OSError,URLError,ValueError):raise DemoError('No se pudo conectar con la cuenta de demostración.') from None

class DemoAccount:
    def __init__(self,data_root,*,http=None,store=None):
        self.root=Path(data_root)/'.local/demo';self.http=http or DemoHTTP();self.store=store or SecureAccountFile(self.root/'session.dpapi');self.lock=threading.RLock();self.session=None;self.message=''
        try:self.session=self.store.load()
        except (OSError,ValueError):self.message='No se pudo abrir la cuenta de demostración.'
    def activate(self,bootstrap):
        if set(bootstrap)-{'schema','origin','invitation','account_name'} or bootstrap.get('schema')!=1 or bootstrap.get('origin')!=DEMO_ORIGIN or not isinstance(bootstrap.get('invitation'),str) or not 32<=len(bootstrap['invitation'])<=128:raise DemoError('La invitación de demostración no es válida.')
        if self.session:return self.refresh()
        self.root.mkdir(parents=True,exist_ok=True);device=self.root/'device.json'
        if device.exists():device_id=json.loads(device.read_text())['id']
        else:device_id=str(uuid4());device.write_text(json.dumps({'id':device_id}))
        value=self.http.call('/v1/activate',{'invitation':bootstrap['invitation'],'deviceId':device_id});self._save(value);return self.status()
    def _save(self,value):
        if not isinstance(value,dict) or value.get('account',{}).get('demo') is not True or value.get('account',{}).get('id')!='jon-demo' or value.get('enabled') is not True or not re.fullmatch(r'[A-Za-z0-9_-]{43}',value.get('token','')):raise DemoError('La sesión de demostración recibida no es válida.')
        with self.lock:self.store.save(value);self.session=value;self.message=''
    def refresh(self):
        with self.lock:session=self.session
        if not session:return self.status()
        value=self.http.call('/v1/account',token=session['token']);self._save({**value,'token':session['token']});return self.status()
    def status(self):
        with self.lock:
            value=self.session or {};return {'demo':bool(self.session),'account':value.get('account'),'budget_usd':value.get('budget_usd'),'remaining_usd':value.get('remaining_usd'),'expires_at':value.get('expires_at'),'voice_session_seconds':value.get('voice_session_seconds'),'message':self.message}
    def apply(self):
        with self.lock:session=self.session
        if not session:return False
        token=session['token'];os.environ.update({'BRIVANY_DEMO_ORIGIN':DEMO_ORIGIN,'BRIVANY_DEMO_SESSION':token,'BRIVANY_META_API_KEY':token,'BRIVANY_MUSE_API_KEY':token,'BRIVANY_META_MODEL':'muse-spark-1.3','BRIVANY_HUMAN_SKILLS_MODEL':'muse-spark-1.3','BRIVANY_CARTESIA_API_KEY':token,'BRIVANY_DEEPGRAM_API_KEY':token,'BRIVANY_META_BASE_URL':DEMO_ORIGIN+'/proxy/meta/v1'})
        return True
    def call(self,path,body=None):
        with self.lock:token=(self.session or {}).get('token')
        if not token:raise DemoError('Activa la cuenta de demostración.')
        return self.http.call(path,body,token)

_current=None
def current():return _current
def start_private_demo(app_root,data_root):
    global _current
    file=Path(app_root)/'desktop/distribution/demo-bootstrap.json'
    if not file.is_file():return None
    if file.stat().st_size>4096:raise DemoError('La invitación de demostración excedió el límite.')
    account=DemoAccount(data_root);_current=account
    try:
        account.activate(json.loads(file.read_text(encoding='utf-8')));account.apply()
        from services.assistant_identity import AssistantIdentity
        identity_root=Path(data_root)/'.local/computer'
        if not (identity_root/'assistant-identity.dpapi').exists():AssistantIdentity(identity_root).configure('Equipo de Jon')
    except (DemoError,OSError,ValueError) as error:account.message=str(error) if isinstance(error,DemoError) else 'No se pudo activar la demostración.'
    return account
