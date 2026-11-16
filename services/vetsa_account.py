"""Shared Vetsa identity; isolated desktop sign-in, PKCE, DPAPI, no remote tools.

Passwords, PINs and passkeys stay in the isolated account window. Only a one-use
code returns to the app. No credential is exposed to the renderer or local HTTP API.
"""
from __future__ import annotations
import base64
from datetime import datetime
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import threading
import time
from urllib import error, parse, request
from services.brivany_account import AccountFailure, NoRedirect, SecureAccountFile

ORIGIN='https://cognira.vetsa.es'
PORT=41416
CALLBACK=f'http://127.0.0.1:{PORT}/auth'
PATHS={'/api/auth/desktop/token','/api/brivany/account/session','/api/brivany/account/refresh','/api/brivany/account/logout','/api/brivany/account/security'}


class IdentityHTTP:
    def call(self,path,body=None,token=None):
        if path not in PATHS:raise AccountFailure('Ruta de cuenta no permitida.')
        headers={'Accept':'application/json','Cache-Control':'no-store','User-Agent':'Brivany-Desktop/0.1'}
        if token:headers['Authorization']='Bearer '+token
        if body is not None:headers['Content-Type']='application/json'
        req=request.Request(ORIGIN+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method='GET' if body is None else 'POST')
        try:
            with request.build_opener(NoRedirect()).open(req,timeout=15) as response:
                raw=response.read(131073)
                if len(raw)>131072:raise ValueError()
                value=json.loads(raw)
                if not isinstance(value,dict):raise ValueError()
                return value
        except error.HTTPError as exc:
            code=exc.code;exc.close()
            failure=AccountFailure('La sesión venció o fue revocada. Inicia sesión de nuevo.' if code in (401,403) else 'El servicio de cuentas no está disponible. Inténtalo de nuevo.')
            failure.unauthorized=code in (401,403)
            raise failure from None
        except (ValueError,OSError,error.URLError):raise AccountFailure('No se pudo conectar con tu cuenta Vetsa.') from None


def expiry(value):
    try:
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
        if result.tzinfo is None:raise ValueError()
        return result.timestamp()
    except (ValueError,TypeError,AttributeError):raise AccountFailure('La sesión Vetsa no es válida.') from None


