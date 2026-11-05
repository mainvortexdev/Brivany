"""One desktop process per login session, with local activation notifications."""
import hashlib
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading


class DesktopInstance:
    def __init__(self,name='Brivany.Desktop'):
        self.name=name;self.primary=False;self._thread=None;self._closed=False
        self._handles=[];self._lock_file=None;self._socket=None

    def __enter__(self):
        if sys.platform=='win32':
            import ctypes
            from ctypes import wintypes as w
            kernel=ctypes.WinDLL('kernel32',use_last_error=True);self._kernel=kernel
            kernel.CreateMutexW.argtypes=[w.LPVOID,w.BOOL,w.LPCWSTR];kernel.CreateMutexW.restype=w.HANDLE
            kernel.CreateEventW.argtypes=[w.LPVOID,w.BOOL,w.BOOL,w.LPCWSTR];kernel.CreateEventW.restype=w.HANDLE
            kernel.SetEvent.argtypes=[w.HANDLE];kernel.SetEvent.restype=w.BOOL
            kernel.CloseHandle.argtypes=[w.HANDLE];kernel.CloseHandle.restype=w.BOOL
            kernel.WaitForMultipleObjects.argtypes=[w.DWORD,ctypes.POINTER(w.HANDLE),w.BOOL,w.DWORD];kernel.WaitForMultipleObjects.restype=w.DWORD
            mutex=kernel.CreateMutexW(None,False,'Local\\'+self.name+'.Instance')
            if not mutex:raise ctypes.WinError(ctypes.get_last_error())
            self.primary=ctypes.get_last_error()!=183;self._handles=[mutex]
            for suffix in ('Open','WorkSpace','Stop.'+str(os.getpid())):
                handle=kernel.CreateEventW(None,False,False,'Local\\'+self.name+'.'+suffix)
                if not handle:self.close();raise ctypes.WinError(ctypes.get_last_error())
                self._handles.append(handle)
        else:
            import fcntl
            tag=hashlib.sha256(self.name.encode()).hexdigest()[:12]
            self._directory=Path(tempfile.gettempdir())/f'brivany-{os.getuid()}-{tag}'
            self._directory.mkdir(mode=0o700,exist_ok=True)
            if self._directory.is_symlink() or self._directory.stat().st_uid!=os.getuid():raise RuntimeError('Directorio de instancia inválido.')
            self._directory.chmod(0o700);self._path=self._directory/'activate.sock'
            self._lock_file=open(self._directory/'instance.lock','a+b')
            try:fcntl.flock(self._lock_file,fcntl.LOCK_EX|fcntl.LOCK_NB);self.primary=True
            except BlockingIOError:self.primary=False
            if self.primary:
                self._path.unlink(missing_ok=True)
                self._socket=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self._socket.bind(str(self._path));self._socket.listen(8);self._socket.settimeout(.5)
        return self

    def activate(self,workspace=False):
        if self.primary:return False
        if sys.platform=='win32':return bool(self._kernel.SetEvent(self._handles[2 if workspace else 1]))
        try:
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                client.settimeout(1);client.connect(str(self._path));client.sendall(b'workspace' if workspace else b'open')
            return True
        except OSError:return False

    def listen(self,callback):
        if not self.primary or self._thread:return
        def serve():
            if sys.platform=='win32':
                from ctypes import wintypes as w
                handles=(w.HANDLE*3)(*self._handles[1:])
                while not self._closed:
                    event=self._kernel.WaitForMultipleObjects(3,handles,False,500)
                    if event==2:break
                    if event in (0,1):
                        try:callback(event==1)
                        except Exception:pass
            else:
                while not self._closed:
                    try:
                        client,_=self._socket.accept()
                        with client:
                            client.settimeout(1);command=client.recv(17)
                        if command in (b'open',b'workspace'):
                            try:callback(command==b'workspace')
                            except Exception:pass
                    except (OSError,TimeoutError):pass
        self._thread=threading.Thread(target=serve,daemon=True,name='brivany-instance');self._thread.start()

    def close(self):
        if self._closed:return
        self._closed=True
        if sys.platform=='win32':
            if self.primary and len(self._handles)==4:self._kernel.SetEvent(self._handles[3])
            if self._thread:self._thread.join(1)
            for handle in reversed(self._handles):self._kernel.CloseHandle(handle)
            self._handles=[]
        else:
            if self._socket:self._socket.close()
            if self._thread:self._thread.join(1.5)
            if self.primary:self._path.unlink(missing_ok=True)
            if self._lock_file:self._lock_file.close()

    def __exit__(self,*args):self.close()
