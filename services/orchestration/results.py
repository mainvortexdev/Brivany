"""Read-only result descriptions and short-lived, artifact-scoped media tickets."""
import base64
import hmac
from io import BytesIO
import mimetypes
from pathlib import Path
import secrets
import threading
import time
from uuid import UUID
from PIL import Image
from .team import artifact

class ResultViewer:
 def __init__(self,service):self.service=service;self.tickets={};self.lock=threading.RLock()
 def describe(self,identifier):
  if not isinstance(identifier,str) or str(UUID(identifier))!=identifier:raise ValueError('Resultado no válido.')
  job=self.service.jobs.get(identifier)
  if not job or job['state'] in {'queued','planning','running','reviewing','awaiting_approval'}:raise ValueError('El resultado todavía no está disponible.')
  result=job.get('result') or {};value={'id':identifier,'title':str(result.get('title') or job.get('title') or job['kind'])[:180],'type':'text'}
  if job['kind']=='orchestrator':return {**value,'type':'team','items':result.get('agents',[])[:6]}
  if job['kind'] in {'document','research'}:
   if not result.get('path') and isinstance(result.get('message'),str):
    return {**value,'text':result['message']}
   path=artifact(result.get('path',''),self.service.workspace,250000);text=path.read_text(encoding='utf-8')[:120000]
   if text.startswith(value['title']+'\n'):text=text[len(value['title']):].lstrip()
   return {**value,'text':text}
  if result.get('scene_id'):
   scene=str(UUID(result['scene_id']));return {**value,'type':'model','url':'/spaces?space='+scene+'&embedded=melodi'+('&representation=plan' if result.get('representation')=='plan' else '')}
  raw=result.get('path')
  if not raw:
   raw=next((r['result'].get('path') for r in result.get('receipts',[]) if r.get('action')=='open_paint_image' and r['result'].get('openedInPaint')),None)
  if not raw:
   raw=next((r['result'].get('localPath') for r in reversed(result.get('receipts',[])) if r.get('action') in {'draw_paint','save_paint'} and r.get('result',{}).get('localPath')),None)
  if raw and Path(raw).suffix.lower() in {'.png','.jpg','.jpeg','.webp'}:
   path=artifact(raw,self.service.workspace,24000000)
   with Image.open(path) as picture:
    picture.load();picture.thumbnail((1800,1800));buffer=BytesIO();picture.convert('RGB').save(buffer,'JPEG',quality=90)
   return {**value,'type':'image','src':'data:image/jpeg;base64,'+base64.b64encode(buffer.getvalue()).decode()}
  if raw and result.get('verified') and Path(raw).suffix.lower() in {'.mp4','.webm','.mov','.wav','.mp3','.m4a','.ogg'}:
   path=artifact(raw,self.service.workspace,128*1024**2);ticket=secrets.token_urlsafe(32)
   with self.lock:
    self.tickets={k:v for k,v in self.tickets.items() if v['expires']>time.monotonic()}
    if len(self.tickets)>=20:self.tickets.pop(next(iter(self.tickets)))
    self.tickets[ticket]={'id':identifier,'path':path,'expires':time.monotonic()+60}
   return {**value,'type':'video' if path.suffix.lower() in {'.mp4','.webm','.mov'} else 'audio','media_url':'/api/computer/result-media/'+identifier,'media_ticket':ticket}
  hidden={'verified','semantic_verification','review_required','conceptual','external_calls','provider_calls','simulated','token','secret','password','api_key','authorization','receipts'}
  def readable(item,depth=0):
   if depth>4:return ''
   if isinstance(item,dict):return '\n\n'.join(str(k).replace('_',' ')+': '+readable(v,depth+1) for k,v in list(item.items())[:24] if k not in hidden and v is not None)
   if isinstance(item,list):return '\n'.join(readable(v,depth+1) for v in item[:30])
   return str(item)[:3000]
  return {**value,'text':readable(result)[:40000] or job.get('phase') or job.get('error') or ''}
 def media(self,identifier,ticket):
  if not isinstance(ticket,str) or len(ticket)>128:raise ValueError('Lectura no autorizada.')
  with self.lock:
   key=next((k for k in self.tickets if hmac.compare_digest(k,ticket)),None);entry=self.tickets.pop(key,None) if key else None
  if not entry or entry['id']!=identifier or entry['expires']<=time.monotonic():raise ValueError('La lectura caducó.')
  path=artifact(entry['path'],self.service.workspace,128*1024**2);return path,mimetypes.guess_type(path)[0] or 'application/octet-stream'
