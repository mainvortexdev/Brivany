"""Fixed Meta Graph social adapters, inactive until an exact approval bridge exists.

Writes use durable intent and never replay an uncertain outcome. Instagram's
container creation and publication require separate reviewed actions. Requests
and responses below have not been verified against an authorized real account.
"""
from copy import deepcopy
import json
import re
from urllib import request,error,parse

from services.integrations import IntegrationError,IntegrationResult,GRAPH_API_VERSION
from services.social import identifier,uuid,fields,digest,canonical,validate_draft,fail

BASE='https://graph.facebook.com/'+GRAPH_API_VERSION+'/'
MAX_RESPONSE=1024*1024
TOKENS={'facebook.pages':'BRIVANY_META_SOCIAL_USER_TOKEN','facebook.posts':'BRIVANY_FACEBOOK_PAGE_TOKEN',
    'facebook.publish_text':'BRIVANY_FACEBOOK_PAGE_TOKEN','instagram.media':'BRIVANY_INSTAGRAM_ACCESS_TOKEN',
    'instagram.insights':'BRIVANY_INSTAGRAM_ACCESS_TOKEN','instagram.create_container':'BRIVANY_INSTAGRAM_ACCESS_TOKEN',
    'instagram.publish_container':'BRIVANY_INSTAGRAM_ACCESS_TOKEN','ads.campaigns':'BRIVANY_META_ADS_ACCESS_TOKEN',
    'ads.create_paused_campaign':'BRIVANY_META_ADS_ACCESS_TOKEN'}
PERMISSIONS={'facebook.pages':{'pages_show_list'},'facebook.posts':{'pages_read_engagement'},
    'facebook.publish_text':{'pages_manage_posts'},'instagram.media':{'instagram_basic'},
    'instagram.insights':{'instagram_basic','instagram_manage_insights'},
    'instagram.create_container':{'instagram_basic','instagram_content_publish'},
    'instagram.publish_container':{'instagram_basic','instagram_content_publish'},
    'ads.campaigns':{'ads_read'},'ads.create_paused_campaign':{'ads_management'}}
READS={'facebook.pages','facebook.posts','instagram.media','instagram.insights','ads.campaigns'}
WRITES={'facebook.publish_text','instagram.create_container','instagram.publish_container','ads.create_paused_campaign'}


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def graph_request(method,url,token,payload=None):
    target=parse.urlsplit(url)
    try:port=target.port
    except ValueError:fail('social_endpoint','Dirección Graph no válida.')
    if method not in {'GET','POST'} or not url.startswith(BASE) or target.scheme!='https' or target.hostname!='graph.facebook.com' or target.username or target.password or port not in (None,443) or target.fragment:
        fail('social_endpoint','Sólo se admite el endpoint Graph fijado.')
    if not isinstance(token,str) or not 1<=len(token)<=8192 or any(ord(char)<33 or ord(char)>126 for char in token):fail('social_credentials','Falta una autorización social válida.',503)
    headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'Brivany-Social/0.1'}
    data=None
    if payload is not None:
        if not isinstance(payload,dict):fail()
        values={key:json.dumps(value,separators=(',',':')) if isinstance(value,(dict,list,bool)) else str(value) for key,value in payload.items()}
        data=parse.urlencode(values).encode();headers['Content-Type']='application/x-www-form-urlencoded'
    try:
        req=request.Request(url,data=data,method=method,headers=headers)
        with request.build_opener(_NoRedirect()).open(req,timeout=20) as response:body=response.read(MAX_RESPONSE+1)
        if len(body)>MAX_RESPONSE:raise ValueError()
        value=json.loads(body)
        if not isinstance(value,dict) or value.get('error'):raise ValueError()
        return value
    except error.HTTPError as exc:
        status=exc.code;exc.close()
        fail('social_access' if status in (401,403) else 'social_provider_rejected','Meta rechazó la operación. No se repitió.',502)
    except (OSError,ValueError,error.URLError):fail('social_outcome_unknown','No se pudo confirmar el resultado de Meta. No se repitió.',502)


def _result_id(value,*,post=False):
    pattern=r'[0-9]{5,30}_[0-9]{5,30}' if post else r'[0-9]{5,30}'
    if not isinstance(value,str) or not re.fullmatch(pattern,value):fail('social_response','Meta no devolvió un identificador válido.',502)
    return value


