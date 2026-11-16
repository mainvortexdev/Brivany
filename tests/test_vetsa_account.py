"""Account boundaries with synthetic identity responses; no real credentials."""
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch,MagicMock
from urllib import parse,request,error
from services.brivany_account import AccountFailure,SecureAccountFile
from services.vetsa_account import VetsaAccount,IdentityHTTP

USER={'id':'fixture-shared-vetsa-user','name':'Cuenta de prueba','email':'fixture@example.test'}
TOKEN='synthetic-session-not-a-real-credential'
EXPIRES=datetime.fromtimestamp(2000000000,tz=timezone.utc).isoformat()
SESSION={'client':'brivany-desktop','user':USER,'token':TOKEN,'expiresAt':EXPIRES}

class Store:
    def __init__(self,value=None):self.value=value
    def load(self):return self.value
    def save(self,value):self.value=json.loads(json.dumps(value))
    def clear(self):self.value=None

class HTTP:
    def __init__(self):self.calls=[];self.fail=None;self.wait=None;self.release=None
    def call(self,path,body=None,token=None):
        self.calls.append((path,body,token))
        if self.fail:raise self.fail
        if path.endswith('/token'):
            if self.wait:self.wait.set();self.release.wait(3)
            return {'token':TOKEN,'user':{'id':USER['id']},'expiresAt':EXPIRES}
        if path.endswith('/session'):return {'authenticated':True,**SESSION}
        if path.endswith('/security'):return {'emailVerified':True,'threeAuth':True,'emailAlerts':True,'passkeys':[{'id':'private-key-id'}]}
        return {'success':True}

class Window:
    def __init__(self):self.destroyed=False
    def destroy(self):self.destroyed=True

