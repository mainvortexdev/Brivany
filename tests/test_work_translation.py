"""Local WorkSpace owner/capture substitutes; no audio device or paid service."""
import json
import math
import struct
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import queue
import numpy as np
from services.work.live_translation import WorkLiveTranslation,CapturePeer
from services.work.system_translation_audio import PCMConverter,choose_route,SilenceClock,SystemAudioRoute
from packages.providers.river_translation import VoiceSamples,pitch_style
from packages.providers.pcm_pacing import PCMRateGate


class Route:
    source='virtual';output='headphones'
    def __init__(self):self.closed=False;self.gain=None;self.sent=[]
    def reduce_original(self,gain):self.gain=gain
    def packets(self,stopped):
        for i in range(25):
            if stopped.wait(.01):break
            raw=struct.pack('<h',i+1)*1920;self.sent.append(raw);yield i,raw
        stopped.wait(3)
    def close(self):self.closed=True


class Bridge:
    def __init__(self,port,*,mixer_factory):self.factory=mixer_factory;self.closed=False;self.inputs=[];self.options=None
    def handle(self,peer):
        self.options=json.loads(peer.recv());self.factory();time.sleep(.1);peer.send(json.dumps({'type':'ready'}))
        while True:
            try:raw=peer.recv(timeout=.1)
            except TimeoutError:continue
            if isinstance(raw,str):
                if json.loads(raw)['type']=='stop':break
                continue
            self.inputs.append(raw)
            peer.send(json.dumps({'type':'transcript','source':'translation','text':'Synthetic English caption.'}))
            peer.send(json.dumps({'type':'voice-style','voice_category':'feminine','method':'asr_speaker_stable_pitch','speaker_label':'Hablante 2','speaker_index':2}))
    def close(self):self.closed=True


class TranslationTests(unittest.TestCase):
    def owner(self,**options):
        self.routes=[];self.bridges=[];self.outputs=[]
        def route():value=Route();self.routes.append(value);return value
        def bridge(*args,**kwargs):value=Bridge(*args,**kwargs);self.bridges.append(value);return value
        owner=WorkLiveTranslation(route_factory=route,bridge_factory=bridge,output_factory=lambda **kw:self.outputs.append(kw),configuration=lambda:{'configured':True,'access_blocked':False},**options)
        self.addCleanup(owner.close);return owner
    def until(self,check):
        deadline=time.monotonic()+3
        while not check():
            if time.monotonic()>deadline:self.fail('Local worker did not reach expected state')
            time.sleep(.01)
    def test_explicit_click_defaults_to_english_auto_buffers_setup_audio_and_restores(self):
        owner=self.owner();self.assertEqual(self.routes,[]);owner.start()
        self.until(lambda:len(self.bridges)>0 and len(self.bridges[0].inputs)>=2)
        state=owner.status();self.assertEqual(self.bridges[0].options['target_language'],'en');self.assertEqual(self.bridges[0].options['voice_mode'],'auto')
        self.assertEqual(self.routes[0].gain,.12);self.assertEqual(self.outputs,[{'endpoint_id':'headphones'}]);self.assertEqual(self.bridges[0].inputs,self.routes[0].sent[:len(self.bridges[0].inputs)])
        self.assertEqual(state['caption'],'Synthetic English caption.');self.assertTrue(state['feedback_isolated']);self.assertFalse(state['microphone_captured']);self.assertFalse(state['audio_persisted'])
        self.assertTrue(self.bridges[0].options['continuous_input']);self.assertTrue(self.bridges[0].options['diarization']);self.assertEqual(state['speaker_label'],'Hablante 2');self.assertEqual(state['speaker_index'],2)
        owner.close();self.assertTrue(self.routes[0].closed);self.assertTrue(self.bridges[0].closed);self.assertFalse(owner.status()['active'])
    def test_no_duplicate_session_and_voice_change_does_not_reconnect(self):
        owner=self.owner();owner.start();self.until(lambda:len(self.bridges)>0)
        with self.assertRaises(ValueError):owner.start()
        owner.set_voice('feminine');self.assertEqual(owner.status()['voice'],'feminine');self.assertEqual(len(self.bridges),1)
        owner.close();owner.start('fr','masculine');self.until(lambda:len(self.bridges)==2);self.assertEqual(self.bridges[-1].options['target_language'],'fr')
    def test_route_failure_stops_before_opening_any_provider(self):
        owner=self.owner();owner.route_factory=lambda:(_ for _ in ()).throw(ValueError('No isolated route'))
        owner.start();self.until(lambda:owner.status()['state']=='error');self.assertEqual(self.bridges,[]);self.assertEqual(owner.status()['error'],'No isolated route')
    def test_invalid_options_and_unconfigured_access_never_start_capture(self):
        owner=self.owner()
        for target,voice in [('de','auto'),('en','unknown')]:
            with self.assertRaises(ValueError):owner.start(target,voice)
        owner.configuration=lambda:{'configured':False}
        with self.assertRaises(ValueError):owner.start()
        self.assertEqual(self.routes,[])
    def test_stop_silences_output_without_waiting_for_blocked_provider(self):
        owner=self.owner();entered=threading.Event();release=threading.Event();closed=threading.Event()
        class Stalled(Bridge):
            def handle(self,peer):self.factory();entered.set();release.wait(2)
        owner.output_factory=lambda **kw:SimpleNamespace(close=closed.set)
        owner.bridge_factory=lambda *a,**kw:Stalled(*a,**kw);self.addCleanup(release.set)
        owner.start();self.assertTrue(entered.wait(1));start=time.monotonic();state=owner.stop()
        self.assertTrue(closed.is_set());self.assertFalse(state['active']);self.assertLess(time.monotonic()-start,.15);self.assertFalse(release.is_set());release.set()
    def test_language_change_restarts_in_background_and_stop_cancels_restart(self):
        owner=self.owner();owner.start();self.until(lambda:len(self.bridges)>0);start=time.monotonic();owner.set_target('fr');self.assertLess(time.monotonic()-start,.2)
        self.until(lambda:len(self.bridges)==2 and self.bridges[-1].options is not None);self.assertEqual(self.bridges[-1].options['target_language'],'fr');self.assertEqual(owner.target,'fr')
        owner.stop();self.assertFalse(owner.status()['active'])
    def test_input_credit_retains_pcm_but_controls_and_stop_stay_immediate(self):
        owner=self.owner();owner.stopped.clear();owner.pcm.put(bytes(3840));peer=CapturePeer(owner);peer.recv();peer.ready.set();peer.set_input_capacity(lambda:False)
        with self.assertRaises(TimeoutError):peer.recv(timeout=.01)
        self.assertEqual(owner.pcm.qsize(),1);self.assertIsNone(peer.pending)
        owner.controls.put({'type':'voice_mode','mode':'feminine'});self.assertEqual(json.loads(peer.recv())['mode'],'feminine')
        owner.stop();started=time.monotonic();self.assertEqual(json.loads(peer.recv()),{'type':'stop'});self.assertLess(time.monotonic()-started,.1)


