"""Motion plan policy and chat/background integration, no external inference."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch,Mock
from uuid import uuid4
from services.motion.service import MotionService,validate,write_project,source_status
from services.computer.service import ComputerService
from tests.test_computer_control import Runtime,Planner
from packages.providers.conversation import ConversationRequest

PLAN={'style':'workspace','title':'A tu ritmo','headline':'Tu voz en movimiento','request':'Melodi, crea un video','payoff':'Una idea que se mueve','closing':'Crea a tu ritmo','duration':24,'fps':30}


class MotionTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_typed_plan_rejects_code_paths_extra_fields_and_unbounded_work(self):
        self.assertEqual(validate(PLAN),PLAN)
        for changed in ({'script':'evil'}, {'style':'https://x'},{'duration':3600},{'duration':True},{'fps':1000},{'headline':'x'*37}):
            with self.subTest(changed=changed),self.assertRaises((ValueError,TypeError)):validate({**PLAN,**changed})
    def test_original_request_cannot_be_silently_changed_to_other_family(self):
        service=MotionService(self.root)
        try:
            with self.assertRaises(ValueError):service.run('Rewritten goal',user_request='Crea un video spatial',identifier=str(uuid4()),decide=lambda *a:PLAN,cancelled=threading.Event())
            self.assertEqual(list(self.root.glob('*/motion.json')),[])
        finally:service.close()
    def test_cancelled_work_does_not_plan_or_write_a_project(self):
        service=MotionService(self.root);stop=threading.Event();stop.set();decide=Mock()
        try:
            with self.assertRaises(ValueError):service.run('Crea un video',identifier=str(uuid4()),decide=decide,cancelled=stop)
            decide.assert_not_called()
        finally:service.close()
    def test_generated_copy_cannot_break_out_of_script_or_overwrite_existing_project(self):
        folder=self.root/'own';folder.mkdir();write_project(folder,{**PLAN,'headline':'</script><script>alert(1)'})
        data=(folder/'index.html').read_text(encoding='utf-8');self.assertIn('\\u003c/script',data);self.assertNotIn('</script><script>alert(1)',data)
        self.assertTrue((folder/'assets/vendor.min.js').is_file());self.assertTrue((folder/'exports/Brivany-animation.html').is_file())
        with self.assertRaises(FileExistsError):write_project(folder,PLAN)
    def test_skill_provenance_and_local_dependencies_are_available(self):
        source=source_status();self.assertTrue(source['installed']);self.assertEqual(source['version'],'1.19.0');self.assertEqual(source['license'],'MIT');self.assertTrue(MotionService.availability()['available'])


class MotionCoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.runtime=Runtime();self.planner=Planner();self.planner.route_kind='motion'
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=self.root,runtime=self.runtime,planner=self.planner,native=True)
        class Fixture:
            def __init__(self,*a):pass
            def run(self,*a,**k):return {'verified':True,'title':'Fixture MP4','path':'fixture.mp4','message':'Video sintético listo'}
            def close(self):pass
        self.service.motion_factory=Fixture
    def tearDown(self):self.service.close();self.temp.cleanup()
    def wait(self,job):
        end=time.monotonic()+5
        while time.monotonic()<end:
            value=self.service.jobs[job['id']]
            if value['state'] not in {'queued','planning','running'}:return value
            time.sleep(.01)
        self.fail('Motion fixture timed out')
    def test_live_dispatch_and_prepared_chat_both_use_motion_without_native_input(self):
        token=self.service.arm()['token'];events=list(self.service.turn(ConversationRequest(text='Crea un video promocional',consent=True),token));job=events[0]['job']
        self.assertEqual(job['kind'],'motion');self.assertEqual(self.wait(job)['state'],'succeeded');self.assertEqual(self.runtime.calls,[])
        events=list(self.service.chat_turn(ConversationRequest(text='Otra animación diferente',consent=True),token));prepared=events[0]
        self.assertEqual(prepared['kind'],'motion');job=self.service.execute_prepared(prepared['ticket'],token);self.assertEqual(self.wait(job)['state'],'succeeded')
        self.assertEqual(self.runtime.calls,[])
    def test_speaking_can_continue_while_motion_worker_is_busy(self):
        entered=threading.Event();release=threading.Event()
        class Slow:
            def __init__(self,*a):pass
            def run(self,*a,**k):entered.set();release.wait(5);return {'verified':True,'message':'Fixture'}
            def close(self):pass
        self.service.motion_factory=Slow;token=self.service.arm()['token'];job=self.service.enqueue('motion','Fixture',token)
        try:
            self.assertTrue(entered.wait(2));self.assertTrue(self.service.native_lane.acquire(blocking=False));self.service.native_lane.release()
            with patch('packages.providers.conversation.stream_reply',return_value=iter([{'type':'done','text':'Podemos seguir hablando.'}])):
                self.assertEqual(list(self.service.chat(ConversationRequest(text='Hola',consent=True),None))[-1]['text'],'Podemos seguir hablando.')
            self.assertIn(self.service.jobs[job['id']]['state'],{'planning','running'})
        finally:release.set()
        self.assertEqual(self.wait(job)['state'],'succeeded')
