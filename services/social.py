"""Versioned private social drafts and exact publication plans.

Creating/reviewing a draft never calls Meta. Publication is handed to a separate
transport only after the application's approval bridge authorizes exact fields.
This is not a token/OAuth flow, account verification or complete ads launcher.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
from urllib.parse import urlsplit
from uuid import UUID,uuid4

from services.integrations import IntegrationError,GRAPH_API_VERSION

SOURCES={
    'graph_version':'https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/apiconfig.py',
    'facebook_feed':'https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py',
    'instagram_media':'https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguser.py',
    'instagram_reference':'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api',
    'paused_campaign':'https://github.com/facebook/facebook-python-business-sdk/blob/main/examples/AdAccountCampaignsPostCategories.py',
}
KINDS={'facebook_post','instagram_image','ad_campaign'}
OBJECTIVES={'OUTCOME_AWARENESS','OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_LEADS','OUTCOME_SALES','OUTCOME_APP_PROMOTION'}
CATEGORIES={'HOUSING','EMPLOYMENT','CREDIT','ISSUES_ELECTIONS_POLITICS','FINANCIAL_PRODUCTS_SERVICES'}
DEFAULT_CONFIG={'execution_enabled':False,'page_ids':[],'instagram_user_ids':[],'ad_account_ids':[],
    'permissions':[],'media_hosts':[],'ad_account_currencies':{},'ad_currency_verified':False}


def fail(code='social_input',message='Revisa los datos del borrador social.',status=422):raise IntegrationError(code,message,status)
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(value):return hashlib.sha256(canonical(value)).hexdigest()
def stamp():return datetime.now(timezone.utc).isoformat()


def identifier(value,*,account=False):
    pattern=r'act_[0-9]{5,30}' if account else r'[0-9]{5,30}'
    if not isinstance(value,str) or not re.fullmatch(pattern,value):fail('social_target','Usa el identificador de una cuenta permitida.')
    return value


def uuid(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except (ValueError,TypeError,AttributeError):fail('social_draft_missing','Borrador no disponible.',404)
    return value


def text(value,maximum=2200,*,empty=False):
    if not isinstance(value,str) or len(value)>maximum or not empty and not value.strip() or any(ord(c)<32 and c not in '\n\t' for c in value):fail()
    return value.strip()


def fields(value,allowed,required):
    if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value):fail()


def config(value):
    fields(value,DEFAULT_CONFIG,[]);result={**deepcopy(DEFAULT_CONFIG),**deepcopy(value)}
    if type(result['execution_enabled']) is not bool or type(result['ad_currency_verified']) is not bool:fail('social_config','Las puertas sociales deben ser booleanas.')
    for key in ('page_ids','instagram_user_ids','ad_account_ids'):
        values=result[key]
        if not isinstance(values,list) or len(values)>20 or len(set(values))!=len(values):fail('social_config','Lista de cuentas no válida.')
        for entry in values:identifier(entry,account=key=='ad_account_ids')
    if not isinstance(result['permissions'],list) or len(result['permissions'])>30 or any(not isinstance(item,str) or not re.fullmatch('[a-z_]{2,80}',item) for item in result['permissions']):fail('social_config','Lista de permisos no válida.')
    if not isinstance(result['media_hosts'],list) or len(result['media_hosts'])>10:fail('social_config','Lista de hosts de medios no válida.')
    for host in result['media_hosts']:
        if not isinstance(host,str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?',host) or '.' not in host or host.endswith(('.local','.localhost')):fail('social_config','Usa un host público propio para los medios.')
        try:address=ipaddress.ip_address(host)
        except ValueError:address=None
        if address is not None and not address.is_global:fail('social_config','El host del medio no puede ser privado.')
    currencies=result['ad_account_currencies']
    if not isinstance(currencies,dict) or set(currencies)-set(result['ad_account_ids']) or any(not isinstance(item,str) or not re.fullmatch('[A-Z]{3}',item) for item in currencies.values()):fail('social_config','Revisa la moneda de cada cuenta publicitaria.')
    return result


def media(value,settings):
    fields(value,{'asset_ref','url','sha256','mime_type'},{'asset_ref','url','sha256','mime_type'})
    if not isinstance(value['asset_ref'],str) or not re.fullmatch('[a-z][a-z0-9_-]{0,79}',value['asset_ref']) or not isinstance(value['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',value['sha256']) or value['mime_type']!='image/jpeg':fail('social_media','Usa una referencia JPEG revisada con su hash.')
    if not isinstance(value['url'],str) or len(value['url'])>2048:fail('social_media','URL de medio no válida.')
    url=urlsplit(value['url'])
    try:port=url.port
    except ValueError:fail('social_media','URL de medio no válida.')
    if url.scheme!='https' or url.hostname not in settings['media_hosts'] or url.username or url.password or port not in (None,443) or url.query or url.fragment:
        fail('social_media','Usa HTTPS en un host de medios permitido, sin credenciales ni parámetros privados.')
    return deepcopy(value)


def validate_draft(value,settings):
    fields(value,{'kind','title','target_id','copy','media','daily_budget','currency','minor_unit_exponent','targeting','objective','special_ad_categories'}, {'kind','title','target_id','copy'})
    kind=value['kind']
    if not isinstance(kind,str) or kind not in KINDS:fail('social_kind','Tipo de borrador no admitido.')
    result={'kind':kind,'title':text(value['title'],120),'target_id':identifier(value['target_id'],account=kind=='ad_campaign'),
        'copy':text(value['copy'],2200 if kind=='instagram_image' else 4000,empty=kind=='ad_campaign')}
    target_list='page_ids' if kind=='facebook_post' else 'instagram_user_ids' if kind=='instagram_image' else 'ad_account_ids'
    if result['target_id'] not in settings[target_list]:fail('social_target','La cuenta no está en la lista permitida.',403)
    if kind=='facebook_post':
        if set(value)-{'kind','title','target_id','copy'}:fail('social_media','Este adaptador inicial admite publicaciones de Facebook sólo de texto.')
    elif kind=='instagram_image':
        if set(value)!={'kind','title','target_id','copy','media'}:fail('social_media','La publicación de Instagram necesita un JPEG revisado.')
        result['media']=media(value['media'],settings)
    else:
        required={'kind','title','target_id','copy','daily_budget','currency','minor_unit_exponent','targeting','objective','special_ad_categories'}
        if set(value)!=required:fail('social_budget','La campaña requiere presupuesto, moneda, objetivo, categorías y destino explícitos.')
        amount=value['daily_budget'];exponent=value['minor_unit_exponent']
        if not isinstance(amount,str) or not re.fullmatch(r'[0-9]{1,6}(?:\.[0-9]{1,3})?',amount) or type(exponent) is not int or not 0<=exponent<=3:fail('social_budget','Usa un presupuesto decimal y la unidad menor de la moneda de la cuenta.')
        try:
            decimal=Decimal(amount);minor=decimal*(Decimal(10)**exponent)
            if decimal<=0 or minor!=minor.to_integral_value() or minor>100000000:raise ValueError()
        except (InvalidOperation,ValueError):fail('social_budget','El presupuesto no coincide con la unidad menor declarada.')
        currency=value['currency']
        if not isinstance(currency,str) or not re.fullmatch('[A-Z]{3}',currency):fail('social_budget','Indica la moneda de la cuenta publicitaria.')
        target=value['targeting'];fields(target,{'countries','age_min','age_max'},{'countries','age_min','age_max'})
        if not isinstance(target['countries'],list) or not 1<=len(target['countries'])<=10 or len(set(target['countries']))!=len(target['countries']) or any(not isinstance(item,str) or not re.fullmatch('[A-Z]{2}',item) for item in target['countries']):fail('social_targeting','Selecciona los países explícitamente.')
        if type(target['age_min']) is not int or type(target['age_max']) is not int or not 18<=target['age_min']<=target['age_max']<=65:fail('social_targeting','Revisa las edades declaradas.')
        categories=value['special_ad_categories']
        if not isinstance(value['objective'],str) or value['objective'] not in OBJECTIVES or not isinstance(categories,list) or len(categories)>5 or any(not isinstance(item,str) or item not in CATEGORIES for item in categories):fail('social_budget','Revisa objetivo y categorías publicitarias.')
        result.update(daily_budget=amount,currency=currency,minor_unit_exponent=exponent,targeting=deepcopy(target),objective=value['objective'],special_ad_categories=list(categories))
    if len(canonical(result))>16384:fail('social_limit','El borrador supera el límite.')
    return result


class SocialService:
    def __init__(self,root,*,settings=None,env=None):
        self.root=Path(root).absolute();self.database=self.root/'social.sqlite3'
        if self.root.resolve()!=self.root or self.database.resolve()!=self.database:fail('social_storage','Usa almacenamiento local sin redirecciones.',503)
        self.root.mkdir(parents=True,exist_ok=True);self.settings=config(settings or {});self.env=dict(os.environ if env is None else env);self.lock=threading.RLock()
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS social_drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,document TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS social_runs(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,draft_revision INTEGER NOT NULL,operation TEXT NOT NULL,action_hash TEXT NOT NULL,state TEXT NOT NULL,container_id TEXT,result_id TEXT,error_code TEXT)')
            if 'simulated' not in {row[1] for row in db.execute('PRAGMA table_info(social_runs)')}:
                db.execute('ALTER TABLE social_runs ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0')

    @contextmanager
    def db(self):
        db=sqlite3.connect(self.database,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:db.execute('BEGIN IMMEDIATE');yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def status(self):
        return {'graph_api_version':GRAPH_API_VERSION,'execution_enabled':self.settings['execution_enabled'],
            'credentials':[{'env':name,'available':bool(self.env.get(name))} for name in ('BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN','BRIVANY_INSTAGRAM_ACCESS_TOKEN','BRIVANY_META_ADS_ACCESS_TOKEN')],
            'configured_targets':{key:len(self.settings[key]) for key in ('page_ids','instagram_user_ids','ad_account_ids')},
            'permissions_declared':list(self.settings['permissions']),'permissions_verified':False,'accounts_connected':False,
            'publication_approval_bridge_required':True,'ad_activation_implemented':False,'sources':SOURCES,'automatic_requests':False}

    def get(self,draft_id):
        uuid(draft_id)
        with self.db() as db:row=db.execute('SELECT * FROM social_drafts WHERE id=?',(draft_id,)).fetchone()
        if not row:fail('social_draft_missing','Borrador no disponible.',404)
        return {'id':row['id'],'revision':row['revision'],'created_at':row['created_at'],'updated_at':row['updated_at'],
            'draft':json.loads(row['document']),'published':None,'publication_status':'consult_execution_receipt','data_stored':'private_local_draft'}

    def execution(self,run_id):
        uuid(run_id)
        with self.db() as db:row=db.execute('SELECT * FROM social_runs WHERE id=?',(run_id,)).fetchone()
        if row is None:fail('social_run_missing','Ejecución social no disponible.',404)
        return {**dict(row),'simulation':bool(row['simulated']),'replay_allowed':False,'visibility_verified':False,
            'spending_authorized':False,'external_calls':0 if row['simulated'] else None}

    def list(self):
        with self.db() as db:ids=[row[0] for row in db.execute('SELECT id FROM social_drafts ORDER BY updated_at DESC LIMIT 100')]
        return {'drafts':[self.get(value) for value in ids],'external_calls':0}

    def save(self,value,*,draft_id=None,expected_revision=0):
        draft=validate_draft(value,self.settings)
        if type(expected_revision) is not int or expected_revision<0:fail()
        if draft_id is not None:uuid(draft_id)
        else:draft_id=str(uuid4())
        with self.lock,self.db() as db:
            row=db.execute('SELECT * FROM social_drafts WHERE id=?',(draft_id,)).fetchone()
            if (row['revision'] if row else 0)!=expected_revision:fail('social_draft_conflict','El borrador cambió; revisa su versión actual.',409)
            now=stamp();revision=expected_revision+1
            db.execute('INSERT OR REPLACE INTO social_drafts VALUES(?,?,?,?,?)',(draft_id,revision,row['created_at'] if row else now,now,json.dumps(draft,ensure_ascii=False)))
        return self.get(draft_id)

    def prepare_action(self,draft_id,expected_revision,*,container_id=None):
        value=self.get(draft_id)
        if type(expected_revision) is not int or value['revision']!=expected_revision:fail('social_draft_conflict','El borrador cambió; vuelve a revisar su contenido.',409)
        draft=validate_draft(value['draft'],self.settings);kind=draft['kind']
        operation='facebook.publish_text' if kind=='facebook_post' else 'instagram.create_container' if kind=='instagram_image' else 'ads.create_paused_campaign'
        if container_id is not None:
            if kind!='instagram_image':fail()
            identifier(container_id)
            with self.db() as db:row=db.execute("SELECT 1 FROM social_runs WHERE draft_id=? AND draft_revision=? AND operation='instagram.create_container' AND container_id=? AND state IN ('container_created','container_created_test_stub')",(draft_id,expected_revision,container_id)).fetchone()
            if not row:fail('social_container','El contenedor no pertenece a esta revisión del borrador.',403)
            operation='instagram.publish_container'
        action={'draft_id':draft_id,'draft_revision':expected_revision,'operation':operation,'draft':draft,'container_id':container_id}
        return {'operation':operation,'parameters':{'draft_id':draft_id,'expected_revision':expected_revision,'container_id':container_id,'action_sha256':digest(action)},
            'action_sha256':digest(action),'preview':action,'approval_required':True,'external_requests':0,
            'ad_status':'PAUSED' if kind=='ad_campaign' else None,'spending_authorized':False,
            'remaining_ad_components':['adset_targeting','creative','ad','separate_activation_review'] if kind=='ad_campaign' else [],
            'source':'private_local_draft','account_access_verified':False,
            'media_content_verified':False if kind=='instagram_image' else None,'media_host_reachability_verified':False if kind=='instagram_image' else None}
