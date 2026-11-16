"""Local connector registry, private webhook inbox and action approval journal.

This module journals reviewed actions; dedicated Google/WhatsApp adapters can
execute only after explicit configuration and approval. A signed WhatsApp message is
untrusted content, never an approval or permission to control the computer.
Inbound text stays in bounded process memory; SQLite retains hashes only.
"""
from __future__ import annotations
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from typing import Protocol
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

GRAPH_API_VERSION='v26.0'
WHATSAPP_MESSAGES_ENDPOINT='https://graph.facebook.com/'+GRAPH_API_VERSION+'/{phone_number_id}/messages'
MAX_WEBHOOK=65536
SOURCES={
    'graph_version':'https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/apiconfig.py',
    'webhook_example':'https://github.com/fbsamples/whatsapp-api-examples/tree/main/signature-validation-with-webhooks-payloads',
    'messages':'https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages',
    'webhook_reference':'https://developers.facebook.com/docs/graph-api/webhooks/getting-started',
}
CONNECTORS={
    'whatsapp':{'label':'WhatsApp Business','env':['BRIVANY_WHATSAPP_ACCESS_TOKEN','BRIVANY_META_APP_SECRET','BRIVANY_WHATSAPP_VERIFY_TOKEN'],'pending':['registered_business_phone','public_https_webhook','app_permissions','real_transport','recipient_opt_in']},
    'calendar':{'label':'Google Calendar','env':['BRIVANY_GOOGLE_CLIENT_ID','BRIVANY_GOOGLE_CLIENT_SECRET','BRIVANY_GOOGLE_REFRESH_TOKEN'],'pending':['oauth_consent','scoped_account_access','real_transport']},
    'gmail':{'label':'Gmail','env':['BRIVANY_GOOGLE_CLIENT_ID','BRIVANY_GOOGLE_CLIENT_SECRET','BRIVANY_GOOGLE_REFRESH_TOKEN'],'pending':['oauth_consent','scoped_account_access','real_transport']},
    'drive':{'label':'Google Drive','env':['BRIVANY_GOOGLE_CLIENT_ID','BRIVANY_GOOGLE_CLIENT_SECRET','BRIVANY_GOOGLE_REFRESH_TOKEN'],'pending':['oauth_consent','scoped_account_access','real_transport']},
    'facebook':{'label':'Facebook','env':['BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN'],'pending':['page_access','declared_permissions','real_access_verification']},
    'instagram':{'label':'Instagram','env':['BRIVANY_INSTAGRAM_ACCESS_TOKEN'],'pending':['professional_account','facebook_login_permissions','real_access_verification']},
    'ads':{'label':'Instagram y Facebook Ads','env':['BRIVANY_META_ADS_ACCESS_TOKEN'],'pending':['business_account','ad_account_permissions','reviewed_budget','real_transport']},
    'system':{'label':'Proyectos en este equipo','env':[],'pending':['reviewed_desktop_adapter']},
    'reminder':{'label':'Recordatorios','env':[],'pending':['delivery_adapter']},
}
OPERATIONS={
    'calendar.create':('calendar','consequential'), 'calendar.list':('calendar','read_only'),
    'gmail.search':('gmail','read_only'), 'gmail.draft':('gmail','reversible'),
    'drive.search':('drive','read_only'), 'system.open_project':('system','reversible'),
    'reminder.prepare':('reminder','reversible'), 'ads.prepare':('ads','reversible'),
    'delivery.prepare':('whatsapp','reversible'), 'whatsapp.send':('whatsapp','consequential'),
    'facebook.publish_text':('facebook','consequential'),
    'instagram.create_container':('instagram','reversible'),
    'instagram.publish_container':('instagram','consequential'),
    'ads.create_paused_campaign':('ads','reversible'),
}
SOCIAL_WRITES={'facebook.publish_text','instagram.create_container','instagram.publish_container','ads.create_paused_campaign'}


class IntegrationError(ValueError):
    def __init__(self,code,message,status=409):self.code,self.status=code,status;super().__init__(message)