class AudioBoundaryTests(unittest.TestCase):
    def test_idle_clock_counts_elapsed_audio_at_94_and_110_ms_scheduler_quantums(self):
        for quantum in (.094,.110):
            with self.subTest(quantum=quantum):
                clock=SilenceClock(0);emitted=0
                for index in range(1,101):
                    at=index*quantum;emitted+=clock.due(at)
                    if at>.1:self.assertAlmostEqual(emitted*.08,math.floor((at+1e-9)/.08)*.08)
                self.assertLess(index*quantum-emitted*.08,.08)
                clock.data(at+.01)
                self.assertEqual(clock.due(at+.02),0,'Old idle deadlines must not duplicate silence when real packets return')
                self.assertEqual(clock.due(at+.12),1)

    def test_idle_silence_keeps_partial_real_tail_before_silence_and_resumed_audio(self):
        import ctypes as C
        first=struct.pack('<h',1200)*1440;second=struct.pack('<h',-900)*2400
        clock=[0.];events=iter([(0.,first),(.110,None),(.204,None),(.210,second),(.320,None)])
        current=[None];buffers=[]
        class Stop:
            stopped=False
            def is_set(self):return self.stopped
            def wait(self,delay):return self.stopped
        stopped=Stop();route=SystemAudioRoute.__new__(SystemAudioRoute)
        route.capture=object();route.pending=bytearray();route.frames=0;route.discontinuities=0
        route.silence_clock=SilenceClock(0);route.align=2;route.converter=SimpleNamespace(convert=lambda raw:raw)
        def call(handle,index,*args):
            if index==5:
                try:clock[0],current[0]=next(events)
                except StopIteration:stopped.stopped=True;current[0]=None
                args[0][1]._obj.value=len(current[0])//2 if current[0] is not None else 0
            elif index==3:
                buffer=C.create_string_buffer(current[0]);buffers.append(buffer)
                args[0][1]._obj.value=C.addressof(buffer);args[1][1]._obj.value=len(current[0])//2;args[2][1]._obj.value=0
        with patch('services.work.system_translation_audio.call',call),patch('services.work.system_translation_audio.time.monotonic',lambda:clock[0]):
            rows=list(route.packets(stopped))
        # Two idle periods before resume, one after. The 60 ms real tail must
        # lead, never be stranded behind the synthetic silence it preceded.
        expected=first+bytes(3840*2)+second+bytes(3840)
        self.assertEqual(b''.join(raw for _,raw in rows)+bytes(route.pending),expected)
        self.assertEqual([sequence for sequence,_ in rows],list(range(len(rows))))
        self.assertTrue(all(len(raw)==3840 for _,raw in rows))

    def test_only_unambiguous_disjoint_fxsound_output_is_selected(self):
        rows=[{'family':['FxSound.exe'],'endpoint':'source','active':True},{'family':['FxSound.exe'],'endpoint':'phones','active':False},{'family':['brave.exe'],'endpoint':'other','active':True}]
        self.assertEqual(choose_route('source',rows),'phones')
        for bad in ([],rows[:1],rows+[{'family':['FxSound.exe'],'endpoint':'second','active':False}]):
            with self.assertRaises(ValueError):choose_route('source',bad)
    def test_resampler_streaming_equals_single_block_for_stereo_float(self):
        signal=np.stack([np.sin(np.arange(4800)*.05)*.2,np.sin(np.arange(4800)*.05)*.2],axis=1).astype('<f4').tobytes()
        whole=PCMConverter(48000,2,32,3).convert(signal);converter=PCMConverter(48000,2,32,3)
        streamed=b''.join(converter.convert(signal[i:i+3200]) for i in range(0,len(signal),3200))
        self.assertEqual(whole,streamed);self.assertEqual(len(streamed),4800)
        with self.assertRaises(ValueError):converter.convert(b'x')
    def test_voice_sample_is_for_asr_turn_instead_of_newer_speaker(self):
        tone=lambda frequency:struct.pack('<'+'h'*24000,*[round(15000*math.sin(2*math.pi*frequency*i/24000)) for i in range(24000)])
        samples=VoiceSamples()
        for raw in (tone(120),tone(250)):
            for i in range(0,len(raw),3840):samples.append(raw[i:i+3840])
        self.assertEqual(pitch_style(samples.turn(0)),'low');self.assertEqual(pitch_style(samples.turn(1)),'high')
        self.assertEqual(samples.turn(100),b'');self.assertEqual(samples.turn(float('nan')),b'')


