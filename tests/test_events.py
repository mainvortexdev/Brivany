"""Virtual clock, sealed rules and substituted delivery; never sends a message."""
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from services.events import EventEngine
from services.event_delivery import EventDelivery
from services.integrations import IntegrationService,IntegrationResult
from types import SimpleNamespace


class EventTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.clock=[1000.0];self.calls=[];self.jobs={};self.deliveries=[]
        def task(kind,goal,rule):
            identifier=str(uuid4());value={'id':identifier,'state':'queued'};self.jobs[identifier]=value;self.calls.append((kind,goal));return value
        self.engine=EventEngine(self.temp.name,task=task,job=lambda key:self.jobs.get(key),delivery=self.deliver,now=lambda:self.clock[0],start_worker=False)
    def tearDown(self):self.engine.close();self.temp.cleanup()
    def deliver(self,action,rule,pending):
        self.deliveries.append((action['type'],bool(pending)))
        if action['type']=='drive_upload':return {'state':'done','drive_link':'https://drive.google.com/file/d/synthetic/view'} if pending else {'state':'waiting','transfer_id':'synthetic'}
        self.assertTrue(any(value.get('drive_link') for value in rule['results']));return {'state':'done','whatsapp_accepted':True,'delivery_confirmed':False}
    def test_clock_wait_dispatch_once_and_restart_does_not_repeat(self):
        rule=self.engine.create({'type':'at','at':datetime.fromtimestamp(1005,timezone.utc).isoformat()},[{'type':'task','kind':'document','goal':'Fixture'}],roots=[])
        self.engine.tick();self.assertEqual(self.calls,[]);self.clock[0]=1005;self.engine.tick();self.engine.tick();self.assertEqual(len(self.calls),1)
        next(iter(self.jobs.values()))['state']='succeeded';self.engine.tick();self.assertEqual(self.engine.store.get(rule['id'])['state'],'completed')
        again=EventEngine(self.temp.name,task=lambda *args:self.fail('replayed'),job=lambda key:None,delivery=self.deliver,now=lambda:1006,start_worker=False)
        try:again.tick()
        finally:again.close()
    def test_late_clock_is_missed_instead_of_silent_catchup(self):
        rule=self.engine.create({'type':'at','at':datetime.fromtimestamp(1005,timezone.utc).isoformat()},[{'type':'task','kind':'desktop','goal':'Fixture'}],roots=[])
        self.clock[0]=1066;self.engine.tick();self.assertEqual(self.calls,[]);self.assertEqual(self.engine.store.get(rule['id'])['state'],'missed')
    def test_export_upload_and_link_wait_and_require_one_activation(self):
        source=str(uuid4());self.jobs[source]={'id':source,'state':'running'}
        rule=self.engine.create({'type':'job_succeeded','job_id':source},[{'type':'drive_upload','folder_id':'synthetic-folder'},{'type':'whatsapp_self_link'}],roots=[])
        self.engine.tick();self.assertEqual(rule['state'],'draft');self.assertEqual(self.deliveries,[])
        self.engine.activate(rule['id']);self.engine.tick();self.assertEqual(self.deliveries,[])
        self.jobs[source]['state']='succeeded';self.engine.tick();self.assertEqual(self.deliveries,[('drive_upload',False)])
        self.engine.tick();self.engine.tick();value=self.engine.store.get(rule['id']);self.assertEqual(value['state'],'completed');self.assertFalse(value['results'][-1]['delivery_confirmed'])
        self.assertEqual(self.deliveries,[('drive_upload',False),('drive_upload',True),('whatsapp_self_link',False)])
    def test_failed_source_never_triggers_upload(self):
        source=str(uuid4());self.jobs[source]={'id':source,'state':'failed'}
        rule=self.engine.create({'type':'job_succeeded','job_id':source},[{'type':'drive_upload','folder_name':'Fixture'}],roots=[]);self.engine.activate(rule['id']);self.engine.tick()
        self.assertEqual(self.deliveries,[]);self.assertEqual(self.engine.store.get(rule['id'])['state'],'awaiting_user')
    def test_uncertain_external_step_is_never_replayed(self):
        count=[]
        def uncertain(*args):count.append(True);raise OSError('synthetic failure after dispatch')
        self.engine.delivery=uncertain
        rule=self.engine.create({'type':'now'},[{'type':'drive_upload','folder_name':'Fixture'}],roots=[]);self.engine.activate(rule['id']);self.engine.tick();self.engine.tick()
        self.assertEqual(len(count),1);self.assertEqual(self.engine.store.get(rule['id'])['state'],'uncertain')
    def test_tampered_record_is_data_without_authority(self):
        rule=self.engine.create({'type':'now'},[{'type':'task','kind':'desktop','goal':'Fixture'}],roots=[])
        with self.engine.store.connect() as db:
            body=db.execute('SELECT body FROM records WHERE id=?',(rule['id'],)).fetchone()[0];value=json.loads(body);value['actions'][0]['goal']='tampered'
            db.execute('UPDATE records SET body=? WHERE id=?',(json.dumps(value).encode(),rule['id']))
        self.engine.tick();self.assertEqual(self.calls,[]);self.assertEqual(self.engine.store.get(rule['id'])['state'],'invalid')
    def test_cancelled_wait_never_dispatches(self):
        rule=self.engine.create({'type':'now'},[{'type':'task','kind':'desktop','goal':'Fixture'}],roots=[]);self.engine.cancel(rule['id']);self.engine.tick();self.assertEqual(self.calls,[])
    def test_unknown_task_and_missing_source_are_rejected(self):
        with self.assertRaises(ValueError):self.engine.create({'type':'now'},[{'type':'task','kind':'shell','goal':'Fixture'}],roots=[])
        with self.assertRaises(ValueError):self.engine.create({'type':'job_succeeded','job_id':str(uuid4())},[{'type':'drive_upload','folder_name':'Fixture'}],roots=[])