class VetsaAccount:
    def __init__(self,root,*,http=None,store=None,open_window=None,now=None,port=PORT,test=False):
        if port!=PORT and not test:raise ValueError('Puerto de identidad no permitido.')
        self.root=Path(root);self.http=http or IdentityHTTP();self.store=store or SecureAccountFile(self.root/'session.dpapi')
        self.open_window=open_window;self.now=now or time.time;self.port=port;self.lock=threading.RLock()
        self.session=None;self.pending=None;self.server=None;self.window=None;self.message='';self.validated=False
        self.resource_generation=None;self.closing=False
        self.stop=threading.Event();self.thread=None;self.generation=0;self.security_state=None;self.management_windows=[]
        try:
            saved=self.store.load()
            if saved:self.session=self._session(saved)
        except Exception:self.message='Inicia sesión para recuperar el acceso a tu cuenta Vetsa.'

    def _session(self,value):
        if not isinstance(value,dict) or value.get('client')!='brivany-desktop':raise AccountFailure('Sesión incompatible.')
        user=value.get('user');token=value.get('token')
        if not isinstance(user,dict) or not isinstance(token,str) or not 20<=len(token)<=16384 or any(c.isspace() for c in token):raise AccountFailure('Sesión no válida.')
        if any(not isinstance(user.get(k),str) or not user[k] or len(user[k])>254 for k in ('id','name','email')):raise AccountFailure('Identidad no válida.')
        if expiry(value.get('expiresAt'))<=self.now():raise AccountFailure('La sesión venció. Inicia sesión de nuevo.')
        return {'client':'brivany-desktop','token':token,'expiresAt':value['expiresAt'],'user':{k:user[k] for k in ('id','name','email')}}

    def status(self):
        with self.lock:
            active=bool(self.session and expiry(self.session['expiresAt'])>self.now())
            return {'signed_in':active,'account':dict(self.session['user']) if active else None,'provider':'Vetsa',
                    'remote_enabled':False,'connected':active and self.validated,'pending':bool(self.pending),
                    'error':self.message,'security':dict(self.security_state) if active and self.security_state else None,
                    'expires_at':self.session['expiresAt'] if active else None}

    def call_whatsapp(self,path,body=None,*,http=None):
        """Forward only a typed channel request under the current account session."""
        from services.whatsapp_cloud import WhatsAppCloudHTTP,MeetingsHTTP,PATHS,MEETING_PATHS
        from urllib.parse import urlsplit
        is_meeting=urlsplit(path).path in MEETING_PATHS
        if (is_meeting and not MeetingsHTTP().allowed(path)) or (not is_meeting and path not in PATHS) or path=='/number':raise AccountFailure('Acción de WhatsApp no permitida.')
        with self.lock:
            session=self.session;generation=self.generation
            if not session or expiry(session['expiresAt'])<=self.now():raise AccountFailure('Inicia sesión en tu cuenta Vetsa de Brivany.')
            token=session['token'];user_id=session['user']['id']
        result=(http or (MeetingsHTTP() if is_meeting else WhatsAppCloudHTTP())).call(path,body,token)
        with self.lock:
            if self.generation!=generation or not self.session or self.session['user']['id']!=user_id:raise AccountFailure('La cuenta cambió durante la solicitud. Vuelve a intentarlo.')
        return result

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():return
            self.stop.clear();self.thread=threading.Thread(target=self._monitor,daemon=True,name='vetsa-account');self.thread.start()

    def _monitor(self):
        while not self.stop.is_set():
            try:self.refresh()
            except AccountFailure:pass
            self.stop.wait(300)

    def refresh(self):
        with self.lock:session=self.session;generation=self.generation
        if not session:return self.status()
        try:
            if expiry(session['expiresAt'])<=self.now():raise AccountFailure('La sesión venció. Inicia sesión de nuevo.')
            if expiry(session['expiresAt'])-self.now()<86400:
                renewed=self.http.call('/api/brivany/account/refresh',{},session['token'])
                if renewed.get('user',{}).get('id')!=session['user']['id']:raise AccountFailure('La renovación no corresponde a tu cuenta.')
                session=self._session({**renewed,'client':'brivany-desktop'})
            verified=self.http.call('/api/brivany/account/session',token=session['token'])
            if verified.get('authenticated') is not True or verified.get('client')!='brivany-desktop' or verified.get('user',{}).get('id')!=session['user']['id']:
                raise AccountFailure('La identidad recibida no corresponde a tu sesión.')
            updated=self._session({**verified,'token':session['token']})
            security=self.http.call('/api/brivany/account/security',token=session['token'])
            clean_security={'email_verified':security.get('emailVerified') is True,'three_auth':security.get('threeAuth') is True,
                            'email_alerts':security.get('emailAlerts') is True,'passkeys':len(security.get('passkeys',[])) if isinstance(security.get('passkeys'),list) else 0}
            with self.lock:
                if self.generation!=generation or not self.session:return self.status()
                self.store.save(updated);self.session=updated;self.security_state=clean_security;self.validated=True;self.message=''
        except (AccountFailure,OSError) as failure:
            exc=failure if isinstance(failure,AccountFailure) else AccountFailure('No se pudo guardar la sesión cifrada en este equipo.')
            with self.lock:
                if generation!=self.generation:return self.status()
                self.validated=False;self.message=str(exc)
                if getattr(exc,'unauthorized',False) or expiry(session['expiresAt'])<=self.now():
                    self.session=None;self.security_state=None;self.store.clear();self.generation+=1
            raise exc from None
        return self.status()

    def login(self,*args,**kwargs):
        raise AccountFailure('Inicia sesión desde la ventana de cuenta Vetsa de Brivany.')

    def begin(self):
        if not self.open_window:raise AccountFailure('Abre este acceso desde Brivany Desktop.')
        with self.lock:
            if self.pending:return self.status()
            if self.server or self.closing:raise AccountFailure('El acceso anterior está cerrándose. Inténtalo de nuevo.')
            self.generation+=1;generation=self.generation
            verifier=secrets.token_urlsafe(64);state=secrets.token_urlsafe(32)
            pending={'state':state,'verifier':verifier,'expires':self.now()+600,'generation':generation,'busy':False}
            self.pending=pending;self.message=''
        account=self
        class Callback(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(handler):
                ok=False
                if handler.headers.get('Host')==f'127.0.0.1:{account.port}' and not handler.headers.get('Origin'):
                    try:ok=account.complete(handler.path,generation)
                    except AccountFailure:pass
                body=('<!doctype html><html lang="es"><meta charset="utf-8"><title>Cuenta Vetsa</title><body><h1>'+('Sesión iniciada' if ok else 'Acceso no completado')+'</h1><p>'+('Ya puedes volver a Brivany.' if ok else 'Reinicia el acceso desde Brivany.')+'</p></body></html>').encode()
                handler.send_response(200 if ok else 400);handler.send_header('Content-Type','text/html; charset=utf-8');handler.send_header('Cache-Control','no-store');handler.send_header('Referrer-Policy','no-referrer');handler.send_header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");handler.send_header('Content-Length',str(len(body)));handler.end_headers()
                try:handler.wfile.write(body)
                except OSError:pass
                if ok:threading.Thread(target=account._close_login,args=(generation,),daemon=True).start()
        try:
            server=ThreadingHTTPServer(('127.0.0.1',self.port),Callback);server.daemon_threads=True
            with self.lock:
                if self.pending is not pending:
                    server.server_close();return self.status()
                self.port=server.server_port;self.server=server;self.resource_generation=generation
                threading.Thread(target=server.serve_forever,daemon=True,name='vetsa-callback').start()
            params={'source':'brivany-desktop','state':state,'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode(),
                    'code_challenge_method':'S256','redirect_uri':f'http://127.0.0.1:{self.port}/auth'}
            view=self.open_window(ORIGIN+'/auth?'+parse.urlencode(params),'Iniciar sesión · Vetsa',lambda:self.cancel(generation))
            with self.lock:
                if self.pending is pending:self.window=view
                else:
                    view.destroy();return self.status()
            timer=threading.Timer(600,lambda:self.cancel(generation,expired=True));timer.daemon=True;timer.start()
            self.start();return self.status()
        except Exception:
            self.cancel(generation)
            raise AccountFailure('No se pudo abrir el acceso. Cierra otra ventana de cuenta e inténtalo de nuevo.') from None

    def complete(self,path,generation):
        parts=parse.urlsplit(path)
        if parts.path!='/auth' or parts.scheme or parts.netloc or parts.fragment or len(path)>2048:return False
        params=parse.parse_qs(parts.query,keep_blank_values=True)
        if set(params)!={'code','state'} or any(len(v)!=1 for v in params.values()):return False
        code=params['code'][0];state=params['state'][0]
        if not re.fullmatch('[A-Za-z0-9_-]{43,128}',code) or not re.fullmatch('[A-Za-z0-9_-]{43,128}',state):return False
        with self.lock:
            pending=self.pending
            if not pending or generation!=self.generation or pending['busy'] or pending['expires']<self.now() or not hmac.compare_digest(state,pending['state']):return False
            pending['busy']=True
        session=None
        try:
            exchanged=self.http.call('/api/auth/desktop/token',{'code':code,'codeVerifier':pending['verifier'],'redirectUri':f'http://127.0.0.1:{self.port}/auth'})
            verified=self.http.call('/api/brivany/account/session',token=exchanged.get('token'))
            if verified.get('authenticated') is not True or verified.get('user',{}).get('id')!=exchanged.get('user',{}).get('id'):raise AccountFailure('No se pudo verificar la cuenta Vetsa.')
            session=self._session({**verified,'token':exchanged.get('token')})
            with self.lock:
                if generation!=self.generation or self.pending is not pending:
                    self.http.call('/api/brivany/account/logout',{},session['token']);return False
                self.store.save(session);self.session=session;self.validated=True;self.security_state=None;self.pending=None;self.message=''
            threading.Thread(target=self._refresh_after_login,daemon=True).start()
            return True
        except (AccountFailure,OSError) as failure:
            exc=failure if isinstance(failure,AccountFailure) else AccountFailure('No se pudo guardar la sesión cifrada en este equipo.')
            if session:
                try:self.http.call('/api/brivany/account/logout',{},session['token'])
                except AccountFailure:pass
            with self.lock:
                if generation==self.generation:self.pending=None;self.message=str(exc)
            self._close_login(generation);raise exc from None

    def _close_login(self,generation=None):
        with self.lock:
            if generation is not None and generation!=self.resource_generation:return
            server,self.server=self.server,None;window,self.window=self.window,None
            self.resource_generation=None;self.closing=bool(server or window)
        try:
            if server:server.shutdown();server.server_close()
            if window:
                try:window.destroy()
                except Exception:pass
        finally:
            with self.lock:self.closing=False

    def _refresh_after_login(self):
        try:self.refresh()
        except AccountFailure:pass

    def cancel(self,generation=None,*,expired=False):
        with self.lock:
            if generation is not None and generation!=self.generation:return self.status()
            if not self.pending:return self.status()
            closing_generation=self.generation
            self.pending=None;self.generation+=1;self.message='El acceso caducó. Inténtalo de nuevo.' if expired else ''
        self._close_login(closing_generation);return self.status()

    def manage(self,section='profile'):
        if section not in {'profile','security'}:raise AccountFailure('Sección no permitida.')
        if not self.status()['signed_in'] or not self.open_window:raise AccountFailure('Inicia sesión en Brivany.')
        view=self.open_window(ORIGIN+'/account'+('#security' if section=='security' else ''),'Mi cuenta · Vetsa',None)
        with self.lock:self.management_windows.append(view)
        return {'opened':True}

    def logout(self):
        self.cancel()
        with self.lock:
            session=self.session;self.generation+=1;self.session=None;self.validated=False;self.security_state=None;self.store.clear();self.message=''
            windows,self.management_windows=self.management_windows,[]
        for window in windows:
            try:window.destroy()
            except Exception:pass
        if session:
            try:self.http.call('/api/brivany/account/logout',{},session['token'])
            except AccountFailure:
                with self.lock:self.message='Sesión cerrada en este equipo. No se pudo confirmar la revocación en Vetsa.'
        return self.status()

    def devices(self):return {'devices':[]}
    def command_status(self,identifier):raise AccountFailure('El acceso a Vetsa no habilita control remoto de este ordenador.')
    def close(self):
        self.cancel();self.stop.set();self._close_login()
        if self.thread and self.thread is not threading.current_thread():self.thread.join(1)
