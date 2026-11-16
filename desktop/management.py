"""First-party lifecycle client and process identity checks. Never force-kill."""
import ctypes
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request,build_opener,ProxyHandler
from urllib.parse import urlsplit
from packages.providers.live_voice import NoRedirect
from services.private_store import PrivateStore

def data_folder():return Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data'

def process_identity(pid):
    if os.name!='nt':
        try:return {'pid':pid,'path':str(Path('/proc')/str(pid)/'exe'),'started':(Path('/proc')/str(pid)/'stat').read_text().split()[21]}
        except OSError:return None
    kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];kernel.OpenProcess.restype=w.HANDLE;kernel.CloseHandle.argtypes=[w.HANDLE];kernel.QueryFullProcessImageNameW.argtypes=[w.HANDLE,w.DWORD,w.LPWSTR,ctypes.POINTER(w.DWORD)];kernel.GetProcessTimes.argtypes=[w.HANDLE,ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME),ctypes.POINTER(w.FILETIME)]
    handle=kernel.OpenProcess(0x1000,False,int(pid))
    if not handle:return None
    try:
        text=ctypes.create_unicode_buffer(32768);length=w.DWORD(len(text));created,exited,kernel_time,user_time=w.FILETIME(),w.FILETIME(),w.FILETIME(),w.FILETIME()
        if not kernel.QueryFullProcessImageNameW(handle,0,text,ctypes.byref(length)) or not kernel.GetProcessTimes(handle,ctypes.byref(created),ctypes.byref(exited),ctypes.byref(kernel_time),ctypes.byref(user_time)):return None
        if exited.dwHighDateTime or exited.dwLowDateTime:return None
        return {'pid':int(pid),'path':text.value,'started':(int(created.dwHighDateTime)<<32)|int(created.dwLowDateTime)}
    finally:kernel.CloseHandle(handle)

def wait_stopped(pid,started,timeout=45):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        current=process_identity(pid)
        if not current or str(current['started'])!=str(started):return True
        time.sleep(.2)
    return False

def read_control(folder=None):
    value=PrivateStore((Path(folder) if folder else data_folder())/'.local/runtime/control.dpapi').read();parsed=urlsplit(value.get('base',''))
    if parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost'} or not parsed.port or parsed.username or parsed.password or parsed.path not in {'','/'} or parsed.query or parsed.fragment or not isinstance(value.get('token'),str) or len(value['token'])!=43:raise ValueError('Brivany aún no tiene activo su control privado de reinicio.')
    current=process_identity(value.get('pid',0))
    if not current or str(current['started'])!=str(value.get('started')):raise ValueError('Brivany no está abierto o cambió de instancia.')
    return value

def request(action='status',*,mode=None,folder=None):
    value=read_control(folder);body=None if action=='status' else json.dumps({'action':action,**({'mode':mode} if mode else {})}).encode()
    headers={'X-Brivany-Management':value['token'],'Content-Type':'application/json'}
    with build_opener(ProxyHandler({}),NoRedirect()).open(Request(value['base']+'/api/desktop/lifecycle',method='GET' if body is None else 'POST',data=body,headers=headers),timeout=15) as response:return json.loads(response.read(8193))

def legacy_stop(pid,install=None,timeout=40):
    """One-time upgrade from a release without IPC: request its own WM_CLOSE.

    The executable and native process owner are verified. This requests the
    existing normal exit handler, including any unsaved-canvas prompt.
    """
    if os.name!='nt':raise ValueError('La actualización inicial requiere Windows.')
    install=Path(install) if install else Path(os.environ['LOCALAPPDATA'])/'Programs/Brivany';current=process_identity(pid)
    release=json.loads((install/'current.json').read_text(encoding='utf-8'))
    version=release.get('version') if isinstance(release,dict) else None
    if not version or any(c not in '0123456789.-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' for c in version):raise ValueError('Instalación no válida.')
    expected=(install/'releases'/version/'python/pythonw.exe').resolve()
    if not current:return {'stopped':True,'already_stopped':True,'forced':False,'pid':pid}
    if not current or Path(current['path']).resolve()!=expected:raise ValueError('El proceso no pertenece a la instalación de Brivany.')
    user=ctypes.WinDLL('user32',use_last_error=True);user.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)];user.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,ctypes.c_int];user.PostMessageW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM]
    matches=[];callback=ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
    @callback
    def visit(handle,_):
        owner=w.DWORD();user.GetWindowThreadProcessId(handle,ctypes.byref(owner));title=ctypes.create_unicode_buffer(512);user.GetWindowTextW(handle,title,len(title))
        if owner.value==pid and title.value=='Brivany':matches.append(handle)
        return True
    user.EnumWindows.argtypes=[callback,w.LPARAM];user.EnumWindows(visit,0)
    if len(matches)!=1:raise ValueError('No se encontró una única ventana principal de la instalación.')
    if not user.PostMessageW(matches[0],0x0010,0,0):raise ValueError('No se pudo solicitar el cierre normal.')
    if not wait_stopped(pid,current['started'],timeout):raise ValueError('Brivany no terminó el cierre normal. No se forzó la salida.')
    return {'stopped':True,'legacy_bootstrap':True,'forced':False,'pid':pid}

def launch(workspace=False):
    executable=Path(os.environ['LOCALAPPDATA'])/'Programs/Brivany/Brivany.exe'
    if not executable.is_file():raise ValueError('No se encontró la instalación de Brivany.')
    process=subprocess.Popen([str(executable),*(['--island'] if workspace else [])],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return {'launched':True,'pid':process.pid,'workspace':workspace}
