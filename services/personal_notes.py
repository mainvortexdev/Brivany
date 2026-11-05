"""Private reminders and authored kitchen notes, independent of development logs.

Construction never starts a worker, requests permissions, or contacts a provider.
Due local reminders are persistent UI items, not an OS alarm guarantee. WhatsApp
delivery needs an explicitly enabled scheduler, current own-chat consent, and a
trusted backend observation of the provider's service window. One claimed attempt
is never replayed after an uncertain outcome or restart. Acceptance is not delivery.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import threading
import time
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL

from packages.providers.personal import WhatsAppTransport
from services.integrations import IntegrationResult

MAX_ACTIVE_REMINDERS=500
MAX_NOTES=1000
DEFAULT_DAILY_CAP=20
REMINDER_STATES={'scheduled','local_due','delivering','accepted_delivery_pending','accepted_test_stub','delivery_blocked','uncertain','completed','cancelled'}


class PersonalNotesError(ValueError):
    def __init__(self,code,message,status=422):self.code,self.status=code,status;super().__init__(message)


def _fail(code='personal_input',message='Revisa los datos del recordatorio o la nota.',status=422):
    raise PersonalNotesError(code,message,status)


def _fields(value,allowed,required=()):
    if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value):_fail()


def _id(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except (ValueError,TypeError,AttributeError):_fail('personal_not_found','El registro no está disponible.',404)
    return value


def _text(value,maximum=1000,*,multiline=False):
    if not isinstance(value,str) or not 1<=len(value.strip())<=maximum or any(ord(char)<32 and not (multiline and char in '\n\t') for char in value):_fail()
    return value.strip()


def _hash(value):return hashlib.sha256(value.encode('utf-8')).hexdigest()
def _json(value):return json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))
def _stamp(timestamp):return datetime.fromtimestamp(timestamp,timezone.utc).isoformat()


def _moment(value):
    if not isinstance(value,str) or len(value)>64:_fail('reminder_date','Indica fecha y hora con su zona horaria.')
    try:
        moment=datetime.fromisoformat(value.replace('Z','+00:00'))
        if moment.tzinfo is None or moment.utcoffset() is None:raise ValueError()
        timestamp=moment.timestamp()
        if not math.isfinite(timestamp) or not 0<=timestamp<4102444800:raise ValueError()
    except (ValueError,TypeError,OverflowError):_fail('reminder_date','Indica fecha y hora válidas con su zona horaria.')
    return moment.isoformat(),timestamp


class PersonalNotesService:
    def __init__(self,root,*,config_provider=None,outbound=None,now=None,allow_whatsapp_delivery=False,
                 window_provider=None,daily_cap=DEFAULT_DAILY_CAP):
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root:_fail('personal_storage','El almacén personal no puede redirigirse.',503)
        self.root.mkdir(parents=True,exist_ok=True);self.database=self.root/'personal-notes.sqlite3'
        if self.database.resolve()!=self.database:_fail('personal_storage','El diario personal no puede redirigirse.',503)
        if type(allow_whatsapp_delivery) is not bool or type(daily_cap) is not int or not 1<=daily_cap<=100:_fail()
        self.config_provider=config_provider;self.outbound=outbound;self.now=now or time.time
        self.allow_whatsapp_delivery=allow_whatsapp_delivery;self.window_provider=window_provider;self.daily_cap=daily_cap
        self.lock=threading.RLock();self.stop_event=threading.Event();self.thread=None
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS personal_reminders(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,due_at REAL NOT NULL,state TEXT NOT NULL,document TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS reminder_attempts(id TEXT PRIMARY KEY,reminder_id TEXT NOT NULL,generation INTEGER NOT NULL,day TEXT NOT NULL,claimed_at REAL NOT NULL,state TEXT NOT NULL,receipt_sha256 TEXT,error_code TEXT,UNIQUE(reminder_id,generation))')
            db.execute('CREATE TABLE IF NOT EXISTS personal_notes(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,archived INTEGER NOT NULL,document TEXT NOT NULL)')

    @contextmanager
    def _db(self):
        db=sqlite3.connect(self.database,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA trusted_schema=OFF');db.execute('BEGIN IMMEDIATE');yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    @staticmethod
    def _read(db,identifier):
        row=db.execute('SELECT * FROM personal_reminders WHERE id=?',(_id(identifier),)).fetchone()
        if row is None:_fail('personal_not_found','El recordatorio no está disponible.',404)
        value=json.loads(row['document'])
        if value['revision']!=row['revision'] or value['state']!=row['state']:_fail('personal_storage','El recordatorio no coincide con su diario.',503)
        return value

    @staticmethod
    def _write(db,value):
        db.execute('INSERT OR REPLACE INTO personal_reminders VALUES(?,?,?,?,?)',(value['id'],value['revision'],value['due_at_epoch'],value['state'],_json(value)))

    @staticmethod
    def _revision(value,expected):
        if type(expected) is not int or expected!=value['revision']:_fail('personal_conflict','El registro cambió. Actualiza antes de guardar.',409)

    def _own_chat(self,expected_hash=None):
        if self.config_provider is None:_fail('reminder_chat_pending','Configura primero tu chat propio.',503)
        try:config=self.config_provider()
        except Exception:_fail('reminder_chat_pending','No se pudo comprobar la configuración del chat propio.',503)
        if not isinstance(config,dict):_fail('reminder_chat_pending','La configuración del chat propio no es válida.',503)
        recipient=config.get('self_recipient')
        if (config.get('execution_enabled') is not True or not isinstance(config.get('opted_in_recipients'),list) or
            not isinstance(config.get('allowed_senders'),list) or not isinstance(recipient,str) or not re.fullmatch('[1-9][0-9]{6,14}',recipient) or
            recipient not in config.get('opted_in_recipients',[]) or recipient not in config.get('allowed_senders',[])):
            _fail('reminder_chat_consent','Autoriza primero tu chat propio para recibir recordatorios.',403)
        if expected_hash is not None and _hash(recipient)!=expected_hash:_fail('reminder_chat_changed','El destinatario propio cambió. Revisa este recordatorio.',409)
        return config,recipient

    def status(self):
        with self._db() as db:
            day=datetime.fromtimestamp(self.now(),timezone.utc).date().isoformat()
            attempts=db.execute('SELECT count(*) FROM reminder_attempts WHERE day=?',(day,)).fetchone()[0]
            counts=dict(db.execute('SELECT state,count(*) FROM personal_reminders GROUP BY state').fetchall())
        return {'scheduler_running':bool(self.thread and self.thread.is_alive()),'whatsapp_delivery_enabled':self.allow_whatsapp_delivery,
            'attempts_today_utc':attempts,'daily_attempt_cap':self.daily_cap,'states':counts,
            'local_delivery':'persistent_due_list_requires_open_app','os_background_alarm_implemented':False,
            'provider_service_window_verified':False,'automatic_scheduler_started':False,'external_calls_triggered_by_status':0}

    def create_reminder(self,payload):
        _fields(payload,{'text','at','channel','delivery_authorized'},{'text','at','channel'})
        channel=payload['channel']
        if not isinstance(channel,str) or channel not in {'local','whatsapp'} or type(payload.get('delivery_authorized',False)) is not bool:_fail()
        declared,due=_moment(payload['at']);recipient_hash=None
        if channel=='whatsapp':
            if payload.get('delivery_authorized') is not True:_fail('reminder_delivery_consent','Confirma que quieres enviar este recordatorio a tu chat propio.',403)
            _,recipient=self._own_chat();recipient_hash=_hash(recipient)
        now=self.now();value={'schema_version':'personal-reminder-1','id':str(uuid4()),'revision':1,
            'text':_text(payload['text']),'at':_stamp(due),'declared_at':declared,'due_at_epoch':due,'channel':channel,
            'recipient_sha256':recipient_hash,'delivery_authorized':channel=='whatsapp','generation':1,'state':'scheduled',
            'created_at':_stamp(now),'updated_at':_stamp(now),'local_ready_at':None,'attempt_id':None,
            'accepted_by_provider':False,'delivery_verified':False,'error_code':None}
        with self._db() as db:
            if db.execute("SELECT count(*) FROM personal_reminders WHERE state NOT IN ('cancelled','completed')").fetchone()[0]>=MAX_ACTIVE_REMINDERS:
                _fail('reminder_limit','Hay demasiados recordatorios activos.',429)
            self._write(db,value)
        return deepcopy(value)

    def get_reminder(self,identifier):
        with self._db() as db:return self._read(db,identifier)

    def list_reminders(self,*,include_finished=False,limit=100):
        if type(include_finished) is not bool or type(limit) is not int or not 1<=limit<=200:_fail()
        with self._db() as db:
            rows=db.execute('SELECT document FROM personal_reminders '+('' if include_finished else "WHERE state NOT IN ('completed','cancelled') ")+'ORDER BY due_at,id LIMIT ?',(limit+1,)).fetchall()
        return {'items':[json.loads(row[0]) for row in rows[:limit]],'more_available':len(rows)>limit,
            'local_alarm_requires_open_app':True,'os_background_alarm_implemented':False}

    def update_reminder(self,identifier,payload):
        _fields(payload,{'expected_revision','text','at'},{'expected_revision'})
        if not ({'text','at'}&set(payload)):_fail()
        with self._db() as db:
            value=self._read(db,identifier);self._revision(value,payload['expected_revision'])
            if value['state'] not in {'scheduled','local_due','delivery_blocked'}:_fail('reminder_state','Este recordatorio ya no admite cambios de entrega.',409)
            if 'text' in payload:value['text']=_text(payload['text'])
            if 'at' in payload:
                declared,due=_moment(payload['at']);value.update(declared_at=declared,at=_stamp(due),due_at_epoch=due,generation=value['generation']+1,state='scheduled',attempt_id=None,local_ready_at=None,error_code=None)
            value['revision']+=1;value['updated_at']=_stamp(self.now());self._write(db,value)
        return value

    def complete_reminder(self,identifier,expected_revision):return self._finish(identifier,expected_revision,'completed')
    def cancel_reminder(self,identifier,expected_revision):return self._finish(identifier,expected_revision,'cancelled')

    def _finish(self,identifier,expected_revision,state):
        with self._db() as db:
            value=self._read(db,identifier);self._revision(value,expected_revision)
            value.update(state=state,revision=value['revision']+1,updated_at=_stamp(self.now()));self._write(db,value)
        return value

    def snooze_reminder(self,identifier,payload):
        _fields(payload,{'expected_revision','at'},{'expected_revision','at'})
        return self.update_reminder(identifier,payload)

    def _claim(self,identifier):
        day=datetime.fromtimestamp(self.now(),timezone.utc).date().isoformat()
        with self._db() as db:
            value=self._read(db,identifier)
            if value['state']!='scheduled' or value['due_at_epoch']>self.now():return None
            if value['channel']=='local':
                value.update(state='local_due',local_ready_at=_stamp(self.now()),revision=value['revision']+1,updated_at=_stamp(self.now()));self._write(db,value);return value
            if not self.allow_whatsapp_delivery:return None
            if db.execute('SELECT count(*) FROM reminder_attempts WHERE day=?',(day,)).fetchone()[0]>=self.daily_cap:return None
            attempt=str(uuid5(NAMESPACE_URL,'brivany:reminder:'+identifier+':'+str(value['generation'])))
            if db.execute('SELECT 1 FROM reminder_attempts WHERE id=?',(attempt,)).fetchone():return None
            db.execute('INSERT INTO reminder_attempts VALUES(?,?,?,?,?,?,NULL,NULL)',(attempt,identifier,value['generation'],day,self.now(),'claimed'))
            value.update(state='delivering',attempt_id=attempt,revision=value['revision']+1,updated_at=_stamp(self.now()));self._write(db,value);return value

    def _can_send(self,value):
        config,recipient=self._own_chat(value['recipient_sha256'])
        if self.outbound is None:_fail('reminder_outbound_pending','El transporte de recordatorios todavía no está conectado.',503)
        if self.window_provider is None:_fail('reminder_window_unverified','No hay una ventana WhatsApp verificada para enviar texto libre.',409)
        try:expiry=self.window_provider(recipient)
        except Exception:_fail('reminder_window_unverified','No se pudo comprobar la ventana de atención WhatsApp.',409)
        if type(expiry) not in (int,float) or not math.isfinite(expiry) or not self.now()<expiry<=self.now()+86400:
            _fail('reminder_window_unverified','La ventana WhatsApp no está vigente. Las plantillas quedan pendientes.',409)
        if isinstance(self.outbound,WhatsAppTransport):self.outbound.config=config
        return recipient

    def _set_attempt(self,value,state,*,error_code=None,receipt=None,accepted=False):
        with self._db() as db:
            current=self._read(db,value['id'])
            # A user can cancel/complete while a request is outstanding. Never
            # overwrite their local state; keep the delivery outcome separately.
            target=state if current['state']=='delivering' else current['state']
            current.update(state=target,revision=current['revision']+1,updated_at=_stamp(self.now()),accepted_by_provider=accepted,error_code=error_code)
            self._write(db,current)
            db.execute('UPDATE reminder_attempts SET state=?,receipt_sha256=?,error_code=? WHERE id=?',(state,_hash(receipt) if receipt else None,error_code,value['attempt_id']))
        return current

    def run_due(self,*,limit=10):
        if type(limit) is not int or not 1<=limit<=20:_fail()
        if self.stop_event.is_set():return {'processed':0,'items':[],'delivery_verified':False,'automatic_retries':0}
        with self._db() as db:ids=[row[0] for row in db.execute("SELECT id FROM personal_reminders WHERE state='scheduled' AND due_at<=? ORDER BY due_at,id LIMIT ?",(self.now(),limit))]
        results=[]
        for identifier in ids:
            value=self._claim(identifier)
            if value is None:continue
            if value['channel']=='local':results.append(value);continue
            try:
                recipient=self._can_send(value)
                current=self.get_reminder(identifier)
                if current['state']!='delivering':
                    results.append(self._set_attempt(value,'cancelled_before_send'));continue
                if self.stop_event.is_set():
                    results.append(self._set_attempt(value,'delivery_blocked',error_code='reminder_scheduler_stopped'));continue
                # Re-check withdrawal after a potentially slow window lookup.
                self._own_chat(value['recipient_sha256'])
            except PersonalNotesError as exc:
                results.append(self._set_attempt(value,'delivery_blocked',error_code=exc.code));continue
            try:
                result=self.outbound.execute('whatsapp.send',{'recipient':recipient,'text':value['text']},value['attempt_id'])
                if not isinstance(result,IntegrationResult) or result.outcome!='succeeded' or not isinstance(result.receipt,str) or not 1<=len(result.receipt)<=200:raise ValueError()
                state='accepted_test_stub' if getattr(self.outbound,'simulation',False) else 'accepted_delivery_pending'
                results.append(self._set_attempt(value,state,receipt=result.receipt,accepted=True))
            except Exception:
                results.append(self._set_attempt(value,'uncertain',error_code='reminder_delivery_outcome_unknown'))
        return {'processed':len(results),'items':results,'delivery_verified':False,'automatic_retries':0}

    def start_scheduler(self,*,interval_seconds=5,limit=10):
        if type(interval_seconds) not in (int,float) or not 1<=interval_seconds<=60 or type(limit) is not int or not 1<=limit<=20:_fail()
        with self.lock:
            if self.thread and self.thread.is_alive():return self.status()
            if self.stop_event.is_set():_fail('reminder_scheduler_closed','Crea una instancia nueva para volver a iniciar el planificador.',409)
            def loop():
                while not self.stop_event.is_set():
                    try:self.run_due(limit=limit)
                    except Exception:pass
                    self.stop_event.wait(interval_seconds)
            self.thread=threading.Thread(target=loop,name='brivany-personal-reminders',daemon=True);self.thread.start()
        return self.status()

    def close(self):
        self.stop_event.set()
        if self.thread and self.thread is not threading.current_thread():self.thread.join(timeout=3)

    def save_note(self,payload):
        _fields(payload,{'id','expected_revision','title','body'},{'expected_revision','title','body'})
        identifier=_id(payload['id']) if 'id' in payload else str(uuid4());title=_text(payload['title'],120);body=_text(payload['body'],4000,multiline=True)
        with self._db() as db:
            row=db.execute('SELECT document FROM personal_notes WHERE id=?',(identifier,)).fetchone()
            if row:
                value=json.loads(row[0]);self._revision(value,payload['expected_revision'])
                if value['archived']:_fail('note_archived','La nota está archivada.',409)
                value.update(title=title,body=body,revision=value['revision']+1,updated_at=_stamp(self.now()))
            else:
                if type(payload['expected_revision']) is not int or payload['expected_revision']!=0 or 'id' in payload:_fail('personal_conflict','Esta nota no existe en la revisión indicada.',409)
                if db.execute('SELECT count(*) FROM personal_notes').fetchone()[0]>=MAX_NOTES:_fail('note_limit','El almacén de notas alcanzó su límite.',429)
                value={'id':identifier,'revision':1,'title':title,'body':body,'kind':'personal','source_revision':None,'archived':False,'created_at':_stamp(self.now()),'updated_at':_stamp(self.now())}
            db.execute('INSERT OR REPLACE INTO personal_notes VALUES(?,?,?,?)',(identifier,value['revision'],int(value['archived']),_json(value)))
        return value

    def list_notes(self,*,include_archived=False,limit=100):
        if type(include_archived) is not bool or type(limit) is not int or not 1<=limit<=200:_fail()
        with self._db() as db:rows=db.execute('SELECT document FROM personal_notes '+('' if include_archived else 'WHERE archived=0 ')+'ORDER BY id LIMIT ?',(limit+1,)).fetchall()
        return {'items':[json.loads(row[0]) for row in rows[:limit]],'more_available':len(rows)>limit,'automatic_whatsapp_send':False}

    def archive_note(self,identifier,expected_revision):
        with self._db() as db:
            row=db.execute('SELECT document FROM personal_notes WHERE id=?',(_id(identifier),)).fetchone()
            if not row:_fail('personal_not_found','La nota no está disponible.',404)
            value=json.loads(row[0]);self._revision(value,expected_revision);value.update(archived=True,revision=value['revision']+1,updated_at=_stamp(self.now()))
            db.execute('UPDATE personal_notes SET revision=?,archived=1,document=? WHERE id=?',(value['revision'],_json(value),identifier))
        return value

    def capture_sous_note(self,snapshot,*,kind='shopping',explicit=False):
        if explicit is not True:_fail('note_consent','Elige guardar una nota de cocina antes de continuar.',403)
        if not isinstance(snapshot,dict) or kind not in {'shopping','activity'}:_fail()
        if kind=='shopping':
            if type(snapshot.get('revision')) is not int or snapshot['revision']<1 or not isinstance(snapshot.get('items'),list) or len(snapshot['items'])>100:_fail()
            lines=[]
            for item in snapshot['items']:
                if not isinstance(item,dict):_fail()
                if item.get('checked') is True:continue
                label=_text(item.get('label'),120);quantity=item.get('quantity');unit=item.get('unit')
                if type(quantity) not in (int,float) or not math.isfinite(quantity) or not 0<quantity<=1000000 or unit not in {'unit','g','kg','ml','l'}:_fail()
                lines.append(f'- {quantity:g} {unit} de {label}')
            if not lines:lines=['Sin ingredientes pendientes.']
            title='Lista de compras · Sous';body='Lista declarada en Sous. Revisa cantidades antes de comprar.\n'+'\n'.join(lines)
        else:
            if type(snapshot.get('revision')) is not int or snapshot['revision']<1 or not isinstance(snapshot.get('steps'),list) or len(snapshot['steps'])>30 or any(not isinstance(step,dict) for step in snapshot['steps']):_fail()
            title='Práctica de cocina · Sous';recipe=_text(snapshot.get('recipe_title','Práctica de cocina'),120)
            completed=[_text(step.get('label'),120) for step in snapshot['steps'] if step.get('state')=='ready']
            body=recipe+'\nPasos marcados por revisión: '+(', '.join(completed) if completed else 'ninguno')+'.\nRegistro de práctica; no certifica dominio, temperatura ni inocuidad.'
        if len(body)>4000:_fail('note_size','La nota completa supera el límite. Guarda una selección más breve.',413)
        with self._db() as db:
            if db.execute('SELECT count(*) FROM personal_notes').fetchone()[0]>=MAX_NOTES:_fail('note_limit','El almacén de notas alcanzó su límite.',429)
            value={'id':str(uuid4()),'revision':1,'title':title,'body':body,'kind':'sous_'+kind,'source_revision':snapshot['revision'],
                'archived':False,'created_at':_stamp(self.now()),'updated_at':_stamp(self.now())}
            db.execute('INSERT INTO personal_notes VALUES(?,?,0,?)',(value['id'],1,_json(value)))
        return {**value,'automatic_whatsapp_send':False,'requires_review_before_sending':True}