class PacingTests(unittest.TestCase):
    def test_receiver_uses_arrival_times_even_if_consumer_wakes_late_and_rejects_true_flood(self):
        gate=PCMRateGate(0)
        # Four normally spaced frames processed together after a stalled worker.
        self.assertTrue(all(gate.accept(3840,at) for at in (0,.08,.16,.24,.32,.4)))
        flooded=PCMRateGate(0)
        self.assertEqual([flooded.accept(3840,0) for _ in range(4)],[True,True,True,False])
        for size,at in [(3838,0),(True,0),(3840,float('nan'))]:
            with self.assertRaises(ValueError):PCMRateGate(0).accept(size,at)
    def test_pause_during_pending_wait_retains_the_dequeued_frame(self):
        clock=[10.];paused=[False]
        class Stop:
            def is_set(self):return False
            def wait(self,delay):
                clock[0]+=delay
                if delay and not paused[0]:paused[0]=True;peer.send(json.dumps({'type':'flow-control','paused':True}))
                return False
        pcm=queue.Queue();first=bytes(3840);second=b'\x01\x00'*1920;pcm.put(first);pcm.put(second)
        owner=SimpleNamespace(stopped=Stop(),pcm=pcm,controls=queue.Queue(),lock=threading.RLock(),submitted=0,target='en',voice='auto',_update=lambda **kw:None)
        peer=CapturePeer(owner);peer.recv();peer.send(json.dumps({'type':'ready'}))
        with patch('services.work.live_translation.time.monotonic',lambda:clock[0]):
            self.assertEqual(peer.recv(),first)
            with self.assertRaises(TimeoutError):peer.recv()
            self.assertEqual(owner.submitted,3840);self.assertEqual(peer.pending,second)
            peer.send(json.dumps({'type':'flow-control','paused':False}));self.assertEqual(peer.recv(),second)
            self.assertEqual(owner.submitted,7680)
    def test_scheduler_stall_must_not_replay_four_frames_as_an_instant_burst(self):
        # Same 80 ms / 300 ms credit contract as the provider relay. Simulate a
        # busy Windows scheduler, without a clock sleep or an external service.
        for flow_pause in (False,True):
            with self.subTest(flow_pause=flow_pause):
                clock=[10.]
                class Stop:
                    def is_set(self):return False
                    def wait(self,delay):clock[0]+=delay;return False
                pcm=queue.Queue()
                packets=[struct.pack('<h',i)*1920 for i in range(9)]
                for raw in packets:pcm.put_nowait(raw)
                owner=SimpleNamespace(stopped=Stop(),pcm=pcm,controls=queue.Queue(),lock=threading.RLock(),submitted=0,target='en',voice='auto',_update=lambda **kw:None)
                peer=CapturePeer(owner);peer.recv();peer.send(json.dumps({'type':'ready'}));received=[];arrivals=[]
                with patch('services.work.live_translation.time.monotonic',lambda:clock[0]):
                    received.append(peer.recv());arrivals.append(clock[0])
                    if flow_pause:peer.send(json.dumps({'type':'flow-control','paused':True}))
                    clock[0]+=.36
                    if flow_pause:peer.send(json.dumps({'type':'flow-control','paused':False}))
                    for _ in range(8):received.append(peer.recv());arrivals.append(clock[0])
                credit=.3;previous=10.;rejected=[]
                for index,at in enumerate(arrivals):
                    credit=min(.3,credit+at-previous);previous=at
                    if .08>credit+.015:rejected.append(index)
                    credit-=.08
                self.assertEqual(received,packets,'No lost/reordered PCM while smoothing a burst')
                self.assertEqual(rejected,[],f'Legitimate capture violates the realtime gate: {arrivals}')
