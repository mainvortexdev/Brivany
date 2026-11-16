"""Installed-app Google OAuth with PKCE and private, user-bound persistence.

No browser is opened and no request is made by construction, status or begin.
The only network destinations in this module are Google's fixed token/revoke
endpoints. Authorization must open in the external system browser, not WebView.
Loopback applies to desktop; native mobile authorization is a separate adapter.
Installed Google clients do not support include_granted_scopes incremental auth:
each connector receives its own explicit grant and stored token record.
"""
from __future__ import annotations

from base64 import urlsafe_b64encode
from contextlib import contextmanager
import ctypes
from http.client import HTTPException
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import threading
import time
from urllib import error,parse,request

AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth'
ISSUER='https://accounts.google.com'
TOKEN_URL='https://oauth2.googleapis.com/token'
REVOKE_URL='https://oauth2.googleapis.com/revoke'
CALLBACK_PATH='/api/integrations/google/callback'
PREFIX='https://www.googleapis.com/auth/'
OPERATIONS={
    'calendar.list':('calendar',PREFIX+'calendar.events.readonly'),
    'gmail.search':('gmail',PREFIX+'gmail.readonly'),
    'gmail.draft':('gmail',PREFIX+'gmail.compose'),
    'drive.search':('drive',PREFIX+'drive.metadata.readonly'),
}
DEFAULT_OPERATIONS={'calendar':['calendar.list'],'gmail':['gmail.search'],'drive':['drive.search']}
SOURCES={
    'desktop_oauth':'https://developers.google.com/identity/protocols/oauth2/native-app',
    'calendar_scopes':'https://developers.google.com/workspace/calendar/api/auth',
    'gmail_scopes':'https://developers.google.com/workspace/gmail/api/auth/scopes',
    'drive_scopes':'https://developers.google.com/workspace/drive/api/guides/api-specific-auth',
}
_LOCKS={};_LOCKS_LOCK=threading.Lock()


class GoogleOAuthError(ValueError):
    def __init__(self,code,message,status=409):self.code,self.status=code,status;super().__init__(message)


def _fail(code='google_oauth_invalid',message='La autorización Google no es válida.',status=422):
    raise GoogleOAuthError(code,message,status)


def _text(value,maximum=8192):
    if not isinstance(value,str) or not 1<=len(value)<=maximum or any(ord(c)<33 or ord(c)>126 for c in value):_fail()
    return value


def _json(value):return json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
def _sha(value):return hashlib.sha256(value.encode()).hexdigest()


def _scopes_cover(granted,required):
    allowed=set(granted)
    if PREFIX+'calendar.events' in allowed:allowed.add(PREFIX+'calendar.events.readonly')
    return set(required)<=allowed


class WindowsDPAPIProtector:
    """CryptProtectData user scope; no exportable key or machine-wide encryption."""
    name='windows_dpapi_current_user'
    available=sys.platform=='win32'
    encrypted=True

    def _apply(self,raw,*,decrypt=False):
        if not self.available:_fail('google_secret_storage_unavailable','El almacén seguro del sistema no está disponible.',503)
        if not isinstance(raw,bytes) or not 1<=len(raw)<=65536:_fail('google_secret_storage','El registro privado no es válido.',503)
        from ctypes import wintypes
        class Blob(ctypes.Structure):_fields_=[('cbData',wintypes.DWORD),('pbData',ctypes.POINTER(ctypes.c_ubyte))]
        buffer=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)));target=Blob()
        library=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
        function=library.CryptUnprotectData if decrypt else library.CryptProtectData
        function.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
        function.restype=wintypes.BOOL
        if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):
            _fail('google_secret_storage','El sistema no pudo proteger o leer la autorización privada.',503)
        try:return ctypes.string_at(target.pbData,target.cbData)
        finally:kernel.LocalFree(target.pbData)

    def protect(self,value):return self._apply(value)
    def unprotect(self,value):return self._apply(value,decrypt=True)