class SocialTransport:
    kind='meta_social'

    def __init__(self,service,*,http=graph_request,approval_validator=None):
        self.service=service;self.http=http;self.approval_validator=approval_validator
        self.simulation=bool(getattr(http,'simulation',False))

    def review(self,operation,parameters):
        """Resolve exact draft content locally so generic proposals show it too."""
        if operation not in WRITES:fail('social_operation','Sólo se revisan acciones sociales de escritura.')
        fields(parameters,{'draft_id','expected_revision','container_id','action_sha256'},{'draft_id','expected_revision','container_id','action_sha256'})
        prepared=self.service.prepare_action(parameters['draft_id'],parameters['expected_revision'],container_id=parameters['container_id'])
        if prepared['operation']!=operation or prepared['parameters']!=parameters:fail('social_action_changed','El contenido cambió después de la revisión.',409)
        return prepared

    def preflight(self,operation,parameters=None):
        if operation not in TOKENS:fail('social_operation','Operación social no admitida.')
        if not self.service.env.get(TOKENS[operation]):fail('social_credentials','Configura la autorización para esta cuenta social.',503)
        if not PERMISSIONS[operation]<=set(self.service.settings['permissions']):fail('social_permissions','Los permisos necesarios aún no están declarados para esta cuenta.',403)
        if operation in WRITES:
            if not self.service.settings['execution_enabled']:fail('social_execution_disabled','La publicación social permanece deshabilitada.',403)
            if self.approval_validator is None:fail('social_approval_bridge_pending','Falta conectar la revisión exacta de esta acción en Brivany.',503)
            if parameters is not None:
                prepared=self.review(operation,parameters)
                draft=prepared['preview']['draft']
                if operation=='ads.create_paused_campaign' and (not self.service.settings['ad_currency_verified'] or self.service.settings['ad_account_currencies'].get(draft['target_id'])!=draft['currency']):
                    fail('social_currency_pending','Comprueba primero la moneda de la cuenta publicitaria.',403)

    def _read_parameters(self,operation,parameters):
        if operation=='facebook.pages':
            fields(parameters,set(),set());return 'me/accounts',{'fields':'id,name,tasks,instagram_business_account{id,username}','limit':20},('id','name','tasks','instagram_business_account')
        key='page_id' if operation=='facebook.posts' else 'ad_account_id' if operation=='ads.campaigns' else 'instagram_user_id'
        allowed={key,'metrics','since','until'} if operation=='instagram.insights' else {key}
        fields(parameters,allowed,allowed);target=identifier(parameters[key],account=key=='ad_account_id')
        configured='page_ids' if key=='page_id' else 'ad_account_ids' if key=='ad_account_id' else 'instagram_user_ids'
        if target not in self.service.settings[configured]:fail('social_target','La cuenta social no está permitida.',403)
        if operation=='facebook.posts':return target+'/published_posts',{'fields':'id,message,created_time,permalink_url','limit':20},('id','message','created_time','permalink_url')
        if operation=='instagram.media':return target+'/media',{'fields':'id,caption,media_type,timestamp,permalink','limit':20},('id','caption','media_type','timestamp','permalink')
        if operation=='ads.campaigns':return target+'/campaigns',{'fields':'id,name,status,effective_status,objective,daily_budget','limit':20},('id','name','status','effective_status','objective','daily_budget')
        metrics=parameters['metrics'];since=parameters['since'];until=parameters['until']
        if not isinstance(metrics,list) or not 1<=len(metrics)<=2 or len(set(metrics))!=len(metrics) or any(item not in {'views','reach'} for item in metrics):fail('social_insights','Selecciona las métricas admitidas views/reach explícitamente.')
        if type(since) is not int or type(until) is not int or not 0<since<until or until-since>28*86400:fail('social_insights','Usa un intervalo explícito de hasta 28 días.')
        return target+'/insights',{'metric':','.join(metrics),'period':'day','metric_type':'total_value','since':since,'until':until},('name','period','title','description','total_value','values')

    def read(self,operation,parameters):
        if operation not in READS:fail('social_operation','La acción no es de lectura.')
        self.preflight(operation);path,query,keys=self._read_parameters(operation,parameters)
        value=self.http('GET',BASE+path+'?'+parse.urlencode(query),self.service.env[TOKENS[operation]])
        data=value.get('data')
        if not isinstance(data,list) or any(not isinstance(item,dict) for item in data):fail('social_response','La lista social no cumple el formato esperado.',502)
        # Never surface access_token fields even if a provider included them.
        items=[{key:deepcopy(item[key]) for key in keys if key in item} for item in data[:20]]
        if operation=='facebook.pages':
            for item in items:
                nested=item.get('instagram_business_account')
                if isinstance(nested,dict):item['instagram_business_account']={key:nested[key] for key in ('id','username') if key in nested}
        paging=value.get('paging');more=isinstance(paging,dict) and bool(paging.get('next'))
        return {'operation':operation,'items':items,'more_available':more,
            'automatic_pagination':False,'simulation':self.simulation,'data_persisted':False,
            'permissions_verified_by_read':False,'metrics_compatibility_verified':False if operation=='instagram.insights' else None}

    def _receipt(self,row):
        state=row['state'];accepted=state in {'publication_accepted','publication_accepted_test_stub','campaign_created_paused','campaign_created_paused_test_stub','container_created','container_created_test_stub'}
        if state in {'started','uncertain'}:
            fail('social_outcome_unknown','El resultado de esta acción sigue sin confirmar; no se repetirá.',502)
        payload={'state':state,'publication_accepted':state.startswith('publication_accepted'),
            'container_created':state.startswith('container_created'),'result_id':row['result_id'],'container_id':row['container_id'],
            'visibility_verified':False,'ad_delivery_started':False,'spending_authorized':False,
            'requires_new_review':state=='container_waiting','replay_allowed':False,'simulation':bool(row['simulated']),
            'external_calls':0 if row['simulated'] else None,
            'remaining_ad_components':['adset_targeting','creative','ad','separate_activation_review'] if row['operation']=='ads.create_paused_campaign' else []}
        return IntegrationResult('succeeded' if accepted else 'failed',row['result_id'] or row['container_id'],payload)

    def execute(self,operation,parameters,idempotency_key):
        if operation not in WRITES:fail('social_operation','Sólo se admiten acciones de publicación revisadas.')
        fields(parameters,{'draft_id','expected_revision','container_id','action_sha256'},{'draft_id','expected_revision','container_id','action_sha256'})
        uuid(idempotency_key);self.preflight(operation)
        prepared=self.service.prepare_action(parameters['draft_id'],parameters['expected_revision'],container_id=parameters['container_id'])
        if prepared['operation']!=operation or prepared['parameters']!=parameters:fail('social_action_changed','El contenido cambió después de la revisión.',409)
        if self.approval_validator(operation,deepcopy(parameters),idempotency_key) is not True:fail('social_approval_required','Falta aprobar esta acción exacta.',403)
        draft=prepared['preview']['draft']
        if operation=='ads.create_paused_campaign':
            if not self.service.settings['ad_currency_verified'] or self.service.settings['ad_account_currencies'].get(draft['target_id'])!=draft['currency']:
                fail('social_currency_pending','Comprueba primero la moneda de la cuenta publicitaria.',403)
        with self.service.lock,self.service.db() as db:
            current=db.execute('SELECT revision,document FROM social_drafts WHERE id=?',(parameters['draft_id'],)).fetchone()
            if current is None or current['revision']!=parameters['expected_revision'] or validate_draft(json.loads(current['document']),self.service.settings)!=draft:
                fail('social_draft_conflict','El borrador cambió antes de iniciar la acción; vuelve a revisarlo.',409)
            existing=db.execute('SELECT * FROM social_runs WHERE id=?',(idempotency_key,)).fetchone()
            if existing:
                if existing['action_hash']!=parameters['action_sha256']:fail('social_action_changed','El identificador ya corresponde a otra acción.',409)
                return self._receipt(existing)
            previous=db.execute("SELECT * FROM social_runs WHERE action_hash=? AND state!='container_waiting' ORDER BY rowid DESC LIMIT 1",(parameters['action_sha256'],)).fetchone()
            if previous:return self._receipt(previous)
            db.execute('INSERT INTO social_runs(id,draft_id,draft_revision,operation,action_hash,state,container_id,result_id,error_code,simulated) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?)',(idempotency_key,parameters['draft_id'],parameters['expected_revision'],operation,parameters['action_sha256'],'started',int(self.simulation)))
        state='uncertain';container=parameters['container_id'];result_id=None;code=None
        token=self.service.env[TOKENS[operation]]
        try:
            if operation=='facebook.publish_text':
                value=self.http('POST',BASE+draft['target_id']+'/feed',token,{'message':draft['copy']})
                result_id=_result_id(value.get('id'),post=True);state='publication_accepted'
            elif operation=='instagram.create_container':
                value=self.http('POST',BASE+draft['target_id']+'/media',token,{'image_url':draft['media']['url'],'caption':draft['copy']})
                container=_result_id(value.get('id'));state='container_created'
            elif operation=='instagram.publish_container':
                status=self.http('GET',BASE+container+'?fields=status_code',token).get('status_code')
                if status=='FINISHED':
                    value=self.http('POST',BASE+draft['target_id']+'/media_publish',token,{'creation_id':container})
                    result_id=_result_id(value.get('id'));state='publication_accepted'
                elif status=='IN_PROGRESS':state='container_waiting'
                elif status in {'ERROR','EXPIRED'}:state='container_unusable'
                else:raise ValueError()
            else:
                from decimal import Decimal
                minor=int(Decimal(draft['daily_budget'])*(Decimal(10)**draft['minor_unit_exponent']))
                value=self.http('POST',BASE+draft['target_id']+'/campaigns',token,{'name':draft['title'],'objective':draft['objective'],
                    'status':'PAUSED','daily_budget':str(minor),'special_ad_categories':draft['special_ad_categories'],
                    **({'special_ad_category_country':draft['targeting']['countries']} if draft['special_ad_categories'] else {})})
                result_id=_result_id(value.get('id'));state='campaign_created_paused'
            if self.simulation and state in {'publication_accepted','container_created','campaign_created_paused'}:state+='_test_stub'
        except Exception:state='uncertain';code='social_outcome_unknown'
        with self.service.db() as db:
            db.execute('UPDATE social_runs SET state=?,container_id=?,result_id=?,error_code=? WHERE id=?',(state,container,result_id,code,idempotency_key))
            completed=db.execute('SELECT * FROM social_runs WHERE id=?',(idempotency_key,)).fetchone()
        return self._receipt(completed)
