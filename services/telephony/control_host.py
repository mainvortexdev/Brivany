"""Start the existing dedicated Call Control listener without a console window."""
import os
from pathlib import Path
import subprocess
import sys
import threading
from packages.runtime_paths import APP_ROOT,DATA_ROOT

class ControlHost:
    def __init__(self):self.lock=threading.Lock();self.thread=None;self.process=None;self.message='';self.closed=False
    def start(self):
        with self.lock:
            if self.closed or self.thread and self.thread.is_alive():return
            self.thread=threading.Thread(target=self._start,daemon=True,name='melodi-call-control-host');self.thread.start()
    def _start(self):
        from .call_control_client import ControlClient
        try:
            if ControlClient().request('/v1/info').get('configured'):return
        except Exception:pass
        with self.lock:
            if self.closed or self.process and self.process.poll() is None:return
            if not (APP_ROOT/'tools/serve_telnyx_control.py').is_file():self.message='El servicio de Telnyx no está instalado.';return
            directory=DATA_ROOT/'.local/telephony';directory.mkdir(parents=True,exist_ok=True)
            executable=Path(sys.executable)
            if executable.name.lower()=='pythonw.exe':executable=executable.with_name('python.exe')
            log=(directory/'call-control-host.log').open('ab')
            try:self.process=subprocess.Popen([str(executable),'-B','-m','tools.serve_telnyx_control','--share'],cwd=APP_ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            finally:log.close()
            self.message='Conectando Telnyx…'
    def close(self):
        # A dedicated listener may own a live call after a panel closes.
        # Its existing safety timer and receipts remain; do not kill it.
        self.closed=True
