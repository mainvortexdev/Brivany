"""Desktop mode ownership and revocation; no browser, device or providers."""
import unittest
import threading
import time
import tempfile
from pathlib import Path
from desktop.experience.work_translation import WorkTranslationBridge


class Relay:
    def __init__(self):self.mode='synchronized';self.active=0;self.revoked=False;self.closed=False;self.connections=[]
    def start(self):return self
    def status(self):return {'available':not self.closed,'active_sessions':self.active,'paired_browsers':0 if self.revoked else 1,'preferred_mode':self.mode}
    def set_mode(self,mode):
        if self.active:raise ValueError('busy')
        self.mode=mode
    def issue_pairing(self):return {'code':'123456','pair_link':'ws://127.0.0.1:1/pair#123456','expires_in':120}
    def revoke_all(self):self.revoked=True
    def close(self):self.closed=True


class Bridge(WorkTranslationBridge):
    def __init__(self):self.checked=0;self.events=[];self.relay=Relay();self._sync_translation_factory=lambda:self.relay;self._work_translation=None
    def _trusted(self):self.checked+=1
    def _publish_audio_translation(self,event):self.events.append(event)


class SyncDesktopTests(unittest.TestCase):
    def test_direct_start_uses_capture_without_creating_or_requesting_extension(self):
        from types import SimpleNamespace
        bridge=Bridge();calls=[]
        bridge._window=SimpleNamespace(evaluate_js=lambda script:None)
        bridge._auditory_mode='synchronized';bridge._browser_translation_pending_until=time.monotonic()+30
        class Owner:
            def start(self,target,voice):
                calls.append((target,voice));return {'active':True,'state':'starting'}
        bridge._work_translation=Owner()
        bridge._sync_translation_factory=lambda:self.fail('Direct translation must not create an extension relay')
        value=bridge.work_audio_translation_start('es','masculine')
        self.assertEqual(calls,[('es','masculine')])
        self.assertEqual(value,{'active':True,'state':'starting','mode':'direct'})
        self.assertEqual(bridge._browser_translation_pending_until,0)
        self.assertEqual(bridge._auditory_mode,'direct')
        self.assertFalse(hasattr(bridge,'_sync_translation_relay'))
        self.assertEqual(bridge.events,[value])
    def test_workspace_requests_browser_selection_before_opening_any_capture(self):
        from types import SimpleNamespace
        bridge=Bridge();calls=[]
        class Owner:
            def status(self):return {'active':False,'state':'idle'}
            def set_target(self,target):calls.append(('target',target))
            def set_voice(self,voice):calls.append(('voice',voice))
        bridge._work_translation=Owner();bridge.relay.request_video=lambda:calls.append('select-active-video')
        value=bridge.work_browser_translation_start('en','auto');self.assertTrue(value['awaiting_browser']);self.assertEqual(value['state'],'selecting');self.assertEqual(calls,[('target','en'),('voice','auto'),'select-active-video'])
    def test_direct_capture_cannot_overlap_an_active_browser_translation(self):
        bridge=Bridge();bridge._sync_translation_relay=bridge.relay;bridge.relay.active=1
        bridge._work_translation_factory=lambda:self.fail('Active browser audio must not be recaptured')
        with self.assertRaisesRegex(ValueError,'Detén la traducción del navegador'):
            bridge.work_audio_translation_start('es','auto')
        self.assertFalse(hasattr(bridge,'_auditory_mode'))
        self.assertEqual(bridge.events,[])
    def test_stopping_inline_video_keeps_workspace_control_and_sends_an_intentional_close(self):
        bridge=Bridge();relay=bridge._sync_translation();relay.lock=threading.RLock();closed=[]
        class Socket:
            def __init__(self,name):self.name=name
            def close(self,**details):closed.append((self.name,details))
        video=Socket('video');relay.inline_video_clients={video};relay.connections={video,Socket('workspace')}
        bridge._browser_translation_pending_until=time.monotonic()+30
        bridge.work_sync_translation_stop()
        self.assertEqual(closed,[('video',{'code':1000,'reason':'workspace-stop'})])
        self.assertEqual(bridge._browser_translation_pending_until,0)
    def test_real_workspace_control_connection_is_authenticated_and_carries_only_fixed_intent(self):
        import json
        from websockets.sync.client import connect
        from services.work.sync_relay import SyncRelay
        from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN as origin
        relay=SyncRelay(port=0,automatic_origin=origin).start();self.addCleanup(relay.close);grant=relay.connect_extension(origin)
        with connect(f'ws://127.0.0.1:{relay.port}/workspace',origin=origin,proxy=None) as socket:
            socket.send(json.dumps({'type': 'authenticate', 'token': grant['token']}))
            self.assertEqual(json.loads(socket.recv(timeout=2)), {'type': 'authenticated', 'client_info_protocol': 1})
            socket.send(json.dumps({'type': 'ping'}))
            self.assertEqual(json.loads(socket.recv(timeout=2)), {'type': 'pong'})
            self.assertIsNone(relay.status()['workspace_client_info'])
            client_info = {'manifest_version': '0.4.8', 'worker_build': '0.4.8-prefix-nav-066'}
            socket.send(json.dumps({'type': 'client-info', **client_info}))
            socket.send(json.dumps({'type': 'ping'}))
            self.assertEqual(json.loads(socket.recv(timeout=2)), {'type': 'pong'})
            self.assertEqual(relay.status()['workspace_client_info'], client_info)
            results=[];worker=threading.Thread(target=lambda:results.append(relay.request_video()));worker.start();command=json.loads(socket.recv(timeout=2));self.assertEqual(set(command),{'type','request_id','expires_at_ms'});self.assertEqual(command['type'],'select-active-video')
            socket.send(json.dumps({'type':'selection-result','request_id':command['request_id'],'ok':True,'reason':''}));worker.join(1);self.assertEqual(results,[{'requested':True}]);self.assertIsNone(relay.workspace_request)
            socket.send(json.dumps({'type':'ping'}));self.assertEqual(json.loads(socket.recv(timeout=2)),{'type':'pong'});self.assertNotIn(grant['token'],json.dumps(relay.status()))
            socket.send(json.dumps({'type': 'client-info', **client_info, 'url': 'https://example.com/'}))
            self.assertEqual(json.loads(socket.recv(timeout=2))['type'], 'error')
        deadline = time.monotonic() + 1
        while relay.status()['workspace_connected'] and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertIsNone(relay.status()['workspace_client_info'])
    def test_transcription_display_defaults_on_and_persists_without_transcript_data(self):
        from services.work.translation_preferences import TranslationPreferences
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'translation-ui.json';store=TranslationPreferences(path)
            self.assertEqual(store.status(),{'show_transcript':True});self.assertFalse(path.exists())
            bridge=Bridge();bridge._translation_preferences_store=store;events=[]
            class Hub:
                def publish_preferences(self):events.append(store.status())
            bridge._selected_video_hub=Hub()
            self.assertEqual(bridge.work_translation_preferences(False),{'show_transcript':False});self.assertEqual(events,[{'show_transcript':False}])
            self.assertEqual(TranslationPreferences(path).status(),{'show_transcript':False})
            self.assertEqual(path.read_text(encoding='utf-8'),'{'+'"show_transcript": false}')
            for invalid in ('false',0,[]):
                with self.assertRaises(ValueError):store.configure(invalid)
            self.assertGreater(bridge.checked,0)
    def test_display_preferences_are_delivered_to_the_active_video_without_stopping_it(self):
        from services.work.selected_video import SelectedVideoHub,SelectedVideo
        events=[];visible={'show_transcript':True}
        class Socket:
            def send(self,raw):events.append(__import__('json').loads(raw))
        hub=SelectedVideoHub(preferences=lambda:visible.copy());video=SelectedVideo(Socket(),{'type':'select','selection':'owned-preferences','source':'video:1','has_captions':True,'translate':True,'audio_ack':True});hub.current=video
        hub.publish_preferences();visible['show_transcript']=False;hub.publish_preferences();visible['show_transcript']=True;hub.publish_preferences()
        self.assertEqual([e['show_transcript'] for e in events],[True,False,True]);self.assertFalse(video.stopped.is_set());video.close()
    def test_overlapping_desktop_calls_create_one_relay(self):
        bridge=Bridge();calls=[];barrier=threading.Barrier(3);results=[]
        def factory():calls.append('created');time.sleep(.03);return bridge.relay
        bridge._sync_translation_factory=factory
        def open_relay():barrier.wait();results.append(bridge._sync_translation())
        workers=[threading.Thread(target=open_relay) for _ in range(2)]
        for worker in workers:worker.start()
        barrier.wait()
        for worker in workers:worker.join(timeout=1)
        self.assertEqual(calls,['created']);self.assertEqual(results,[bridge.relay,bridge.relay])
    def test_pairing_is_lazy_and_mode_publishes_to_both_owned_views(self):
        bridge=Bridge();self.assertFalse(bridge.work_sync_translation_status()['available']);self.assertFalse(hasattr(bridge,'_sync_translation_relay'))
        bridge.work_audio_translation_mode('preproduction');self.assertIs(bridge._sync_translation_relay,bridge.relay);self.assertEqual(bridge.relay.mode,'preproduction');self.assertEqual(bridge.events,[{'mode':'preproduction'}])
        self.assertEqual(bridge.work_sync_translation_pair()['expires_in'],120);self.assertGreater(bridge.checked,0)
    def test_invalid_modes_and_active_session_cannot_change_mode(self):
        bridge=Bridge()
        with self.assertRaises(ValueError):bridge.work_audio_translation_mode('arbitrary')
        self.assertFalse(hasattr(bridge,'_sync_translation_relay'));bridge.work_sync_translation_prepare();bridge.relay.active=1
        with self.assertRaises(ValueError):bridge.work_audio_translation_mode('direct')
        self.assertEqual(bridge.events,[])
    def test_preparing_browser_stops_direct_capture_and_resets_internal_ducking(self):
        bridge=Bridge();calls=[]
        class Capture:
            def close(self):calls.append('capture_closed')
        class Ducking:
            def set_internal(self,key,value):calls.append((key,value))
        bridge._work_translation=Capture();bridge._audio_ducker=Ducking();bridge.work_sync_translation_prepare('preproduction')
        self.assertEqual(calls,['capture_closed',('work-translation',False)])
    def test_revocation_and_shutdown_keep_capabilities_out_of_status(self):
        bridge=Bridge();bridge.work_sync_translation_pair();state=bridge.work_sync_translation_revoke();self.assertEqual(state['paired_browsers'],0);self.assertNotIn('code',state);self.assertNotIn('token',state)
        bridge._close_sync_translation();self.assertTrue(bridge.relay.closed)

if __name__=='__main__':unittest.main()