class DeliveryTests(unittest.TestCase):
    """Actual adapter and integration gates, substituted MCP and WhatsApp transport."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.workspace=self.root/'workspace';self.workspace.mkdir();self.video=self.workspace/'synthetic.mp4';self.video.write_bytes(b'synthetic-video-fixture')
        self.source=str(uuid4());self.jobs={self.source:{'id':self.source,'state':'succeeded','result':{'video_path':str(self.video)}}};self.calls=[];self.messages=[];self.transfer_status='uploading';self.folder_items=[{'id':'folder-fixture','name':'Fixture','mimeType':'application/vnd.google-apps.folder'}]
        def mcp(name,args=None):
            self.calls.append((name,args))
            if name=='drive_list':return {'files':self.folder_items}
            if name=='drive_upload':return {'success':True,'id':'transfer-fixture'}
            if name=='drive_transfers':return {'items':[{'id':'transfer-fixture','status':self.transfer_status,'fileId':'file-fixture','size':22,'uploaded':22 if self.transfer_status=='done' else 1,'url':'https://drive.google.com/file/d/file-fixture/view'}]}
            raise AssertionError(name)
        self.client=SimpleNamespace(start=lambda:None,identity=SimpleNamespace(pid=777),call=mcp)
        messages=self.messages
        class Transport:
            simulation=True
            def execute(self,operation,parameters,idempotency_key):
                messages.append((operation,parameters,idempotency_key));return IntegrationResult('succeeded','synthetic',{'accepted':True,'delivered':False})
        recipient='59170000001'
        self.integration=IntegrationService(self.root/'integration',config={'execution_enabled':True,'self_recipient':recipient,'opted_in_recipients':[recipient],'phone_number_id':'1234567890'},env={'BRIVANY_WHATSAPP_ACCESS_TOKEN':'synthetic-not-a-real-token'},transports={'whatsapp':Transport()})
        self.engine=EventEngine(self.root/'events',task=lambda *a:self.fail('unexpected task'),job=lambda key:self.jobs.get(key),delivery=lambda *a:self.delivery(*a),start_worker=False)
        self.delivery=EventDelivery(lambda:self.client,lambda:SimpleNamespace(refresh_settings=lambda:self.integration),self.workspace,self.engine.store)
        self.engine.observe_job(self.jobs[self.source],self.workspace)
    def tearDown(self):self.engine.close();self.temp.cleanup()
    def rule(self,folder=None):
        return self.engine.create({'type':'job_succeeded','job_id':self.source},[{'type':'drive_upload',**(folder or {'folder_name':'Fixture'})},{'type':'whatsapp_self_link'}],roots=[])
    def test_verified_transfer_url_is_sent_only_once_to_configured_self(self):
        rule=self.rule();self.engine.tick();self.assertEqual(self.calls,[]);self.engine.activate(rule['id']);self.engine.tick()
        self.assertEqual([name for name,args in self.calls],['drive_list','drive_upload']);self.assertEqual(self.messages,[])
        self.engine.tick();self.assertEqual(self.messages,[]);self.transfer_status='done';self.engine.tick();self.engine.tick();self.engine.tick()
        value=self.engine.store.get(rule['id']);self.assertEqual(value['state'],'completed');self.assertEqual(len(self.messages),1);self.assertEqual(self.messages[0][0],'whatsapp.send')
        self.assertEqual(self.messages[0][1],{'recipient':'59170000001','text':'Tu video está listo: https://drive.google.com/file/d/file-fixture/view'})
        self.assertFalse(value['results'][-1]['delivery_confirmed']);self.assertTrue(value['results'][-1]['simulated']);self.assertEqual(sum(name=='drive_upload' for name,args in self.calls),1)
    def test_changed_export_never_uploads_or_messages(self):
        rule=self.rule();self.video.write_bytes(b'tampered-video-fixture!');self.engine.activate(rule['id']);self.engine.tick()
        self.assertFalse(any(name=='drive_upload' for name,args in self.calls));self.assertEqual(self.messages,[]);self.assertEqual(self.engine.store.get(rule['id'])['state'],'uncertain')
    def test_ambiguous_folder_name_requires_user_without_upload(self):
        self.folder_items.append({**self.folder_items[0],'id':'other-folder'});rule=self.rule();self.engine.activate(rule['id']);self.engine.tick()
        self.assertEqual([name for name,args in self.calls],['drive_list']);self.assertEqual(self.messages,[])
    def test_editor_session_change_after_upload_never_repeats_upload(self):
        rule=self.rule({'folder_id':'folder-fixture'});self.engine.activate(rule['id']);self.engine.tick();self.client.identity.pid=778;self.engine.tick();self.engine.tick()
        self.assertEqual(sum(name=='drive_upload' for name,args in self.calls),1);self.assertEqual(self.messages,[]);self.assertEqual(self.engine.store.get(rule['id'])['state'],'awaiting_user')
    def test_delivery_order_is_validated_before_activation(self):
        with self.assertRaises(ValueError):self.engine.create({'type':'now'},[{'type':'whatsapp_self_link'},{'type':'drive_upload','folder_name':'Fixture'}],roots=[])
        self.assertEqual(self.calls,[]);self.assertEqual(self.messages,[])


if __name__=='__main__':unittest.main()
