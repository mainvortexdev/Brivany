"""Computer integration with substituted native input and model, plus real GLB compilation."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler
from services.computer.service import ComputerService,simple_application_open
from services.computer.models import publish_model
from services.computer.backend import resolve_backend
from services.computer.runtime import NativeRuntime
from services.spatial.jobs import SpatialService
from packages.providers.conversation import ConversationRequest

SOURCE=resolve_backend().source


class Runtime:
    source=SOURCE
    def __init__(self):self.calls=[];self.cancelled=0
    def availability(self):return {'available':True,'native_input_verified':False}
    def call(self,method,**kwargs):
        self.calls.append((method,kwargs))
        if method=='resolve_application':return {'installed':True,'verified':True,'application':kwargs['name'],'executable_name':kwargs['name']+'.exe'}
        return {'windows':[],'roots':kwargs.get('roots',[])} if method=='observe' else {'verified':True}
    def cancel(self):self.cancelled+=1
    def close(self):pass


class Planner:
    def __init__(self):self.count=0;self.route_kind='desktop'
    def route(self,value,cancelled=None):return {'kind':self.route_kind,'goal':value.text}
    def generate(self,prompt,data,**kwargs):
        self.count+=1
        if 'objects' in prompt and 'modeladora' in prompt:return {'title':'Mesa sintética','objects':[{'name':'Tablero','type':'box','position':[0,1,0],'size':[2,.1,1],'color':'#ab8877'}]}
        if data.get('completed_steps'):return {'done':True,'message':'Terminada'}
        return {'done':False,'step':{'action':'write_note','params':{'name':'synthetic.txt','text':'Fixture sintética'}}}


class LocalProtocolRuntime(NativeRuntime):
    """Exercise the real transport method against an in-memory owned child."""
    def __init__(self):
        self.lock=threading.RLock();self.write_lock=threading.Lock();self.responses={};self.token='fixture';self.sent=[];self.started=False
        class Socket:
            def sendall(inner,data):
                message=json.loads(data);self.sent.append(message);target=self.responses[message['id']]
                target.put({'event':'progress','stage':'untrusted text'})
                target.put({'event':'progress','stage':'ide_waiting'})
                target.put({'result':{'verified':True}})
        self.socket=Socket()
    def start(self):self.started=True
    def availability(self):return {'available':True}


class NativeProtocolTests(unittest.TestCase):
    def test_progress_is_local_and_does_not_finish_the_call(self):
        runtime=LocalProtocolRuntime();stages=[]
        self.assertEqual(runtime.call('terminal_editor_run',on_progress=stages.append,workspace='owned fixture'),{'verified':True})
        self.assertEqual(stages,['ide_waiting']);self.assertNotIn('on_progress',runtime.sent[0]);self.assertEqual(runtime.responses,{})
    def test_already_cancelled_task_never_starts_or_sends(self):
        runtime=LocalProtocolRuntime();cancelled=threading.Event();cancelled.set()
        with self.assertRaises(ValueError):runtime.call('terminal_editor_run',cancelled=cancelled)
        self.assertFalse(runtime.started);self.assertEqual(runtime.sent,[])


class ComputerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.runtime=Runtime();self.planner=Planner()
        self.spatial=SpatialService(Path(self.temp.name)/'spatial',start_worker=False,seed_demo=False)
        self.service=ComputerService('http://127.0.0.1:1',lambda:self.spatial,root=Path(self.temp.name)/'computer',runtime=self.runtime,planner=self.planner,native=True)
    def tearDown(self):self.service.close();self.spatial.close();self.temp.cleanup()
    def wait(self,job):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            value=self.service.jobs[job['id']]
            if value['state'] not in {'queued','planning','running'}:return value
            time.sleep(.01)
        self.fail('Task did not complete')
    def test_no_control_without_native_grant(self):
        with self.assertRaises(PermissionError):self.service.enqueue('desktop','x','unknown')
        self.assertEqual(self.runtime.calls,[])
        self.service.native=False
        with self.assertRaises(ValueError):self.service.arm()
    def test_observe_execute_observe_then_done(self):
        token=self.service.arm()['token'];job=self.service.enqueue('desktop','Crear nota sintética',token)
        value=self.wait(job)
        self.assertEqual(value['state'],'succeeded');self.assertEqual(value['steps'],1)
        self.assertEqual([call[0] for call in self.runtime.calls],['begin_task','observe','execute','observe','end_task'])
        self.assertNotIn('goal',self.service.status()['jobs'][0]);self.assertNotIn('grant',self.service.status()['jobs'][0])
        self.assertFalse(value['result']['semantic_verification'])
    def test_simple_app_open_is_one_background_launch_without_followup_input(self):
        self.planner.generate=lambda *a,**k:{'done':False,'step':{'action':'launch_app','params':{'app':'Word'}}}
        token=self.service.arm()['token'];job=self.service.enqueue('desktop','Abre Word por mí',token)
        value=self.wait(job);self.assertTrue(value['finished'].wait(2));self.assertEqual(value['state'],'succeeded')
        self.assertEqual([c[0] for c in self.runtime.calls],['resolve_application','begin_task','execute','end_task'])
        self.assertTrue(self.runtime.calls[1][1]['background']);self.assertEqual(value['steps'],1);self.assertEqual(value['external_calls'],0)
        self.assertTrue(simple_application_open('Abre Word por mi'));self.assertFalse(simple_application_open('Abre Word y escribe una carta'))
    def test_simple_open_rejects_planner_attempt_to_focus_a_window(self):
        self.planner.generate=lambda *a,**k:{'done':False,'step':{'action':'focus_window','params':{'handle':123,'process_id':456}}}
        token=self.service.arm()['token'];job=self.service.enqueue('desktop','Abre Word por mí',token)
        value=self.wait(job);self.assertTrue(value['finished'].wait(2));self.assertEqual(value['state'],'succeeded')
        self.assertEqual([c[1]['step']['action'] for c in self.runtime.calls if c[0]=='execute'],['launch_app'])
    def test_old_account_orchestrator_request_still_takes_the_direct_path(self):
        self.service.orchestrator.prepare_plan=lambda *a:(_ for _ in ()).throw(AssertionError('Simple open must not plan a team'))
        job=self.service.enqueue('orchestrator','Abre Word por mí',self.service.arm()['token']);value=self.wait(job);value['finished'].wait(2)
        self.assertEqual(value['state'],'succeeded');self.assertEqual(value['kind'],'desktop');self.assertEqual(value['external_calls'],0)
        discovery=next(j for j in self.service.jobs.values() if j['kind']=='discovery')
        self.assertEqual(discovery['parent_id'],value['id']);self.assertEqual(discovery['result']['executable_name'],'word.exe')
    def test_missing_installation_never_attempts_to_launch(self):
        original=self.runtime.call
        self.runtime.call=lambda method,**kw:{'installed':False,'verified':False} if method=='resolve_application' else original(method,**kw)
        job=self.service.enqueue('desktop','Abre Word',self.service.arm()['token']);value=self.wait(job);value['finished'].wait(2)
        self.assertEqual(value['state'],'failed');self.assertFalse(any(c[0] in {'begin_task','execute'} for c in self.runtime.calls))
    def test_process_question_returns_observed_count_without_model_or_input(self):
        original=self.runtime.call
        self.runtime.call=lambda method,**kw:{'count':247,'observed_at':'fixture'} if method=='system_process_count' else original(method,**kw)
        job=self.service.enqueue('orchestrator','Cuántos procesos tengo corriendo en mi pc ahora mismo?',self.service.arm()['token']);value=self.wait(job);value['finished'].wait(2)
        self.assertEqual(value['state'],'succeeded');self.assertIn('247',value['result']['message']);self.assertEqual(value['external_calls'],0);self.assertEqual(self.runtime.calls,[])
    def test_disarm_revokes_old_grants(self):
        first=self.service.arm()['token'];self.service.disarm();self.assertFalse(self.service.authorized(first))
        self.assertNotEqual(first,self.service.arm()['token'])
    def test_explicit_voice_stop_revokes_the_session(self):
        token=self.service.arm()['token'];self.planner.route_kind='stop'
        events=list(self.service.turn(ConversationRequest(text='Detén la tarea.',consent=True),token))
        self.assertFalse(self.service.authorized(token));self.assertEqual(events[-1]['type'],'done');self.assertEqual(self.runtime.calls,[])
    def test_expired_grant_never_enqueues(self):
        token=self.service.arm()['token'];self.service.granted_at-=3601
        with self.assertRaises(PermissionError):self.service.enqueue('model','Modelo',token)
    def test_scheduled_authority_survives_expired_chat_grant_and_is_task_scoped(self):
        token=self.service.arm()['token'];self.service.granted_at-=3601
        self.planner.generate=lambda *a,**k:{'title':'Fixture','body':'Documento sintético diferido.'}
        job=self.service.enqueue_scheduled('document','Fixture',{'id':str(__import__('uuid').uuid4()),'roots':list(self.service.roots),'selected':[]})
        value=self.wait(job);self.assertEqual(value['state'],'succeeded');self.assertFalse(self.service.authorized(token));self.assertTrue(self.service.authorized(value['grant']))
        with self.assertRaises(PermissionError):self.service.enqueue('desktop','Different goal',value['grant'])
    def test_large_skill_library_keeps_live_chat_within_context_budget(self):
        class Human:
            def library(self):return {'skills':[{'id':'fixture-'+str(i),'title':'T'*600,'objective':'O'*1200} for i in range(100)]}
        self.service.skills.human=lambda:Human()
        self.service.skills.context=lambda:{'context':{'draft':{'steps':['long fixture '*1000]}},'instructions':'Fixture guidance.'}
        with patch('packages.providers.conversation.stream_reply',return_value=iter([{'type':'done','text':'Fixture'}])) as reply:
            list(self.service.chat(ConversationRequest(text='Continúa',consent=True),None))
        context=reply.call_args.kwargs['context'];self.assertLessEqual(len(json.dumps(context,ensure_ascii=False)),17000);self.assertTrue(context['truncated']);self.assertTrue(context['active_human_skill']['truncated'])
    def test_cancelled_router_cannot_start_late_action(self):
        token=self.service.arm()['token'];cancelled=threading.Event();cancelled.set()
        self.assertEqual(list(self.service.turn(ConversationRequest(text='Fixture',consent=True),token,cancelled)),[])
        self.assertEqual(self.service.jobs,{})
    def test_voice_turn_returns_job_receipt_and_stays_conversational(self):
        token=self.service.arm()['token'];events=list(self.service.turn(ConversationRequest(text='Fixture',consent=True),token))
        self.assertEqual(events[0]['type'],'computer_task');self.assertTrue(events[-1]['await_user'])
        self.assertIn(next(e['text'] for e in events if e['type']=='sentence'),['Me pongo con ello.','Voy con eso.','Ahora lo hago.','Dame un momento, voy con ello.'])
        self.wait(events[0]['job'])
    def test_models_run_while_desktop_is_busy(self):
        token=self.service.arm()['token'];entered=threading.Event();release=threading.Event()
        original=self.runtime.call
        def blocked(method,**kwargs):
            if method=='observe':entered.set();release.wait(5)
            return original(method,**kwargs)
        self.runtime.call=blocked
        try:
            desktop=self.service.enqueue('desktop','Fixture',token);self.assertTrue(entered.wait(2))
            self.service.publisher=lambda *args:{'scene_id':'synthetic','conceptual':True}
            model=self.service.enqueue('model','Mesa fixture',token)
            self.assertEqual(self.wait(model)['state'],'succeeded')
            self.assertIn(self.service.jobs[desktop['id']]['state'],{'planning','running'})
        finally:release.set()
        self.wait(desktop)
    def test_invalid_plan_fails_without_native_execution(self):
        token=self.service.arm()['token'];self.planner.generate=lambda *a,**k:{'script':'not executable'}
        job=self.service.enqueue('desktop','Fixture',token)
        self.assertEqual(self.wait(job)['state'],'failed');self.assertEqual([c[0] for c in self.runtime.calls],['begin_task','observe','end_task'])
    def test_receipt_survives_restart_without_prompt_token_or_replay(self):
        token=self.service.arm()['token'];job=self.service.enqueue('desktop','Private synthetic instruction',token);self.wait(job)
        receipt=self.service.receipts/(job['id']+'.json')
        deadline=time.monotonic()+2
        while not receipt.exists() and time.monotonic()<deadline:time.sleep(.01)
        raw=receipt.read_text(encoding='utf-8');self.assertNotIn('Private synthetic instruction',raw);self.assertNotIn(token,raw)
        restored_runtime=Runtime();restored=ComputerService('http://127.0.0.1:1',lambda:self.spatial,root=self.service.root,runtime=restored_runtime,planner=Planner(),native=True)
        try:
            self.assertEqual(restored.status()['jobs'][0]['id'],job['id']);self.assertEqual(restored_runtime.calls,[]);self.assertFalse(restored.status()['enabled'])
        finally:restored.close()
    def test_restart_marks_in_progress_receipt_interrupted(self):
        from uuid import uuid4
        identifier=str(uuid4());saved={'id':identifier,'kind':'desktop','state':'planning','phase':'Preparando','steps':0,'result':None,'error':None,'external_calls':0}
        (self.service.receipts/(identifier+'.json')).write_text(json.dumps(saved),encoding='utf-8')
        runtime=Runtime();restored=ComputerService('http://127.0.0.1:1',lambda:self.spatial,root=self.service.root,runtime=runtime,planner=Planner(),native=True)
        try:self.assertEqual(restored.jobs[identifier]['state'],'interrupted');self.assertEqual(runtime.calls,[])
        finally:restored.close()
    def test_public_receipts_do_not_retain_window_or_file_inventories(self):
        result=self.service.step_receipts([{'action':'browser_observe','result':{'tabs':[{'name':'Private fixture title'}]}},{'action':'list_files','result':{'files':[{'name':'private-fixture.txt'}]}}])
        self.assertNotIn('Private fixture',json.dumps(result));self.assertNotIn('private-fixture.txt',json.dumps(result));self.assertEqual(result[0]['result']['item_count'],1)
    def test_navigation_receipts_do_not_retain_queries_or_auth_redirects(self):
        result=self.service.step_receipts([{'action':'browser_search','result':{'verified':True,'navigated':'https://example.com/search?q=private-fixture'}},
                                          {'action':'browser_open_login','result':{'verified':True,'requires_user':True,'navigated':'https://example.com/callback?code=synthetic-secret'}}])
        self.assertNotIn('private-fixture',json.dumps(result));self.assertNotIn('synthetic-secret',json.dumps(result))
        self.assertTrue(result[0]['result']['verified']);self.assertTrue(result[1]['result']['requires_user'])
    def test_page_history_keeps_newest_observation_without_growing_each_step(self):
        results=[{'action':'browser_read','result':{'items':[{'name':'old-'+str(i)+'x'*200} for _ in range(50)]}} for i in range(8)]
        results.append({'action':'browser_scroll','result':{'verified':True,'input_count':1,'page':{'items':[{'name':'latest-visible-fixture'}]}}})
        compact=self.service.planning_steps(results);encoded=json.dumps(compact)
        self.assertIn('latest-visible-fixture',encoded);self.assertNotIn('old-',encoded);self.assertEqual(compact[0]['result']['item_count'],50);self.assertEqual(len(compact),9)
        receipts=self.service.step_receipts(results);self.assertNotIn('latest-visible-fixture',json.dumps(receipts));self.assertEqual(receipts[-1]['result']['input_count'],1)
    def test_login_handoff_stops_without_following_actions(self):
        token=self.service.arm()['token'];original=self.runtime.call
        def handoff(method,**kwargs):
            if method=='execute':return {'requires_user':True,'handoff_reason':'Completa la verificación tú.'}
            return original(method,**kwargs)
        self.runtime.call=handoff
        job=self.service.enqueue('desktop','Fixture de inicio de sesión',token);result=self.wait(job)
        self.assertEqual(result['state'],'waiting_for_user');self.assertEqual(result['steps'],1)
        self.assertTrue(result['result']['receipts'][0]['result']['requires_user'])
    def test_proxy_requires_private_bridge_token_and_active_job(self):
        with self.assertRaises(PermissionError):self.service.proxy({'prompt':'x'},'bad')
        with self.assertRaises(PermissionError):self.service.proxy({'prompt':'x'},self.service.secret)
    def test_limits_requests_per_task(self):
        token=self.service.arm()['token'];job={'grant':token,'cancelled':threading.Event(),'external_calls':12}
        with self.assertRaises(ValueError):self.service.request_plan(job,'x',{})
    def test_compiler_publishes_real_scene_and_glb(self):
        if not (SOURCE/'node_modules/three/build/three.module.js').is_file():self.skipTest('Cognira runtime not installed')
        plan={'title':'Mesa fixture','assumptions':'Dimensiones sintéticas sin verificar.','objects':[{'name':'Tablero','type':'box','position':[0,1,0],'size':[2,.1,1],'color':'#ab8877'}]}
        result=publish_model(plan,self.spatial,SOURCE,threading.Event())
        self.assertTrue(result['conceptual']);self.assertEqual(result['object_count'],1)
        scene=self.spatial.scene(result['scene_id'])
        self.assertEqual(scene['scene']['units'],'source_relative')
        self.assertEqual(self.spatial.asset(result['scene_id'],'object-0')[0][:4],b'glTF')
        self.assertEqual(self.spatial.library()['spaces'][0]['title'],'Mesa fixture')
    def test_cancelled_model_not_published(self):
        if not (SOURCE/'node_modules/three/build/three.module.js').is_file():self.skipTest('Cognira runtime not installed')
        event=threading.Event();event.set()
        with self.assertRaises(ValueError):publish_model({'objects':[{'type':'box','position':[0,0,0],'size':[1,1,1]}]},self.spatial,SOURCE,event)
        self.assertEqual(self.spatial.library()['spaces'],[])
    def test_http_requires_origin_and_grant(self):
        with LocalDesktopServer(handler=experience_handler(Handler)) as server:
            server.http.computer_lock=threading.RLock();server.http.computer=self.service
            def post(origin=None,token=None):
                headers={'Content-Type':'application/json'}
                if origin:headers['Origin']=origin
                if token:headers['X-Brivany-Control']=token
                return urlopen(Request(server.base_url+'/api/computer/jobs',data=b'{"kind":"desktop","goal":"fixture"}',headers=headers),timeout=4)
            with self.assertRaises(HTTPError) as missing:self.assertEqual(post().status,200)
            self.assertEqual(missing.exception.code,403)
            with self.assertRaises(HTTPError) as unarmed:post(server.base_url,'bad')
            self.assertEqual(unarmed.exception.code,403)
            response=post(server.base_url,self.service.arm()['token']);self.assertEqual(response.status,202);job=json.load(response)['job'];response.close();self.wait(job)
            status=json.load(urlopen(server.base_url+'/api/computer/status',timeout=4));self.assertEqual(status['jobs'],[]);self.assertEqual(status['roots'],[])


if __name__=='__main__':unittest.main()
