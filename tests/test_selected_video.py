"""Selected element, silent transcription and WorkSpace input: local substitutes."""
import base64
import hashlib
import json
from pathlib import Path
import queue
import threading
import time
import unittest
from unittest.mock import patch
from services.work.selected_video import SelectedVideo,SelectedVideoHub,SelectedVideoCoordinator
from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN
from services.work.sync_relay import SyncRelay
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed,InvalidStatus


class Socket:
    def __init__(self):self.sent=[];self.closed=False
    def send(self,data):self.sent.append(json.loads(data) if isinstance(data,str) else data)
    def close(self):self.closed=True


class SelectedVideoTests(unittest.TestCase):
    def selected(self,captions=True,connector=None,translate=False):
        socket=Socket();options={'type':'select','selection':'owned-selection-1','source':'youtube:abcdefghijk','has_captions':captions}
        if translate:options['translate']=True
        value=SelectedVideo(socket,options,**({'connector':connector} if connector else {}));self.addCleanup(value.close);return value
    def wait(self,predicate):
        until=time.monotonic()+2
        while not predicate() and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(predicate())
    def test_public_manifest_identity_is_stable_and_native_bootstrap_rejects_other_origins(self):
        manifest=json.loads(Path('browser-extension/manifest.json').read_text(encoding='utf-8'));key=base64.b64decode(manifest['key'])
        ident=''.join(chr(97+int(n,16)) for n in hashlib.sha256(key).hexdigest()[:32]);self.assertEqual(BRIVANY_EXTENSION_ORIGIN,'chrome-extension://'+ident)
        relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN).start();self.addCleanup(relay.close)
        for origin in ['https://www.youtube.com','chrome-extension://'+'a'*32]:
            with self.assertRaises(InvalidStatus):connect(f'ws://127.0.0.1:{relay.port}/connect',origin=origin,proxy=None)
        with connect(f'ws://127.0.0.1:{relay.port}/connect',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'connect','protocol':1}));grant=json.loads(ws.recv(timeout=2));self.assertEqual(grant['type'],'connected')
        self.assertTrue(relay.authorized(grant['token'],BRIVANY_EXTENSION_ORIGIN));self.assertFalse(relay.authorized(grant['token'],'https://www.youtube.com'))
        relay.revoke_all();self.assertFalse(relay.authorized(grant['token'],BRIVANY_EXTENSION_ORIGIN))
        with self.assertRaises(InvalidStatus):connect(f'ws://127.0.0.1:{relay.port}/connect',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None)
    def test_existing_captions_are_kept_in_memory_without_asr_or_audio_output(self):
        video=self.selected(connector=lambda *_a,**_k:self.fail('captions must not open ASR'))
        video.captions({'type':'captions','cues':[{'start':0,'end':2,'text':'Owned caption.','speaker':'Caption hint'}],'done':True});video.accept(bytes(3840))
        self.assertEqual(video.status()['state'],'ready');self.assertEqual(video.status()['asr_calls'],0)
        self.assertNotIn('captions',video.status());self.assertEqual(video.snapshot()['captions'][0]['speaker'],'Caption hint')
        video.close();self.assertEqual(video.snapshot()['captions'],[])
    def test_real_local_video_protocol_prepares_captions_and_disconnect_erases_session(self):
        hub=SelectedVideoHub(connector=lambda *_a,**_k:self.fail('no ASR for subtitle source'))
        relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub).start();self.addCleanup(relay.close)
        grant=relay.connect_extension(BRIVANY_EXTENSION_ORIGIN)
        with connect(f'ws://127.0.0.1:{relay.port}/video',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'authenticate','token':grant['token']}));self.assertEqual(json.loads(ws.recv(timeout=2))['type'],'authenticated')
            ws.send(json.dumps({'type':'select','selection':'owned-selection-1','source':'youtube:abcdefghijk','has_captions':True}));self.assertEqual(json.loads(ws.recv(timeout=2))['type'],'selected')
            ws.send(json.dumps({'type':'captions','cues':[{'start':5,'end':7,'text':'Owned future sentence.','speaker':None}],'done':True}));self.assertEqual(json.loads(ws.recv(timeout=2))['type'],'caption-ack')
            ws.send(json.dumps({'type':'position','position':4}));ws.send(bytes(3840));self.wait(lambda:hub.selected() and hub.selected().frames==1920)
            self.assertEqual(hub.selected().lookahead()['cues'][0]['text'],'Owned future sentence.')
            self.assertNotIn('captions',relay.status()['selected_video']);ws.send(json.dumps({'type':'stop'}))
        self.wait(lambda:hub.selected() is None)

    def test_native_ack_window_survives_a_reader_stall_without_false_acceleration(self):
        hub=SelectedVideoHub(on_translate=lambda _selected:time.sleep(.65))
        relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub).start();self.addCleanup(relay.close)
        grant=relay.connect_extension(BRIVANY_EXTENSION_ORIGIN)
        self.assertEqual(grant['selected_video_protocol'],2);self.assertTrue(grant['progressive_translation_available'])
        with connect(f'ws://127.0.0.1:{relay.port}/video',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'authenticate','token':grant['token']}));self.assertEqual(json.loads(ws.recv(timeout=2))['type'],'authenticated')
            ws.send(json.dumps({'type':'select','selection':'owned-reader-stall','source':'youtube:abcdefghijk','has_captions':True,'translate':True,'audio_ack':True}));self.assertEqual(json.loads(ws.recv(timeout=2))['type'],'selected')
            self.assertEqual(json.loads(ws.recv(timeout=2)),{'type':'preferences','show_transcript':True})
            # Exactly the four frames the extension may have unacknowledged.
            for index in range(4):ws.send(bytes(3840));time.sleep(.08)
            for index in range(4):self.assertEqual(json.loads(ws.recv(timeout=2)),{'type':'audio-ack','sequence':index})
            for index in range(4,14):
                time.sleep(.08);ws.send(bytes(3840));self.assertEqual(json.loads(ws.recv(timeout=2)),{'type':'audio-ack','sequence':index})
            self.assertEqual(hub.selected().frames,14*1920);self.assertIsNone(relay.status()['last_failure'])
            ws.send(json.dumps({'type':'stop'}))

    def test_legacy_flood_still_reports_a_safe_specific_error(self):
        hub=SelectedVideoHub();relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub).start();self.addCleanup(relay.close)
        grant=relay.connect_extension(BRIVANY_EXTENSION_ORIGIN)
        with connect(f'ws://127.0.0.1:{relay.port}/video',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'authenticate','token':grant['token']}));ws.recv(timeout=2)
            ws.send(json.dumps({'type':'select','selection':'owned-real-flood','source':'video:1234','has_captions':True}));ws.recv(timeout=2)
            for _ in range(7):
                try:ws.send(bytes(3840))
                except ConnectionClosed:break  # The relay can reject before the sender finishes.
            events=[]
            while True:
                event=json.loads(ws.recv(timeout=2));events.append(event)
                if event['type']=='error':break
            self.assertEqual(event['code'],'video_input');self.assertIn('demasiado rápido',event['message'])
            self.assertLessEqual(sum(e['type']=='audio-ack' for e in events),5)
        self.assertEqual(relay.status()['last_failure'],{'stage':'selected-video','code':'video_input','exception_type':'SelectedVideoError'})

    def test_ack_protocol_paces_consecutive_bursts_without_cancelling(self):
        hub=SelectedVideoHub();relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub).start();self.addCleanup(relay.close)
        grant=relay.connect_extension(BRIVANY_EXTENSION_ORIGIN)
        with connect(f'ws://127.0.0.1:{relay.port}/video',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'authenticate','token':grant['token']}));ws.recv(timeout=2)
            ws.send(json.dumps({'type':'select','selection':'owned-batched-input','source':'video:1234','has_captions':True,'audio_ack':True}));ws.recv(timeout=2);ws.recv(timeout=2)
            start=time.monotonic()
            for first in range(0,12,4):
                for _ in range(4):ws.send(bytes(3840))
                for index in range(first,first+4):self.assertEqual(json.loads(ws.recv(timeout=2)),{'type':'audio-ack','sequence':index})
            self.assertGreaterEqual(time.monotonic()-start,.48)
            self.assertEqual(hub.selected().frames,12*1920)
            self.assertIsNone(relay.status()['last_failure'])

    def test_slow_audio_preparation_has_a_distinct_error_without_provider_or_private_input(self):
        hub=SelectedVideoHub();relay=SyncRelay(port=0,automatic_origin=BRIVANY_EXTENSION_ORIGIN,video_hub=hub).start();self.addCleanup(relay.close)
        grant=relay.connect_extension(BRIVANY_EXTENSION_ORIGIN)
        with patch('services.work.selected_video.SELECTION_SETUP_TIMEOUT',.05),connect(f'ws://127.0.0.1:{relay.port}/video',origin=BRIVANY_EXTENSION_ORIGIN,proxy=None) as ws:
            ws.send(json.dumps({'type':'authenticate','token':grant['token']}));ws.recv(timeout=2)
            error=json.loads(ws.recv(timeout=2));self.assertEqual(error['code'],'video_input');self.assertIn('preparar el audio',error['message'])
        self.assertNotIn(grant['token'],json.dumps(relay.status()))
    def test_caption_lookahead_is_limited_to_imminent_source_and_pause_stops_speculation(self):
        video=self.selected();video.captions({'type':'captions','cues':[{'start':0,'end':2,'text':'Past.','speaker':None},{'start':6,'end':8,'text':'Next.','speaker':None},{'start':40,'end':42,'text':'Later.','speaker':None}],'done':True});video.set_position(4)
        self.assertEqual([c['text'] for c in video.lookahead()['cues']],['Next.']);video.set_paused(True);self.assertIsNone(video.lookahead());video.set_paused(False);self.assertIsNotNone(video.lookahead())
    def test_failed_asr_does_not_retry_on_each_new_packet(self):
        attempts=[]
        def broken(*_a,**_k):attempts.append(1);raise ValueError('synthetic rejection')
        video=self.selected(False,broken);video.accept(bytes(3840));self.wait(video.stopped.is_set)
        for _ in range(4):video.accept(bytes(3840))
        self.assertEqual(len(attempts),1)
    def test_work_translation_receives_only_the_selected_element_and_restores_original_gain(self):
        a=self.selected();b=self.selected();route=b.route();self.addCleanup(route.close);route.reduce_original(.12)
        a.accept(b'\x01\x00'*1920);b.accept(b'\x02\x00'*1920)
        stopped=threading.Event();_,raw=next(route.packets(stopped));self.assertEqual(raw,b'\x02\x00'*1920)
        route.close();self.assertEqual([m['value'] for m in b.socket.sent],[.12,1]);self.assertFalse(b.status()['translation_input'])
        self.assertEqual(a.frames,1920)
    def test_invalid_captions_and_pcm_do_not_pass_the_selected_source_boundary(self):
        video=self.selected()
        for bad in [b'x',bytes(7680),'not PCM']:
            with self.assertRaises(ValueError):video.accept(bad)
        with self.assertRaises(ValueError):video.captions({'type':'captions','cues':[{'start':0,'end':float('nan'),'text':'x','speaker':None}],'done':True})
        self.assertEqual(video.status()['cue_count'],0)
    def test_no_caption_path_uses_diarized_asr_without_mt_tts_and_retains_anonymous_turns(self):
        class Muse(Socket):
            def __init__(self):super().__init__();self.events=queue.Queue();self.events.put(json.dumps({'sessionId':'owned'}))
            def send(self,data):
                super().send(data)
                if isinstance(data,bytes):
                    for event in [{'type':'speechStart','turnId':1,'audioProcessedMs':0},{'type':'speaker','label':'B'},{'type':'speechComplete','turnId':1,'transcript':'Owned source phrase.','audioProcessedMs':80}]:self.events.put(json.dumps(event))
            def recv(self,timeout):
                try:return self.events.get(timeout=timeout)
                except queue.Empty:raise TimeoutError()
        upstream=Muse();video=self.selected(False,lambda *_a,**_k:upstream)
        with patch.dict('os.environ',{'BRIVANY_MUSE_API_KEY':'synthetic-local-key'}):
            video.accept(bytes(3840));self.wait(lambda:video.status()['transcribed_turns']==1)
        self.assertEqual(upstream.sent[0]['mode'],'DIARIZATION');self.assertEqual(video.snapshot()['turns'][0]['speaker'],'B');self.assertEqual(video.status()['asr_calls'],1)
        self.assertFalse(any(isinstance(m,dict) and 'voice' in m for m in upstream.sent))

    def test_simultaneous_mode_buffers_first_audio_and_uses_translation_asr_for_progressive_text(self):
        video=self.selected(False,lambda *_a,**_k:self.fail('must reuse the translation ASR'),translate=True)
        video.accept(b'\x03\x00'*1920);video.accept(b'\x04\x00'*1920)
        route=video.route();self.addCleanup(route.close);packets=route.packets(threading.Event())
        self.assertEqual(next(packets)[1],b'\x03\x00'*1920);self.assertEqual(next(packets)[1],b'\x04\x00'*1920)
        for text,final in [('A partial',False),('A partial sentence.',True),('A partial sentence.',True)]:
            video.observe_translation({'type':'transcript','source':'original','text':text,'final':final,'turn_id':'1','asr_label':'B','at':0})
        video.observe_translation({'type':'transcript','source':'translation','text':'Una frase parcial.','final':True})
        self.assertEqual(len(video.snapshot()['turns']),1);self.assertEqual(video.snapshot()['turns'][0]['speaker'],'B')
        self.assertEqual(video.snapshot()['translation'],'Una frase parcial.');self.assertEqual(video.status()['asr_calls'],0)
        self.assertEqual([e['text'] for e in video.socket.sent if e['type']=='transcript'][:2],['A partial','A partial sentence.'])

    def test_coordinator_replaces_pending_selection_without_starting_stale_sources(self):
        entered=threading.Event();release=threading.Event();calls=[]
        class Owner:
            target='en';voice='auto';active=False
            def close(self):entered.set();release.wait(2);self.active=False
            def start(self,target,voice,*,route_factory):calls.append(route_factory.__self__);self.active=True;return {'active':True}
            def stop(self):self.active=False
            def status(self):return {'active':self.active}
        owner=Owner();coordinator=SelectedVideoCoordinator(lambda:owner);a=self.selected(translate=True);b=self.selected(translate=True)
        self.addCleanup(release.set);coordinator.request(a);self.assertTrue(entered.wait(1));coordinator.request(b);a.close();release.set();self.wait(lambda:calls==[b]);coordinator.request(b);time.sleep(.02);self.assertEqual(calls,[b]);coordinator.stop(b);self.assertFalse(owner.active)

    def test_progressive_audio_plays_before_video_ends_with_one_asr_session(self):
        from services.work.live_translation import WorkLiveTranslation
        from packages.providers.river_translation import RiverBridge
        from tests.test_river_translation import PipelineTests
        fixture=PipelineTests('test_invalid_pcm_stops_session_before_translation');fixture.setUp();self.addCleanup(fixture.tearDown)
        fixture.expect_diarization=True
        video=self.selected(False,lambda *_a,**_k:self.fail('a duplicate ASR must not be opened'),translate=True)
        def build(port,**options):return RiverBridge(port,**options,content_filter_factory=lambda:type('Filter',(),{'classify':lambda _self,_pcm:{'skip':False,'kind':'speech','latency_ms':0}})())
        owner=WorkLiveTranslation(bridge_factory=build,output_factory=lambda **_kw:fixture.mixer_factory(),configuration=lambda:{'configured':True,'access_blocked':False});owner.target='fr';self.addCleanup(owner.close)
        coordinator=SelectedVideoCoordinator(lambda:owner);coordinator.request(video)
        stop=threading.Event()
        def feed():
            start=time.monotonic()
            for index in range(40):
                if stop.wait(max(0,start+index*.08-time.monotonic())):return
                video.accept(fixture.pcm*2)
        feeder=threading.Thread(target=feed,daemon=True);self.addCleanup(stop.set);feeder.start()
        self.assertTrue(fixture.audio_seen.wait(3),'first translation must not wait for end-of-video')
        self.assertTrue(feeder.is_alive());self.assertTrue(video.snapshot()['partial']);self.assertTrue(video.snapshot()['translation'])
        self.assertEqual(fixture.counts['muse'],1);self.assertEqual(video.status()['asr_calls'],0);self.assertIsNone(video.worker)
        self.assertTrue(any(e['type']=='transcript' and e['source']=='original' for e in video.socket.sent));self.assertTrue(any(e['type']=='original-gain' and e['value']==.12 for e in video.socket.sent))
        stop.set();feeder.join(timeout=1);coordinator.stop(video)

    def test_continuous_native_input_survives_slow_asr_sends_without_overflow_or_missing_frames(self):
        from services.work.live_translation import WorkLiveTranslation
        from packages.providers import river_translation as river
        from tests.test_river_translation import PipelineTests
        fixture=PipelineTests('test_invalid_pcm_stops_session_before_translation');fixture.setUp();self.addCleanup(fixture.tearDown);fixture.expect_diarization=True
        sent=[];closed=threading.Event();real_connect=river.connect
        class SlowedASR:
            def __init__(self,socket):self.socket=socket
            def __getattr__(self,name):return getattr(self.socket,name)
            def send(self,raw):
                if isinstance(raw,bytes):
                    if len(sent) in (0,160,320):closed.wait(.75)
                    sent.append(raw)
                return self.socket.send(raw)
            def close(self):closed.set();return self.socket.close()
        def connect(*args,**kwargs):
            socket=real_connect(*args,**kwargs)
            return SlowedASR(socket) if args[0]==river.MUSE_URL else socket
        self.enterContext(patch.object(river,'connect',connect))
        video=self.selected(False,lambda *_a,**_k:self.fail('duplicate ASR'),translate=True)
        def build(port,**options):return river.RiverBridge(port,**options,content_filter_factory=lambda:type('Filter',(),{'classify':lambda _self,_pcm:{'skip':False,'kind':'speech','latency_ms':0}})())
        owner=WorkLiveTranslation(bridge_factory=build,output_factory=lambda **_kw:fixture.mixer_factory(),configuration=lambda:{'configured':True,'access_blocked':False});owner.target='fr';self.addCleanup(owner.close)
        coordinator=SelectedVideoCoordinator(lambda:owner);coordinator.request(video);stop=threading.Event();self.addCleanup(stop.set);frames=420
        def feed():
            started=time.monotonic()
            for index in range(frames):
                if stop.wait(max(0,started+index*.08-time.monotonic())):return
                video.accept(fixture.pcm*2)
        feeder=threading.Thread(target=feed,daemon=True);feeder.start();deadline=time.monotonic()+40
        while len(sent)<frames and time.monotonic()<deadline:
            self.assertNotEqual(owner.status()['state'],'error',owner.status().get('error'));time.sleep(.03)
        self.assertEqual(len(sent),frames);self.assertTrue(fixture.audio_seen.is_set());self.assertEqual(fixture.counts['muse'],1)
        self.assertTrue(all(raw==fixture.pcm*2 for raw in sent));self.assertGreater(owner.input_waits,0)
        started=time.monotonic();coordinator.stop(video);self.assertLess(time.monotonic()-started,.15);stop.set();feeder.join(timeout=1)
