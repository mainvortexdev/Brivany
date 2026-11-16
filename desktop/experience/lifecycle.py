"""Private per-user application lifecycle, independent of window automation."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
from urllib.parse import urlsplit
from services.private_store import PrivateStore

class Lifecycle:
    def __init__(self,base,folder,*,stop,save,launch_command,busy=lambda:[],workspace=False,version='0.1.0',vault=None,spawn=None,prepare_update=lambda:False):
        parsed=urlsplit(base)
        if parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost'} or not parsed.port or parsed.username or parsed.password or parsed.path not in {'','/'}:raise ValueError('La administración requiere una dirección privada local.')
        self.base=base.rstrip('/');self.folder=Path(folder);self.vault=vault or PrivateStore(self.folder/'control.dpapi');self.token=secrets.token_urlsafe(32);self.pid=os.getpid();self.stop_callback=stop;self.save_callback=save;self.launch_command=list(launch_command);self.busy_callback=busy;self.workspace=workspace;self.version=version;self.spawn=spawn or subprocess.Popen;self.prepare_update=prepare_update;self.lock=threading.RLock();self.state='starting';self.error=None;self.closed=False
        from desktop.management import process_identity
        identity=process_identity(self.pid)
        self.vault.write({'base':self.base,'token':self.token,'pid':self.pid,'started':identity['started'] if identity else None,'version':version,'workspace':workspace,'protocol':1})
    def ready(self):
        with self.lock:
            if self.state=='starting':self.state='running'
    def authenticate(self,token):return isinstance(token,str) and secrets.compare_digest(token,self.token) and not self.closed
    def status(self):
        with self.lock:return {'pid':self.pid,'state':self.state,'ready':self.state=='running','version':self.version,'workspace':self.workspace,'busy':self.busy_callback(),'error':self.error}
    def request(self,action,mode=None):
        if action not in {'stop','restart'} or mode not in {None,'workspace','chat'}:raise ValueError('Acción de administración no válida.')
        with self.lock:
            if self.state!='running':raise ValueError('Brivany todavía no está listo para reiniciar.')
            if self.busy_callback():raise ValueError('Termina las tareas, llamadas, grabaciones o transferencias activas antes de reiniciar.')
            self.state='saving';self.error=None
        def execute():
            try:
                if self.busy_callback():raise ValueError('Brivany tiene una operación activa.')
                if self.save_callback() is not True:raise ValueError('No se pudo confirmar el guardado del chat.')
                if action=='restart' and not self.prepare_update():
                    from desktop.management import process_identity
                    started=process_identity(self.pid)['started'];command=[sys.executable,'-m','desktop.distribution.restart','--pid',str(self.pid),'--started',str(started),'--command',json.dumps(self.launch_command),'--mode',mode or ('workspace' if self.workspace else 'chat')]
                    env={key:value for key,value in os.environ.items() if not key.startswith('BRIVANY_SMOKE_')}
                    self.spawn(command,cwd=Path(__file__).resolve().parents[2],env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                with self.lock:self.state='stopping'
                self.stop_callback()
            except Exception:
                with self.lock:self.state='running';self.error='No se pudo completar el guardado o el cierre. No se forzó la salida.'
        timer=threading.Timer(.2,execute);timer.daemon=True;timer.start();return {'accepted':True,'action':action,'pid':self.pid,'state':'saving'}
    def close(self):
        with self.lock:
            self.closed=True
            try:
                value=self.vault.read()
                if value.get('pid')==self.pid and value.get('token')==self.token:self.vault.path.unlink(missing_ok=True)
            except Exception:pass

def handle(handler,method):
    if urlsplit(handler.path).path!='/api/desktop/lifecycle':return False
    if not handler.local_request():return True
    service=getattr(handler.server,'desktop_lifecycle',None)
    if not service or not service.authenticate(handler.headers.get('X-Brivany-Management')):
        handler.reject_before_body(403,'lifecycle_access','Administración privada no disponible.');return True
    try:
        if method=='GET':handler.send_json(200,service.status());return True
        if method!='POST':raise ValueError('Método no válido.')
        size=int(handler.headers.get('Content-Length','0'))
        if not 1<=size<=256 or handler.headers.get('Transfer-Encoding') or handler.headers.get_content_type()!='application/json':raise ValueError('Solicitud no válida.')
        value=json.loads(handler.rfile.read(size))
        if not isinstance(value,dict) or set(value)-{'action','mode'}:raise ValueError('Solicitud no válida.')
        handler.send_json(200,service.request(value.get('action'),value.get('mode')))
    except (ValueError,TypeError,OSError):handler.error(409,'lifecycle_busy','No se pudo reiniciar de forma segura. Consulta el estado privado de Brivany.')
    return True
