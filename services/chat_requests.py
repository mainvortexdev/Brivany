"""Own-chat commands become private typed requests, never remote approvals.

Only explicit slash commands are parsed. An authenticated WhatsApp message does
not grant account/system permissions: requests still need local exact review.
This database deliberately holds private requested fields, not conversations or
development evidence. No model, account transport or background worker runs here.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import time
from uuid import UUID,uuid5,NAMESPACE_URL

from services.integrations import IntegrationError,_parameters
from services.personal_notes import _moment

HELP='Prepara una solicitud con /recordatorio fecha-ISO-con-zona | texto, /nota título | texto, /agenda inicio-ISO | fin-ISO, /drive búsqueda, /gmail búsqueda o /borrador correo | asunto | texto. Luego revísala en Conexiones de Brivany. No se ejecuta desde este mensaje.'


def fail(code='chat_request',message='Revisa los datos de la solicitud del chat.',status=422):raise IntegrationError(code,message,status)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def sha(value):return hashlib.sha256(value.encode('utf-8')).hexdigest()
def identifier(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except (TypeError,ValueError,AttributeError):fail('chat_request_missing','Solicitud no disponible.',404)
    return value


def parse_command(text,config):
    if not isinstance(text,str) or not 1<=len(text.strip())<=1200:fail()
    text=text.strip()
    if not text.startswith('/'):return None
    command,_,body=text.partition(' ');command=command.lower();parts=[part.strip() for part in body.split('|')]
    if command=='/ayuda':return {'kind':'help'}
    if command=='/recordatorio' and len(parts)==2 and all(parts):
        declared,_=_moment(parts[0])
        if len(parts[1])>1000 or any(ord(char)<32 for char in parts[1]):fail()
        return {'kind':'personal','operation':'reminder.create','parameters':{'text':parts[1],'at':declared,'channel':'local'}}
    if command=='/nota' and len(parts)==2 and all(parts):
        if len(parts[0])>120 or len(parts[1])>1000 or any(ord(char)<32 and char not in '\n\t' for char in body):fail()
        return {'kind':'personal','operation':'note.create','parameters':{'title':parts[0],'body':parts[1]}}
    if command=='/agenda' and len(parts)==2:operation='calendar.list';parameters=dict(zip(('start','end'),parts))
    elif command=='/evento':fail('calendar_read_only','Google Calendar en Desktop permite solo consultar la agenda.',403)
    elif command in {'/drive','/gmail'} and body.strip():operation=command[1:]+'.search';parameters={'query':body.strip()}
    elif command=='/borrador' and len(parts)==3:operation='gmail.draft';parameters=dict(zip(('to','subject','body'),parts))
    else:fail('chat_command_format',HELP)
    return {'kind':'integration','operation':operation,'parameters':_parameters(operation,parameters,config)}


class ChatRequestsService:
    def __init__(self,root,*,config_provider,now=None):
        self.root=Path(root).absolute();self.path=self.root/'chat-requests.sqlite3';self.config_provider=config_provider;self.now=now or time.time
        if self.root.resolve()!=self.root or self.path.resolve()!=self.path:fail('chat_storage','El almacén del chat no puede redirigirse.',503)
        self.root.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS chat_requests(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,sender_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,created_at REAL NOT NULL,expires_at REAL NOT NULL,document TEXT NOT NULL,action_sha256 TEXT NOT NULL,result_id TEXT,error_code TEXT)')

    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:db.execute('PRAGMA trusted_schema=OFF');db.execute('BEGIN IMMEDIATE');yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def configuration(self):
        config=self.config_provider()
        if not isinstance(config,dict):fail('chat_disabled','La configuración del chat no está disponible.',503)
        return config

    def _consent(self,sender_sha256=None):
        config=self.configuration();own=config.get('self_recipient')
        if (config.get('chat_requests_enabled') is not True or config.get('webhook_enabled') is not True or not isinstance(own,str)
            or own not in config.get('allowed_senders',[]) or own not in config.get('opted_in_recipients',[])
            or sender_sha256 is not None and sha(own)!=sender_sha256):
            fail('chat_disabled','Las solicitudes del chat propio están deshabilitadas o su consentimiento cambió.',403)
        return config,own

    def accept(self,event_id,text,sender):
        """Called only after the gateway has validated signature/own sender/time."""
        identifier(event_id);config,own=self._consent()
        if sender!=own:fail('chat_sender','Sólo se admiten solicitudes del chat propio.',403)
        command=parse_command(text,config)
        if command is None:return None
        if command['kind']=='help':return {'reply':HELP,'request':None,'model_needed':False}
        encoded=canonical(command);digest=sha(encoded);stamp=self.now();request_id=str(uuid5(NAMESPACE_URL,'brivany:chat-request:'+event_id))
        with self.db() as db:
            previous=db.execute('SELECT * FROM chat_requests WHERE event_id=?',(event_id,)).fetchone()
            if previous and (previous['action_sha256']!=digest or previous['sender_sha256']!=sha(sender)):fail('chat_event_conflict','La solicitud cambió respecto al mensaje recibido.',409)
            if previous is None:
                if db.execute("SELECT count(*) FROM chat_requests WHERE created_at>=?",(stamp-86400,)).fetchone()[0]>=100:fail('chat_daily_limit','Se alcanzó el límite de solicitudes del chat.',429)
                if db.execute("SELECT count(*) FROM chat_requests WHERE state='pending' AND expires_at>?",(stamp,)).fetchone()[0]>=100:fail('chat_pending_limit','Revisa las solicitudes pendientes antes de preparar otras.',429)
                db.execute('INSERT INTO chat_requests VALUES(?,?,?,1,?,?,?,?,?,NULL,NULL)',(request_id,event_id,sha(sender),'pending',stamp,stamp+86400,encoded,digest))
        return {'reply':'Solicitud preparada para revisar en Conexiones de Brivany. Aún no se ha ejecutado.','request':self.get(request_id),'model_needed':False}

    def _public(self,row):
        value=dict(row);value.pop('sender_sha256');value.pop('event_id');value['action']=json.loads(value.pop('document'))
        if value['state']=='started':value['state']='uncertain'
        if value['state']=='pending' and value['expires_at']<=self.now():value['state']='expired'
        return {**value,'original_message_stored':False,'private_requested_fields_stored':True,'remote_approval':False,'automatic_execution':False}

    def get(self,request_id):
        identifier(request_id)
        with self.db() as db:row=db.execute('SELECT * FROM chat_requests WHERE id=?',(request_id,)).fetchone()
        if row is None:fail('chat_request_missing','Solicitud no disponible.',404)
        return self._public(row)

    def list(self):
        with self.db() as db:rows=db.execute("SELECT * FROM chat_requests WHERE state IN ('pending','started','uncertain') AND expires_at>? ORDER BY created_at DESC LIMIT 100",(self.now(),)).fetchall()
        return {'items':[self._public(row) for row in rows],'remote_approvals_supported':False,'help':HELP}

    def _review(self,request_id,expected_revision,expected_sha256):
        value=self.get(request_id)
        if type(expected_revision) is not int or value['revision']!=expected_revision or value['action_sha256']!=expected_sha256:fail('chat_request_conflict','La solicitud cambió. Actualiza antes de continuar.',409)
        if value['state']!='pending':fail('chat_request_state','La solicitud ya no está pendiente.',409)
        with self.db() as db:sender=db.execute('SELECT sender_sha256 FROM chat_requests WHERE id=?',(request_id,)).fetchone()[0]
        self._consent(sender)
        return value

    def propose(self,request_id,expected_revision,expected_sha256,integration):
        value=self._review(request_id,expected_revision,expected_sha256)
        if value['action']['kind']!='integration':fail('chat_request_kind','Esta solicitud se confirma como nota o recordatorio local.')
        action=value['action'];proposed=integration.propose(action['operation'],action['parameters'],origin='whatsapp_webhook',request_id=request_id)
        with self.db() as db:db.execute("UPDATE chat_requests SET result_id=? WHERE id=? AND state='pending'",(proposed['id'],request_id))
        return proposed

    def settle(self,request_id,expected_revision,integration):
        value=self.get(request_id)
        if type(expected_revision) is not int or value['revision']!=expected_revision or value['state']!='pending' or not value['result_id']:fail('chat_request_conflict','La solicitud no tiene una ejecución revisada.',409)
        receipt=integration.inspect(value['result_id'])
        states={'succeeded':'completed','succeeded_test_stub':'completed_test_stub','failed':'failed','failed_test_stub':'failed_test_stub','uncertain':'uncertain'}
        state=states.get(receipt['state'])
        if state is None:fail('chat_request_pending','La acción todavía requiere revisión o ejecución.',409)
        with self.db() as db:
            if db.execute("UPDATE chat_requests SET state=?,revision=revision+1 WHERE id=? AND revision=? AND state='pending'",(state,request_id,expected_revision)).rowcount!=1:fail('chat_request_conflict','La solicitud cambió.',409)
        return self.get(request_id)

    def execute_local(self,request_id,expected_revision,expected_sha256,personal,*,execute=False):
        if execute is not True:fail('chat_local_confirmation','Confirma esta acción local desde Brivany.',403)
        value=self._review(request_id,expected_revision,expected_sha256)
        action=value['action']
        if action['kind']!='personal':fail('chat_request_kind','Esta solicitud requiere la revisión del conector.')
        with self.db() as db:
            changed=db.execute("UPDATE chat_requests SET state='started',revision=revision+1 WHERE id=? AND revision=? AND state='pending'",(request_id,expected_revision)).rowcount
            if changed!=1:fail('chat_request_conflict','La solicitud ya se procesó.',409)
        try:
            result=personal.create_reminder(action['parameters']) if action['operation']=='reminder.create' else personal.save_note({**action['parameters'],'expected_revision':0})
            state='completed';error=None
        except Exception:
            # A crash or storage failure across the two private databases is not
            # evidence that no write happened. Do not replay that ambiguity.
            result=None;state='uncertain';error='chat_local_outcome_unknown'
        with self.db() as db:db.execute('UPDATE chat_requests SET state=?,revision=revision+1,result_id=?,error_code=? WHERE id=?',(state,result.get('id') if result else None,error,request_id))
        return {'request':self.get(request_id),'result':result,'external_calls':0}

    def dismiss(self,request_id,expected_revision):
        value=self.get(request_id)
        if type(expected_revision) is not int or value['revision']!=expected_revision or value['state']!='pending':fail('chat_request_conflict','La solicitud cambió.',409)
        with self.db() as db:
            if db.execute("UPDATE chat_requests SET state='dismissed',revision=revision+1 WHERE id=? AND revision=? AND state='pending'",(request_id,expected_revision)).rowcount!=1:fail('chat_request_conflict','La solicitud cambió.',409)
        return self.get(request_id)
