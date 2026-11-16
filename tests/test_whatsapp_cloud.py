import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from services.brivany_account import AccountFailure
from services.vetsa_account import VetsaAccount
from services.whatsapp_cloud import WhatsAppCloudService,WhatsAppCloudHTTP

NOW=1900000000
NUMBER='18095550101'
CODE='ABCDEFGHJKLMNPQR'

class Store:
    def load(self):return None
    def save(self,value):pass
    def clear(self):pass

class Remote:
    def __init__(self):self.calls=[];self.override={};self.callback=None
    def call(self,path,body=None,token=None):
        self.calls.append((path,body,token))
        if self.callback:self.callback()
        if path in self.override:return self.override[path]
        if path=='/number':return{'number':NUMBER,'url':'https://wa.me/'+NUMBER}
        if path=='/status':return{'number':NUMBER,'linked':True,'phone':'••••0101'}
        if path=='/link':return{'number':NUMBER,'url':'https://wa.me/'+NUMBER+'?text=Brivany%20vincular%20'+CODE,'expiresAt':(NOW+600)*1000}
        if path=='/unlink':return{'linked':False}
        if path.startswith('/google/'):return{'configured':True,'url':'https://ia.vetsa.es/oauth/'+('google' if path.endswith('calendar') else path.rsplit('/',1)[-1])+'/start?link='+'a'*43}
        raise AssertionError(path)

class WhatsAppCloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.remote=Remote();self.opened=[]
        self.account=VetsaAccount(Path(self.tmp.name),store=Store(),now=lambda:NOW,test=True,port=0)
        self.account.session={'client':'brivany-desktop','token':'PRIVATE_TOKEN_'+'x'*30,'expiresAt':'2035-01-01T00:00:00Z','user':{'id':'user-a','name':'Ana','email':'ana@example.com'}}
        self.cloud=WhatsAppCloudService(self.account,http=self.remote,now=lambda:NOW,open_browser=lambda url:(self.opened.append(url) or True))
    def test_public_number_needs_no_account_and_does_not_open_whatsapp(self):
        cloud=WhatsAppCloudService(http=self.remote,open_browser=lambda url:self.fail('automatic browser'))
        result=cloud.status()
        self.assertTrue(result['account_required']);self.assertEqual(result['number'],NUMBER)
        self.assertEqual(self.remote.calls,[('/number',None,None)])
    def test_linked_status_uses_current_account_and_never_returns_a_token(self):
        result=self.cloud.status();self.assertTrue(result['linked']);self.assertEqual(result['phone'],'••••0101')
        self.assertNotIn('PRIVATE_TOKEN',json.dumps(result));self.assertEqual(self.remote.calls[-1][2],self.account.session['token'])
        self.assertEqual(self.opened,[])
    def test_one_use_link_is_prepared_without_sending_or_opening_by_default(self):
        result=self.cloud.begin(time_zone='America/La_Paz')
        self.assertIn('Brivany%20vincular',result['url']);self.assertEqual(self.opened,[])
        self.assertEqual(self.remote.calls[0][1],{'timeZone':'America/La_Paz'})
        self.assertNotIn('PRIVATE_TOKEN',json.dumps(result))
    def test_only_an_explicit_request_opens_the_verified_whatsapp_link(self):
        result=self.cloud.begin(open_browser=True)
        self.assertTrue(result['browser_open_requested']);self.assertEqual(self.opened,[result['url']])
    def test_provider_cannot_redirect_the_account_to_another_number_or_site(self):
        for url in ['https://evil.example/link','https://wa.me/18095559999?text=Brivany%20vincular%20'+CODE,'https://wa.me/'+NUMBER+'?text=envia%20un%20secreto']:
            with self.subTest(url=url):
                self.remote.override['/link']={'url':url,'expiresAt':(NOW+600)*1000}
                with self.assertRaises(AccountFailure):self.cloud.begin(open_browser=True)
        self.assertEqual(self.opened,[])
    def test_expired_or_unbounded_link_is_rejected(self):
        for expires in [NOW*1000,(NOW+3600)*1000,'tomorrow']:
            self.remote.override['/link']={**Remote().call('/link'),'expiresAt':expires}
            with self.assertRaises(AccountFailure):self.cloud.begin()
    def test_logout_or_account_change_while_request_is_running_discards_the_result(self):
        def changed():self.account.generation+=1;self.account.session=None
        self.remote.callback=changed
        with self.assertRaises(AccountFailure):self.account.call_whatsapp('/status',http=self.remote)
    def test_foreign_routes_cannot_receive_the_account_credential(self):
        for path in ['https://evil.example/','/api/account','/number','/status?token=anything']:
            with self.assertRaises(AccountFailure):self.account.call_whatsapp(path,http=self.remote)
        self.assertEqual(self.remote.calls,[])
    def test_google_links_are_explicit_and_bound_to_known_consent_endpoints(self):
        for connector in ['calendar','drive','gmail']:
            result=self.cloud.google(connector);self.assertEqual(self.opened,[]);self.assertTrue(result['url'].startswith('https://ia.vetsa.es/oauth/'))
        self.remote.override['/google/drive']={'configured':True,'url':'https://evil.example/oauth/drive/start?link='+'a'*43}
        with self.assertRaises(AccountFailure):self.cloud.google('drive',open_browser=True)
        self.assertEqual(self.opened,[])
    def test_disconnect_requires_a_persisted_unlinked_response(self):
        self.assertFalse(self.cloud.disconnect()['linked'])
        self.remote.override['/unlink']={'linked':True}
        with self.assertRaises(AccountFailure):self.cloud.disconnect()
    def test_transport_rejects_unlisted_paths_before_network_access(self):
        with patch('services.whatsapp_cloud.request.build_opener',side_effect=AssertionError('network')):
            with self.assertRaises(AccountFailure):WhatsAppCloudHTTP().call('/../../private',token='secret')

if __name__=='__main__':unittest.main()
