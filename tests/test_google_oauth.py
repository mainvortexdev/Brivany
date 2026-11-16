"""OAuth/state/persistence contracts using synthetic grants, never Google accounts.

The single DPAPI primitive test is real Windows user-bound encryption of fixed
synthetic bytes. All OAuth HTTP requests use deterministic substitutes.
"""
from base64 import urlsafe_b64encode
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib import error,parse

from services.google_oauth import (GoogleOAuthError,GoogleOAuthHTTP,GoogleOAuthService,
    WindowsDPAPIProtector,PREFIX,TOKEN_URL,REVOKE_URL,AUTH_URL,CALLBACK_PATH)


class SyntheticProtector:
    """A memory-only fixture map, not encryption or a production fallback."""
    available=True;encrypted=False;name='synthetic_memory_map_not_encryption'
    def __init__(self):self.values={}
    def protect(self,raw):
        opaque=b'test-record-'+secrets.token_bytes(24);self.values[opaque]=raw;return opaque
    def unprotect(self,raw):return self.values[raw]


class SyntheticGoogle:
    simulation=True
    def __init__(self):self.calls=[];self.response=None;self.on_request=None;self.failure=None
    def __call__(self,url,fields):
        self.calls.append((url,deepcopy(fields)))
        if self.on_request:self.on_request(url,fields)
        if self.failure:raise self.failure
        if url==REVOKE_URL:return {}
        return deepcopy(self.response)


class GoogleOAuthTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.clock=[1800000000.]
        self.env={'BRIVANY_GOOGLE_CLIENT_ID':'12345-synthetic.apps.googleusercontent.com',
            'BRIVANY_GOOGLE_CLIENT_SECRET':'synthetic-client-secret-private'}
        self.transport=SyntheticGoogle();self.protector=SyntheticProtector();self.service=self.instance()

    def instance(self,**changes):
        return GoogleOAuthService(self.root,base_url=changes.pop('base_url','http://127.0.0.1:19876'),
            env=changes.pop('env',self.env),transport=changes.pop('transport',self.transport),
            now=lambda:self.clock[0],protector=changes.pop('protector',self.protector),**changes)

    def begin(self,connector='calendar',operations=None,service=None):
        result=(service or self.service).begin(connector,operations)
        query={key:values[0] for key,values in parse.parse_qs(parse.urlsplit(result['authorization_url']).query).items()}
        return result,query

    def response(self,query,**changes):
        result={'access_token':'synthetic-access-token-private','refresh_token':'synthetic-refresh-token-private',
            'token_type':'Bearer','expires_in':3600,'scope':query['scope']}
        result.update(changes);return result

    def authorize(self,connector='calendar',operations=None,**response_changes):
        result,query=self.begin(connector,operations);self.transport.response=self.response(query,**response_changes)
        self.service.finish({'state':[query['state']],'code':['synthetic-authorization-code-private']})
        return result,query

    def test_begin_and_status_make_no_network_or_browser_request_and_pkce_matches_exchange(self):
        self.service.status();result,query=self.begin()
        self.assertEqual(self.transport.calls,[]);self.assertTrue(result['requires_external_browser'])
        self.assertEqual(parse.urlsplit(result['authorization_url']).scheme,'https');self.assertTrue(result['authorization_url'].startswith(AUTH_URL+'?'))
        self.assertEqual(query['redirect_uri'],'http://127.0.0.1:19876'+CALLBACK_PATH)
        self.assertEqual(query['code_challenge_method'],'S256');self.assertNotIn('include_granted_scopes',query)
        self.assertNotIn('client_secret',query);self.assertNotIn('code_verifier',query)
        self.transport.response=self.response(query)
        safe=self.service.finish({'code':'synthetic-authorization-code-private','state':query['state']})
        url,fields=self.transport.calls[0];self.assertEqual(url,TOKEN_URL)
        verifier=fields['code_verifier'];self.assertTrue(43<=len(verifier)<=128)
        challenge=urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        self.assertEqual(challenge,query['code_challenge']);self.assertEqual(fields['redirect_uri'],query['redirect_uri'])
        serialized=json.dumps(safe);self.assertNotIn('synthetic-access',serialized);self.assertNotIn('synthetic-refresh',serialized)
        self.assertTrue(safe['connectors'][0]['authorized']);self.assertFalse(safe['connectors'][0]['connected'])

    def test_grants_are_separate_minimal_and_calendar_is_readonly(self):
        self.authorize('calendar',['calendar.list'])
        self.assertEqual(self.transport.calls[0][1]['grant_type'],'authorization_code')
        self.assertEqual(self.service.access_token('calendar',required_scopes=[PREFIX+'calendar.events.readonly']),'synthetic-access-token-private')
        self.assertEqual(self.service.status('calendar')['connectors'][0]['granted_scopes'],[PREFIX+'calendar.events.readonly'])
        self.authorize('gmail')
        self.assertTrue(self.service.status('calendar')['connectors'][0]['authorized'])
        self.assertEqual(self.service.status('gmail')['connectors'][0]['granted_scopes'],[PREFIX+'gmail.readonly'])
        with self.assertRaises(GoogleOAuthError) as missing:self.service.access_token('gmail',required_scopes=[PREFIX+'gmail.compose'])
        self.assertEqual(missing.exception.status,403);self.assertFalse(self.service.status('drive')['connectors'][0]['authorized'])

    def test_calendar_write_consent_is_rejected_and_existing_read_grant_survives(self):
        self.authorize('calendar');calls=len(self.transport.calls)
        with self.assertRaises(GoogleOAuthError):self.begin('calendar',['calendar.create'])
        grant=self.service.status('calendar')['connectors'][0]
        self.assertEqual(grant['authorized_operations'],['calendar.list'])
        self.assertEqual(grant['granted_scopes'],[PREFIX+'calendar.events.readonly'])
        self.assertEqual(len(self.transport.calls),calls)

    def test_legacy_calendar_write_grant_is_exposed_as_readonly(self):
        self.authorize('calendar')
        with self.service._db() as db:
            value=self.service._load_token(db,'calendar');generation=value.pop('_generation')
            value['scopes']=[PREFIX+'calendar.events'];self.service._save(db,'calendar',generation,value)
        restored=self.instance();grant=restored.status('calendar')['connectors'][0]
        self.assertEqual(grant['authorized_operations'],['calendar.list'])
        self.assertEqual(restored.access_token('calendar',required_scopes=[PREFIX+'calendar.events.readonly']),'synthetic-access-token-private')

    def test_desktop_pkce_client_secret_is_optional(self):
        service=self.instance(env={'BRIVANY_GOOGLE_CLIENT_ID':self.env['BRIVANY_GOOGLE_CLIENT_ID']})
        _,query=self.begin(service=service);self.transport.response=self.response(query)
        service.finish({'state':query['state'],'code':'synthetic-code'})
        self.assertNotIn('client_secret',self.transport.calls[0][1])
        self.assertEqual(service.access_token('calendar'),'synthetic-access-token-private')

    def test_current_google_issuer_is_accepted_and_foreign_or_duplicate_issuer_never_exchanges(self):
        _,query=self.begin('drive');self.transport.response=self.response(query)
        callback={'state':[query['state']],'code':['synthetic-code'],'iss':['https://accounts.google.com']}
        for issuer in ('https://untrusted.example','http://accounts.google.com','https://accounts.google.com/','https://accounts.google.com.untrusted.example'):
            with self.subTest(issuer=issuer),self.assertRaises(GoogleOAuthError) as rejected:
                self.service.finish({**callback,'iss':[issuer]})
            self.assertEqual(rejected.exception.code,'google_issuer')
        with self.assertRaises(GoogleOAuthError):self.service.finish({**callback,'iss':['https://accounts.google.com']*2})
        self.assertEqual(self.transport.calls,[])
        self.service.finish(callback)
        self.assertEqual(len(self.transport.calls),1)
        self.assertTrue(self.service.status('drive')['connectors'][0]['authorized'])

    def test_unknown_connector_cross_connector_scopes_and_write_requests_are_rejected(self):
        for connector,operations in [('gmail',['calendar.create']),('drive',['drive.search','gmail.search']),
            ('calendar',['calendar.list','calendar.list']),('calendar',[]),('unknown',None),('calendar',[{}])]:
            with self.subTest(connector=connector,operations=operations),self.assertRaises(GoogleOAuthError):
                self.begin(connector,operations)
        self.assertEqual(self.transport.calls,[])

    def test_invalid_state_expiry_denial_and_callback_replay_never_exchange_twice(self):
        _,query=self.begin()
        with self.assertRaises(GoogleOAuthError):self.service.finish({'state':'A'*43,'code':'wrong'})
        self.assertEqual(self.transport.calls,[])
        with self.assertRaises(GoogleOAuthError) as denied:self.service.finish({'state':query['state'],'error':'access_denied'})
        self.assertEqual(denied.exception.code,'google_consent_denied')
        with self.assertRaises(GoogleOAuthError):self.service.finish({'state':query['state'],'code':'late'})
        _,query=self.begin();self.clock[0]+=301
        with self.assertRaises(GoogleOAuthError) as expired:self.service.finish({'state':query['state'],'code':'expired'})
        self.assertEqual(expired.exception.code,'google_state_expired');self.assertEqual(self.transport.calls,[])
        self.authorize();query=self.transport.calls[-1][1]
        self.assertNotIn('state',query)

    def test_replaced_flow_and_changed_origin_or_client_are_rejected(self):
        _,old=self.begin();_,new=self.begin()
        with self.assertRaises(GoogleOAuthError):self.service.finish({'state':old['state'],'code':'old'})
        other=self.instance(base_url='http://127.0.0.1:19877')
        with self.assertRaises(GoogleOAuthError) as changed:other.finish({'state':new['state'],'code':'wrong-origin'})
        self.assertEqual(changed.exception.code,'google_flow_changed')
        _,query=self.begin();other=self.instance(env={**self.env,'BRIVANY_GOOGLE_CLIENT_ID':'98765-other.apps.googleusercontent.com'})
        with self.assertRaises(GoogleOAuthError):other.finish({'state':query['state'],'code':'changed-client'})
        self.assertEqual(self.transport.calls,[])

    def test_failed_exchange_is_consumed_and_provider_details_do_not_persist(self):
        _,query=self.begin();self.transport.failure=GoogleOAuthError('google_exchange_failed','Fallo sustituido.',502)
        for _ in range(2):
            with self.assertRaises(GoogleOAuthError):self.service.finish({'state':query['state'],'code':'synthetic-code'})
        self.assertEqual(len(self.transport.calls),1);self.assertFalse(self.service.status()['connectors'][0]['authorized'])
        raw=self.service.database.read_bytes();self.assertNotIn(query['state'].encode(),raw)
        self.assertNotIn(self.env['BRIVANY_GOOGLE_CLIENT_SECRET'].encode(),raw)

    def test_restart_keeps_private_grant_and_status_never_returns_tokens(self):
        _,query=self.authorize();restored=self.instance()
        count=len(self.transport.calls);safe=restored.status();self.assertEqual(len(self.transport.calls),count)
        self.assertEqual(restored.access_token('calendar'),'synthetic-access-token-private')
        serialized=json.dumps(safe);raw=self.service.database.read_bytes()
        for private in ['synthetic-access-token-private','synthetic-refresh-token-private','synthetic-authorization-code-private',self.env['BRIVANY_GOOGLE_CLIENT_SECRET']]:
            self.assertNotIn(private,serialized);self.assertNotIn(private.encode(),raw)
        self.assertNotIn(query['state'].encode(),raw)

    def test_refresh_preserves_refresh_token_and_serializes_two_instances(self):
        self.authorize(expires_in=60);self.clock[0]+=20
        self.transport.response={'access_token':'synthetic-refreshed-private','expires_in':3600,'token_type':'Bearer'}
        other=self.instance();barrier=threading.Barrier(2)
        def access(service):barrier.wait();return service.access_token('calendar')
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(access,[self.service,other]))
        self.assertEqual(results,['synthetic-refreshed-private']*2);self.assertEqual(len(self.transport.calls),2)
        self.assertEqual(self.transport.calls[-1][1]['refresh_token'],'synthetic-refresh-token-private')
        self.assertTrue(self.instance().status('calendar')['connectors'][0]['refresh_token_saved'])

    def test_previous_grant_can_refresh_while_new_consent_is_pending(self):
        self.authorize('gmail',expires_in=60);_,pending=self.begin('gmail',['gmail.search','gmail.draft']);self.clock[0]+=20
        self.transport.response={'access_token':'synthetic-refreshed-private','expires_in':3600,'token_type':'Bearer'}
        self.assertEqual(self.service.access_token('gmail'),'synthetic-refreshed-private')
        self.assertTrue(self.service.status('gmail')['connectors'][0]['pending'])
        self.transport.response=self.response(pending)
        self.service.finish({'state':pending['state'],'code':'synthetic-new-code'})
        self.assertEqual(self.service.status('gmail')['connectors'][0]['authorized_operations'],['gmail.search','gmail.draft'])

    def test_expired_grant_cleanup_is_committed_and_no_retry_occurs(self):
        self.authorize(expires_in=60);self.clock[0]+=20
        self.transport.failure=GoogleOAuthError('google_grant_expired','Autorización vencida.',401)
        with self.assertRaises(GoogleOAuthError):self.service.access_token('calendar')
        self.assertFalse(self.instance().status('calendar')['connectors'][0]['authorized']);self.assertEqual(len(self.transport.calls),2)
        with self.assertRaises(GoogleOAuthError):self.service.access_token('calendar')
        self.assertEqual(len(self.transport.calls),2)

    def test_invalid_or_overscoped_token_response_is_not_saved(self):
        for changes in [{'scope':PREFIX+'gmail.readonly'},{'refresh_token':None},{'expires_in':True},{'token_type':'other'},{'access_token':'bad\nvalue'}]:
            with self.subTest(changes=list(changes)):
                _,query=self.begin();self.transport.response=self.response(query,**changes)
                with self.assertRaises(GoogleOAuthError):self.service.finish({'state':query['state'],'code':'synthetic-code'})
                self.assertFalse(self.service.status('calendar')['connectors'][0]['authorized'])

    def test_concurrent_callback_claim_exchanges_only_once(self):
        _,query=self.begin();self.transport.response=self.response(query);other=self.instance();barrier=threading.Barrier(2)
        def finish(service):
            barrier.wait()
            try:service.finish({'state':query['state'],'code':'synthetic-code'});return True
            except GoogleOAuthError:return False
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(finish,[self.service,other]))
        self.assertEqual(sorted(results),[False,True]);self.assertEqual(len(self.transport.calls),1)

    def test_disconnect_during_exchange_cannot_resurrect_grant(self):
        _,query=self.begin();self.transport.response=self.response(query);started=threading.Event();release=threading.Event();outcomes=[]
        def block(*_):started.set();release.wait(3)
        self.transport.on_request=block
        def finish():
            try:self.service.finish({'state':query['state'],'code':'synthetic-code'});outcomes.append('saved')
            except GoogleOAuthError as exc:outcomes.append(exc.code)
        thread=threading.Thread(target=finish);thread.start();self.assertTrue(started.wait(3))
        self.instance().disconnect('calendar',revoke=False);release.set();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(outcomes,['google_flow_replaced'])
        self.assertFalse(self.service.status('calendar')['connectors'][0]['authorized'])

    def test_revoke_clears_all_project_grants_and_local_disconnect_clears_only_selected(self):
        self.authorize('calendar');self.authorize('gmail');self.authorize('drive')
        count=len(self.transport.calls);result=self.service.disconnect('calendar',revoke=False)
        self.assertEqual(len(self.transport.calls),count);self.assertEqual(result['removed_local_connectors'],['calendar'])
        self.assertTrue(self.service.status('gmail')['connectors'][0]['authorized'])
        self.begin('calendar');result=self.service.disconnect('gmail',revoke=True)
        self.assertEqual(self.transport.calls[-1][0],REVOKE_URL);self.assertTrue(result['revocation_request_accepted'])
        self.assertTrue(result['other_google_grants_may_be_revoked'])
        self.assertTrue(all(not item['authorized'] and not item['pending'] for item in self.service.status()['connectors']))

    def test_revocation_failure_keeps_local_credentials_removed_and_reports_unknown(self):
        self.authorize();self.transport.failure=GoogleOAuthError('google_exchange_failed','Sustituto no disponible.',502)
        result=self.service.disconnect('calendar')
        self.assertTrue(result['local_credentials_removed']);self.assertTrue(result['revocation_requested'])
        self.assertFalse(result['revocation_request_accepted']);self.assertEqual(result['revocation_error_code'],'google_exchange_failed')
        self.assertFalse(self.instance().status('calendar')['connectors'][0]['authorized'])

    def test_missing_configuration_insecure_storage_and_foreign_redirect_never_exchange(self):
        missing=self.instance(env={});self.assertFalse(missing.status()['client_configured'])
        with self.assertRaises(GoogleOAuthError):missing.begin('calendar')
        unavailable=type('Unavailable',(),{'available':False,'encrypted':False,'name':'unavailable'})()
        service=self.instance(protector=unavailable)
        with self.assertRaises(GoogleOAuthError):service.begin('calendar')
        for base in ['https://127.0.0.1:19876','http://localhost:19876','http://127.0.0.1:19876/other','http://user@127.0.0.1:19876','https://example.com']:
            with self.subTest(base=base),self.assertRaises(GoogleOAuthError):self.instance(base_url=base)
        self.assertEqual(self.transport.calls,[])

    @unittest.skipUnless(sys.platform=='win32','DPAPI is specific to Windows')
    def test_real_windows_dpapi_roundtrip_is_private_without_oauth_network(self):
        protector=WindowsDPAPIProtector();raw=b'synthetic-test-secret-not-an-account'
        encrypted=protector.protect(raw)
        self.assertNotEqual(encrypted,raw);self.assertNotIn(raw,encrypted)
        self.assertEqual(WindowsDPAPIProtector().unprotect(encrypted),raw)
        with self.assertRaises(GoogleOAuthError):protector.unprotect(b'invalid ciphertext')
        self.assertEqual(self.transport.calls,[])
        service=self.instance(protector=WindowsDPAPIProtector())
        _,query=self.begin(service=service);self.transport.response=self.response(query)
        service.finish({'state':query['state'],'code':'synthetic-code'})
        restored=self.instance(protector=WindowsDPAPIProtector())
        self.assertEqual(restored.access_token('calendar'),'synthetic-access-token-private')
        self.assertNotIn(b'synthetic-access-token-private',service.database.read_bytes())
        self.assertNotIn(b'synthetic-refresh-token-private',service.database.read_bytes())
        self.assertEqual(len(self.transport.calls),1);self.assertTrue(restored.status()['storage']['encrypted'])


