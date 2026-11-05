"""Native lifecycle contract with substituted windows; no screen or audio capture."""
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from desktop.experience.work import WorkBridge
from services.work.session import WorkSession
from desktop.experience.island import geometry,pointer_presence


class Event:
    def __init__(self):self.callbacks=[]
    def __iadd__(self,callback):self.callbacks.append(callback);return self
    def fire(self):
        for callback in self.callbacks:callback()


class Window:
    def __init__(self):self.hidden=False;self.destroyed=False;self.scripts=[];self.events=SimpleNamespace(closed=Event(),loaded=Event());self.bounds={}
    def hide(self):self.hidden=True
    def show(self):self.hidden=False
    def restore(self):self.hidden=False
    def resize(self,width,height):self.bounds.update(width=width,height=height)
    def move(self,x,y):self.bounds.update(x=x,y=y)
    def evaluate_js(self,source):self.scripts.append(source)
    def destroy(self):self.destroyed=True;self.events.closed.fire()


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.capture_calls=[];self.work=WorkSession(self.temp.name,capture=lambda *a,**k:self.capture_calls.append(True));self.main=Window();self.windows=[]
        self.bridge=WorkBridge();self.bridge._base='http://127.0.0.1:1';self.bridge._window=self.main;self.bridge._trusted=lambda:None;self.bridge._work_factory=lambda:self.work
        from desktop.experience.chat_visibility import ChatVisibility
        from tests.test_chat_visibility import FakeMonitor
        self.bridge._workspace_chat_visibility=ChatVisibility(self.work.root/'workspace-ui.json',FakeMonitor())
        def create(*args,**kwargs):value=Window();self.windows.append((value,kwargs));return value
        self.fake=SimpleNamespace(screens=[SimpleNamespace(width=800,height=600)],create_window=create)
        self.patcher=patch.dict('sys.modules',{'webview':self.fake});self.patcher.start()
    def load_windows(self):
        for window,options in list(self.windows):window.events.loaded.fire()
    def tearDown(self):
        if getattr(self.bridge,'_workspace_chat_visibility',None):self.bridge._workspace_chat_visibility.close()
        self.patcher.stop();self.work.close();self.temp.cleanup()
    def test_chat_stays_open_outside_pointer_and_only_external_typing_requests_dismissal(self):
        import os
        self.bridge.start_work();self.load_windows();self.bridge.work_island_layout(True,'normal','chat',False)
        with patch.object(self.bridge._island_host,'pointer',return_value={'near':False,'inside':False}):
            value=self.bridge.work_island_pointer();self.assertTrue(value['keep_open']);self.assertFalse(value['hide_chat'])
            monitor=self.bridge._chat_visibility().monitor;monitor.record(0x41,os.getpid())
            self.assertFalse(self.bridge.work_island_pointer()['hide_chat'])
            monitor.record(0x41,os.getpid()+1);self.assertTrue(self.bridge.work_island_pointer()['hide_chat'])
            self.bridge.workspace_chat_visibility('manual');monitor.record(0x41,os.getpid()+1)
            self.assertFalse(self.bridge.work_island_pointer()['hide_chat'])
    def test_start_keeps_chat_and_native_close_in_background_without_audio(self):
        self.bridge.start_work();self.assertTrue(self.main.hidden);self.assertTrue(self.work.active);self.assertEqual(self.capture_calls,[])
        self.assertLessEqual(self.windows[0][1]['width'],800);self.assertLessEqual(self.windows[0][1]['height'],600)
        self.bridge.return_to_chat();self.assertFalse(self.main.hidden);self.assertFalse(self.bridge._keep_work_background());self.assertTrue(self.main.hidden)
        self.bridge.stop_work();self.assertFalse(self.main.hidden);self.assertFalse(self.work.active);self.assertTrue(self.windows[0][0].destroyed)
    def test_voice_cloning_requires_consent_and_is_locked_during_translation(self):
        with self.assertRaises(ValueError):self.bridge.work_voice_cloning(True,'es',False)
        self.assertEqual(self.bridge.work_voice_cloning(True,'es',True),{'enabled':True,'language':'es'})
        self.bridge._work_translation=SimpleNamespace(status=lambda:{'active':True})
        with self.assertRaises(ValueError):self.bridge.work_voice_cloning(False,'es',False)
        self.bridge._work_translation=None
        self.bridge._sync_translation_relay=SimpleNamespace(status=lambda:{'active_sessions':1})
        with self.assertRaises(ValueError):self.bridge.work_voice_cloning(False,'es',False)
    def test_tray_keeps_close_in_background_and_explicit_exit_can_close(self):
        self.bridge._tray_host=SimpleNamespace(active=True)
        self.assertFalse(self.bridge._keep_work_background())
        self.assertTrue(self.work.active);self.assertTrue(self.main.hidden);self.assertEqual(self.capture_calls,[])
        self.bridge._exit_requested=True
        self.assertIsNone(self.bridge._keep_work_background())

    def test_companion_native_close_restores_main(self):
        self.bridge.start_work();self.windows[0][0].destroy();self.assertFalse(self.work.active);self.assertFalse(self.main.hidden);self.assertIsNone(self.bridge._work_window)
    def test_failed_region_capture_restores_companion(self):
        self.bridge.start_work();self.load_windows();self.work.screen_snapshot=lambda:(_ for _ in ()).throw(OSError('synthetic capture failure'))
        with self.assertRaises(OSError):self.bridge.begin_work_region()
        self.assertFalse(self.windows[1][0].hidden);self.assertEqual(self.capture_calls,[])
    def test_translation_selector_uses_the_translation_entry_without_enabling_audio(self):
        self.bridge.start_work();self.load_windows()
        self.work.screen_snapshot=lambda:{'preview':'synthetic fixture'}
        urls=[]
        original=self.fake.create_window
        def create(title,url,**options):
            urls.append(url);return original(title,url,**options)
        self.fake.create_window=create
        self.bridge.begin_work_region('translate')
        self.assertEqual(urls,['http://127.0.0.1:1/work-capture?action=translate'])
        self.assertEqual(self.capture_calls,[])
        self.bridge.cancel_work_region()
        with self.assertRaises(ValueError):self.bridge.begin_work_region('unknown')
        with self.assertRaises(ValueError):self.bridge.use_work_region(0,0,.5,.5,'explain')
    def test_loaded_fallback_is_top_center_and_resizes_to_visible_bounds(self):
        self.bridge._island_preview=True
        self.bridge.start_work();self.load_windows();window=self.windows[0][0]
        self.assertEqual(window.bounds,{'width':336,'height':0,'x':232,'y':46});self.assertTrue(window.hidden)
        self.assertEqual(self.windows[1][0].bounds,{'width':800,'height':40,'x':0,'y':0})
        result=self.bridge.work_island_layout(True,'normal','home',False)
        self.assertEqual(window.bounds,{'width':336,'height':148,'x':232,'y':46});self.assertFalse(result['native_clip']);self.assertEqual(self.capture_calls,[])
    def test_invalid_island_geometry_cannot_change_native_window(self):
        self.bridge.start_work()
        with self.assertRaises(ValueError):self.bridge.work_island_layout(True,'arbitrary','home')
        with self.assertRaises(ValueError):self.bridge.work_island_layout('yes','normal','home')
    def test_geometry_respects_small_and_offset_screens(self):
        for width,height,x,y in [(320,240,0,0),(1366,768,0,0),(1920,1080,-1920,40),(3840,2160,1920,-80)]:
            screen=SimpleNamespace(width=width,height=height,x=x,y=y)
            for size in ('compact','normal','large'):
                for expanded in (False,True):
                    for panel in ('home','voice','tasks','settings','music','music-player','music-library','music-lyrics','music-devices'):
                        value=geometry(screen,expanded,size,panel)
                        self.assertEqual(value['y'],y);self.assertGreaterEqual(value['x'],x);self.assertLessEqual(value['x']+value['width'],x+width);self.assertLessEqual(value['height'],height)
    def test_pointer_proximity_has_a_tolerant_margin_without_exposing_coordinates(self):
        screen=SimpleNamespace(width=800,height=600,x=0,y=0,scale=1)
        self.assertEqual(pointer_presence(screen,336,48,400,20),{'inside':True,'near':True})
        self.assertEqual(pointer_presence(screen,336,48,578,54),{'inside':False,'near':True})
        self.assertEqual(pointer_presence(screen,336,48,610,80),{'inside':False,'near':False})
        self.assertEqual(set(pointer_presence(screen,336,48,400,20)),{'inside','near'})
    def test_native_transparency_is_bounded_and_never_enables_capture(self):
        self.bridge.start_work();result=self.bridge.work_island_opacity(0);self.assertEqual(result['transparency'],0)
        for invalid in (-1,18,28,41,True,'28'):
            with self.assertRaises(ValueError):self.bridge.work_island_opacity(invalid)
        self.assertEqual(self.capture_calls,[])
    def test_chat_moves_below_wave_while_live_and_returns_when_stopped(self):
        self.bridge.start_work();self.load_windows();self.bridge.work_island_layout(True,'normal','chat',False)
        self.assertEqual(self.bridge._island_host.value['y'],46)
        self.bridge.workspace_chat_publish({'messages':[],'listening':True})
        self.assertEqual(self.bridge._island_host.value['y'],118)
        self.bridge.workspace_chat_publish({'messages':[],'listening':False})
        self.assertEqual(self.bridge._island_host.value['y'],46)
        self.assertEqual(self.capture_calls,[])
    def test_pointer_anchored_panels_stay_inside_screen_at_both_edges(self):
        for sw in (320,800,1920):
            screen=SimpleNamespace(width=sw,height=600,x=-1920,y=0)
            for anchor in (0,sw/2,sw):
                v=geometry(screen,True,panel='music-player',docked=True,anchor_x=anchor)
                self.assertGreaterEqual(v['host_x'],-1920);self.assertLessEqual(v['host_x']+v['host_width'],-1920+sw)
                self.assertGreaterEqual(v['x'],-1920+8);self.assertLessEqual(v['x']+v['width'],-1920+sw-8)
                self.assertEqual(v['host_x']+v['clip_left'],v['x'])
        self.bridge.start_work();self.load_windows()
        right=self.bridge.work_island_layout(True,'normal','music',False,False,790)
        left=self.bridge.work_island_layout(True,'normal','screen',False,False,10)
        self.assertGreater(right['x'],left['x']);self.assertEqual(right['transparency'],0)
    def test_closed_selector_resets_presentation_before_reopen(self):
        self.bridge.start_work();self.load_windows();host=self.bridge._island_host
        for _ in range(3):
            self.bridge.work_island_layout(True,'normal','melodi',True)
            self.assertTrue(host._visible);self.assertFalse(self.windows[0][0].hidden)
            self.bridge.work_island_layout(False,'normal','melodi',False)
            self.assertFalse(host._visible);self.assertTrue(self.windows[0][0].hidden)
        self.assertEqual(self.capture_calls,[])
    def test_switching_to_selector_retires_previous_content_before_native_show(self):
        self.bridge.start_work();self.load_windows();self.bridge.work_island_layout(True,'normal','music-player',False)
        panel=self.windows[0][0];observed=[];original=panel.evaluate_js
        def record(source):
            if 'receiveLayout' in source:observed.append(panel.hidden)
            return original(source)
        panel.evaluate_js=record;self.bridge.work_island_layout(True,'normal','melodi',True)
        self.assertEqual(observed,[True]);self.assertFalse(panel.hidden)
    def test_connected_music_resolves_full_player_before_show_without_api_reads(self):
        self.bridge.start_work();self.load_windows()
        self.bridge._spotify_factory=lambda:SimpleNamespace(status=lambda:{'connected':True,'configured':True})
        state=self.bridge.work_island_layout(True,'normal','music',True)
        self.assertEqual((state['panel'],state['width'],state['height']),('music-player',720,232))
        self.assertTrue(state['music_status']['connected']);self.assertFalse(self.windows[0][0].hidden)
        self.bridge.work_island_layout(False,'normal','music-player',False)
        library=self.bridge.work_island_layout(True,'normal','music-library',True)
        self.assertEqual((library['width'],library['height']),(720,404))
    def test_invalid_anchor_and_module_are_rejected(self):
        self.bridge.start_work()
        for anchor in (-1,801,float('nan'),True,'10'):
            with self.assertRaises(ValueError):self.bridge.work_island_layout(True,anchor_x=anchor)
        with self.assertRaises(ValueError):self.bridge.workspace_open_module('https://example.com')
        self.bridge.workspace_open_module('/spaces');self.assertFalse(self.main.hidden)
        self.assertTrue(any('BrivanyNavigate' in s for s in self.main.scripts))
    def test_gaze_follows_from_current_roaming_eye_position(self):
        self.bridge.start_work();host=self.bridge._island_host
        with patch.object(host,'_pointer',return_value=(600,20)):
            self.assertGreater(self.bridge.work_island_gaze(400)['x'],0)
            self.assertLess(self.bridge.work_island_gaze(700)['x'],0)
        with self.assertRaises(ValueError):self.bridge.work_island_gaze(float('nan'))
    def test_docked_pointer_crosses_bar_and_panel_without_leaving_the_hover_area(self):
        self.bridge.start_work();host=self.bridge._island_host;host.layout(True,animate=False)
        for point in ((10,20),(400,44),(400,140),(400,205)):
            with patch.object(host,'_pointer',return_value=point):self.assertTrue(host.pointer()['near'])
        with patch.object(host,'_pointer',return_value=(10,180)):self.assertFalse(host.pointer()['near'])


if __name__=='__main__':unittest.main()