class GoogleOAuthHTTP:
    """Fixed endpoints, bounded form POST, TLS defaults, no redirects or retries."""
    simulation=False

    def __call__(self,url,fields):
        if url not in {TOKEN_URL,REVOKE_URL}:_fail('google_endpoint','Destino Google no permitido.',403)
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        encoded=parse.urlencode(fields).encode()
        if len(encoded)>32768:_fail()
        req=request.Request(url,data=encoded,method='POST',headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'})
        opener=request.build_opener(NoRedirect())
        try:
            with opener.open(req,timeout=15) as response:
                raw=response.read(65537)
                if len(raw)>65536:_fail('google_response','La respuesta Google excede el límite.',502)
                if url==REVOKE_URL and not raw:return {}
                value=json.loads(raw)
        except error.HTTPError as exc:
            try:
                if exc.code==400:
                    # Provider bodies, codes and tokens never enter exceptions.
                    try:value=json.loads(exc.read(4096))
                    except (ValueError,OSError):value={}
                    if isinstance(value,dict) and value.get('error')=='invalid_grant':
                        _fail('google_grant_expired','La autorización venció o fue revocada. Conecta de nuevo.',401)
                _fail('google_exchange_failed','Google no aceptó esta autorización. No se reintentó.',502)
            finally:exc.close()
        except (error.URLError,OSError,ValueError,TimeoutError,HTTPException):
            _fail('google_exchange_failed','No se pudo completar la conexión con Google. No se reintentó.',502)
        if not isinstance(value,dict):_fail('google_response','Google devolvió una respuesta no válida.',502)
        return value


class GoogleOAuthService:
    def __init__(self,root,*,base_url,env=None,transport=None,now=None,protector=None):
        try:
            if not isinstance(base_url,str):raise ValueError()
            parsed=parse.urlsplit(base_url);port=parsed.port
        except (ValueError,TypeError):_fail('google_loopback','Google necesita el origen loopback propio de Brivany.',422)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not port or parsed.path not in {'','/'} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            _fail('google_loopback','Google necesita el origen loopback propio de Brivany.',422)
        self.redirect_uri=base_url.rstrip('/')+CALLBACK_PATH
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root:_fail('google_storage','El almacén privado no puede redirigirse.',503)
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.database=self.root/'google-oauth.sqlite3'
        if self.database.resolve()!=self.database:_fail('google_storage','El almacén privado no puede redirigirse.',503)
        self.env=dict(os.environ if env is None else env);self.transport=transport or GoogleOAuthHTTP();self.now=now or time.time
        self.protector=protector or WindowsDPAPIProtector()
        with _LOCKS_LOCK:self.lock=_LOCKS.setdefault(str(self.database),threading.RLock())
        with self._db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS google_generations(connector TEXT PRIMARY KEY,generation INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS google_pending(state_hash TEXT PRIMARY KEY,connector TEXT UNIQUE NOT NULL,generation INTEGER NOT NULL,expires_at REAL NOT NULL,private BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS google_tokens(connector TEXT PRIMARY KEY,generation INTEGER NOT NULL,private BLOB NOT NULL);''')
        if os.name!='nt':os.chmod(self.database,0o600)

    @contextmanager
    def _db(self):
        if self.database.resolve()!=self.database:_fail('google_storage','El almacén privado no puede redirigirse.',503)
        db=sqlite3.connect(self.database,timeout=20,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA trusted_schema=OFF');db.execute('BEGIN IMMEDIATE');yield db
            if db.in_transaction:db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def _configuration(self):
        client=self.env.get('BRIVANY_GOOGLE_CLIENT_ID','').strip();secret=self.env.get('BRIVANY_GOOGLE_CLIENT_SECRET','').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{5,250}\.apps\.googleusercontent\.com',client):
            _fail('google_client_missing','Configura un cliente OAuth de tipo Desktop app para Google.',503)
        if secret:_text(secret,1024)
        return client,secret

    def _pack(self,value):
        if not self.protector.available:_fail('google_secret_storage_unavailable','Configura el almacén seguro del sistema antes de conectar Google.',503)
        return self.protector.protect(_json(value))

    def _unpack(self,raw):
        try:
            value=json.loads(self.protector.unprotect(bytes(raw)))
            if not isinstance(value,dict):raise ValueError()
            return value
        except GoogleOAuthError:raise
        except (OSError,ValueError,TypeError):_fail('google_secret_storage','No se pudo leer la autorización privada.',503)

    def _connector(self,connector):
        if not isinstance(connector,str) or connector not in DEFAULT_OPERATIONS:_fail('google_connector','Conector Google no admitido.',422)
        return connector

    def _load_token(self,db,connector):
        row=db.execute('SELECT * FROM google_tokens WHERE connector=?',(connector,)).fetchone()
        if not row:return None
        value=self._unpack(row['private'])
        try:
            if set(value)!={'access_token','refresh_token','expires_at','scopes','simulated','client_sha256'}:raise ValueError()
            _text(value['access_token'],16384);_text(value['refresh_token'],16384)
            if type(value['expires_at']) not in (int,float) or not math.isfinite(value['expires_at']) or type(value['simulated']) is not bool:raise ValueError()
            expected={scope for owner,scope in OPERATIONS.values() if owner==connector}
            # Keep existing broader Calendar records usable for reads only.
            if connector=='calendar':expected.add(PREFIX+'calendar.events')
            if not isinstance(value['scopes'],list) or not value['scopes'] or any(not isinstance(scope,str) or scope not in expected for scope in value['scopes']):raise ValueError()
            if not isinstance(value['client_sha256'],str) or not re.fullmatch('[0-9a-f]{64}',value['client_sha256']):raise ValueError()
        except (ValueError,GoogleOAuthError):_fail('google_secret_storage','El registro privado no cumple el contrato.',503)
        value['_generation']=row['generation'];return value

    def _next_generation(self,db,connector):
        db.execute('INSERT INTO google_generations VALUES(?,1) ON CONFLICT(connector) DO UPDATE SET generation=generation+1',(connector,))
        return db.execute('SELECT generation FROM google_generations WHERE connector=?',(connector,)).fetchone()[0]

    def _save(self,db,connector,generation,value):
        current=db.execute('SELECT generation FROM google_generations WHERE connector=?',(connector,)).fetchone()
        if not current or current[0]!=generation:_fail('google_flow_replaced','Esta autorización fue sustituida. Usa la conexión más reciente.',409)
        db.execute('INSERT INTO google_tokens VALUES(?,?,?) ON CONFLICT(connector) DO UPDATE SET generation=excluded.generation,private=excluded.private',(connector,generation,self._pack(value)))

    def begin(self,connector,operations=None):
        self._connector(connector);client,secret=self._configuration()
        operations=DEFAULT_OPERATIONS[connector] if operations is None else operations
        if not isinstance(operations,list) or not operations or len(operations)>3 or any(not isinstance(op,str) or op not in OPERATIONS or OPERATIONS[op][0]!=connector for op in operations) or len(set(operations))!=len(operations):
            _fail('google_scopes','Selecciona sólo las operaciones necesarias de este conector.',422)
        scopes=sorted({OPERATIONS[op][1] for op in operations})
        state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
        challenge=urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')
        expiry=self.now()+300
        private=self._pack({'verifier':verifier,'client_sha256':_sha(client),'redirect_uri':self.redirect_uri,'scopes':scopes})
        with self.lock,self._db() as db:
            db.execute('DELETE FROM google_pending WHERE expires_at<=?',(self.now(),));generation=self._next_generation(db,connector)
            db.execute('DELETE FROM google_pending WHERE connector=?',(connector,))
            db.execute('INSERT INTO google_pending VALUES(?,?,?,?,?)',(_sha(state),connector,generation,expiry,private))
        url=AUTH_URL+'?'+parse.urlencode({'client_id':client,'response_type':'code','redirect_uri':self.redirect_uri,'scope':' '.join(scopes),
            'state':state,'code_challenge':challenge,'code_challenge_method':'S256','access_type':'offline','prompt':'consent'})
        return {'authorization_url':url,'connector':connector,'scopes':scopes,'expires_at':expiry,'requires_external_browser':True,
            'pkce':'S256','incremental_authorization_supported':False,'automatic_browser_opened':False,'network_requests':0}

    def _token_response(self,value,requested,*,refresh=None):
        if not isinstance(value,dict):_fail('google_response','Google devolvió una respuesta no válida.',502)
        try:
            access=_text(value.get('access_token'),16384)
            expires=value.get('expires_in')
            if type(expires) is not int or not 1<=expires<=86400 or str(value.get('token_type','')).lower()!='bearer':raise ValueError()
            actual=value.get('scope')
            if actual is None and refresh:scopes=refresh['scopes']
            elif isinstance(actual,str):scopes=sorted(set(actual.split()))
            else:raise ValueError()
            if not scopes or not set(scopes)<=set(requested):raise ValueError()
            refreshed=value.get('refresh_token') or (refresh.get('refresh_token') if refresh else None)
            _text(refreshed,16384)
        except (GoogleOAuthError,ValueError,TypeError):_fail('google_response','Google no devolvió un permiso o token válido para este conector.',502)
        return {'access_token':access,'refresh_token':refreshed,'expires_at':self.now()+expires,'scopes':scopes,
            'simulated':bool(getattr(self.transport,'simulation',False)),'client_sha256':_sha(self._configuration()[0])}

    def finish(self,query):
        if not isinstance(query,dict) or set(query)-{'code','state','scope','error','authuser','prompt','hd','iss'}:_fail()
        normalized={}
        for key,value in query.items():
            if isinstance(value,list):
                if len(value)!=1:_fail()
                value=value[0]
            if not isinstance(value,str) or len(value)>8192 or any(ord(char)<32 for char in value):_fail()
            normalized[key]=value
        # Validate Google's RFC 9207 issuer before claiming state. Legacy
        # callbacks without iss retain the fixed endpoint and PKCE binding.
        if 'iss' in normalized and normalized['iss']!=ISSUER:
            _fail('google_issuer','El emisor de la autorización no es Google.',403)
        state=normalized.get('state')
        if not isinstance(state,str) or not re.fullmatch('[A-Za-z0-9_-]{43}',state):_fail('google_state','Esta conexión no tiene una solicitud válida.',403)
        # Claim is committed before exchange. An interrupted/failed exchange
        # cannot silently reuse the authorization code or PKCE verifier.
        with self.lock,self._db() as db:
            row=db.execute('SELECT * FROM google_pending WHERE state_hash=?',(_sha(state),)).fetchone()
            if not row:_fail('google_state','La solicitud venció, ya fue usada o no pertenece a esta aplicación.',403)
            db.execute('DELETE FROM google_pending WHERE state_hash=?',(_sha(state),))
        if row['expires_at']<=self.now():_fail('google_state_expired','La solicitud Google venció. Inicia una conexión nueva.',403)
        pending=self._unpack(row['private']);client,secret=self._configuration()
        if pending['redirect_uri']!=self.redirect_uri or pending['client_sha256']!=_sha(client):_fail('google_flow_changed','El origen o cliente cambió. Inicia la conexión de nuevo.',403)
        if normalized.get('error'):_fail('google_consent_denied','No se concedió la autorización Google.',403)
        code=_text(normalized.get('code'),4096)
        fields={'client_id':client,'code':code,'code_verifier':pending['verifier'],'redirect_uri':self.redirect_uri,'grant_type':'authorization_code'}
        if secret:fields['client_secret']=secret
        value=self._token_response(self.transport(TOKEN_URL,fields),pending['scopes'])
        with self.lock,self._db() as db:self._save(db,row['connector'],row['generation'],value)
        return self.status(row['connector'])

    def status(self,connector=None):
        if connector is not None:self._connector(connector)
        try:self._configuration();configured=True
        except GoogleOAuthError:configured=False
        result=[]
        with self.lock,self._db() as db:
            for key in ([connector] if connector else DEFAULT_OPERATIONS):
                value=self._load_token(db,key);client_matches=bool(value and configured and value['client_sha256']==_sha(self._configuration()[0]))
                granted=value['scopes'] if client_matches else []
                operations=[]
                for operation,(owner,scope) in OPERATIONS.items():
                    accepted={scope}
                    if operation=='calendar.list':accepted.add(PREFIX+'calendar.events')
                    if owner==key and accepted.intersection(granted):operations.append(operation)
                authorized=bool(client_matches and value.get('refresh_token'))
                result.append({'connector':key,'configured':configured,'authorized':authorized,'connected':authorized and not value['simulated'],
                    'simulated':bool(value and value['simulated']),'granted_scopes':granted,'authorized_operations':operations,
                    'access_token_expires_at':value['expires_at'] if client_matches else None,'refresh_token_saved':authorized,
                    'pending':bool(db.execute('SELECT 1 FROM google_pending WHERE connector=? AND expires_at>?',(key,self.now())).fetchone()),
                    'real_oauth_exchange':authorized and not value['simulated'],'provider_api_verified':False})
        return {'connectors':result,'client_configured':configured,'storage':{'protection':self.protector.name,'available':self.protector.available,'encrypted':self.protector.encrypted},
            'desktop_loopback_only':True,'requires_external_browser':True,'incremental_authorization_supported':False,'sources':SOURCES}

    def access_token(self,connector,*,required_scopes=()):
        """Backend-only credential accessor. Never expose its return in HTTP DTOs."""
        self._connector(connector);client,secret=self._configuration()
        if not isinstance(required_scopes,(list,tuple,set)) or any(not isinstance(scope,str) for scope in required_scopes):_fail()
        with self.lock,self._db() as db:
            value=self._load_token(db,connector)
            if not value or value['client_sha256']!=_sha(client):_fail('google_not_connected','Conecta primero esta cuenta Google.',401)
            if not _scopes_cover(value['scopes'],required_scopes):_fail('google_scope_missing','Autoriza primero los permisos de esta operación.',403)
            if value['expires_at']>self.now()+45:return value['access_token']
            fields={'client_id':client,'grant_type':'refresh_token','refresh_token':value['refresh_token']}
            if secret:fields['client_secret']=secret
            try:refreshed=self._token_response(self.transport(TOKEN_URL,fields),value['scopes'],refresh=value)
            except GoogleOAuthError as exc:
                if exc.code=='google_grant_expired':
                    # A revocation is persisted without rolling back this cleanup.
                    db.execute('DELETE FROM google_tokens WHERE connector=?',(connector,));db.execute('COMMIT')
                raise
            # A new consent request can be pending while the previous grant
            # remains usable. Refresh that token generation; do not replace the
            # new pending flow's generation or reinstate a disconnected grant.
            db.execute('UPDATE google_tokens SET private=? WHERE connector=? AND generation=?',
                (self._pack(refreshed),connector,value['_generation']))
            if not _scopes_cover(refreshed['scopes'],required_scopes):_fail('google_scope_missing','Google no mantuvo los permisos solicitados.',403)
            return refreshed['access_token']

    def disconnect(self,connector,*,revoke=True):
        self._connector(connector)
        if type(revoke) is not bool:_fail()
        with self.lock,self._db() as db:
            value=self._load_token(db,connector)
            # Google's revocation endpoint can invalidate every grant for this
            # OAuth project, not just one scope. Clear all grants held here and
            # invalidate their pending exchanges before requesting revocation.
            affected=list(DEFAULT_OPERATIONS) if revoke and value else [connector]
            for owner in affected:
                self._next_generation(db,owner)
                db.execute('DELETE FROM google_pending WHERE connector=?',(owner,))
                db.execute('DELETE FROM google_tokens WHERE connector=?',(owner,))
        accepted=False;error_code=None;attempted=bool(revoke and value)
        if revoke and value:
            try:self.transport(REVOKE_URL,{'token':value['refresh_token']});accepted=True
            except GoogleOAuthError as exc:error_code=exc.code
            except (OSError,TimeoutError,HTTPException):error_code='google_revocation_unknown'
        return {'connector':connector,'local_credentials_removed':True,'removed_local_connectors':affected,
            'revocation_requested':attempted,'revocation_request_accepted':accepted,'revocation_error_code':error_code,
            'connected':False,'other_google_grants_may_be_revoked':attempted}