@dataclass(frozen=True)
class IntegrationResult:
    outcome: str
    receipt: str | None = None
    payload: dict | None = None


class IntegrationTransport(Protocol):
    simulation: bool
    def execute(self,operation: str,parameters: dict,idempotency_key: str) -> IntegrationResult: ...


def _canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def _hash(value):return hashlib.sha256(value if isinstance(value,bytes) else _canonical(value)).hexdigest()
def _text(value,maximum=1000):
    if not isinstance(value,str) or not 1<=len(value.strip())<=maximum or any(ord(c)<32 for c in value):
        raise IntegrationError('integration_parameters','Revisa los datos de la propuesta.',422)
    return value.strip()
def _uuid(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except (ValueError,TypeError,AttributeError):raise IntegrationError('integration_not_found','Propuesta no disponible.',404) from None
    return value
def _phone(value):
    if not isinstance(value,str) or not re.fullmatch('[1-9][0-9]{6,14}',value):
        raise IntegrationError('integration_recipient','Usa un número internacional sin signo ni espacios.',422)
    return value
def _moment(value):
    try:
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
        if parsed.tzinfo is None:raise ValueError()
        return parsed
    except (ValueError,AttributeError,TypeError):raise IntegrationError('integration_parameters','La fecha debe incluir su zona horaria.',422) from None


def _parameters(operation,value,config):
    if not isinstance(operation,str) or operation not in OPERATIONS or not isinstance(value,dict):raise IntegrationError('integration_operation','Operación no admitida.',422)
    if operation in SOCIAL_WRITES:
        # Content lives in a versioned private social draft. Approval binds its
        # exact digest, revision and optional Instagram container, not mutable text.
        if set(value)!={'draft_id','expected_revision','container_id','action_sha256'}:raise IntegrationError('integration_parameters','Revisa los parámetros del borrador social.',422)
        _uuid(value['draft_id'])
        if type(value['expected_revision']) is not int or value['expected_revision']<1 or not isinstance(value['action_sha256'],str) or not re.fullmatch('[0-9a-f]{64}',value['action_sha256']):raise IntegrationError('integration_parameters','La revisión y hash sociales no son válidos.',422)
        container=value['container_id']
        if (operation=='instagram.publish_container' and (not isinstance(container,str) or not re.fullmatch('[0-9]{5,30}',container))) or (operation!='instagram.publish_container' and container is not None):raise IntegrationError('integration_parameters','El contenedor no corresponde a la acción social.',422)
        return deepcopy(value)
    fields={
        'calendar.create':({'title','start','end'},set()),'calendar.list':({'start','end'},set()),
        'gmail.search':({'query'},set()),'gmail.draft':({'to','subject','body'},set()),'drive.search':({'query'},set()),
        'system.open_project':({'project_id'},set()),'reminder.prepare':({'text','at'},set()),
        'ads.prepare':({'platform','objective','daily_budget_usd','copy'},set()),
        'delivery.prepare':({'recipient','text'},set()),'whatsapp.send':({'recipient','text'},set()),
    }
    required,optional=fields[operation]
    if set(value)-required-optional or required-set(value):raise IntegrationError('integration_parameters','Los parámetros no corresponden a la operación.',422)
    result=deepcopy(value)
    for key in set(value)-{'daily_budget_usd'}:
        if key in {'body','text'}:
            entry=value[key]
            if not isinstance(entry,str) or not 1<=len(entry.strip())<=4096 or any(ord(c)<32 and c not in '\n\t' for c in entry):raise IntegrationError('integration_parameters','Revisa el texto de la propuesta.',422)
            result[key]=entry.strip()
        else:result[key]=_text(value[key],1000)
    if operation in {'calendar.create','calendar.list'} and _moment(result['end'])<=_moment(result['start']):raise IntegrationError('integration_parameters','El final debe ser posterior al inicio.',422)
    if operation=='reminder.prepare':_moment(result['at'])
    if operation=='gmail.draft' and not re.fullmatch(r'[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+',result['to']):raise IntegrationError('integration_parameters','Revisa el destinatario del borrador.',422)
    if operation=='system.open_project' and result['project_id'] not in config['project_ids']:raise IntegrationError('integration_project','El proyecto no está en la lista permitida.',403)
    if operation=='ads.prepare':
        if result['platform'] not in {'facebook','instagram'} or not isinstance(value['daily_budget_usd'],str) or not re.fullmatch(r'[0-9]{1,6}(?:\.[0-9]{1,2})?',value['daily_budget_usd']):raise IntegrationError('integration_parameters','Indica plataforma y presupuesto decimal explícito.',422)
        # A draft amount is never permission to launch or spend.
    if operation in {'delivery.prepare','whatsapp.send'}:
        recipient=_phone(result['recipient'])
        if recipient!=config['self_recipient'] or recipient not in config['opted_in_recipients']:
            raise IntegrationError('integration_opt_in','Sólo se admite el destinatario propio que dio su consentimiento.',403)
    if len(_canonical(result))>16384:raise IntegrationError('integration_parameters','La propuesta supera el límite local.',413)
    return result


class IntegrationService:
    def __init__(self,root,*,config=None,env=None,transports=None,now=None):
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root:raise IntegrationError('integration_storage','La carpeta local no puede redirigirse.')
        self.root.mkdir(parents=True,exist_ok=True);self.database=self.root/'integrations.sqlite3'
        if self.database.resolve()!=self.database:raise IntegrationError('integration_storage','El diario local no puede redirigirse.')
        supplied=deepcopy(config or {})
        allowed={'execution_enabled','webhook_enabled','chat_requests_enabled','allowed_senders','self_recipient','opted_in_recipients','phone_number_id','project_ids','social'}
        if set(supplied)-allowed:raise IntegrationError('integration_config','Configuración no admitida.',422)
        self.config={'execution_enabled':False,'webhook_enabled':False,'chat_requests_enabled':False,'allowed_senders':[],'self_recipient':None,'opted_in_recipients':[],'phone_number_id':None,'project_ids':[],**supplied}
        from services.social import config as social_config
        self.config['social']=social_config(supplied.get('social',{}))
        if any(type(self.config[key]) is not bool for key in ('execution_enabled','webhook_enabled','chat_requests_enabled')):raise IntegrationError('integration_config','Las puertas deben ser booleanas.',422)
        for key in ('allowed_senders','opted_in_recipients'):
            values=self.config[key]
            if not isinstance(values,list) or len(values)>10 or len(set(values))!=len(values):raise IntegrationError('integration_config','Lista de teléfonos no válida.',422)
            for value in values:_phone(value)
        if self.config['self_recipient'] is not None:_phone(self.config['self_recipient'])
        phone_id=self.config['phone_number_id']
        if phone_id is not None and (not isinstance(phone_id,str) or not re.fullmatch('[0-9]{5,30}',phone_id)):raise IntegrationError('integration_config','Identificador del número no válido.',422)
        if not isinstance(self.config['project_ids'],list) or len(self.config['project_ids'])>30 or any(not isinstance(value,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,80}',value) for value in self.config['project_ids']):raise IntegrationError('integration_config','La lista admite identificadores de proyecto, nunca rutas o comandos.',422)
        self.env=dict(os.environ if env is None else env);self.transports=dict(transports or {});self.now=now or time.time
        self.lock=threading.RLock();self.inbox={}
        with self._db() as db:
            # Keep schema creation/migration within BEGIN IMMEDIATE. executescript
            # would implicitly commit and allow two processes to race ALTER.
            db.execute('CREATE TABLE IF NOT EXISTS inbound_events(event_id TEXT PRIMARY KEY,message_key TEXT UNIQUE NOT NULL,sender_hash TEXT NOT NULL,body_hash TEXT NOT NULL,received_at REAL NOT NULL,expires_at REAL NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,action_hash TEXT NOT NULL,operation TEXT NOT NULL,classification TEXT NOT NULL,origin TEXT NOT NULL,created_at REAL NOT NULL,expires_at REAL NOT NULL,state TEXT NOT NULL,result_hash TEXT,error_code TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,proposal_id TEXT UNIQUE NOT NULL,action_hash TEXT NOT NULL,expires_at REAL NOT NULL,used INTEGER NOT NULL)')
            columns={row[1] for row in db.execute('PRAGMA table_info(proposals)')}
            if 'transport_kind' not in columns:db.execute("ALTER TABLE proposals ADD COLUMN transport_kind TEXT NOT NULL DEFAULT 'test_stub'")

    @contextmanager
    def _db(self):
        db=sqlite3.connect(self.database,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE');yield db
            if db.in_transaction:db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def registry(self):
        return {'connectors':[{'id':key,'label':value['label'],'state':'declared_not_connected','connected':False,
            'credentials':[{'env':name,'available':bool(self.env.get(name))} for name in value['env']],
            'operations':[{'name':name,'classification':classification,'approval_required':True} for name,(connector,classification) in OPERATIONS.items() if connector==key and name in getattr(self.transports.get(key),'available_operations',OPERATIONS)],
            'pending':list(value['pending']),'real_transport_implemented':False} for key,value in CONNECTORS.items()],
            'execution_enabled':self.config['execution_enabled'],'webhook_enabled':self.config['webhook_enabled'],
            'self_recipient_opted_in':self.config['self_recipient'] in self.config['opted_in_recipients'] if self.config['self_recipient'] else False,
            'allowed_sender_count':len(self.config['allowed_senders']),'graph_api_version':GRAPH_API_VERSION,
            'whatsapp_messages_endpoint_template':WHATSAPP_MESSAGES_ENDPOINT,
            'sources':SOURCES,'arbitrary_shell_supported':False,'inbound_can_grant_permissions':False}

    def verify_whatsapp_challenge(self,query):
        expected=self.env.get('BRIVANY_WHATSAPP_VERIFY_TOKEN')
        if not self.config['webhook_enabled'] or not expected:raise IntegrationError('webhook_not_configured','La entrada WhatsApp está deshabilitada.',503)
        if not isinstance(query,dict) or set(query)!={'hub.mode','hub.verify_token','hub.challenge'}:raise IntegrationError('webhook_challenge','Verificación no válida.',403)
        value={}
        for key,entry in query.items():
            if isinstance(entry,list):
                if len(entry)!=1:raise IntegrationError('webhook_challenge','Verificación no válida.',403)
                entry=entry[0]
            if not isinstance(entry,str) or len(entry)>1000:raise IntegrationError('webhook_challenge','Verificación no válida.',403)
            value[key]=entry
        if value['hub.mode']!='subscribe' or not value['hub.challenge'] or not hmac.compare_digest(value['hub.verify_token'].encode(),expected.encode()):raise IntegrationError('webhook_challenge','Verificación no válida.',403)
        return value['hub.challenge']

    def receive_whatsapp(self,raw_bytes,signature):
        secret=self.env.get('BRIVANY_META_APP_SECRET')
        if not self.config['webhook_enabled'] or not secret or not self.config['phone_number_id']:raise IntegrationError('webhook_not_configured','La entrada WhatsApp está deshabilitada.',503)
        if not isinstance(raw_bytes,bytes) or not 1<=len(raw_bytes)<=MAX_WEBHOOK:raise IntegrationError('webhook_body','El webhook supera el límite o está vacío.',413)
        if not isinstance(signature,str) or not re.fullmatch('sha256=[0-9a-f]{64}',signature):raise IntegrationError('webhook_signature','Firma no válida.',403)
        expected='sha256='+hmac.new(secret.encode(),raw_bytes,hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):raise IntegrationError('webhook_signature','Firma no válida.',403)
        messages=[]
        try:
            payload=json.loads(raw_bytes)
            if payload['object']!='whatsapp_business_account' or not isinstance(payload['entry'],list) or len(payload['entry'])>20:raise ValueError()
            for entry in payload['entry']:
                if not isinstance(entry['changes'],list) or len(entry['changes'])>20:raise ValueError()
                for change in entry['changes']:
                    if change['field']!='messages':continue
                    value=change['value']
                    if value['metadata']['phone_number_id']!=self.config['phone_number_id']:raise ValueError()
                    batch=value.get('messages',[])
                    if not isinstance(batch,list):raise ValueError()
                    for message in batch:
                        if message.get('type')!='text':continue
                        sender=_phone(message['from'])
                        if sender not in self.config['allowed_senders']:raise IntegrationError('webhook_sender','El remitente no está autorizado para este proyecto.',403)
                        identifier=_text(message['id'],250);text=message['text']['body']
                        if not isinstance(text,str) or not 1<=len(text)<=4096:raise ValueError()
                        key=_hash({'phone_id':self.config['phone_number_id'],'message_id':identifier});event_id=str(uuid5(NAMESPACE_URL,'brivany:whatsapp:'+key))
                        messages.append({'event_id':event_id,'message_key':key,'sender_hash':_hash(sender.encode()),'body_hash':_hash(text.encode()),'sender':sender,'text':text})
                        if len(messages)>50:raise ValueError()
        except IntegrationError:raise
        except (ValueError,TypeError,KeyError,AttributeError,RecursionError):raise IntegrationError('webhook_payload','El evento WhatsApp no cumple el formato esperado.',422) from None
        now=self.now();result=[];accepted=[]
        with self.lock:
            with self._db() as db:
                for message in messages:
                    previous=db.execute('SELECT * FROM inbound_events WHERE message_key=?',(message['message_key'],)).fetchone()
                    if previous:
                        if previous['body_hash']!=message['body_hash'] or previous['sender_hash']!=message['sender_hash']:raise IntegrationError('webhook_conflict','Un identificador de mensaje cambió de contenido.',409)
                    else:
                        db.execute('INSERT INTO inbound_events VALUES(?,?,?,?,?,?)',tuple(message[key] for key in ('event_id','message_key','sender_hash','body_hash'))+(now,now+300));accepted.append(message)
                    result.append({'event_id':message['event_id'],'duplicate':previous is not None,'body_sha256':message['body_hash'],'trusted_instruction':False,'permissions_granted':False})
            # Publish ephemeral text only after the durable deduplication commit.
            for key,(expiry,_) in list(self.inbox.items()):
                if expiry<now:del self.inbox[key]
            for message in accepted:
                if len(self.inbox)>=128:self.inbox.pop(next(iter(self.inbox)))
                self.inbox[message['event_id']]=(now+300,{'sender':message['sender'],'text':message['text'],'origin':'whatsapp_webhook','trusted_instruction':False,'permissions_granted':False})
        return {'events':result,'accepted':len(accepted),'automatic_actions':0,'text_persisted':False}

    def take_inbound(self,event_id):
        _uuid(event_id)
        with self.lock:
            found=self.inbox.pop(event_id,None)
            if not found or found[0]<self.now():return None
            return found[1]

    def propose(self,operation,parameters,*,origin='local_ui',ttl_seconds=300,request_id=None):
        if origin not in {'local_ui','whatsapp_webhook','planner'} or type(ttl_seconds) is not int or not 1<=ttl_seconds<=3600:raise IntegrationError('integration_proposal','Revisa el origen y el plazo.',422)
        value=_parameters(operation,parameters,self.config)
        transport=self.transports.get(OPERATIONS[operation][0])
        if operation not in getattr(transport,'available_operations',OPERATIONS):
            raise IntegrationError('integration_operation','Esta operación no está disponible en el conector.',422)
        action_hash=_hash({'operation':operation,'parameters':value})
        social_review=None
        if operation in SOCIAL_WRITES:
            from packages.providers.social import SocialTransport
            social_transport=self.transports.get(OPERATIONS[operation][0])
            if not isinstance(social_transport,SocialTransport):raise IntegrationError('integration_transport_pending','Falta conectar la revisión del borrador social.',503)
            social_review=social_transport.review(operation,value)
        # Stable action identity prevents ambiguous retries via a fresh proposal.
        if request_id is not None:_uuid(request_id)
        identifier=str(uuid5(NAMESPACE_URL,'brivany:action:'+action_hash+(':'+request_id if request_id else '')));now=self.now()
        with self._db() as db:
            # A fresh explicit request can repeat a successful read/action, but
            # cannot disguise an unresolved identical previous execution.
            uncertain=db.execute("SELECT id FROM proposals WHERE action_hash=? AND state IN ('started','uncertain') LIMIT 1",(action_hash,)).fetchone()
            if uncertain:identifier=uncertain['id']
            if not db.execute('SELECT 1 FROM proposals WHERE id=?',(identifier,)).fetchone():
                db.execute('INSERT INTO proposals(id,action_hash,operation,classification,origin,created_at,expires_at,state,result_hash,error_code) VALUES(?,?,?,?,?,?,?,?,?,?)',(identifier,action_hash,operation,OPERATIONS[operation][1],origin,now,now+ttl_seconds,'awaiting_approval',None,None))
        result={**self.inspect(identifier),'parameters':value,'parameters_persisted':False}
        if social_review is not None:result.update(preview=social_review['preview'],spending_authorized=False,ad_status=social_review['ad_status'],remaining_ad_components=social_review['remaining_ad_components'])
        return result

    def inspect(self,proposal_id):
        _uuid(proposal_id)
        with self._db() as db:
            row=db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone()
            if not row:raise IntegrationError('integration_not_found','Propuesta no disponible.',404)
            result=dict(row)
        result['action_sha256']=result.pop('action_hash');result['state']='uncertain' if result['state']=='started' else result['state']
        if result['state']=='awaiting_approval' and result['expires_at']<=self.now():result['state']='expired'
        return {**result,'approval_required':True,'replay_allowed':False,'real_transport_implemented':False}

    def approve(self,proposal_id,action_sha256,*,channel='local_ui',explicit=True,ttl_seconds=120):
        if channel!='local_ui' or explicit is not True:raise IntegrationError('integration_approval','La autorización exige una acción explícita en la interfaz local.',403)
        if type(ttl_seconds) is not int or not 1<=ttl_seconds<=300:raise IntegrationError('integration_approval','Plazo de aprobación inválido.',422)
        _uuid(proposal_id);now=self.now()
        with self._db() as db:
            row=db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone()
            if not row or row['state']!='awaiting_approval' or row['expires_at']<=now:raise IntegrationError('integration_approval','La propuesta no admite aprobación.',409)
            if not isinstance(action_sha256,str) or not re.fullmatch('[0-9a-f]{64}',action_sha256) or not hmac.compare_digest(row['action_hash'],action_sha256):raise IntegrationError('integration_approval','La aprobación no corresponde a los parámetros.',409)
            previous=db.execute('SELECT * FROM approvals WHERE proposal_id=?',(proposal_id,)).fetchone()
            if previous:return {'approval_id':previous['id'],'proposal_id':proposal_id,'action_sha256':previous['action_hash'],'expires_at':previous['expires_at'],'single_use':True}
            identifier=str(uuid4());expiry=min(row['expires_at'],now+ttl_seconds)
            db.execute('INSERT INTO approvals VALUES(?,?,?,?,0)',(identifier,proposal_id,action_sha256,expiry))
        return {'approval_id':identifier,'proposal_id':proposal_id,'action_sha256':action_sha256,'expires_at':expiry,'single_use':True}

    def validates_started_action(self,operation,parameters,proposal_id):
        """Approval bridge for fixed social transport; never grants new authority."""
        try:
            _uuid(proposal_id);value=_parameters(operation,parameters,self.config)
            action_hash=_hash({'operation':operation,'parameters':value})
            with self._db() as db:
                row=db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone()
                grant=db.execute('SELECT * FROM approvals WHERE proposal_id=?',(proposal_id,)).fetchone()
            return bool(self.config['execution_enabled'] and row and row['operation']==operation and row['state']=='started' and hmac.compare_digest(row['action_hash'],action_hash)
                and grant and grant['used']==1 and grant['expires_at']>self.now() and hmac.compare_digest(grant['action_hash'],action_hash))
        except (IntegrationError,ValueError,TypeError):return False

    def execute(self,proposal_id,parameters,approval_id,*,execute=False):
        _uuid(proposal_id);_uuid(approval_id)
        if execute is not True or not self.config['execution_enabled']:raise IntegrationError('integration_disabled','La ejecución permanece deshabilitada.',403)
        with self.lock,self._db() as db:
            row=db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone()
            if not row:raise IntegrationError('integration_not_found','Propuesta no disponible.',404)
            value=_parameters(row['operation'],parameters,self.config);action_hash=_hash({'operation':row['operation'],'parameters':value})
            if not hmac.compare_digest(action_hash,row['action_hash']):raise IntegrationError('integration_action_changed','Los parámetros cambiaron después de la revisión.',409)
            if row['state']!='awaiting_approval':return self._receipt(row)
            other=db.execute("SELECT * FROM proposals WHERE action_hash=? AND id<>? AND state IN ('started','uncertain') LIMIT 1",(action_hash,proposal_id)).fetchone()
            if other is not None:return self._receipt(other)
            grant=db.execute('SELECT * FROM approvals WHERE id=? AND proposal_id=?',(approval_id,proposal_id)).fetchone();now=self.now()
            if not grant or grant['used'] or grant['expires_at']<=now or row['expires_at']<=now or not hmac.compare_digest(grant['action_hash'],action_hash):raise IntegrationError('integration_not_approved','Falta una aprobación vigente de estos parámetros.',403)
            transport=self.transports.get(OPERATIONS[row['operation']][0])
            from packages.providers.personal import GoogleTransport,WhatsAppTransport
            from packages.providers.social import SocialTransport
            dedicated=(GoogleTransport,WhatsAppTransport,SocialTransport)
            real=isinstance(transport,dedicated) and getattr(transport,'simulation',None) is False
            if transport is None or (not real and getattr(transport,'simulation',None) is not True):raise IntegrationError('integration_transport_pending','El conector aún no tiene transporte disponible.',503)
            if isinstance(transport,(GoogleTransport,WhatsAppTransport)):transport.preflight(row['operation'])
            if isinstance(transport,SocialTransport):transport.preflight(row['operation'],value)
            db.execute('UPDATE approvals SET used=1 WHERE id=?',(approval_id,));db.execute("UPDATE proposals SET state='started',transport_kind=? WHERE id=?",(transport.kind if real else 'test_stub',proposal_id))
            operation=row['operation']
        try:
            result=transport.execute(operation,value,proposal_id)
            if not isinstance(result,IntegrationResult) or result.outcome not in {'succeeded','failed'} or result.receipt is not None and (not isinstance(result.receipt,str) or len(result.receipt)>200):raise ValueError()
            digest=_hash({'outcome':result.outcome,'receipt':result.receipt});state=('succeeded' if real else 'succeeded_test_stub') if result.outcome=='succeeded' else ('failed' if real else 'failed_test_stub');error_code=None
        except Exception:
            state,digest,error_code='uncertain',None,'transport_outcome_unknown'
        with self._db() as db:
            db.execute('UPDATE proposals SET state=?,result_hash=?,error_code=? WHERE id=?',(state,digest,error_code,proposal_id))
            receipt=self._receipt(db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone())
        if state in {'succeeded','succeeded_test_stub','failed','failed_test_stub'} and result.payload is not None:
            if not isinstance(result.payload,dict) or len(_canonical(result.payload))>1024*1024:raise IntegrationError('integration_result_limit','El resultado supera el límite de visualización.',502)
            receipt['result']=result.payload;receipt['result_persisted']=False
        return receipt

    @staticmethod
    def _receipt(row):
        real=row['transport_kind']!='test_stub'
        return {'id':row['id'],'operation':row['operation'],'state':'uncertain' if row['state']=='started' else row['state'],
            'action_sha256':row['action_hash'],'result_sha256':row['result_hash'],'error_code':row['error_code'],
            'replay_allowed':False,'real_transport_implemented':real,'external_calls':None if real else 0,'origin':row['transport_kind'] if real else 'local_test_transport'}
