"""User-facing final creations. Technical projects remain private and unchanged."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
from uuid import UUID
from .team import artifact
from .motion_result import motion_artifact
from services.media.files import documents_directory,publish
from services.terminal.policy import scoped

CATEGORIES={
 'Documentos':{'.txt','.md','.pdf','.docx','.xlsx','.csv','.pptx','.rtf','.odt','.ods','.odp'},
 'Imágenes':{'.png','.jpg','.jpeg','.webp'},
 'Videos':{'.mp4','.webm','.mov','.mkv'},
}


class CreationFiles:
 def __init__(self,service,root=None):
  self.service=service;self.explicit_root=Path(root).absolute() if root is not None else None;self.lock=threading.RLock()
  self.database=Path(service.root)/'creations.sqlite3'
 @property
 def root(self):
  if self.explicit_root is None:self.explicit_root=documents_directory()/'Creaciones de Melodi'
  return self.explicit_root
 @contextmanager
 def connect(self):
  scoped(self.database,[self.service.root]);db=sqlite3.connect(self.database,timeout=10)
  try:
   with db:
    db.execute('CREATE TABLE IF NOT EXISTS files (job TEXT NOT NULL, slot INTEGER NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(job,slot))')
    yield db
  finally:db.close()
 @staticmethod
 def digest(path):
  with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
 def sources(self,identifier):
  if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Creación no válida.')
  job=self.service.jobs.get(identifier);result=(job or {}).get('result') or {}
  if not job or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError('La creación todavía no está disponible.')
  if job['kind'] not in {'image','motion','document','research'} or not result.get('path'):return []
  if result.get('verified') is not True:raise ValueError('El archivo final todavía no está confirmado.')
  items=result.get('images') or [result]
  if not isinstance(items,list) or not 1<=len(items)<=8:raise ValueError('Colección no válida.')
  values=[]
  for item in items:
   path=motion_artifact(self.service.workspace,identifier,result) if job['kind']=='motion' else artifact(item.get('path',''),self.service.workspace,128*1024**2)
   category=next((name for name,extensions in CATEGORIES.items() if path.suffix.lower() in extensions),None)
   if category is None:raise ValueError('El resultado no es un documento, imagen o video final.')
   values.append((path,category))
  return values
 def export(self,identifier,index=None):
  try:return self._export(identifier,index)
  except sqlite3.Error as error:raise OSError('No pude abrir el catálogo privado de creaciones.') from error
 def _export(self,identifier,index=None):
  with self.lock:
   sources=self.sources(identifier)
   if index is not None and (type(index) is not int or not 0<=index<len(sources)):raise ValueError('Archivo no válido.')
   if not sources:return []
   root=scoped(self.root,[self.root]);root.mkdir(parents=True,exist_ok=True)
   for category in CATEGORIES:scoped(root/category,[root]).mkdir(exist_ok=True)
   result=self.service.jobs[identifier]['result'];title=str(result.get('title') or self.service.jobs[identifier].get('title') or 'Creación').strip()
   title=re.sub(r'\.{2,}','_',re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',title)).strip(' .')[:80] or 'Creación'
   exported=[]
   with self.connect() as db:
    for slot,(source,category) in enumerate(sources):
     if index is not None and index!=slot:continue
     folder=scoped(root/category,[root],existing=True);sha=self.digest(source)
     row=db.execute('SELECT path,sha256 FROM files WHERE job=? AND slot=?',(identifier,slot)).fetchone()
     if row:
      previous=scoped(row[0],[folder])
      if previous.is_file() and row[1]==sha and self.digest(previous)==sha:exported.append(previous);continue
     # Copy just the delivered file, not assets, reports or project metadata.
     stage=None
     try:
      with tempfile.NamedTemporaryFile(dir=folder,prefix='.melodi-',suffix='.tmp',delete=False) as stream:
       stage=Path(stream.name)
       with source.open('rb') as incoming:shutil.copyfileobj(incoming,stream,1024*1024)
       stream.flush();os.fsync(stream.fileno())
      if self.digest(stage)!=sha:raise OSError('No se pudo comprobar la copia del archivo final.')
      stem=title+' - '+identifier[:8]+('-'+str(slot+1).zfill(2) if len(sources)>1 else '')
      target=publish(stage,folder,stem,source.suffix.lower());stage=None
      db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)',(identifier,slot,str(target),sha));exported.append(target)
     finally:
      if stage:stage.unlink(missing_ok=True)
   return exported
