"""Local settings and OAuth/operation façade. No inference or automatic sending."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import json
import os
from pathlib import Path
import tempfile
import threading

from packages.providers.personal import GoogleTransport,WhatsAppTransport,request_json
from packages.providers.social import SocialTransport,graph_request,READS,WRITES
from services.google_oauth import GoogleOAuthService
from services.integrations import IntegrationService,IntegrationError,CONNECTORS
from services.social import SocialService
from services.chat_requests import ChatRequestsService
from uuid import uuid4

LOCK=threading.RLock()


class ConnectionsService:
    def __init__(self,root,*,base_url,oauth=None,env=None,http=request_json,social_http=graph_request):
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root:raise IntegrationError('connection_storage','El almacén local no puede redirigirse.',503)
        self.root.mkdir(parents=True,exist_ok=True);self.path=self.root/'settings.json';self.env=dict(os.environ if env is None else env);self.http=http;self.social_http=social_http
        self.oauth=oauth or GoogleOAuthService(self.root/'google',base_url=base_url,env=self.env)
        config={}
        if self.path.is_file():
            if self.path.resolve()!=self.path or self.path.stat().st_size>16384:raise IntegrationError('connection_settings','La configuración local no es válida.',503)
            config=json.loads(self.path.read_text(encoding='utf-8'))
        self._configure(config)

    def _configure(self,config):
        self.integration=IntegrationService(self.root,config=config,env=self.env)
        self.integration.transports={key:GoogleTransport(self.oauth,key,http=self.http) for key in ('calendar','gmail','drive')}
        self.integration.transports['whatsapp']=WhatsAppTransport(self.env,self.integration.config,http=self.http)
        self.social=SocialService(self.root/'social',settings=self.integration.config['social'],env=self.env)
        self.social_transport=SocialTransport(self.social,http=self.social_http,approval_validator=self.integration.validates_started_action)
        self.integration.transports.update({key:self.social_transport for key in ('facebook','instagram','ads')})
        self.chat_requests=ChatRequestsService(self.root,config_provider=lambda:self.refresh_settings().config)

    def refresh_settings(self):
        with LOCK:
            if self.path.exists():
                if self.path.resolve()!=self.path or not self.path.is_file() or self.path.stat().st_size>16384:
                    raise IntegrationError('connection_settings','La configuración local no es válida.',503)
                current=json.loads(self.path.read_text(encoding='utf-8'))
                if current!=self.integration.config:self._configure(current)
        return self.integration

    def status(self):
        self.refresh_settings()
        oauth=self.oauth.status();registry=self.integration.registry()
        for connector in registry['connectors']:
            key=connector['id']
            if key in {'calendar','gmail','drive'}:
                grant=next((item for item in oauth['connectors'] if item['connector']==key),None)
                connector.update(real_transport_implemented=True,authorized=bool(grant and grant['authorized']),connected=bool(grant and grant['connected']),
                    state='authorized_api_unverified' if grant and grant['authorized'] else 'authorization_pending')
                connector['pending']=['api_access_verification'] if grant and grant['authorized'] else ['oauth_client_and_consent']
            elif key=='whatsapp':
                connector['real_transport_implemented']=True;connector['state']='configuration_pending'
                connector['pending']=['business_phone_and_access_token','own_chat_opt_in','public_https_webhook','real_send_and_delivery_verification']
            elif key in {'facebook','instagram','ads'}:
                connector['real_transport_implemented']=True;connector['state']='configuration_pending';connector['connected']=False
                connector['pending']=['authorized_account_tokens','declared_target_and_permissions','real_access_verification']
                if key=='ads':connector['pending']+=['account_currency_verification','adset_creative_and_activation']
        social=self.social.status();social.update(publication_approval_bridge_required=False,publication_approval_bridge_implemented=True,
            read_operations=sorted(READS),write_operations=sorted(WRITES))
        return {'google':oauth,'registry':registry,'settings':self.integration.config,'social':social,'automatic_sending':False,
            'persistent_conversation_implemented':False,'public_webhook_mounted':False}

    def propose_social(self,draft_id,expected_revision,*,container_id=None,request_id=None):
        self.refresh_settings()
        prepared=self.social.prepare_action(draft_id,expected_revision,container_id=container_id)
        # A second explicit review may check a pending Instagram container. An
        # uncertain prior action is still blocked by IntegrationService's hash.
        proposed=self.integration.propose(prepared['operation'],prepared['parameters'],request_id=request_id or str(uuid4()))
        return {**proposed,'preview':prepared['preview'],'social_action_sha256':prepared['action_sha256'],
            'spending_authorized':False,'ad_status':prepared['ad_status'],'remaining_ad_components':prepared['remaining_ad_components']}

    def update_credentials(self,values):
        """Install already persisted credentials without returning their values."""
        self.env.update(values);self.oauth.env.update(values);self.integration.env.update(values);self.social.env.update(values)

    def save_settings(self,value):
        if not isinstance(value,dict):raise IntegrationError('connection_settings','Revisa la configuración.',422)
        with LOCK:
            # Merge partial patches against durable current settings, not the
            # stale snapshot from another window/server instance.
            current=self.integration.config
            if self.path.exists():
                if self.path.resolve()!=self.path or not self.path.is_file() or self.path.stat().st_size>16384:
                    raise IntegrationError('connection_settings','La configuración local no es válida.',503)
                current=json.loads(self.path.read_text(encoding='utf-8'))
            patch=dict(value)
            if 'social' in patch:
                if not isinstance(patch['social'],dict):raise IntegrationError('connection_settings','Revisa la configuración social.',422)
                patch['social']={**current.get('social',{}),**patch['social']}
            validated=IntegrationService(self.root,config={**current,**patch},env=self.env).config
            temporary=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.root,prefix='.settings-',delete=False) as output:
                    temporary=Path(output.name);json.dump(validated,output,ensure_ascii=False);output.flush();os.fsync(output.fileno())
                os.replace(temporary,self.path)
            finally:
                if temporary:temporary.unlink(missing_ok=True)
            self._configure(validated)
        return self.status()


def service(handler):
    with LOCK:
        if not hasattr(handler.server,'connections'):
            from services.h1.server import ROOT
            handler.server.connections=ConnectionsService(DATA_ROOT/'.local'/'integrations',base_url='http://127.0.0.1:'+str(handler.server.server_port))
        return handler.server.connections