class VetsaAccountTests(unittest.TestCase):
    def make(self,*,store=None):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);http=HTTP();urls=[];window=Window()
        account=VetsaAccount(tmp.name,http=http,store=store or Store(),open_window=lambda url,title,on_close:(urls.append(url) or window),now=lambda:1900000000,port=0,test=True)
        self.addCleanup(account.close);return account,http,urls,window
    def test_same_user_persists_but_renderer_never_receives_credentials_or_remote_access(self):
        store=Store(SESSION);account,http,_,_=self.make(store=store);account.refresh();state=account.status()
        self.assertEqual(state['account'],USER);self.assertTrue(state['connected']);self.assertFalse(state['remote_enabled']);self.assertEqual(state['security']['passkeys'],1)
        self.assertNotIn(TOKEN,json.dumps(state));self.assertNotIn('private-key-id',json.dumps(state));self.assertEqual(store.value['token'],TOKEN)
        replacement,_,_,_=self.make(store=store);self.assertEqual(replacement.status()['account']['id'],USER['id']);self.assertFalse(replacement.status()['connected'])
    def test_pkce_callback_is_local_exact_one_use_and_does_not_reveal_verifier(self):
        account,http,urls,window=self.make();state=account.begin();self.assertTrue(state['pending']);params=parse.parse_qs(parse.urlsplit(urls[0]).query)
        self.assertEqual(params['source'],['brivany-desktop']);self.assertEqual(params['code_challenge_method'],['S256']);self.assertNotIn('verifier',urls[0])
        generation=account.generation;correct='/auth?code='+'c'*43+'&state='+params['state'][0]
        for bad in [correct.replace('/auth?','/evil?'),correct+'&state=duplicate',correct.replace(params['state'][0],'x'*43)]:self.assertFalse(account.complete(bad,generation))
        self.assertEqual(http.calls,[])
        self.assertTrue(account.complete(correct,generation));self.assertFalse(account.complete(correct,generation));self.assertEqual(account.status()['account']['id'],USER['id'])
        exchange=http.calls[0][1];self.assertNotIn(exchange['codeVerifier'],json.dumps(account.status()));account._close_login();self.assertTrue(window.destroyed)
    def test_forged_host_is_rejected_without_consuming_requested_login(self):
        account,http,urls,_=self.make();account.begin();params=parse.parse_qs(parse.urlsplit(urls[0]).query);url=params['redirect_uri'][0]+'?code='+'c'*43+'&state='+params['state'][0]
        req=request.Request(url,headers={'Host':'attacker.invalid'})
        with self.assertRaises(error.HTTPError) as raised:request.urlopen(req,timeout=3)
        self.assertEqual(raised.exception.code,400);raised.exception.close();self.assertEqual(http.calls,[]);self.assertTrue(account.status()['pending'])
    def test_cancel_and_logout_during_exchange_cannot_restore_the_old_session(self):
        account,http,urls,_=self.make();account.begin();params=parse.parse_qs(parse.urlsplit(urls[0]).query);generation=account.generation
        http.wait=threading.Event();http.release=threading.Event();result=[]
        worker=threading.Thread(target=lambda:result.append(account.complete('/auth?code='+'c'*43+'&state='+params['state'][0],generation)));worker.start();self.assertTrue(http.wait.wait(1));account.logout();http.release.set();worker.join(3)
        self.assertEqual(result,[False]);self.assertFalse(account.status()['signed_in']);self.assertIsNone(account.store.value);self.assertTrue(any(p.endswith('/logout') for p,_,_ in http.calls))
    def test_revoked_session_clears_encrypted_store_but_network_error_preserves_it(self):
        account,http,_,_=self.make(store=Store(SESSION));http.fail=AccountFailure('Sin conexión.')
        with self.assertRaises(AccountFailure):account.refresh()
        self.assertIsNotNone(account.store.value);self.assertFalse(account.status()['connected'])
        http.fail.unauthorized=True
        with self.assertRaises(AccountFailure):account.refresh()
        self.assertIsNone(account.store.value);self.assertFalse(account.status()['signed_in'])
    def test_logout_revokes_brivany_only_and_management_links_are_fixed(self):
        account,http,urls,_=self.make(store=Store(SESSION));account.manage('security');self.assertEqual(urls,['https://cognira.vetsa.es/account#security'])
        with self.assertRaises(AccountFailure):account.manage('https://attacker.invalid')
        state=account.logout();self.assertFalse(state['signed_in']);self.assertIsNone(account.store.value);self.assertEqual(http.calls[-1][0],'/api/brivany/account/logout')
    def test_identity_transport_rejects_arbitrary_endpoints(self):
        for path in ['https://attacker.invalid','/api/auth/login','/api/brivany/account/session?token=secret']:
            with self.assertRaises(AccountFailure):IdentityHTTP().call(path)
    def test_native_account_window_has_no_computer_bridge_and_accepts_only_identity_pages(self):
        from desktop.experience.account_window import open_account_window
        with patch.dict('sys.modules',{'webview':MagicMock()}) as modules:
            host=modules['webview'];on_close=MagicMock(return_value={'pending':False});event=host.create_window.return_value.events.closed
            self.assertIs(open_account_window('https://cognira.vetsa.es/auth?source=brivany-desktop','Vetsa',on_close),host.create_window.return_value)
            self.assertIsNone(host.create_window.call_args.kwargs['js_api'])
            callback=event.__iadd__.call_args.args[0]
            self.assertIsNone(callback());on_close.assert_called_once_with()
            for url in ['http://cognira.vetsa.es/auth','https://attacker.invalid/auth','https://cognira.vetsa.es:443/auth','https://cognira.vetsa.es/api/account/security','https://cognira.vetsa.es@attacker.invalid/account']:
                with self.assertRaises(ValueError):open_account_window(url,'Vetsa')
            self.assertEqual(host.create_window.call_count,1)
    def test_old_callback_cleanup_cannot_close_a_new_signin(self):
        account,http,urls,_=self.make();account.begin();old=account.generation;account.cancel()
        account.begin();server=account.server;window=account.window
        account._close_login(old)
        self.assertIs(account.server,server);self.assertIs(account.window,window);self.assertTrue(account.status()['pending'])
    def test_encrypted_storage_failure_revokes_the_new_session_and_closes_signin(self):
        class UnavailableStore(Store):
            def save(self,value):raise PermissionError('private filesystem details')
        account,http,urls,window=self.make(store=UnavailableStore());account.begin();params=parse.parse_qs(parse.urlsplit(urls[0]).query)
        with self.assertRaisesRegex(AccountFailure,'sesión cifrada'):
            account.complete('/auth?code='+'c'*43+'&state='+params['state'][0],account.generation)
        state=account.status();self.assertFalse(state['signed_in']);self.assertFalse(state['pending']);self.assertIsNone(account.server);self.assertTrue(window.destroyed)
        self.assertNotIn('private filesystem',state['error']);self.assertTrue(any(p.endswith('/logout') for p,_,_ in http.calls))
    def test_dpapi_file_contains_no_plain_token_or_identity(self):
        from services.google_oauth import WindowsDPAPIProtector
        if not WindowsDPAPIProtector().available:self.skipTest('Windows required')
        with tempfile.TemporaryDirectory() as tmp:
            store=SecureAccountFile(Path(tmp)/'session.dpapi');store.save(SESSION);raw=store.path.read_bytes()
            for value in [TOKEN,USER['email'],USER['id']]:self.assertNotIn(value.encode(),raw)
            self.assertEqual(store.load(),SESSION)

if __name__=='__main__':unittest.main()
