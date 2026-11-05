"""Private Streamable-HTTP client for the installed Cognira Edits MCP contract."""
import ctypes
from dataclasses import dataclass
import http.client
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
VERSION='2025-06-18'


class EditsError(ValueError):
    def __init__(self,message,code='edits_unavailable'):
        self.code=code;super().__init__(message)


def process_alive(pid):
    if sys.platform=='win32':
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.restype=ctypes.c_void_p
        handle=kernel.OpenProcess(0x1000,False,pid)
        if not handle:return False
        try:
            status=ctypes.c_ulong();return bool(kernel.GetExitCodeProcess(ctypes.c_void_p(handle),ctypes.byref(status)) and status.value==259)
        finally:kernel.CloseHandle(ctypes.c_void_p(handle))
    try:os.kill(pid,0);return True
    except OSError:return False


def default_descriptor():
    override=os.environ.get('BRIVANY_EDITS_MCP_DESCRIPTOR') or os.environ.get('COGNIRA_EDITS_MCP_DESCRIPTOR')
    if override:return Path(override)
    base=Path(os.environ.get('APPDATA',Path.home()/'AppData/Roaming')) if sys.platform=='win32' else Path.home()/'Library/Application Support' if sys.platform=='darwin' else Path(os.environ.get('XDG_CONFIG_HOME',Path.home()/'.config'))
    return base/'Cognira Edits'/'automation/mcp.json'


