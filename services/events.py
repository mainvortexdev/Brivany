"""Sealed local one-shot rules: clock/job triggers, durable steps, no uncertain replay."""
from datetime import datetime,timezone
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from uuid import uuid4,UUID


def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()


class EventStore:
    def __init__(self,root):
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root:raise ValueError('El almacén de eventos no admite enlaces.')
        self.root.mkdir(parents=True,exist_ok=True);self.database=self.root/'events.sqlite3';keyfile=self.root/'authority.key'
        if keyfile.is_symlink() or self.database.is_symlink():raise ValueError('Almacén inválido.')
        if not keyfile.exists():
            try:
                with os.fdopen(os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as file:file.write(secrets.token_bytes(32))
            except FileExistsError:pass
        self.key=keyfile.read_bytes()
        if len(self.key)!=32:raise ValueError('Autoridad local inválida.')
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, body BLOB NOT NULL, seal TEXT NOT NULL)')
    @contextmanager
    def connect(self):
        database=sqlite3.connect(self.database,timeout=10)
        try:
            with database:yield database
        finally:database.close()
    def save(self,value,*,kind='rule',new=False):
        value=dict(value);previous=value.get('revision',0);value['revision']=previous+1;raw=canonical(value);seal=hmac.new(self.key,raw,hashlib.sha256).hexdigest()
        with self.connect() as db:
            if new:db.execute('INSERT INTO records VALUES (?,?,?,?,?)',(value['id'],kind,value['revision'],raw,seal))
            else:
                result=db.execute('UPDATE records SET revision=?,body=?,seal=? WHERE id=? AND revision=?',(value['revision'],raw,seal,value['id'],previous))
                if result.rowcount!=1:raise ValueError('El evento cambió durante la operación.')
        return value
    def get(self,identifier):
        with self.connect() as db:row=db.execute('SELECT revision,body,seal FROM records WHERE id=?',(identifier,)).fetchone()
        if not row:return None
        revision,raw,seal=row
        if not hmac.compare_digest(hmac.new(self.key,raw,hashlib.sha256).hexdigest(),seal):return {'id':identifier,'state':'invalid','revision':revision}
        try:value=json.loads(raw)
        except ValueError:return {'id':identifier,'state':'invalid','revision':revision}
        if value.get('id')!=identifier or value.get('revision')!=revision:return {'id':identifier,'state':'invalid','revision':revision}
        return value
    def rules(self):
        with self.connect() as db:ids=[row[0] for row in db.execute("SELECT id FROM records WHERE kind='rule' ORDER BY rowid DESC LIMIT 100")]
        return [self.get(identifier) for identifier in ids]


