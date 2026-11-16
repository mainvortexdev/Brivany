"""Small user-bound DPAPI records; no plaintext fallback or secret logging."""
import json
import os
from pathlib import Path
import tempfile
import threading
from services.google_oauth import WindowsDPAPIProtector

LOCK=threading.RLock()

class PrivateStore:
    def __init__(self,path,protector=None):
        self.path=Path(path).absolute();self.protector=protector or WindowsDPAPIProtector()
        for item in (self.path,*self.path.parents):
            if item.is_symlink() or getattr(item,'is_junction',lambda:False)():raise ValueError('Almacén privado no válido.')
        self.path.parent.mkdir(parents=True,exist_ok=True)
    def read(self):
        with LOCK:
            if not self.path.exists():return {}
            if self.path.stat().st_size>70000:raise ValueError('El registro privado supera el límite.')
            return json.loads(self.protector.unprotect(self.path.read_bytes()))
    def write(self,value):
        raw=json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        protected=self.protector.protect(raw)
        with LOCK:
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(dir=self.path.parent,prefix='.private-',delete=False) as stream:
                    temporary=Path(stream.name);stream.write(protected);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,self.path)
            finally:
                if temporary:temporary.unlink(missing_ok=True)
