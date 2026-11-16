import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from services.demo_account import DemoAccount,DemoError,DemoHTTP,start_private_demo
from packages.providers.provider_access import DEMO_ORIGIN,endpoint,enabled,demo_headers,https_connection
from services.telephony.demo_client import DemoCallClient

TOKEN='s'*43
STATE={'token':TOKEN,'account':{'id':'jon-demo','name':'Equipo de prueba','demo':True},'enabled':True,'budget_usd':5,'remaining_usd':4.9,'expires_at':9999999999999,'voice_session_seconds':120}
class Store:
    def __init__(self):self.value=None
    def load(self):return self.value
    def save(self,value):self.value=json.loads(json.dumps(value))
class HTTP:
    def __init__(self):self.calls=[]
    def call(self,path,body=None,token=None):
        self.calls.append((path,body,token))
        if path=='/v1/activate':return dict(STATE)
        if path=='/v1/account':return {k:v for k,v in STATE.items() if k!='token'}
        if path=='/v1/telnyx/status':return {'configured':True,'outbound':True,'from_number':'+34111111111'}
        if path=='/v1/calls':return {'id':body['id'],'state':'scheduled'}
        return {'state':'active'}

class DemoAccountTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.http=HTTP();self.store=Store();self.account=DemoAccount(self.root,http=self.http,store=self.store);self.bootstrap={'schema':1,'origin':DEMO_ORIGIN,'invitation':'invite-'+'a'*40,'account_name':'Equipo de prueba'}
    def test_activation_has_only_an_invitation_and_status_never_returns_token(self):
        state=self.account.activate(self.bootstrap);self.assertTrue(state['demo']);self.assertEqual(state['remaining_usd'],4.9);self.assertNotIn(TOKEN,json.dumps(state));self.assertEqual(set(self.http.calls[0][1]),{'invitation','deviceId'});self.assertEqual(self.store.value['token'],TOKEN)
    def test_existing_session_refreshes_without_redeeming_another_device(self):
        self.account.activate(self.bootstrap);self.account.activate(self.bootstrap);self.assertEqual([x[0] for x in self.http.calls],['/v1/activate','/v1/account'])
    def test_bootstrap_rejects_another_origin_and_extra_secret_fields(self):
        for value in [{**self.bootstrap,'origin':'https://other.invalid'},{**self.bootstrap,'meta_key':'do-not-embed-provider-keys'},{**self.bootstrap,'schema':2}]:
            with self.assertRaises(DemoError):self.account.activate(value)
        self.assertFalse(self.http.calls)
    def test_applied_credentials_are_the_limited_account_token(self):
        self.account.activate(self.bootstrap)
        with patch.dict(os.environ,{},clear=True):
            self.account.apply();self.assertTrue(enabled());self.assertEqual(os.environ['BRIVANY_META_API_KEY'],TOKEN);self.assertEqual(os.environ['BRIVANY_CARTESIA_API_KEY'],TOKEN);self.assertEqual(os.environ['BRIVANY_DEEPGRAM_API_KEY'],TOKEN);self.assertEqual(demo_headers(),{'Authorization':'Bearer '+TOKEN,'User-Agent':'Brivany-Desktop/0.2.1'})
    def test_ordinary_installations_do_not_activate_a_demo(self):
        with patch('services.demo_account.DemoAccount') as factory:self.assertIsNone(start_private_demo(self.root,self.root));factory.assert_not_called()
    def test_invalid_server_session_cannot_enable_demo(self):
        with self.assertRaises(DemoError):self.account._save({**STATE,'account':{'id':'another-account','demo':True}})
        self.assertIsNone(self.account.session)
    def test_fixed_provider_urls_are_routed_but_other_hosts_are_not(self):
        self.account.activate(self.bootstrap)
        with patch.dict(os.environ,{},clear=True):
            self.assertEqual(endpoint('https://api.meta.ai/v1/responses'),'https://api.meta.ai/v1/responses');self.account.apply()
            for name,provider in [('api.meta.ai','meta'),('api.cartesia.ai','cartesia'),('api.deepgram.com','deepgram')]:self.assertEqual(endpoint('wss://'+name+'/v1/test?x=1'),'wss://demo.brivany.vetsa.es/proxy/'+provider+'/v1/test?x=1')
            self.assertEqual(endpoint('https://other.invalid/path'),'https://other.invalid/path')
    def test_fixed_https_connection_prefixes_paths_and_preserves_timeout(self):
        class Connection:
            def __init__(self,*args,**kwargs):self.args=args;self.timeout=kwargs['timeout'];self.sent=[]
            def request(self,*args,**kwargs):self.sent.append((args,kwargs))
        self.account.activate(self.bootstrap)
        with patch.dict(os.environ,{},clear=True):
            self.account.apply();value=https_connection(Connection,'api.meta.ai',443,timeout=2);value.request('POST','/v1/chat/completions',b'{}');value.timeout=7;self.assertEqual(value.connection.args,('demo.brivany.vetsa.es',443));self.assertEqual(value.connection.sent[0][0][1],'/proxy/meta/v1/chat/completions');self.assertEqual(value.connection.timeout,7)
    def test_demo_calls_use_only_the_account_gateway_and_map_receipts(self):
        self.account.activate(self.bootstrap);client=DemoCallClient(self.account);result=client.request('/v1/calls',{'id':'12345678-1234-4234-8234-123456789012','destination':'+34111111111','objective':'Synthetic call'});self.assertEqual(result['state'],'queued');self.assertTrue(self.http.calls[-1][1]['confirmed']);self.assertEqual(self.http.calls[-1][2],TOKEN);self.assertTrue(client.request('/v1/info')['configured'])
    def test_http_rejects_unexpected_routes_before_any_network_access(self):
        with self.assertRaises(DemoError):DemoHTTP().call('/admin/providers',{})

if __name__=='__main__':unittest.main()