def editor_executable():
    override=os.environ.get('BRIVANY_EDITS_EXECUTABLE') or os.environ.get('COGNIRA_EDITS_EXECUTABLE')
    candidates=[Path(override)] if override else []
    if sys.platform=='win32':
        candidates += [ROOT.parent/'cognira-edits/release/win-unpacked/Cognira Edits.exe',Path(os.environ.get('LOCALAPPDATA',Path.home()/'AppData/Local'))/'Programs/cognira-edits/Cognira Edits.exe',Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Cognira Edits/Cognira Edits.exe']
    elif sys.platform=='darwin':candidates += [Path('/Applications/Cognira Edits.app/Contents/MacOS/Cognira Edits')]
    else:candidates += [Path('/opt/Cognira Edits/cognira-edits'),Path.home()/'.local/bin/cognira-edits']
    return next((path.absolute() for path in candidates if path.is_absolute() and path.is_file()),None)


@dataclass(frozen=True,repr=False)
class Descriptor:
    endpoint:str
    token:str
    pid:int


class EditsClient:
    def __init__(self,descriptor=None,*,alive=process_alive,executable=editor_executable,launch=True):
        self.file=Path(descriptor or default_descriptor()).absolute();self.alive=alive;self.executable=executable;self.launch=launch
        self.identity=None;self.serial=0;self.start_lock=threading.RLock();self.serial_lock=threading.Lock();self.definitions=None

    def descriptor(self):
        try:
            if self.file.is_symlink() or self.file.resolve()!=self.file or not self.file.is_file() or self.file.stat().st_size>4096:raise ValueError()
            value=json.loads(self.file.read_text(encoding='utf-8'));endpoint=value['endpoint'];token=value['token'];pid=value['pid']
            if not isinstance(endpoint,str) or not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}/mcp',endpoint) or not 1<=urlsplit(endpoint).port<=65535:raise ValueError()
            if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',token) or type(pid) is not int or not 0<pid<2**32 or not self.alive(pid):raise ValueError()
            return Descriptor(endpoint,token,pid)
        except (OSError,ValueError,KeyError,TypeError):raise EditsError('Cognira Edits no tiene una conexión local activa.') from None

    def availability(self):
        try:current=self.descriptor();ready=True
        except EditsError:current=None;ready=False
        return {'installed':bool(self.executable()),'descriptor_ready':ready,'connected_verified':self.identity is not None and current==self.identity,
                'transport':'local_mcp','automatic_requests':False}

    def start(self,cancelled=None):
        with self.start_lock:
            if self.identity:
                if self.descriptor()!=self.identity:raise EditsError('La sesión del editor cambió. No se repetirá la operación.','edits_session_changed')
                return
            try:identity=self.descriptor()
            except EditsError:
                binary=self.executable()
                if not self.launch or not binary:raise EditsError('Abre o instala Cognira Edits para editar videos con Melodi.') from None
                from services.computer.backend import child_environment
                env=child_environment()
                for name in list(env):
                    if name.startswith('COGNIRA_EDITS_') or name=='COGNIRA_DESKTOP_DEV_DIRECTORY':env.pop(name,None)
                subprocess.Popen([str(binary)],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),start_new_session=sys.platform!='win32')
                deadline=time.monotonic()+40
                while True:
                    if cancelled is not None and cancelled.is_set():raise EditsError('Apertura cancelada.','edits_cancelled')
                    try:identity=self.descriptor();break
                    except EditsError:
                        if time.monotonic()>deadline:raise EditsError('No se confirmó el arranque de Cognira Edits.') from None
                        if cancelled is not None:cancelled.wait(.2)
                        else:time.sleep(.2)
            self.identity=identity
            try:
                value=self.rpc('initialize',{'protocolVersion':VERSION,'capabilities':{},'clientInfo':{'name':'Brivany · Melodi','version':'1.0'}},cancelled=cancelled,timeout=5)
                if value.get('protocolVersion')!=VERSION or value.get('serverInfo',{}).get('name')!='Cognira Edits':raise EditsError('El MCP no corresponde al contrato de Cognira Edits.')
            except Exception:self.identity=None;raise

    def rpc(self,method,params,*,cancelled=None,timeout=60):
        if not self.identity:raise EditsError('Conecta primero Cognira Edits.')
        if cancelled is not None and cancelled.is_set():raise EditsError('Operación cancelada.','edits_cancelled')
        if self.descriptor()!=self.identity:raise EditsError('La sesión del editor cambió; no se repetirá.','edits_session_changed')
        with self.serial_lock:self.serial+=1;identifier=self.serial
        body=json.dumps({'jsonrpc':'2.0','id':identifier,'method':method,'params':params},allow_nan=False).encode()
        if len(body)>1024*1024:raise EditsError('La petición excede el contrato local.')
        connection=http.client.HTTPConnection('127.0.0.1',urlsplit(self.identity.endpoint).port,timeout=timeout)
        done=threading.Event()
        def watch():
            while not done.wait(.05):
                if cancelled is not None and cancelled.is_set():
                    try:
                        if connection.sock:connection.sock.shutdown(socket.SHUT_RDWR)
                    except OSError:pass
                    connection.close();return
        if cancelled is not None:threading.Thread(target=watch,daemon=True).start()
        try:
            connection.request('POST','/mcp',body=body,headers={'Authorization':'Bearer '+self.identity.token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':VERSION})
            response=connection.getresponse()
            if response.status!=200:raise EditsError('El editor rechazó la operación local; no se repitió.','edits_outcome_unknown')
            raw=response.read(16*1024*1024+1)
            if len(raw)>16*1024*1024:raise ValueError()
            value=json.loads(raw)
            if value.get('jsonrpc')!='2.0' or value.get('id')!=identifier or 'error' in value or not isinstance(value.get('result'),dict):raise ValueError()
            return value['result']
        except (OSError,ValueError,http.client.HTTPException):
            raise EditsError('No se confirmó el resultado de Edits. Revisa el editor antes de repetir.','edits_outcome_unknown') from None
        finally:done.set();connection.close()

    def tools(self,cancelled=None):
        self.start(cancelled)
        if self.definitions is None:
            definitions=self.rpc('tools/list',{},cancelled=cancelled).get('tools')
            if not isinstance(definitions,list) or len(definitions)>100 or any(not isinstance(d,dict) or not isinstance(d.get('name'),str) or not isinstance(d.get('inputSchema'),dict) for d in definitions):raise EditsError('Catálogo MCP no válido.')
            self.definitions=definitions
        return self.definitions

    def call(self,name,arguments=None,*,cancelled=None,timeout=120):
        if arguments is not None and not isinstance(arguments,dict):raise EditsError('Los argumentos deben ser un objeto.')
        self.start(cancelled)
        result=self.rpc('tools/call',{'name':name,'arguments':arguments or {}},cancelled=cancelled,timeout=timeout)
        try:
            block=next(block for block in result['content'] if block.get('type')=='text');value=json.loads(block['text'])
            if result.get('isError') or not isinstance(value,dict) or value.get('success') is False:raise ValueError()
            return value
        except (KeyError,ValueError,TypeError,StopIteration):raise EditsError('Edits no aplicó la operación. No se repetirá automáticamente.','edits_tool_rejected') from None

    def wait_job(self,identifier,*,cancelled=None,progress=lambda value:None,timeout=7200):
        deadline=time.monotonic()+timeout
        try:
            while time.monotonic()<deadline:
                if cancelled is not None and cancelled.is_set():raise EditsError('Tarea cancelada.','edits_cancelled')
                job=self.call('job_status',{'id':identifier},cancelled=cancelled,timeout=10);progress(job)
                if job.get('status')=='done':return job.get('result',{})
                if job.get('status') in {'failed','canceled','cancelled'}:raise EditsError('El trabajo terminó sin completar la edición.','edits_job_failed')
                if cancelled is not None:cancelled.wait(.5)
                else:time.sleep(.5)
            raise EditsError('La edición sigue pendiente en el editor. Comprueba su estado antes de repetir.','edits_outcome_unknown')
        except EditsError:
            if cancelled is not None and cancelled.is_set():
                try:self.call('job_cancel',{'id':identifier},timeout=5)
                except EditsError:pass
            raise