class EventEngine:
    def __init__(self,root,*,task,job,delivery,now=time.time,start_worker=True):
        self.store=EventStore(root);self.task=task;self.job=job;self.delivery=delivery;self.now=now;self.stopped=threading.Event();self.lock=threading.RLock()
        for value in self.store.rules():
            if value['state']=='running' and value.get('step_state',{}).get('state')=='started':
                value.update(state='uncertain',phase='Brivany se cerró durante una operación. Revisa el resultado antes de repetirla.');self.store.save(value)
        self.thread=None
        if start_worker:self.thread=threading.Thread(target=self._run,daemon=True,name='melodi-events');self.thread.start()
    def create(self,when,actions,*,roots,selected=()):
        if not isinstance(when,dict) or not isinstance(actions,list) or not 1<=len(actions)<=5:raise ValueError('Espera inválida.')
        trigger=when.get('type')
        if trigger=='at':
            if set(when)!={'type','at'}:raise ValueError('Hora inválida.')
            instant=datetime.fromisoformat(when['at'].replace('Z','+00:00'))
            if instant.tzinfo is None or instant.timestamp()<=self.now():raise ValueError('Indica una fecha y hora futuras con su zona.')
        elif trigger=='job_succeeded':
            if set(when)!={'type','job_id'} or str(UUID(when['job_id']))!=when['job_id'] or not self.job(when['job_id']):raise ValueError('Elige una tarea de origen observada.')
        elif trigger=='now':
            if set(when)!={'type'}:raise ValueError('Evento inválido.')
        else:raise ValueError('Tipo de espera no admitido.')
        for action in actions:
            if not isinstance(action,dict):raise ValueError('Acción inválida.')
            if action.get('type')=='task':
                if set(action)!={'type','kind','goal'} or action['kind'] not in {'desktop','edits','model','document','skill','personal'} or not isinstance(action['goal'],str) or not 0<len(action['goal'])<=2000:raise ValueError('Tarea diferida inválida.')
            elif action.get('type')=='drive_upload':
                if set(action)-{'type','folder_id','folder_name'} or not (action.get('folder_id') or action.get('folder_name')):raise ValueError('Indica la carpeta de Drive de destino.')
                for key in ('folder_id','folder_name'):
                    if key in action and (not isinstance(action[key],str) or not 0<len(action[key])<=180):raise ValueError('Destino inválido.')
            elif action!={'type':'whatsapp_self_link'}:raise ValueError('Acción de entrega no admitida.')
        for index,action in enumerate(actions):
            if action['type']=='whatsapp_self_link' and not any(a['type']=='drive_upload' for a in actions[:index]):raise ValueError('Se necesita una carga comprobada antes del WhatsApp.')
        reviewed=not any(action['type'] in {'drive_upload','whatsapp_self_link'} for action in actions)
        value={'id':str(uuid4()),'when':when,'actions':actions,'roots':list(roots),'selected':list(selected),'state':'waiting' if reviewed else 'draft','phase':'Esperando el evento' if reviewed else 'Revisa y activa la entrega diferida',
               'created_at':self.now(),'index':0,'step_state':{},'results':[],'source_job_id':when.get('job_id'),'revision':0}
        return self.public(self.store.save(value,new=True))
    def activate(self,identifier):
        with self.lock:
            value=self.store.get(identifier)
            if not value or value['state']!='draft':raise ValueError('La espera no está pendiente de activación.')
            value.update(state='waiting',phase='Autorizada: esperando el evento',approved_at=self.now())
            return self.public(self.store.save(value))
    def observe_job(self,job,workspace):
        path=(job.get('result') or {}).get('video_path')
        if job.get('state')!='succeeded' or not path:return
        file=Path(path).absolute()
        if file.resolve()!=file or not file.is_relative_to(Path(workspace).resolve()) or not file.is_file():return
        digest=hashlib.sha256()
        with file.open('rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
        identifier='artifact:'+job['id'];previous=self.store.get(identifier)
        value={'id':identifier,'job_id':job['id'],'state':'succeeded','path':str(file),'size':file.stat().st_size,'sha256':digest.hexdigest(),'revision':previous.get('revision',0) if previous else 0}
        self.store.save(value,kind='artifact',new=previous is None)
    @staticmethod
    def public(value):return {key:value.get(key) for key in ('id','state','phase','when','index','source_job_id')}
    def statuses(self):return [self.public(value) for value in self.store.rules()]
    def cancel(self,identifier):
        with self.lock:
            value=self.store.get(identifier)
            if not value or value['state']=='invalid':raise ValueError('Evento no disponible.')
            if value['state'] not in {'completed','cancelled','uncertain'}:
                value.update(state='cancelled',phase='Cancelado. Comprueba operaciones que ya estuvieran en curso.');self.store.save(value)
            return self.public(value)
    def cancel_all(self):
        for value in self.store.rules():
            if value['state'] in {'waiting','running'}:self.cancel(value['id'])
    def tick(self):
        for rule in self.store.rules():
            if self.stopped.is_set():return
            if rule['state'] not in {'waiting','running'}:continue
            try:self._advance(rule)
            except Exception:
                current=self.store.get(rule['id'])
                if current and current['state'] not in {'invalid','cancelled'}:
                    current.update(state='uncertain' if current.get('step_state',{}).get('state')=='started' else 'awaiting_user',phase='No se confirmó el siguiente paso. Revisa permisos, destino y resultados; no se reintentará.');self.store.save(current)
    def _advance(self,value):
        when=value['when'];state=value.get('step_state',{})
        if value['state']=='waiting':
            if when['type']=='at':
                instant=datetime.fromisoformat(when['at'].replace('Z','+00:00')).timestamp()
                if self.now()<instant:return
                if self.now()-instant>60:value.update(state='missed',phase='La hora pasó mientras Brivany no ejecutaba la espera. No se recuperó automáticamente.');self.store.save(value);return
            elif when['type']=='job_succeeded':
                job=self.job(when['job_id'])
                if not job or job['state'] in {'queued','planning','running'}:return
                if job['state']!='succeeded':value.update(state='awaiting_user',phase='La tarea de origen no terminó correctamente. No se entregará un resultado sin comprobar.');self.store.save(value);return
            value.update(state='running',phase='Ejecutando el siguiente paso');value=self.store.save(value)
        action=value['actions'][value['index']]
        if state.get('state')=='started':raise ValueError('Resultado incierto; no repetir.')
        if action['type']=='task' and state.get('state')=='waiting':
            job=self.job(state['job_id'])
            if job and job['state'] in {'queued','planning','running'}:return
            if not job or job['state']!='succeeded':raise ValueError('La tarea diferida no terminó.')
            value['source_job_id']=job['id'];result={'job_id':job['id'],'state':'done'}
        else:
            if not state:
                value['step_state']={'state':'started'};value=self.store.save(value)
            if action['type']=='task':
                job=self.task(action['kind'],action['goal'],value);result={'state':'waiting','job_id':job['id']}
            else:result=self.delivery(action,value,state)
        if result.get('state')=='waiting':value['step_state']=result;self.store.save(value);return
        value['results'].append(result);value['index']+=1;value['step_state']={}
        if value['index']>=len(value['actions']):value.update(state='completed',phase='Pasos confirmados. La aceptación de WhatsApp no acredita entrega al teléfono.')
        else:value['phase']='Esperando el siguiente paso'
        self.store.save(value)
    def _run(self):
        while not self.stopped.wait(1):
            try:self.tick()
            except Exception:pass
    def start(self):
        if not self.thread:self.thread=threading.Thread(target=self._run,daemon=True,name='melodi-events');self.thread.start()
    def close(self):
        self.stopped.set()
        if self.thread and self.thread is not threading.current_thread():self.thread.join(timeout=2)