class GoogleOAuthHTTPTests(unittest.TestCase):
    def test_only_google_token_or_revoke_post_uses_no_redirect_and_bounded_response(self):
        with patch('services.google_oauth.request.build_opener') as factory:
            with self.assertRaises(GoogleOAuthError):GoogleOAuthHTTP()('https://evil.invalid',{'token':'synthetic'})
            factory.assert_not_called()
            response=BytesIO(b'{"access_token":"synthetic"}');response.__enter__=lambda:response
            factory.return_value.open.return_value=response
            result=GoogleOAuthHTTP()(TOKEN_URL,{'code':'synthetic-code'})
            self.assertEqual(result,{'access_token':'synthetic'})
            args=factory.return_value.open.call_args
            self.assertEqual(args.args[0].full_url,TOKEN_URL);self.assertEqual(args.args[0].method,'POST');self.assertEqual(args.kwargs['timeout'],15)
            handler=factory.call_args.args[0];self.assertIsNone(handler.redirect_request(None,None,None,None,None,None))

    def test_http_failure_closes_body_and_never_exposes_diagnostic(self):
        failure=error.HTTPError(TOKEN_URL,400,'bad',{},BytesIO(b'{"error":"invalid_grant","secret":"SYNTHETIC-PRIVATE-DIAGNOSTIC"}'))
        with patch('services.google_oauth.request.build_opener') as factory:
            factory.return_value.open.side_effect=failure
            with self.assertRaises(GoogleOAuthError) as denied:GoogleOAuthHTTP()(TOKEN_URL,{'refresh_token':'synthetic'})
            self.assertEqual(denied.exception.code,'google_grant_expired');self.assertNotIn('SYNTHETIC',str(denied.exception));self.assertTrue(failure.closed)


if __name__=='__main__':unittest.main()
