"""Actual loopback WS relay, synthetic PCM and substituted native output only."""
import base64
import json
import math
import os
import threading
import time
import unittest
from unittest.mock import patch

from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed

from packages.providers.palabra import PalabraBridge
from packages.providers import palabra
from packages.providers.native_audio import NativeAudioError
from tests.test_palabra import acknowledge

OPTIONS={'type':'start','consent':True,'source_language':'en','target_language':'es','max_seconds':5,
    'audio_output':'local_device','quality_mode':'contextual_live','original_gain':.12,'translation_gain':.85}
PCM=b'\x20\x01'*1920


class FakeNative:
    def __init__(self,*,close_failure=False,drain=True):
        self.original=[];self.translation=[];self.levels=[];self.events=[];self.closed=threading.Event();self.close_failure=close_failure;self.drain=drain
    def set_levels(self,**values):
        if any(type(value) not in {int,float} or not math.isfinite(value) or not 0<=value<=1 for value in values.values()):
            raise NativeAudioError('native_audio_volume','El volumen debe estar entre cero y uno.')
        self.levels.append(values);self.events.append('levels')
    def check_error(self):pass
    def push_original(self,raw):self.original.append(raw);self.events.append('original')
    def push_translation(self,raw):self.translation.append(raw);self.events.append('translation')
    def flush_translation(self):self.events.append('flush_translation')
    def finish(self,timeout):self.events.append('finish');return self.drain
    def close(self):
        self.events.append('close');self.closed.set()
        if self.close_failure:raise NativeAudioError('native_audio_close','No se pudo cerrar completamente la salida local de audio.')


