"""Real loopback account HTTP and journals, exclusively synthetic OAuth/API IO."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
from uuid import uuid4

from services.h1.server import Handler,save_local_secret
from services.connections import ConnectionsService
from services.google_oauth import GoogleOAuthService,PREFIX,TOKEN_URL,REVOKE_URL


class SyntheticProtector:
    available=True;encrypted=False;name='test_memory_map_not_encryption'
    def __init__(self):self.values={}
    def protect(self,raw):
        opaque=b'test-only-'+secrets.token_bytes(24);self.values[opaque]=raw;return opaque
    def unprotect(self,value):return self.values[value]


class ConnectionsHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.calls=[];self.response={'files':[{'id':'fixture-1','name':'PRIVATE-SYNTHETIC-RESULT','mimeType':'application/pdf'}]};self.failure=False
        self.env={'BRIVANY_GOOGLE_CLIENT_ID':'synthetic-client-12345.apps.googleusercontent.com',
            'BRIVANY_GOOGLE_CLIENT_SECRET':'synthetic-client-secret-private'}
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.base='http://127.0.0.1:'+str(self.server.server_port)
        self.scopes=PREFIX+'drive.metadata.readonly'
        def oauth_http(url,fields):
            self.calls.append(('oauth',url))
            if url==REVOKE_URL:return {}
            if url!=TOKEN_URL:raise AssertionError('Unknown external destination')
            return {'access_token':'synthetic-access-token-private','refresh_token':'synthetic-refresh-token-private',
                'expires_in':3600,'token_type':'Bearer','scope':self.scopes}
        oauth_http.simulation=True
        def api_http(method,url,token,payload=None):
            self.calls.append(('provider',method,url))
            if self.failure:raise OSError('PRIVATE provider token=DO-NOT-RETURN')
            return self.response
        api_http.simulation=True
        self.oauth=GoogleOAuthService(self.root/'oauth',base_url=self.base,env=self.env,transport=oauth_http,protector=SyntheticProtector())
        self.connections=ConnectionsService(self.root/'connections',base_url=self.base,oauth=self.oauth,env=self.env,http=api_http)
        self.server.connections=self.connections
        thread=threading.Thread(target=self.server.serve_forever,daemon=True);thread.start()
        def close():self.server.shutdown();self.server.server_close();thread.join(3)
        self.addCleanup(close)

    def request(self,method,path,value=None,*,origin=True,host=None,content_type='application/json',raw=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        headers={'Content-Type':content_type}
        if origin:headers['Origin']=self.base if origin is True else origin
        if host:headers['Host']=host
        body=raw if raw is not None else None if value is None else json.dumps(value).encode()
        connection.request(method,path,body=body,headers=headers)
        response=connection.getresponse();status=response.status;body=response.read();connection.close()
        try:decoded=json.loads(body)
        except ValueError:decoded=body.decode('utf-8')
        return status,decoded

    def authorize(self,operations=None):
        status,begin=self.request('POST','/api/integrations/google/begin',{'connector':'drive','operations':operations or ['drive.search']})
        self.assertEqual(status,200);query=parse_qs(urlsplit(begin['authorization_url']).query)
        status,_=self.request('GET','/api/integrations/google/callback?state='+query['state'][0]+'&code=synthetic-code-private&iss=https%3A%2F%2Faccounts.google.com',origin=False)
        self.assertEqual(status,200)

    def proposal(self):
        status,result=self.request('POST','/api/integrations/proposals',{'operation':'drive.search','parameters':{'query':'Synthetic query'},'request_id':str(uuid4())})
        self.assertEqual(status,201);return result

    def approve(self,proposal):
        status,result=self.request('POST','/api/integrations/approve',{'proposal_id':proposal['id'],'action_sha256':proposal['action_sha256']})
        self.assertEqual(status,200);return result

    def execute(self,proposal,approval):
        return self.request('POST','/api/integrations/execute',{'proposal_id':proposal['id'],'parameters':proposal['parameters'],'approval_id':approval['approval_id'],'execute':True})

    def test_calendar_write_is_not_advertised_or_authorized_or_proposed(self):
        status,result=self.request('GET','/api/integrations/status');self.assertEqual(status,200)
        calendar=next(item for item in result['registry']['connectors'] if item['id']=='calendar')
        self.assertEqual([item['name'] for item in calendar['operations']],['calendar.list'])
        status,_=self.request('POST','/api/integrations/google/begin',{'connector':'calendar','operations':['calendar.create']})
        self.assertEqual(status,422)
        status,_=self.request('POST','/api/integrations/proposals',{'operation':'calendar.create','parameters':{'title':'Synthetic','start':'2027-01-15T09:00:00Z','end':'2027-01-15T10:00:00Z'}})
        self.assertEqual(status,422);self.assertEqual(self.calls,[])

    def test_status_is_read_only_and_never_exposes_tokens_or_secret_values(self):
        for _ in range(2):
            status,result=self.request('GET','/api/integrations/status');self.assertEqual(status,200)
            text=json.dumps(result);self.assertNotIn(self.env['BRIVANY_GOOGLE_CLIENT_SECRET'],text)
            self.assertFalse(result['automatic_sending']);self.assertFalse(result['public_webhook_mounted'])
        self.assertEqual(self.calls,[])

    def test_csrf_origin_host_media_type_and_oversize_are_rejected_before_actions(self):
        route='/api/integrations/google/begin';value={'connector':'drive'}
        self.assertEqual(self.request('POST',route,value,origin=False)[0],403)
        self.assertEqual(self.request('POST',route,value,origin='https://unrelated.invalid')[0],403)
        self.assertEqual(self.request('POST',route,value,host='unrelated.invalid')[0],403)
        self.assertEqual(self.request('POST',route,value,content_type='text/plain')[0],415)
        self.assertEqual(self.request('POST',route,raw=b'x'*40001)[0],413)
        self.assertEqual(self.calls,[])

    def test_parameters_unknown_operations_and_scope_escalation_are_rejected(self):
        for value in ({'connector':'drive','operations':['gmail.draft']},{'connector':'unknown'},
                {'connector':'drive','redirect_uri':'https://unrelated.invalid'}, {'connector':'drive','open_browser':'yes'}):
            self.assertEqual(self.request('POST','/api/integrations/google/begin',value)[0],422)
        self.assertEqual(self.request('POST','/api/integrations/proposals',{'operation':'system.shell','parameters':{'command':'echo test'}})[0],422)
        self.assertEqual(self.calls,[])

    def test_missing_scope_blocks_before_consuming_review_approval(self):
        self.connections.save_settings({'execution_enabled':True});proposal=self.proposal();approval=self.approve(proposal)
        status,result=self.execute(proposal,approval);self.assertEqual(status,403);self.assertEqual(result['error']['code'],'google_authorization_pending')
        with self.connections.integration._db() as db:self.assertEqual(db.execute('SELECT used FROM approvals').fetchone()[0],0)
        self.assertEqual(self.calls,[])

    def test_reviewed_search_returns_ephemeral_metadata_and_duplicate_does_not_repeat(self):
        self.authorize();self.connections.save_settings({'execution_enabled':True});proposal=self.proposal();approval=self.approve(proposal)
        status,result=self.execute(proposal,approval);self.assertEqual(status,200);self.assertEqual(result['state'],'succeeded_test_stub')
        self.assertFalse(result['result_persisted']);self.assertEqual(result['external_calls'],0)
        self.assertIn('PRIVATE-SYNTHETIC-RESULT',json.dumps(result['result']))
        self.assertNotIn(b'PRIVATE-SYNTHETIC-RESULT',self.connections.integration.database.read_bytes())
        self.assertNotIn('synthetic-access-token-private',json.dumps(result))
        status,repeated=self.execute(proposal,approval);self.assertEqual(status,200);self.assertNotIn('result',repeated)
        self.assertEqual(sum(call[0]=='provider' for call in self.calls),1)

    def test_precreated_identical_proposal_cannot_repeat_an_uncertain_action(self):
        self.authorize();self.connections.save_settings({'execution_enabled':True});first=self.proposal();second=self.proposal()
        self.assertNotEqual(first['id'],second['id']);approval1=self.approve(first);approval2=self.approve(second)
        self.failure=True;status,result=self.execute(first,approval1);self.assertEqual(status,200);self.assertEqual(result['state'],'uncertain')
        status,repeated=self.execute(second,approval2);self.assertEqual(status,200);self.assertEqual(repeated['id'],first['id'])
        self.assertEqual(sum(call[0]=='provider' for call in self.calls),1)
        self.assertNotIn('DO-NOT-RETURN',json.dumps(result))
        with self.connections.integration._db() as db:
            self.assertEqual(db.execute('SELECT used FROM approvals WHERE id=?',(approval2['approval_id'],)).fetchone()[0],0)

    def test_credentials_validate_client_before_persisting_and_never_echo_values(self):
        target=self.root/'private.env'
        with patch('services.h1.server.save_local_secret') as saver:
            status,_=self.request('POST','/api/integrations/credentials',{'provider':'google','values':{'BRIVANY_GOOGLE_CLIENT_ID':'not-google-client-'+'x'*30}})
            self.assertEqual(status,422);saver.assert_not_called()
        def save(key,variable):
            with patch.dict('os.environ',{},clear=False):save_local_secret(key,variable,target)
        supplied={'BRIVANY_GOOGLE_CLIENT_ID':'new-synthetic-12345.apps.googleusercontent.com','BRIVANY_GOOGLE_CLIENT_SECRET':'new-secret-synthetic-private'}
        with patch('services.h1.server.save_local_secret',side_effect=save):
            status,result=self.request('POST','/api/integrations/credentials',{'provider':'google','values':supplied})
        self.assertEqual(status,200);self.assertTrue(result['saved']);text=json.dumps(result)
        for secret in supplied.values():self.assertNotIn(secret,text);self.assertIn(secret,target.read_text(encoding='utf-8'))
        self.assertEqual(self.oauth.env['BRIVANY_GOOGLE_CLIENT_ID'],supplied['BRIVANY_GOOGLE_CLIENT_ID'])
        with patch('services.h1.server.save_local_secret') as saver:
            self.assertEqual(self.request('POST','/api/integrations/credentials',{'provider':'google','values':{'BRIVANY_META_API_KEY':'x'*30}})[0],422);saver.assert_not_called()

    def test_settings_patches_from_stale_instances_preserve_each_other_and_reload_execution_gate(self):
        other=ConnectionsService(self.connections.root,base_url=self.base,oauth=self.oauth,env=self.env,http=self.connections.http)
        self.connections.save_settings({'self_recipient':'59170000001','opted_in_recipients':['59170000001']})
        other.save_settings({'execution_enabled':True})
        current=self.connections.status()['settings'];self.assertEqual(current['self_recipient'],'59170000001');self.assertTrue(current['execution_enabled'])
        self.connections.save_settings({'execution_enabled':False});self.assertFalse(other.status()['settings']['execution_enabled'])
        self.assertEqual(other.status()['settings']['opted_in_recipients'],['59170000001'])

    def test_concurrent_settings_partial_patches_do_not_lose_values(self):
        other=ConnectionsService(self.connections.root,base_url=self.base,oauth=self.oauth,env=self.env,http=self.connections.http)
        barrier=threading.Barrier(2)
        def save(pair):
            instance,patch=pair;barrier.wait();return instance.save_settings(patch)
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(save,[(self.connections,{'phone_number_id':'1234567890'}),(other,{'execution_enabled':True})]))
        final=self.connections.status()['settings'];self.assertEqual(final['phone_number_id'],'1234567890');self.assertTrue(final['execution_enabled'])

    def test_whatsapp_missing_configuration_and_unconsented_recipient_do_not_send(self):
        self.connections.save_settings({'execution_enabled':True,'self_recipient':'59170000001','opted_in_recipients':['59170000001']})
        status,proposal=self.request('POST','/api/integrations/proposals',{'operation':'whatsapp.send','parameters':{'recipient':'59170000001','text':'Synthetic own chat'}})
        self.assertEqual(status,201);approval=self.approve(proposal)
        status,result=self.execute(proposal,approval);self.assertEqual(status,503);self.assertEqual(result['error']['code'],'whatsapp_configuration_pending')
        self.assertEqual(self.calls,[])
        self.assertEqual(self.request('POST','/api/integrations/proposals',{'operation':'whatsapp.send','parameters':{'recipient':'59170000002','text':'blocked'}})[0],403)

    def test_social_http_draft_review_execution_and_receipt_with_substituted_graph(self):
        social_calls=[]
        def graph(method,url,token,payload=None):
            social_calls.append((method,url,payload));return {'id':'123456789_987654321'}
        graph.simulation=True;self.connections.social_http=graph
        self.connections.update_credentials({'BRIVANY_FACEBOOK_PAGE_TOKEN':'synthetic-social-token-private'})
        status,_=self.request('POST','/api/integrations/settings',{'execution_enabled':True,'social':{
            'execution_enabled':True,'page_ids':['123456789'],'permissions':['pages_manage_posts']}})
        self.assertEqual(status,200)
        value={'kind':'facebook_post','target_id':'123456789','title':'Prueba local','copy':'Texto sintético <sin HTML>'}
        status,draft=self.request('POST','/api/integrations/social/drafts',{'draft':value});self.assertEqual(status,200)
        self.assertEqual(social_calls,[])
        status,listed=self.request('GET','/api/integrations/social/drafts');self.assertEqual(status,200);self.assertEqual(listed['drafts'][0]['draft'],value)
        status,proposed=self.request('POST','/api/integrations/social/proposals',{'draft_id':draft['id'],'expected_revision':draft['revision']})
        self.assertEqual(status,201);self.assertEqual(proposed['preview']['draft'],value);self.assertEqual(social_calls,[])
        approval=self.approve(proposed);status,result=self.execute(proposed,approval)
        self.assertEqual(status,200);self.assertEqual(result['state'],'succeeded_test_stub');self.assertEqual(len(social_calls),1)
        self.assertEqual(social_calls[0][2],{'message':value['copy']})
        status,receipt=self.request('GET','/api/integrations/social/runs/'+proposed['id'])
        self.assertEqual(status,200);self.assertTrue(receipt['simulation']);self.assertFalse(receipt['visibility_verified'])
        self.execute(proposed,approval);self.assertEqual(len(social_calls),1)
        self.assertNotIn('synthetic-social-token-private',json.dumps(result))

    def test_social_http_reads_are_explicit_and_credentials_are_private(self):
        graph_calls=[]
        def graph(method,url,token,payload=None):
            graph_calls.append((method,url));return {'data':[{'id':'123456789','name':'Página sintética','access_token':'never-return'}]}
        graph.simulation=True;self.connections.social_http=graph
        self.connections.save_settings({'social':{'permissions':['pages_show_list']}})
        target=self.root/'social.env'
        def save(key,variable):save_local_secret(key,variable,target)
        with patch('services.h1.server.save_local_secret',side_effect=save):
            status,result=self.request('POST','/api/integrations/credentials',{'provider':'social','values':{'BRIVANY_META_SOCIAL_USER_TOKEN':'private-synthetic-user-token'}})
        self.assertEqual(status,200);self.assertNotIn('private-synthetic-user-token',json.dumps(result));self.assertEqual(graph_calls,[])
        self.assertEqual(self.request('POST','/api/integrations/social/read',{'operation':'facebook.pages','parameters':{}},origin=False)[0],403)
        status,result=self.request('POST','/api/integrations/social/read',{'operation':'facebook.pages','parameters':{}})
        self.assertEqual(status,200);self.assertEqual(len(graph_calls),1);self.assertNotIn('never-return',json.dumps(result));self.assertFalse(result['data_persisted'])
        self.assertEqual(self.request('POST','/api/integrations/social/read',{'operation':'facebook.publish_text','parameters':{}})[0],422)


if __name__=='__main__':unittest.main()
