"""Cloned voices the user chose to keep after a translation session.

Stores only the remote Cartesia voice ID, a display name, the original
language and the creation time. Never PCM, transcripts, embeddings, the video
or who the speaker is. A kept voice stays in the Cartesia account until the
user deletes it here.
"""
from packages.runtime_paths import DATA_ROOT
import json
from pathlib import Path
import threading
import time
from uuid import UUID

_LOCK=threading.RLock()
LIMIT=64


class KeptVoices:
    def __init__(self,path=None):
        self.path=Path(path) if path is not None else DATA_ROOT/'.local/translation/kept-voices.json'

    def _read(self):
        if not self.path.exists():return []
        if self.path.stat().st_size>131072:raise ValueError('La lista de voces guardadas supera el límite.')
        rows=json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(rows,list) or len(rows)>LIMIT:raise ValueError('Lista de voces guardadas no válida.')
        return [row for row in rows if isinstance(row,dict)]

    def _write(self,rows):
        self.path.parent.mkdir(parents=True,exist_ok=True);temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8');temporary.replace(self.path)

    def add(self,identifier,*,name,language):
        identifier=str(UUID(identifier))
        if not isinstance(name,str) or not 1<=len(name)<=64 or any(ord(c)<32 for c in name):raise ValueError('Nombre de voz no válido.')
        if language not in ('es','en','fr'):raise ValueError('Idioma de voz no válido.')
        with _LOCK:
            rows=[row for row in self._read() if row.get('id')!=identifier]
            if len(rows)>=LIMIT:raise ValueError('Elimina alguna voz guardada antes de conservar otra.')
            rows.append({'id':identifier,'name':name,'language':language,'kept_at':round(time.time())})
            self._write(rows)

    def list(self):
        with _LOCK:return [{'id':row['id'],'name':row.get('name','Voz'),'language':row.get('language'),'kept_at':row.get('kept_at')} for row in self._read() if isinstance(row.get('id'),str)]

    def contains(self,identifier):
        with _LOCK:return any(row.get('id')==identifier for row in self._read())

    def remove(self,identifier):
        identifier=str(UUID(identifier))
        with _LOCK:self._write([row for row in self._read() if row.get('id')!=identifier])


def delete_kept_voice(identifier,*,library=None,cloner_factory=None):
    """Delete one kept voice from Cartesia, then from the local list.

    Only IDs listed in the local library are accepted; this never deletes an
    arbitrary voice from the account.
    """
    library=library or KeptVoices();identifier=str(UUID(identifier))
    if not library.contains(identifier):raise ValueError('Esa voz no está en tus voces guardadas.')
    if cloner_factory is None:
        from packages.providers.voice_clone import CartesiaVoiceCloner as cloner_factory
    cloner_factory().delete(identifier)
    library.remove(identifier)
    return library.list()
