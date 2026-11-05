"""Native translation display choice; no audio or transcript persistence."""
import json
import os
from pathlib import Path
import tempfile
import threading


class TranslationPreferences:
    def __init__(self,path):
        self.path=Path(path);self.lock=threading.RLock();self.show_transcript=True
        try:
            value=json.loads(self.path.read_text(encoding='utf-8')).get('show_transcript')
            if type(value) is bool:self.show_transcript=value
        except (OSError,ValueError,AttributeError):pass
    def status(self):
        with self.lock:return {'show_transcript':self.show_transcript}
    def configure(self,value):
        if type(value) is not bool:raise ValueError('Elige si mostrar la transcripción.')
        with self.lock:
            self.path.parent.mkdir(parents=True,exist_ok=True);temporary=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.path.parent,delete=False) as stream:
                    temporary=Path(stream.name);json.dump({'show_transcript':value},stream);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,self.path);self.show_transcript=value
            finally:
                if temporary:temporary.unlink(missing_ok=True)
            return self.status()
