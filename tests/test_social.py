"""Social drafts/Graph plans with local substitutes; no real account or publish."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
from uuid import uuid4

from packages.providers.social import SocialTransport,graph_request,BASE
from services.integrations import IntegrationError
from services.social import SocialService,validate_draft
from services.connections import ConnectionsService


class StubHTTP:
    simulation=True
    def __init__(self):self.calls=[];self.results=[];self.lock=threading.Lock()
    def __call__(self,method,url,token,payload=None):
        with self.lock:
            self.calls.append((method,url,deepcopy(payload)))
            result=self.results.pop(0) if self.results else {}
        if isinstance(result,Exception):raise result
        return result


class SocialTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.settings={'execution_enabled':True,'page_ids':['123456'],'instagram_user_ids':['234567'],'ad_account_ids':['act_345678'],
            'media_hosts':['media.example.com'],'permissions':['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_manage_insights','instagram_content_publish','ads_read','ads_management'],
            'ad_currency_verified':True,'ad_account_currencies':{'act_345678':'USD'}}
        self.env={key:'SYNTHETIC-PRIVATE-TOKEN-DO-NOT-SURFACE' for key in ('BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN','BRIVANY_INSTAGRAM_ACCESS_TOKEN','BRIVANY_META_ADS_ACCESS_TOKEN')}
        self.service=SocialService(self.root,settings=self.settings,env=self.env);self.http=StubHTTP()
        self.transport=SocialTransport(self.service,http=self.http,approval_validator=lambda *_:True)

    def draft(self,kind='facebook_post',**changes):
        value={'kind':kind,'title':'Borrador de prueba','target_id':'123456','copy':'Texto sintético\nSegunda línea'}
        if kind=='instagram_image':value.update(target_id='234567',media={'asset_ref':'fixture-image','url':'https://media.example.com/fixture.jpg','sha256':'a'*64,'mime_type':'image/jpeg'})
        elif kind=='ad_campaign':value.update(target_id='act_345678',daily_budget='12.34',currency='USD',minor_unit_exponent=2,
            targeting={'countries':['BO'],'age_min':18,'age_max':65},objective='OUTCOME_LEADS',special_ad_categories=['HOUSING'])
        value.update(changes);return value

    def prepare(self,kind='facebook_post'):
        saved=self.service.save(self.draft(kind));return saved,self.service.prepare_action(saved['id'],saved['revision'])

    def execute(self,prepared,key=None,transport=None):
        return (transport or self.transport).execute(prepared['operation'],prepared['parameters'],key or str(uuid4()))

    def test_status_draft_save_and_prepare_are_local_and_never_claim_account_access(self):
        status=self.service.status();saved,prepared=self.prepare()
        self.assertEqual(self.http.calls,[]);self.assertFalse(status['accounts_connected']);self.assertFalse(status['permissions_verified'])
        self.assertNotIn('SYNTHETIC-PRIVATE-TOKEN',json.dumps(status));self.assertTrue(prepared['approval_required']);self.assertEqual(prepared['external_requests'],0)
        self.assertIsNone(saved['published']);self.assertFalse(prepared['spending_authorized'])

    def test_revision_and_private_content_survive_reopen_and_stale_save_fails(self):
        saved,_=self.prepare();value=self.draft(copy='Contenido actualizado')
        updated=self.service.save(value,draft_id=saved['id'],expected_revision=1);self.assertEqual(updated['revision'],2)
        with self.assertRaises(IntegrationError) as error:self.service.save(value,draft_id=saved['id'],expected_revision=1)
        self.assertEqual(error.exception.status,409)
        reopened=SocialService(self.root,settings=self.settings,env=self.env);self.assertEqual(reopened.get(saved['id'])['draft']['copy'],'Contenido actualizado')
        self.assertEqual(len(reopened.list()['drafts']),1)

    def test_page_list_never_returns_access_tokens_or_follows_provider_pagination(self):
        self.http.results=[{'data':[{'id':'123456','name':'Fixture','access_token':'PRIVATE','instagram_business_account':{'id':'234567','username':'fixture','access_token':'PRIVATE'}}], 'paging':{'next':'https://evil.invalid/collect'}}]
        result=self.transport.read('facebook.pages',{})
        self.assertTrue(result['more_available']);self.assertFalse(result['automatic_pagination']);self.assertNotIn('access_token',json.dumps(result))
        self.assertEqual(len(self.http.calls),1);self.assertNotIn('access_token',self.http.calls[0][1])

    def test_read_operations_are_target_scoped_and_only_return_selected_fields(self):
        for operation,parameters in [('facebook.posts',{'page_id':'123456'}),('instagram.media',{'instagram_user_id':'234567'}),('ads.campaigns',{'ad_account_id':'act_345678'})]:
            self.http.results.append({'data':[{'id':'123456','unknown_secret':'drop'}]});result=self.transport.read(operation,parameters)
            self.assertEqual(result['items'],[{'id':'123456'}]);self.assertFalse(result['data_persisted'])
        before=len(self.http.calls)
        with self.assertRaises(IntegrationError):self.transport.read('facebook.posts',{'page_id':'999999'})
        with self.assertRaises(IntegrationError):self.transport.read('facebook.posts',{'page_id':'../other'})
        self.assertEqual(len(self.http.calls),before)

    def test_insights_interval_and_metrics_are_explicit_and_not_silently_retried(self):
        self.http.results=[{'data':[{'name':'reach','total_value':{'value':12}}]}]
        result=self.transport.read('instagram.insights',{'instagram_user_id':'234567','metrics':['reach'],'since':1800000000,'until':1800086400})
        query=parse_qs(urlsplit(self.http.calls[0][1]).query);self.assertEqual(query['metric'],['reach']);self.assertEqual(query['period'],['day'])
        self.assertFalse(result['metrics_compatibility_verified'])
        with self.assertRaises(IntegrationError):self.transport.read('instagram.insights',{'instagram_user_id':'234567','metrics':['all'],'since':1,'until':3000000})
        self.assertEqual(len(self.http.calls),1)

    def test_writes_are_closed_without_execution_flag_and_approval_bridge(self):
        _,prepared=self.prepare()
        self.service.settings['execution_enabled']=False
        with self.assertRaises(IntegrationError):self.execute(prepared)
        self.service.settings['execution_enabled']=True
        with self.assertRaises(IntegrationError) as error:self.execute(prepared,transport=SocialTransport(self.service,http=self.http))
        self.assertEqual(error.exception.code,'social_approval_bridge_pending');self.assertEqual(self.http.calls,[])

    def test_exact_parameters_and_approval_are_checked_before_any_provider_call(self):
        _,prepared=self.prepare();changed=deepcopy(prepared);changed['parameters']['action_sha256']='b'*64
        with self.assertRaises(IntegrationError):self.execute(changed)
        denied=SocialTransport(self.service,http=self.http,approval_validator=lambda *_:False)
        with self.assertRaises(IntegrationError):self.execute(prepared,transport=denied)
        self.assertEqual(self.http.calls,[])

    def test_revision_changed_during_approval_does_not_publish_old_snapshot(self):
        saved,prepared=self.prepare()
        def approving(*_):self.service.save(self.draft(copy='Cambio paralelo'),draft_id=saved['id'],expected_revision=1);return True
        with self.assertRaises(IntegrationError) as error:self.execute(prepared,transport=SocialTransport(self.service,http=self.http,approval_validator=approving))
        self.assertEqual(error.exception.code,'social_draft_conflict');self.assertEqual(self.http.calls,[])

    def test_facebook_post_acceptance_does_not_claim_visibility_and_cannot_duplicate(self):
        _,prepared=self.prepare();self.http.results=[{'id':'123456_987654'}];key=str(uuid4())
        first=self.execute(prepared,key);second=self.execute(prepared,key);third=self.execute(prepared)
        self.assertEqual(first,second);self.assertEqual(second,third);self.assertEqual(len(self.http.calls),1)
        self.assertEqual(first.payload['state'],'publication_accepted_test_stub');self.assertFalse(first.payload['visibility_verified'])
        self.assertEqual(self.http.calls[0][0],'POST');self.assertTrue(self.http.calls[0][1].endswith('/123456/feed'))
        self.assertNotIn('PRIVATE',self.service.database.read_bytes().decode('utf-8',errors='ignore'))

    def test_uncertain_outcome_and_restart_never_replay_and_do_not_store_provider_errors(self):
        _,prepared=self.prepare();self.http.results=[OSError('PRIVATE token=SYNTHETIC-SECRET')];key=str(uuid4())
        with self.assertRaises(IntegrationError) as error:self.execute(prepared,key)
        self.assertEqual(error.exception.code,'social_outcome_unknown');self.assertEqual(self.service.execution(key)['state'],'uncertain');self.assertTrue(self.service.execution(key)['simulation'])
        reopened=SocialService(self.root,settings=self.settings,env=self.env)
        transport=SocialTransport(reopened,http=self.http,approval_validator=lambda *_:True)
        with self.assertRaises(IntegrationError):self.execute(prepared,transport=transport)
        self.assertEqual(len(self.http.calls),1)
        self.assertNotIn(b'SYNTHETIC-SECRET',self.service.database.read_bytes());self.assertFalse(reopened.execution(key)['replay_allowed'])

    def test_two_reviewed_actions_for_same_draft_claim_one_provider_attempt(self):
        _,prepared=self.prepare();self.http.results=[{'id':'123456_987654'}];barrier=threading.Barrier(2)
        def publish(_):
            barrier.wait()
            try:return self.execute(prepared)
            except IntegrationError as error:return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(publish,range(2)))
        self.assertEqual(len(self.http.calls),1);self.assertTrue(any(not isinstance(result,str) and result.payload['publication_accepted'] for result in results))

    def test_instagram_has_two_explicit_actions_and_binds_container_to_revision(self):
        saved,prepared=self.prepare('instagram_image');self.http.results=[{'id':'456789'}]
        created=self.execute(prepared);self.assertTrue(created.payload['container_created']);self.assertFalse(created.payload['publication_accepted']);self.assertEqual(len(self.http.calls),1)
        publish=self.service.prepare_action(saved['id'],1,container_id='456789');self.assertEqual(publish['operation'],'instagram.publish_container')
        self.http.results=[{'status_code':'FINISHED'},{'id':'567890'}];result=self.execute(publish)
        self.assertTrue(result.payload['publication_accepted']);self.assertEqual(len(self.http.calls),3)
        self.assertTrue(self.http.calls[1][1].startswith(BASE+'456789?'));self.assertEqual(self.http.calls[2][2],{'creation_id':'456789'})
        with self.assertRaises(IntegrationError):self.service.prepare_action(saved['id'],1,container_id='999999')

    def test_instagram_waiting_only_rechecks_after_new_explicit_review(self):
        saved,prepared=self.prepare('instagram_image');self.http.results=[{'id':'456789'}];self.execute(prepared)
        publish=self.service.prepare_action(saved['id'],1,container_id='456789');self.http.results=[{'status_code':'IN_PROGRESS'}];key=str(uuid4())
        result=self.execute(publish,key);self.assertEqual(result.payload['state'],'container_waiting');self.assertTrue(result.payload['requires_new_review'])
        self.execute(publish,key);self.assertEqual(len(self.http.calls),2)
        self.http.results=[{'status_code':'FINISHED'},{'id':'567890'}];self.assertTrue(self.execute(publish).payload['publication_accepted']);self.assertEqual(len(self.http.calls),4)

    def test_instagram_invalid_container_result_is_uncertain_not_implicitly_recreated(self):
        _,prepared=self.prepare('instagram_image');self.http.results=[{'id':'invalid'}]
        with self.assertRaises(IntegrationError):self.execute(prepared)
        with self.assertRaises(IntegrationError):self.execute(prepared)
        self.assertEqual(len(self.http.calls),1)

    def test_campaign_budget_is_exact_minor_units_and_only_paused_scaffold_is_created(self):
        _,prepared=self.prepare('ad_campaign');self.http.results=[{'id':'678901'}];result=self.execute(prepared)
        method,url,payload=self.http.calls[0];self.assertEqual(method,'POST');self.assertTrue(url.endswith('/act_345678/campaigns'))
        self.assertEqual(payload['daily_budget'],'1234');self.assertEqual(payload['status'],'PAUSED');self.assertNotIn('targeting',payload)
        self.assertNotIn('copy',payload);self.assertFalse(result.payload['ad_delivery_started']);self.assertFalse(result.payload['spending_authorized'])
        self.assertIn('adset_targeting',result.payload['remaining_ad_components']);self.assertFalse(self.service.status()['ad_activation_implemented'])

    def test_unverified_or_wrong_currency_and_fractional_minor_units_block_execution(self):
        for changes in ({'daily_budget':'1.001'},{'daily_budget':1.2},{'daily_budget':'0'},{'minor_unit_exponent':True},{'targeting':{'countries':['BO'],'age_min':17,'age_max':65}}):
            with self.assertRaises(IntegrationError):self.service.save(self.draft('ad_campaign',**changes))
        _,prepared=self.prepare('ad_campaign');self.service.settings['ad_currency_verified']=False
        with self.assertRaises(IntegrationError):self.execute(prepared)
        self.service.settings['ad_currency_verified']=True;self.service.settings['ad_account_currencies']['act_345678']='BOB'
        with self.assertRaises(IntegrationError):self.execute(prepared)
        self.assertEqual(self.http.calls,[])

    def test_media_rejects_private_hosts_credentials_queries_paths_and_unknown_types(self):
        base=self.draft('instagram_image')
        for url in ('file:///private/image.jpg','http://media.example.com/a.jpg','https://127.0.0.1/a.jpg','https://user:pass@media.example.com/a.jpg','https://media.example.com/a.jpg?token=PRIVATE','https://other.example.com/a.jpg'):
            changed=deepcopy(base);changed['media']['url']=url
            with self.assertRaises(IntegrationError):self.service.save(changed)
        changed=deepcopy(base);changed['media']['asset_ref']='../../image'
        with self.assertRaises(IntegrationError):self.service.save(changed)
        self.assertEqual(self.http.calls,[])

    def test_graph_client_rejects_external_endpoint_and_tokens_before_network(self):
        with patch('packages.providers.social.request.build_opener') as opener:
            for url in ('http://graph.facebook.com/v26.0/me','https://evil.invalid/v26.0/me','https://user@graph.facebook.com/v26.0/me','https://graph.facebook.com:444/v26.0/me'):
                with self.assertRaises(IntegrationError):graph_request('GET',url,'synthetic')
            with self.assertRaises(IntegrationError):graph_request('GET',BASE+'me','bad\nheader')
            opener.assert_not_called()

    def test_media_host_config_rejects_private_ips_before_saving_any_draft(self):
        for host in ('127.0.0.1','10.0.0.8','192.168.1.4','169.254.1.1','0.0.0.0'):
            with self.assertRaises(IntegrationError) as error:SocialService(self.root/'invalid',settings={**self.settings,'media_hosts':[host]},env=self.env)
            self.assertEqual(error.exception.code,'social_config')
        _,prepared=self.prepare('instagram_image')
        self.assertFalse(prepared['media_content_verified']);self.assertFalse(prepared['media_host_reachability_verified'])


class SocialApprovalBridgeTests(unittest.TestCase):
    draft=SocialTests.draft

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.http=StubHTTP();self.env={key:'SYNTHETIC-PRIVATE-TOKEN-DO-NOT-SURFACE' for key in ('BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN','BRIVANY_INSTAGRAM_ACCESS_TOKEN','BRIVANY_META_ADS_ACCESS_TOKEN')}
        self.settings={'execution_enabled':True,'page_ids':['123456'],'instagram_user_ids':['234567'],'ad_account_ids':['act_345678'],
            'media_hosts':['media.example.com'],'permissions':['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_manage_insights','instagram_content_publish','ads_read','ads_management'],
            'ad_currency_verified':True,'ad_account_currencies':{'act_345678':'USD'}}
        self.connections=self.instance();self.connections.save_settings({'execution_enabled':True,'social':self.settings})

    def instance(self):
        return ConnectionsService(self.root,base_url='http://127.0.0.1:18765',env=self.env,social_http=self.http)

    def proposal(self,kind='facebook_post'):
        saved=self.connections.social.save(self.draft(kind))
        return saved,self.connections.propose_social(saved['id'],saved['revision'])

    def execute(self,proposal,*,approve=True):
        current=self.connections.integration
        approval=current.approve(proposal['id'],proposal['action_sha256'])['approval_id'] if approve else str(uuid4())
        return current.execute(proposal['id'],proposal['parameters'],approval,execute=True)

    def test_shared_journal_requires_explicit_approval_and_preserves_only_hashes(self):
        saved,proposal=self.proposal()
        self.assertEqual(proposal['preview']['draft']['copy'],saved['draft']['copy']);self.assertEqual(self.http.calls,[])
        with self.assertRaises(IntegrationError):self.execute(proposal,approve=False)
        self.http.results=[{'id':'123456_987654'}];result=self.execute(proposal)
        self.assertEqual(result['state'],'succeeded_test_stub');self.assertTrue(result['result']['publication_accepted'])
        self.assertFalse(result['result']['visibility_verified']);self.assertFalse(result['result_persisted']);self.assertEqual(len(self.http.calls),1)
        journal=self.connections.integration.database.read_bytes()
        self.assertNotIn(saved['draft']['copy'].encode(),journal);self.assertNotIn(b'SYNTHETIC-PRIVATE-TOKEN',journal)

    def test_direct_transport_cannot_bypass_journal_with_invented_id(self):
        _,proposal=self.proposal()
        with self.assertRaises(IntegrationError) as error:self.connections.social_transport.execute(proposal['operation'],proposal['parameters'],str(uuid4()))
        self.assertEqual(error.exception.code,'social_approval_required');self.assertEqual(self.http.calls,[])

    def test_changed_draft_or_credentials_preflight_does_not_consume_approval(self):
        saved,proposal=self.proposal();current=self.connections.integration
        approval=current.approve(proposal['id'],proposal['action_sha256'])['approval_id']
        self.connections.social.save(self.draft(copy='Cambio explícito'),draft_id=saved['id'],expected_revision=1)
        with self.assertRaises(IntegrationError):current.execute(proposal['id'],proposal['parameters'],approval,execute=True)
        with current._db() as db:self.assertEqual(db.execute('SELECT used FROM approvals WHERE id=?',(approval,)).fetchone()[0],0)
        self.assertEqual(current.inspect(proposal['id'])['state'],'awaiting_approval');self.assertEqual(self.http.calls,[])

    def test_missing_token_then_saved_credential_uses_same_review(self):
        saved,proposal=self.proposal();self.connections.social.env.pop('BRIVANY_FACEBOOK_PAGE_TOKEN')
        current=self.connections.integration;approval=current.approve(proposal['id'],proposal['action_sha256'])['approval_id']
        with self.assertRaises(IntegrationError) as error:current.execute(proposal['id'],proposal['parameters'],approval,execute=True)
        self.assertEqual(error.exception.code,'social_credentials');self.assertEqual(self.http.calls,[])
        self.connections.update_credentials({'BRIVANY_FACEBOOK_PAGE_TOKEN':'SYNTHETIC-UPDATED-CREDENTIAL'})
        self.http.results=[{'id':'123456_987654'}]
        self.assertEqual(current.execute(proposal['id'],proposal['parameters'],approval,execute=True)['state'],'succeeded_test_stub')

    def test_unknown_provider_outcome_blocks_same_hash_in_new_review_after_restart(self):
        _,proposal=self.proposal();self.http.results=[OSError('PRIVATE no-store')]
        result=self.execute(proposal);self.assertEqual(result['state'],'uncertain')
        reopened=self.instance()
        new=reopened.propose_social(proposal['parameters']['draft_id'],1)
        self.assertEqual(new['id'],proposal['id']);self.assertEqual(new['state'],'uncertain')
        self.assertEqual(len(self.http.calls),1);self.assertNotIn(b'PRIVATE no-store',reopened.integration.database.read_bytes())

    def test_instagram_pending_result_is_visible_and_new_explicit_review_can_check_again(self):
        saved,proposal=self.proposal('instagram_image');self.http.results=[{'id':'456789'}];self.execute(proposal)
        publish=self.connections.propose_social(saved['id'],1,container_id='456789');self.http.results=[{'status_code':'IN_PROGRESS'}]
        waiting=self.execute(publish);self.assertEqual(waiting['state'],'failed_test_stub');self.assertEqual(waiting['result']['state'],'container_waiting')
        self.assertTrue(waiting['result']['requires_new_review']);self.assertEqual(len(self.http.calls),2)
        again=self.connections.propose_social(saved['id'],1,container_id='456789');self.assertNotEqual(publish['id'],again['id'])
        self.http.results=[{'status_code':'FINISHED'},{'id':'567890'}];self.assertTrue(self.execute(again)['result']['publication_accepted'])
        self.assertEqual(len(self.http.calls),4)

    def test_generic_social_proposals_also_resolve_exact_content_for_review(self):
        saved,proposal=self.proposal();generic=self.connections.integration.propose(proposal['operation'],proposal['parameters'],request_id=str(uuid4()))
        self.assertEqual(generic['preview']['draft'],saved['draft']);self.assertFalse(generic['spending_authorized'])
        changed=deepcopy(proposal['parameters']);changed['action_sha256']='f'*64
        with self.assertRaises(IntegrationError):self.connections.integration.propose(proposal['operation'],changed)
        self.assertEqual(self.http.calls,[])

    def test_social_partial_settings_merge_durably_and_never_claim_account_connection(self):
        other=self.instance();other.save_settings({'social':{'execution_enabled':False}})
        self.connections.save_settings({'social':{'media_hosts':['other.example.com']}})
        final=other.status();settings=final['settings']['social']
        self.assertFalse(settings['execution_enabled']);self.assertEqual(settings['page_ids'],['123456']);self.assertEqual(settings['media_hosts'],['other.example.com'])
        self.assertTrue(final['social']['publication_approval_bridge_implemented']);self.assertFalse(final['social']['accounts_connected'])
        self.assertTrue(all(not item['connected'] for item in final['registry']['connectors']))
        self.assertEqual(self.http.calls,[])

    def test_campaign_can_only_create_paused_scaffold_through_shared_approval(self):
        _,proposal=self.proposal('ad_campaign');self.assertEqual(proposal['ad_status'],'PAUSED');self.assertFalse(proposal['spending_authorized'])
        self.http.results=[{'id':'678901'}];result=self.execute(proposal)
        self.assertEqual(result['result']['state'],'campaign_created_paused_test_stub');self.assertFalse(result['result']['ad_delivery_started'])
        self.assertEqual(self.http.calls[0][2]['status'],'PAUSED');self.assertEqual(self.http.calls[0][2]['daily_budget'],'1234')


if __name__=='__main__':unittest.main()
