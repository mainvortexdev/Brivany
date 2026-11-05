import json
from pathlib import Path
import platform
import tempfile
import time
import unittest
from uuid import uuid4
from services.brivany_account import AccountHTTP,DesktopAccount,SecureAccountFile


class MemoryStore:
    def load(self):return None
    def save(self,value):self.saved=value
    def clear(self):self.saved=None

class FakeHTTP:
    base='https://mobile.brivany.example'
    def __init__(self):self.calls=[]
    def call(self,path,body=None,token=None,**kwargs):self.calls.append(path);return {'ok':True}

class Computer:
    def __init__(self):self.grant=None;self.jobs={};self.executions=[];self.approvals=[]
    def authorized(self,value):return bool(value and value==self.grant)
    def arm(self):self.grant='fixture-local-grant'
    def enqueue(self,kind,instruction,grant,**kwargs):
        self.last_options=kwargs
        self.executions.append((kind,instruction,grant));id=str(uuid4());self.jobs[id]={'id':id,'state':'running','phase':'Trabajando','result':None};return self.jobs[id]
    def public(self,job):return dict(job)
    def cancel(self,id):self.jobs[id]['state']='cancelled'

class Socket:
    def __init__(self):self.sent=[]
    def send(self,value):self.sent.append(json.loads(value))

class DesktopAccountTests(unittest.TestCase):
    def fixture(self,temp):
        computer=Computer();host=DesktopAccount(temp,lambda:computer,http=FakeHTTP(),store=MemoryStore());host.socket=Socket();host.session={'account':{'email':'own@brivany.test'},'session':{'token':'fixture-session'}}
        return host,computer
    def command(self):return {'type':'command','id':str(uuid4()),'kind':'terminal','instruction':'Consulta el sistema sin modificarlo.','source':'voice','issued_at':time.time()*1000}
    def test_delivery_waits_for_ack_and_never_runs_duplicate_or_replayed_commands(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);event=self.command();host._receive(event)
            self.assertEqual(computer.executions,[]);self.assertEqual(host.socket.sent[-1]['state'],'accepted')
            host._receive({'type':'ack','id':event['id'],'ok':True});self.assertEqual(len(computer.executions),1)
            host._receive(event);self.assertEqual(len(computer.executions),1)
            restored,_=self.fixture(temp);restored._receive(event);self.assertEqual(restored.pending,{})
            saved=(Path(temp)/'receipts'/(event['id']+'.json')).read_text();self.assertNotIn(event['instruction'],saved);self.assertNotIn('fixture-session',saved)
    def test_negative_ack_or_stale_delivery_cannot_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);event=self.command();host._receive(event);host._receive({'type':'ack','id':event['id'],'ok':False});self.assertEqual(computer.executions,[])
            late=self.command();late['issued_at']-=120000;host._receive(late);self.assertNotIn(late['id'],host.seen)
    def test_original_request_reaches_the_executor_separately_from_model_instructions(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);event={**self.command(),'user_request':'Petición original propia.'};host._receive(event);host._receive({'type':'ack','id':event['id'],'ok':True});self.assertEqual(computer.last_options,{'user_request':event['user_request']})
    def test_acknowledgement_arriving_after_logout_cannot_start_a_task(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);event=self.command();host._receive(event);host.logout();host._receive({'type':'ack','id':event['id'],'ok':True});self.assertEqual(computer.executions,[])
    def test_host_uses_existing_executor_grant_and_preserves_pending_file_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);event=self.command();host._receive(event);host._receive({'type':'ack','id':event['id'],'ok':True});local=host.jobs[event['id']]['local_id']
            self.assertEqual(computer.executions[0][2],computer.grant);computer.jobs[local].update(state='awaiting_approval',phase='Revisar archivo')
            host._update(event['id'],computer.jobs[local]);self.assertEqual(host.socket.sent[-1]['state'],'awaiting_approval');self.assertEqual(computer.approvals,[])
    def test_logout_revokes_and_cancels_only_jobs_owned_by_this_host(self):
        with tempfile.TemporaryDirectory() as temp:
            host,computer=self.fixture(temp);host.socket=None;local=str(uuid4());other=str(uuid4());computer.jobs={local:{'state':'running'},other:{'state':'running'}};host.jobs={'remote':{'local_id':local}}
            result=host.logout();self.assertFalse(result['signed_in']);self.assertEqual(computer.jobs[local]['state'],'cancelled');self.assertEqual(computer.jobs[other]['state'],'running');self.assertIn('/v1/account/logout',host.http.calls);self.assertEqual(host.jobs,{});self.assertEqual(host.sent,{})
    def test_public_status_has_no_session_token_or_password(self):
        with tempfile.TemporaryDirectory() as temp:
            host,_=self.fixture(temp);self.assertNotIn('fixture-session',json.dumps(host.status()));self.assertTrue(host.status()['remote_enabled'])
    def test_large_diagnostics_keep_the_answer_even_when_details_exceed_packet_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            host,_=self.fixture(temp);identifier=str(uuid4());job={'id':str(uuid4()),'state':'succeeded','phase':'Consulta completada','result':{'verified':True,'message':'Respuesta observada.','facts':{'rows':['x'*1000]*20}}}
            host._update(identifier,job);output=host.socket.sent[-1]['result']['output']
            self.assertEqual(output['message'],'Respuesta observada.');self.assertTrue(output['details_in_desktop']);self.assertNotIn('facts',output)
    def test_already_armed_desktop_and_clean_chat_share_the_account_router(self):
        from services.computer.service import ComputerService
        from types import SimpleNamespace
        from unittest.mock import Mock
        current=object.__new__(ComputerService);current.native=True;current.require=Mock();current.planner=SimpleNamespace(route=Mock(side_effect=AssertionError('Must use the account router')))
        current.remote_account=SimpleNamespace(status=lambda:{'signed_in':True},chat_turn=Mock(side_effect=lambda value,cancelled:iter([{'type':'delta','text':'Account fixture'}])))
        value=SimpleNamespace(document=None,source='voice',conversation_id=str(uuid4()))
        for method in (current.turn,current.chat_turn):self.assertEqual(list(method(value,'own-local-grant')),[{'type':'delta','text':'Account fixture'}])
        self.assertEqual(current.remote_account.chat_turn.call_count,2);current.require.assert_called_once_with('own-local-grant');current.planner.route.assert_not_called()
    def test_transport_cannot_be_pointed_at_an_arbitrary_service_or_plain_http(self):
        for address in ['https://example.com','http://mobile.brivany.example','https://mobile.brivany.example.evil.test']:
            with self.assertRaises(ValueError):AccountHTTP(address)
    @unittest.skipUnless(platform.system()=='Windows','Actual DPAPI check needs Windows')
    def test_real_windows_secure_store_encrypts_session_for_the_current_os_user(self):
        with tempfile.TemporaryDirectory() as temp:
            store=SecureAccountFile(Path(temp)/'account.dpapi');value={'session':{'token':'own-synthetic-token-not-a-provider-key'}};store.save(value)
            self.assertNotIn(value['session']['token'].encode(),store.path.read_bytes());self.assertEqual(store.load(),value);store.clear();self.assertFalse(store.path.exists())

if __name__=='__main__':unittest.main()
