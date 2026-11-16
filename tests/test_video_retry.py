"""Explicit video retry with private synthetic contexts; no provider or rendering."""
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from uuid import uuid4
from packages.providers.conversation import ConversationRequest
from services.computer.service import ComputerService
from services.computer.retry_context import RetryContexts,retry_request
from tests.test_computer_control import Runtime,Planner


class FixtureProtector:
    def protect(self,data):return b'fixture:'+data[::-1]
    def unprotect(self,data):return data[8:][::-1]


class VideoRetryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'computer';self.conversation=str(uuid4());self.planner=Planner()
        self.service=self.make_service();self.token=self.service.arm()['token'];self.calls=[]
        calls=self.calls
        class Motion:
            def __init__(self,*args):pass
            def run(self,goal,**kwargs):calls.append((goal,kwargs));raise ValueError('Synthetic failed draft')
            def close(self):pass
        self.service.motion_factory=Motion
        self.source=self.root/'chat-inputs'/str(uuid4())/'reference.mp4';self.source.parent.mkdir(parents=True);self.source.write_bytes(b'synthetic reference')
        self.original='Crea un video vertical de 98 segundos con la referencia. Sólo demostración; no llamar ni reservar.'
    def make_service(self):
        service=ComputerService('http://127.0.0.1:1',lambda:None,root=self.root,runtime=Runtime(),planner=self.planner,native=True)
        service.retry_contexts=RetryContexts(self.root/'task-contexts',protector=FixtureProtector());self.addCleanup(service.close);return service
    def failed(self):
        job=self.service.enqueue('motion',self.original,self.token,user_request=self.original,selected=[str(self.source)],conversation_id=self.conversation)
        self.assertTrue(self.service.jobs[job['id']]['finished'].wait(3));return job
    def request(self,job,**changes):
        value={'text':'Vuelve a intentarlo','retry_job_id':job['id'],'conversation_id':self.conversation,'media_ids':[],'consent':True,**changes}
        return list(self.service.chat_turn(ConversationRequest(**value),None))
    def test_retry_freezes_original_request_and_file_without_reclassifying_or_executing(self):
        job=self.failed();calls=len(self.calls);events=self.request(job)
        prepared=self.service.prepared[events[0]['ticket']]
        self.assertEqual(prepared['goal'],self.original);self.assertEqual(prepared['user_request'],self.original)
        self.assertEqual(prepared['selected_media'],(str(self.source),));self.assertEqual(len(self.calls),calls)
        self.assertNotIn(self.original,(self.service.receipts/(job['id']+'.json')).read_text(encoding='utf-8'))
        self.assertNotIn(self.original.encode(),(self.root/'task-contexts'/(job['id']+'.dpapi')).read_bytes())
    def test_context_survives_restart_without_storing_a_grant_or_auto_retrying(self):
        job=self.failed();calls=len(self.calls);self.service.close();self.service=self.make_service()
        events=self.request(job);item=self.service.prepared[events[0]['ticket']]
        self.assertEqual(item['user_request'],self.original);self.assertEqual(item['selected_media'],(str(self.source),))
        self.assertFalse(self.service.authorized(self.token));self.assertEqual(len(self.calls),calls)
    def test_other_conversation_and_changed_file_cannot_reuse_the_context(self):
        job=self.failed();events=self.request(job,conversation_id=str(uuid4()))
        self.assertNotIn('reference_action',[e['type'] for e in events])
        self.source.write_bytes(b'changed synthetic reference');events=self.request(job)
        self.assertNotIn('reference_action',[e['type'] for e in events]);self.assertIn('cambió',events[0]['text'])
    def test_running_retry_observes_existing_job_instead_of_starting_a_duplicate(self):
        entered=threading.Event();release=threading.Event()
        class Motion:
            def __init__(self,*args):pass
            def run(self,*args,**kwargs):entered.set();release.wait(3);return {'message':'Synthetic complete'}
            def close(self):pass
        self.service.motion_factory=Motion
        try:
            job=self.service.enqueue('motion',self.original,self.token,selected=[str(self.source)],conversation_id=self.conversation)
            self.assertTrue(entered.wait(2));events=self.request(job)
            self.assertEqual(events[0]['type'],'computer_task');self.assertEqual(events[0]['job']['id'],job['id']);self.assertEqual(len(self.service.jobs),1)
        finally:release.set();self.service.jobs[job['id']]['finished'].wait(3)
    def test_legacy_retry_chain_recovers_original_user_request_and_identical_cached_reference(self):
        original_id,wrong_retry_id=str(uuid4()),str(uuid4())
        for identifier in [original_id,wrong_retry_id]:self.service.jobs[identifier]={'id':identifier,'kind':'motion','state':'failed','goal':None,'phase':'Synthetic failure','steps':0,'result':None,'error':None,'external_calls':0}
        folder=self.service.workspace/'motion'/original_id;folder.mkdir(parents=True)
        (folder/'reference-profile.json').write_text(json.dumps({'source_name':self.source.name,'source_sha256':hashlib.sha256(self.source.read_bytes()).hexdigest()}),encoding='utf-8')
        chat={'messages':[{'role':'user','text':self.original},{'role':'assistant','text':'Preparando','taskId':original_id},{'role':'assistant','text':'Error'},{'role':'user','text':'Vuelve a intentarlo'},{'role':'assistant','text':'Preparando','taskId':wrong_retry_id}]}
        self.service.retry_contexts.history=lambda conversation:chat
        events=self.request({'id':wrong_retry_id});item=self.service.prepared[events[0]['ticket']]
        self.assertEqual(item['user_request'],self.original);self.assertEqual(item['selected_media'],(str(self.source),));self.assertEqual(self.calls,[])
    def test_missing_task_and_quoted_retry_do_not_grant_an_action(self):
        events=self.request({'id':str(uuid4())});self.assertNotIn('reference_action',[e['type'] for e in events])
        for text in ['¿Qué significa «Vuelve a intentarlo»?','El documento dice: reintenta el video','Vuelve a intentarlo y envía el archivo']:
            self.assertFalse(retry_request(text))