class PalabraNativeTests(unittest.TestCase):
    def test_small_provider_packets_are_coalesced_without_padding_or_lost_pcm(self):
        native=FakeNative();parts=[bytes([value,0])*120 for value in range(1,33)]
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:
                if json.loads(raw)['message_type']=='input_audio_data':
                    for index,part in enumerate(parts):ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(part).decode(),'transcription_id':'tiny-packets','language':'es','last_chunk':index==len(parts)-1}}))
                    break
            for _ in ws:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                for _ in range(4):browser.send(PCM)
                events=self.read_until(browser,'audio-playback')
                self.assertEqual(native.translation,[b''.join(parts)])
                self.assertEqual(events[-1]['duration_ms'],160)
                browser.send(json.dumps({'type':'cancel'}))
        self.relay(upstream,body,factory=lambda:native)

    def test_stop_and_tab_close_cut_output_before_slow_provider_disconnect(self):
        original_connect=palabra.connect
        for explicit_cancel in (True,False):
            with self.subTest(explicit_cancel=explicit_cancel):
                native=FakeNative();closing=threading.Event();release=threading.Event()
                class SlowClose:
                    def __init__(self,connection):self.connection=connection
                    def __getattr__(self,name):return getattr(self.connection,name)
                    def close(self):closing.set();release.wait(2);self.connection.close()
                def upstream(ws):
                    acknowledge(ws)
                    for _ in ws:pass
                def body(bridge):
                    browser=self.browser(bridge)
                    try:
                        browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                        if explicit_cancel:browser.send(json.dumps({'type':'cancel'}))
                        else:browser.close()
                        self.assertTrue(native.closed.wait(.3),'Output must stop before the network close completes')
                        self.assertTrue(closing.wait(.3));self.assertNotIn('finish',native.events)
                    finally:release.set();browser.close()
                with patch('packages.providers.palabra.connect',side_effect=lambda *args,**kwargs:SlowClose(original_connect(*args,**kwargs))):
                    self.relay(upstream,body,factory=lambda:native)

    def test_slow_provider_write_does_not_stall_original_capture_and_finish_preserves_fifo(self):
        native=FakeNative();entered=threading.Event();release=threading.Event();forwarded=bytearray()
        connect_real=palabra.connect
        class SlowSend:
            def __init__(self,connection):self.connection=connection;self.delayed=False
            def __getattr__(self,name):return getattr(self.connection,name)
            def send(self,raw):
                if json.loads(raw).get('message_type')=='input_audio_data' and not self.delayed:
                    self.delayed=True;entered.set();release.wait(3)
                return self.connection.send(raw)
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:
                event=json.loads(raw)
                if event['message_type']=='input_audio_data':forwarded.extend(base64.b64decode(event['data']['data']))
                if event['message_type']=='end_task':ws.send(json.dumps({'message_type':'end_of_stream','data':{}}));return
        def body(bridge):
            try:
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))['type'],'ready')
                    for _ in range(20):browser.send(PCM[:1920]);time.sleep(.04)
                    self.assertTrue(entered.is_set())
                    deadline=time.monotonic()+.4
                    while len(native.original)<20 and time.monotonic()<deadline:time.sleep(.01)
                    self.assertEqual(len(native.original),20,'A provider TLS write must not stop the local capture reader')
                    browser.send(json.dumps({'type':'finish'}));release.set();self.read_until(browser,'done')
                    self.assertEqual(bytes(forwarded),PCM[:1920]*20)
            finally:release.set()
        with patch('packages.providers.palabra.connect',side_effect=lambda *args,**kwargs:SlowSend(connect_real(*args,**kwargs))):
            self.relay(upstream,body,factory=lambda:native)

    def relay(self,upstream,body,*,factory):
        failures=[]
        def checked(ws):
            try:upstream(ws)
            except ConnectionClosed:pass
            except Exception as error:failures.append(error)
        with serve(checked,'127.0.0.1',0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start();endpoint=f'ws://127.0.0.1:{fake.socket.getsockname()[1]}'
            bridge=PalabraBridge(9876).start()
            try:
                with patch.dict(os.environ,{'BRIVANY_PALABRA_API_KEY':'synthetic-native-key'},clear=True),patch('packages.providers.palabra.URL',endpoint),patch('packages.providers.palabra.native_audio.open_native_audio',side_effect=factory):body(bridge)
            finally:bridge.close()
        if failures:raise failures[0]

    def browser(self,bridge):return connect(f'ws://127.0.0.1:{bridge.port}/dub',origin='http://127.0.0.1:9876',proxy=None)

    def read_until(self,browser,kind):
        values=[]
        while True:
            value=json.loads(browser.recv(timeout=3));values.append(value)
            if value['type']==kind:return values

    def test_native_open_failure_happens_before_provider_connection(self):
        connected=[]
        def upstream(ws):connected.append(True)
        def factory():raise NativeAudioError('native_audio_open','No se pudo abrir el altavoz de Windows.')
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));error=json.loads(browser.recv(timeout=2))
                self.assertEqual(error['type'],'error');self.assertEqual(error['code'],'dubbing_audio_output')
            self.assertEqual(connected,[])
        self.relay(upstream,body,factory=factory)

    def test_native_pcm_never_returns_to_captured_browser_and_finish_drains_before_done(self):
        native=FakeNative();received=[]
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:
                event=json.loads(raw);received.append(event['message_type'])
                if event['message_type']=='input_audio_data':
                    ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(PCM).decode(),'language':'es','transcription_id':'native-first','last_chunk':True}}))
                elif event['message_type']=='end_task':
                    ws.send(json.dumps({'message_type':'end_of_stream','data':{}}));return
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));ready=json.loads(browser.recv(timeout=2));self.assertEqual(ready['audio_output'],'local_device')
                self.assertEqual(ready['output_location'],'server_computer');self.assertFalse(ready['physical_playback_verified'])
                browser.send(PCM);browser.send(json.dumps({'type':'finish'}));values=self.read_until(browser,'done')
                self.assertIn('finish',native.events);self.assertEqual(b''.join(native.original),PCM);self.assertEqual(b''.join(native.translation),PCM)
                playback=[value for value in values if value['type']=='audio-playback'];self.assertEqual(sum(value['duration_ms'] for value in playback),len(PCM)/48)
                self.assertTrue(all('audio' not in value and value['epoch']==0 and value['target_language']=='es' for value in playback))
                self.assertFalse(any(value['type']=='audio' for value in values));self.assertNotIn('synthetic-native-key',json.dumps(values))
            self.assertTrue(native.closed.wait(1));self.assertLess(native.events.index('finish'),native.events.index('close'))
        self.relay(upstream,body,factory=lambda:native)

    def test_cancellation_closes_output_without_provider_finish_or_drain(self):
        native=FakeNative();commands=[]
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:commands.append(json.loads(raw)['message_type'])
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))['type'],'ready')
                browser.send(PCM);browser.send(json.dumps({'type':'cancel'}))
                with self.assertRaises(ConnectionClosed):browser.recv(timeout=2)
            self.assertTrue(native.closed.wait(1));self.assertNotIn('finish',native.events);self.assertNotIn('end_task',commands)
        self.relay(upstream,body,factory=lambda:native)

    def test_invalid_start_levels_never_open_device_or_provider(self):
        connected=[];opened=[]
        def upstream(ws):connected.append(True)
        def factory():opened.append(True);return FakeNative()
        def body(bridge):
            for key in ('original_gain','translation_gain'):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps({**OPTIONS,key:1.1}));error=json.loads(browser.recv(timeout=2));self.assertEqual(error['code'],'dubbing_options')
            self.assertEqual(connected,[]);self.assertEqual(opened,[])
        self.relay(upstream,body,factory=factory)

    def test_live_levels_validate_and_invalid_control_stops_native(self):
        native=FakeNative()
        def upstream(ws):
            acknowledge(ws)
            for _ in ws:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))['type'],'ready')
                browser.send(json.dumps({'type':'audio_levels','original_gain':1.,'translation_gain':0.}))
                browser.send(json.dumps({'type':'audio_levels','original_gain':-.1,'translation_gain':1.}))
                error=self.read_until(browser,'error')[-1];self.assertEqual(error['code'],'dubbing_audio_output')
            self.assertTrue(native.closed.wait(1));self.assertEqual(native.levels[-1],{'original':1.,'translation':0.})
        self.relay(upstream,body,factory=lambda:native)

    def test_drain_failure_reports_error_instead_of_done(self):
        native=FakeNative(drain=False)
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:
                if json.loads(raw)['message_type']=='end_task':ws.send(json.dumps({'message_type':'end_of_stream','data':{}}));return
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(json.dumps({'type':'finish'}))
                values=self.read_until(browser,'error');self.assertFalse(any(value['type']=='done' for value in values))
                self.assertEqual(values[-1]['code'],'dubbing_audio_output')
            self.assertTrue(native.closed.wait(1))
        self.relay(upstream,body,factory=lambda:native)

    def test_close_failure_still_releases_exclusive_bridge_lock_and_connections(self):
        natives=[]
        def factory():
            native=FakeNative(close_failure=not natives);natives.append(native);return native
        def upstream(ws):
            acknowledge(ws)
            for _ in ws:pass
        def body(bridge):
            for index in range(2):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))['type'],'ready')
                    browser.send(json.dumps({'type':'cancel'}))
                    with self.assertRaises(ConnectionClosed):browser.recv(timeout=2)
                self.assertTrue(natives[index].closed.wait(1));deadline=time.monotonic()+1
                while bridge.lock.locked() and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(bridge.lock.locked())
            self.assertEqual(len(natives),2)
        self.relay(upstream,body,factory=factory)

    def test_language_switch_flushes_native_queue_before_accepting_new_target(self):
        native=FakeNative();commands=[]
        def upstream(ws):
            acknowledge(ws)
            for raw in ws:
                event=json.loads(raw);commands.append(event['message_type'])
                if event['message_type']=='interrupt_task':
                    ws.send(json.dumps({'message_type':'task_status','data':{'command':'interrupt_task','event':'interrupted','task_status':'running'}}))
                elif event['message_type']=='set_task':
                    self.assertEqual(event['data']['pipeline']['translations'][0]['target_language'],'fr')
                    ws.send(json.dumps({'message_type':'task_status','data':{'command':'set_task','event':'updated','task_status':'running'}}))
                    for lang,id_ in [('es','old'),('fr','fresh')]:ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(PCM).decode(),'language':lang,'transcription_id':id_}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(json.dumps({'type':'switch_language','target_language':'fr'}))
                values=self.read_until(browser,'audio-playback');changed=next(value for value in values if value['type']=='language-changed')
                self.assertEqual(changed['target_language'],'fr');self.assertEqual(changed['epoch'],1)
                self.assertEqual(native.events.count('flush_translation'),1);self.assertLess(native.events.index('flush_translation'),native.events.index('translation'))
                self.assertEqual(values[-1]['language'],'fr');self.assertEqual(values[-1]['epoch'],1)
                browser.send(json.dumps({'type':'cancel'}))
            self.assertTrue(native.closed.wait(1));self.assertEqual(commands[:2],['interrupt_task','set_task'])
        self.relay(upstream,body,factory=lambda:native)


if __name__=='__main__':unittest.main()
