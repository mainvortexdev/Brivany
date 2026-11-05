"""Local broker policy with synthetic UI state; no microphone, network or audio."""
import json
from types import SimpleNamespace
import unittest
from desktop.experience.companion import CompanionBridge
from desktop.experience.island import IslandHost, geometry

class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.calls=[];self.bridge=CompanionBridge();self.bridge._trusted=lambda:None
        self.bridge._window=SimpleNamespace(evaluate_js=lambda s:self.calls.append(s))
        self.bridge._bar_window=SimpleNamespace(evaluate_js=lambda s:self.calls.append(s))
    def tearDown(self):
        for key in ('_workspace_reply_timer','_workspace_overlay_hide'):
            timer=getattr(self.bridge,key,None)
            if timer:timer.cancel()
    def test_closed_chat_reply_is_previewed_but_open_chat_suppresses_it(self):
        import time
        self.bridge._island_host=SimpleNamespace(value={'expanded':False})
        self.bridge.workspace_chat_publish({'messages':[{'role':'user','text':'Consulta de prueba'}],'pending':True})
        self.bridge.workspace_chat_publish({'messages':[{'role':'user','text':'Consulta de prueba'},{'role':'assistant','text':'Respuesta propia de prueba.'}],'pending':False})
        self.assertEqual(self.bridge._workspace_reply_text,'Respuesta propia de prueba.');self.assertGreater(self.bridge._workspace_reply_deadline,time.monotonic())
        self.assertIn('"reply_visible": true',self.calls[-1])
        self.bridge._island_host.value['expanded']=True;self.bridge._publish_companion(self.bridge._companion_snapshot())
        self.assertIn('"reply_visible": false',self.calls[-1]);self.assertEqual(len(self.bridge.workspace_chat_state()['messages']),2)
        self.bridge._workspace_reply_deadline=0;self.bridge._island_host.value['expanded']=False;self.bridge._publish_companion(self.bridge._companion_snapshot())
        self.assertIn('"reply_visible": false',self.calls[-1])
    def test_only_explicit_commands_reach_original_chat_without_showing_main_window(self):
        text='Hola "}; window.evil=true; //'
        self.assertTrue(self.bridge.workspace_chat_command('send',text)['accepted'])
        self.assertIn(json.dumps(text),self.calls[0]);self.assertIn('workspaceCommand(request)',self.calls[0])
        for action,text in [('shell','x'),('send',' '),('send','x'*1201),('start',None)]:
            with self.assertRaises(ValueError):self.bridge.workspace_chat_command(action,text)
    def test_chat_state_and_live_signal_are_bounded_and_stored_only_in_memory(self):
        self.bridge.workspace_chat_publish({'messages':[{'role':'user','text':'Hola'}],'listening':True})
        self.bridge.workspace_live_signal({'level':.05,'samples':[.1]*48})
        self.assertEqual(self.bridge.workspace_chat_state()['messages'][0]['text'],'Hola')
        self.assertEqual(len(self.bridge.workspace_chat_state()['samples']),48)
        for value in [{'level':True},{'samples':[float('nan')]},{'samples':[1]*65},{'samples':[2]}]:
            with self.assertRaises(ValueError):self.bridge.workspace_live_signal(value)
        with self.assertRaises(ValueError):self.bridge.workspace_chat_publish({'messages':[{'role':'system','text':'x'}]})
    def test_dictation_state_and_commands_are_bounded(self):
        for phase in ('idle','starting','recording','finishing'):
            self.bridge.workspace_chat_publish({'dictation':{'phase':phase,'draft':'Texto de prueba','revision':2}})
            self.assertEqual(self.bridge.workspace_chat_state()['dictation']['phase'],phase)
        for value in ({'phase':'shell','draft':'','revision':0},{'phase':'idle','draft':'x'*1201,'revision':0},{'phase':'idle','draft':'','revision':True}):
            with self.assertRaises(ValueError):self.bridge.workspace_chat_publish({'dictation':value})
        for action in ('dictate_cancel','dictate_stop','dictate_send'):
            self.assertTrue(self.bridge.workspace_chat_command(action)['accepted'])
            self.assertIn(action,self.calls[-1])
    def test_workspace_mic_permission_is_temporary_and_only_for_our_origin(self):
        import time
        self.bridge._base='http://127.0.0.1:1234';self.bridge._workspace_microphone_until=time.monotonic()+12
        self.assertTrue(self.bridge._workspace_microphone_allowed('http://127.0.0.1:1234/app'))
        for uri in ('https://example.com','http://127.0.0.1:4567/app','http://user@127.0.0.1:1234/app','http://127.0.0.1:1234/connections'):
            self.assertFalse(self.bridge._workspace_microphone_allowed(uri))
        self.bridge.workspace_chat_command('dictate_cancel')
        self.assertFalse(self.bridge._workspace_microphone_allowed('http://127.0.0.1:1234/app'))
    def test_popup_and_wave_stay_in_small_or_offset_monitor_bounds(self):
        for width,height in [(280,240),(390,600),(1280,1024),(1920,1080)]:
            for panel in ('melodi','chat','live-wave','reply'):
                value=geometry(SimpleNamespace(x=-1920,y=30,width=width,height=height),True,panel=panel,docked=True)
                self.assertGreaterEqual(value['x'],-1920);self.assertLessEqual(value['x']+value['width'],-1920+width);self.assertLessEqual(value['y']+value['height'],height+30)
    def test_chat_starts_compact_and_cannot_exceed_previous_maximum_or_screen(self):
        screen=SimpleNamespace(width=1280,height=800)
        self.assertEqual(geometry(screen,True,panel='chat',docked=True)['height'],148)
        self.assertEqual(geometry(screen,True,panel='chat',docked=True,chat_height=404)['height'],404)
        tiny=geometry(SimpleNamespace(width=320,height=240),True,panel='chat',docked=True,chat_height=404)
        self.assertLessEqual(tiny['y']+tiny['height'],240)
        for invalid in (True,147,405,float('nan'),'200'):
            with self.assertRaises(ValueError):geometry(screen,True,panel='chat',docked=True,chat_height=invalid)
    def test_glass_backdrop_cannot_extend_past_the_physical_window(self):
        screen=SimpleNamespace(width=1280,height=800)
        for panel in ('reply','result'):
            for anchor in (0,640,1280):
                value=geometry(screen,True,panel=panel,docked=True,anchor_x=anchor)
                self.assertEqual(value['host_width'],value['width']);self.assertEqual(value['host_height'],value['height']);self.assertEqual(value['clip_left'],0);self.assertEqual(value['host_x'],value['x'])

    def test_silent_waveform_and_open_chat_hide_the_native_overlay(self):
        screen=SimpleNamespace(width=1280,height=800)
        host=IslandHost(screen,expanded=True,docked=True)
        host.window=SimpleNamespace(evaluate_js=lambda script:None)
        host.show=lambda:setattr(host,'_visible',True)
        host.hide=lambda:setattr(host,'_visible',False)
        host.layout=lambda *args,**kwargs:host.value.update(panel=args[2],anchor_x=kwargs['anchor_x'])
        self.bridge._voice_host=host
        self.bridge._island_host=SimpleNamespace(value={'expanded':False})
        self.bridge.workspace_chat_publish({'listening':True})
        self.assertFalse(host._visible)
        self.bridge.workspace_live_signal({'level':.08,'samples':[.1]*48})
        self.assertTrue(host._visible)
        self.assertEqual(host._layer_flags(),3)
        self.bridge._island_host.value['expanded']=True
        self.bridge._publish_companion(self.bridge._companion_snapshot())
        self.assertFalse(host._visible)
        self.bridge._island_host.value['expanded']=False
        self.bridge.workspace_live_signal({'level':0,'samples':[]})
        self.assertFalse(host._visible)
