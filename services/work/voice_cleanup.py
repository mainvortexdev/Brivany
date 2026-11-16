"""Owned temporary remote IDs only. Never stores PCM, names or transcripts."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import hashlib
import json
from pathlib import Path
import threading
import time
from uuid import UUID

ROOT=Path(__file__).resolve().parents[2]
_LOCK=threading.RLock()


class VoiceCleanupJournal:
    def __init__(self,key,path=None):self.path=Path(path) if path is not None else DATA_ROOT/'.local/translation/temporary-voices.json';self.key_hash=hashlib.sha256(key.encode()).hexdigest()
    def _read(self):
        if not self.path.exists():return []
        if self.path.stat().st_size>524288:raise ValueError('La lista de voces temporales supera el límite.')
        rows=json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(rows,list) or len(rows)>1000:raise ValueError('Lista de voces temporales inválida.')
        return rows
    def _write(self,rows):
        self.path.parent.mkdir(parents=True,exist_ok=True);temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(rows),encoding='utf-8');temporary.replace(self.path)
    def remember(self,identifier):
        identifier=str(UUID(identifier))
        with _LOCK:
            rows=self._read()
            existing=next((row for row in rows if row.get('id')==identifier and row.get('key')==self.key_hash),None)
            if existing:existing['expires']=time.time()+1800
            else:rows.append({'id':identifier,'key':self.key_hash,'expires':time.time()+1800})
            self._write(rows)
    def forget(self,identifier):
        with _LOCK:self._write([row for row in self._read() if not (row.get('id')==identifier and row.get('key')==self.key_hash)])
    def expired(self):
        with _LOCK:
            return [str(UUID(row['id'])) for row in self._read() if row.get('key')==self.key_hash and type(row.get('expires')) in (int,float) and row['expires']<=time.time()][:4]
