"""Local provider substitutes only; no real keys, audio devices or inference."""
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import json
import math
import os
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from websockets.sync.client import connect
from websockets.sync.server import serve
from packages.providers import river_translation as river
from packages.providers import meta_translation as mt
from packages.providers.live_voice import VoiceError
from packages.providers.native_audio import NativeMixer


class ContinuousTests(unittest.TestCase):
    def test_long_speech_commits_before_sentence_end_without_repeating_final(self):
        clauses=river.LiveClauses();text='one two three four five six seven eight nine ten eleven twelve'
        self.assertEqual(clauses.accept({'id':'a','text':text,'final':False}),[])
        segments=clauses.accept({'id':'a','text':text+' thirteen','final':False})
        self.assertEqual([s.text for s in segments],['one two three four five six seven eight'])
        rest=clauses.accept({'id':'a','text':text+' thirteen','final':True})
        self.assertEqual([s.text for s in rest],['nine ten eleven twelve thirteen'])
        self.assertEqual(clauses.accept({'id':'a','text':text+' thirteen','final':True}),[])

    def test_known_access_failure_matches_current_key_only(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(river,'ACCESS_PATH',Path(tmp)/'access.json'):
            with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'synthetic-key-a'}):
                river.ACCESS_PATH.write_text(json.dumps({'meta':{'access':False,'http_status':403,
                    'credential_hash':river.hashlib.sha256(b'synthetic-key-a').hexdigest()}}))
                self.assertTrue(river.river_status()['access_blocked'])
            with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'synthetic-key-b'}):
                self.assertEqual(river.access_checks(),{})

    def test_groq_key_and_cached_rejection_do_not_configure_or_block_the_meta_route(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(river,'ACCESS_PATH',Path(tmp)/'access.json'):
            with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'synthetic-meta','BRIVANY_META_MODEL':'muse-spark-1.3',
                'BRIVANY_MUSE_API_KEY':'synthetic-muse','BRIVANY_CARTESIA_API_KEY':'synthetic-cartesia','BRIVANY_GROQ_API_KEY':''}):
                river.ACCESS_PATH.write_text(json.dumps({'groq':{'access':False,'http_status':403}}))
                result=river.river_status()
                self.assertTrue(result['configured']);self.assertFalse(result['access_blocked'])
                self.assertEqual(result['model'],'muse-spark-1.3')

    def test_status_has_no_session_duration_daily_or_total_text_quota(self):
        status=river.river_status()
        for field in ('max_seconds','daily_sessions','sessions_remaining','max_segments','max_characters'):
            self.assertIsNone(status[field])
        self.assertTrue(status['continuous'])

    def test_more_than_64_turns_and_20000_characters_use_rolling_state(self):
        clauses=river.LiveClauses()
        for turn in range(100):
            parts=clauses.accept({'id':str(turn),'text':'word '*60+'.','final':True})
            self.assertTrue(parts)
        self.assertLessEqual(len(clauses.turns),64)

    def test_pitch_silence_and_two_synthetic_tones(self):
        self.assertEqual(river.pitch_style(b'\0'*24000),'neutral')
        def tone(hz):return b''.join(struct.pack('<h',round(3000*math.sin(2*math.pi*hz*i/24000))) for i in range(12000))
        self.assertEqual(river.pitch_style(tone(120)),'low')
        self.assertEqual(river.pitch_style(tone(250)),'high')


class MetaRecoveryTests(unittest.TestCase):
    def test_inline_uses_measured_standard_model_and_respects_other_configured_modes(self):
        for model,expected in [('muse-spark-1.3','muse-spark-1.2'),('muse-spark-1.2','muse-spark-1.2'),('muse-spark-1.3-contributor','muse-spark-1.3-contributor')]:
            with patch.object(river,'meta_translation_status',return_value={'model':model}):
                translator,created=self.install([[{'type':'done'}]],inline_video=True)
                self.assertEqual(created[0].options['model_override'],expected)
                translator.close()
        translator,created=self.install([[{'type':'done'}]])
        self.assertNotIn('model_override',created[0].options)

    def install(self,scripts,**options):
        created=[]
        class Session:
            def __init__(self,**options):
                self.script=scripts[len(created)];self.closed=False;self.options=options;created.append(self)
            def stream(self,*args,**kwargs):
                for event in self.script:
                    if isinstance(event,Exception):raise event
                    yield event
            def close(self):self.closed=True
        patcher=patch.object(river,'MetaTranslationSession',Session);patcher.start();self.addCleanup(patcher.stop)
        translator=river.MetaStream(**options);self.addCleanup(translator.close);return translator,created

    def test_duration_budget_is_forwarded_only_by_inline_video_translation(self):
        requests=[]
        class Session:
            def __init__(self,**options):pass
            def stream(self,text,source,target,**options):
                requests.append((text,source,target,options))
                yield {'type':'delta','text':'Bonjour.'}
                yield {'type':'done'}
            def close(self):pass
        with patch.object(river,'MetaTranslationSession',Session):
            for inline in (False,True):
                translator=river.MetaStream(inline_video=inline)
                try:self.assertEqual(list(translator.stream_for_duration('Hello.','fr',[('Prior.','Avant.')],duration_ms=2400)),['Bonjour.'])
                finally:translator.close()
        self.assertEqual(requests[0][3],{'context':[{'source_text':'Prior.','translated_text':'Avant.'}]})
        self.assertEqual(requests[1][3],{'context':[{'source_text':'Prior.','translated_text':'Avant.'}],'duration_ms':2400})

    def test_inline_timeout_reopens_transport_for_the_next_turn_without_replaying(self):
        translator,created=self.install([[{'type':'delta','text':'Par'},mt.MetaTranslationError('mt_timeout','Fixed timeout')],
            [{'type':'delta','text':'Bonjour.'},{'type':'done'}]],inline_video=True)
        with self.assertRaises(mt.MetaTranslationError):list(translator.stream('First.','fr',[]))
        self.assertEqual(translator.usage['total_attempts'],1)
        self.assertTrue(created[0].closed)
        self.assertEqual(created[1].options['timeout_seconds'],6.5)
        self.assertEqual(list(translator.stream('Next.','fr',[])),['Bonjour.'])
        self.assertEqual(translator.usage['total_attempts'],2)

    def test_zero_delta_timeout_gets_exactly_one_fresh_attempt_and_exposes_usage(self):
        translator,created=self.install([[mt.MetaTranslationError('mt_timeout','Fixed timeout')],
            [{'type':'delta','text':'Bonjour.'},{'type':'done','usage':{'total_tokens':7}}]])
        stages=[];translator.on_stage=lambda name,**values:stages.append((name,values))
        self.assertEqual(list(translator.stream('Hello.','fr',[])),['Bonjour.'])
        self.assertEqual(len(created),2);self.assertTrue(created[0].closed)
        self.assertEqual(created[0].options,created[1].options)
        self.assertEqual((translator.attempts,translator.recoveries),(2,1))
        self.assertEqual(translator.usage,{'total_tokens':7,'attempts':2,'recoveries':1,'total_attempts':2,'total_recoveries':1})
        self.assertEqual([name for name,_ in stages],['mt_attempt','mt_recovery','mt_attempt'])
        self.assertEqual(stages[1][1]['cause'],0)

    def test_partial_output_is_never_replayed(self):
        translator,created=self.install([[{'type':'delta','text':'Bon'},mt.MetaTranslationError('mt_timeout','Fixed timeout')]])
        stream=translator.stream('Hello.','fr',[]);self.assertEqual(next(stream),'Bon')
        with self.assertRaises(mt.MetaTranslationError):list(stream)
        self.assertEqual(len(created),1);self.assertEqual(translator.usage['attempts'],1);self.assertEqual(translator.usage['recoveries'],0)

    def test_configuration_change_cannot_redirect_a_recovery_to_a_different_model_or_key(self):
        created=[]
        class Session:
            def __init__(self,**_):
                self.model='muse-spark-1.3' if not created else 'muse-spark-1.2';self._key='synthetic-only';self.closed=False;self.calls=0;created.append(self)
            def stream(self,*args,**kwargs):
                self.calls+=1;raise mt.MetaTranslationError('mt_timeout','Fixed timeout')
                yield
            def close(self):self.closed=True
        with patch.object(river,'MetaTranslationSession',Session):
            translator=river.MetaStream();self.addCleanup(translator.close)
            with self.assertRaises(VoiceError) as raised:list(translator.stream('Hello.','fr',[]))
            self.assertEqual(raised.exception.code,'mt_configuration_changed')
            self.assertEqual([row.calls for row in created],[1,0]);self.assertTrue(created[1].closed)

    def test_second_transient_failure_does_not_open_a_third_request(self):
        translator,created=self.install([[mt.MetaTranslationError('mt_unavailable','Fixed unavailable')],
            [mt.MetaTranslationError('mt_timeout','Fixed timeout')]])
        with self.assertRaises(mt.MetaTranslationError):list(translator.stream('Hello.','fr',[]))
        self.assertEqual(len(created),2);self.assertEqual(translator.usage['attempts'],2)

    def test_http_4xx_refusal_and_invalid_response_never_retry(self):
        for code,status in [('mt_rejected',429),('mt_refused',200),('mt_invalid_response',200),('mt_unavailable',403)]:
            with self.subTest(code=code):
                translator,created=self.install([[mt.MetaTranslationError(code,'Fixed failure',http_status=status)]])
                with self.assertRaises(mt.MetaTranslationError):list(translator.stream('Hello.','fr',[]))
                self.assertEqual(len(created),1);self.assertEqual(translator.recoveries,0)
                translator.close()

    def test_stop_closes_inflight_session_and_prevents_fresh_attempt(self):
        started=threading.Event();released=threading.Event();created=[];failures=[]
        class Session:
            def __init__(self,**_):created.append(self)
            def stream(self,*args,**kwargs):
                started.set();released.wait(2)
                raise mt.MetaTranslationError('mt_unavailable','Fixed unavailable')
                yield
            def close(self):released.set()
        with patch.object(river,'MetaTranslationSession',Session):
            translator=river.MetaStream()
            def consume():
                try:list(translator.stream('Hello.','fr',[]))
                except VoiceError as error:failures.append(error.code)
            worker=threading.Thread(target=consume);worker.start();self.assertTrue(started.wait(1))
            translator.close();worker.join(1)
            self.assertFalse(worker.is_alive());self.assertEqual(len(created),1)
            self.assertEqual(failures,['mt_session_closed']);self.assertEqual(translator.recoveries,0)


class SpeakerTrackerTests(unittest.TestCase):
    def test_confident_catalog_timbre_is_independent_of_vocal_pitch(self):
        tracker=river.SpeakerTracker();tracker.observe('one','A')
        advisory={'voice_register':'high','register_confidence':.95,
                  'voice_timbre':'masculine','timbre_confidence':.9}
        voice=tracker.voice('one',bytes(48000),'auto',stopped=threading.Event(),advisory=advisory)
        self.assertEqual(voice['style'],'high')
        self.assertEqual(voice['voice_category'],'masculine')
        self.assertEqual(voice['timbre_source'],'meta_audio_timbre')
        tracker.observe('two','A')
        next_voice=tracker.voice('two',bytes(48000),'auto',stopped=threading.Event(),advisory={})
        self.assertEqual(next_voice['voice_id'],voice['voice_id'])
        manual=tracker.voice('two',bytes(48000),'feminine',stopped=threading.Event(),advisory=advisory)
        self.assertEqual(manual['voice_category'],'feminine')

    def test_timestamped_label_can_arrive_after_next_turn_starts(self):
        from packages.providers.live_voice import MuseEvents
        events=MuseEvents();tracker=river.SpeakerTracker()
        for message in ({'type':'speechStart','turnId':1,'audioProcessedMs':800},
                        {'type':'speechStart','turnId':2,'audioProcessedMs':3600},
                        {'type':'speaker','label':'A','audioProcessedMs':3600},
                        {'type':'speaker','label':'B','audioProcessedMs':4800}):
            events.accept(message)
            if message['type']=='speaker':tracker.observe(events.speaker_turn,message['label'])
        self.assertEqual(tracker.metadata(1)['speaker_index'],1)
        self.assertEqual(tracker.metadata(2)['speaker_index'],2)
        self.assertEqual(events.accept({'type':'speechComplete','turnId':1,'transcript':'Owned test.'})['speaker'],'A')

    def test_older_speaker_event_cannot_overwrite_newer_label(self):
        from packages.providers.live_voice import MuseEvents
        events=MuseEvents()
        events.accept({'type':'speechStart','turnId':1,'audioProcessedMs':400})
        events.accept({'type':'speaker','label':'A','audioProcessedMs':1600})
        events.accept({'type':'speaker','label':'B','audioProcessedMs':1000})
        self.assertIsNone(events.speaker_turn)
        self.assertEqual(events.accept({'type':'speechComplete','turnId':1,'transcript':'Owned test.'})['speaker'],'A')

    def test_catalog_register_uses_the_voiced_span_and_ignores_initial_silence(self):
        def harmonic(frequency):
            return b''.join(struct.pack('<h',round(1200*math.sin(2*math.pi*frequency*i/24000)+
                3000*math.sin(4*math.pi*frequency*i/24000))) for i in range(24000))
        self.assertEqual(river.pitch_style(bytes(24000)+harmonic(125)),'low')
        self.assertEqual(river.pitch_style(bytes(24000)+harmonic(235)),'high')

    def test_strong_second_harmonic_does_not_double_the_source_pitch(self):
        audio=b''.join(struct.pack('<h',round(900*math.sin(i*math.tau*120/24000)
            +9000*math.sin(i*math.tau*240/24000))) for i in range(24000))
        self.assertEqual(river.pitch_style(audio),'low')

    def test_register_uses_voice_after_a_high_introduction(self):
        def tone(frequency):
            return b''.join(struct.pack('<h',round(9000*math.sin(i*math.tau*frequency/24000))) for i in range(24000))
        self.assertEqual(river.pitch_style(tone(245)*3+tone(124)*5),'low')

    def test_first_reliable_category_is_fixed_for_a_label_despite_later_intonation(self):
        tracker=river.SpeakerTracker();stop=threading.Event()
        with patch.object(river,'pitch_style',side_effect=['low','high']) as pitch:
            tracker.observe('1','A');first=tracker.voice('1',b'first','auto',stopped=stop)
            tracker.observe('2','B');second=tracker.voice('2',b'second','auto',stopped=stop)
            tracker.observe('3','A');third=tracker.voice('3',b'higher intonation','auto',stopped=stop)
        self.assertEqual([row['speaker_label'] for row in (first,second,third)],['Hablante 1','Hablante 2','Hablante 1'])
        self.assertEqual([row['voice_id'] for row in (first,second,third)],[river.VOICES['low'],river.VOICES['high'],river.VOICES['low']])
        self.assertEqual(pitch.call_count,2)
        self.assertTrue(all(row['voice_category_is_identity'] is False for row in (first,second,third)))

    def test_inline_register_corrects_initial_pitch_and_requires_two_distinct_turns_to_change(self):
        tracker=river.SpeakerTracker();stop=threading.Event()
        low={'voice_register':'low','register_confidence':.95}
        high={'voice_register':'high','register_confidence':.9}
        with patch.object(river,'pitch_style',return_value='high'):
            tracker.observe('1','A')
            self.assertEqual(tracker.voice('1',b'intro','auto',stopped=stop,advisory={})['voice_category'],'feminine')
            tracker.observe('2','A')
            voice=tracker.voice('2',b'confirmed','auto',stopped=stop,advisory=low)
            self.assertEqual((voice['voice_category'],voice['register_source']),('masculine','meta_audio'))
            tracker.observe('3','A')
            for _ in range(2):
                self.assertEqual(tracker.voice('3',b'pitch rise','auto',stopped=stop,advisory=high)['voice_category'],'masculine')
            tracker.observe('4','A')
            corrected=tracker.voice('4',b'confirmed again','auto',stopped=stop,advisory=high)
            self.assertEqual(corrected['voice_category'],'feminine')
            self.assertEqual(corrected['speaker_index'],voice['speaker_index'])

    def test_missing_label_wait_is_bounded_and_late_label_does_not_repeat_audio_or_invent_identity(self):
        tracker=river.SpeakerTracker();stop=threading.Event();started=time.monotonic()
        with patch.object(river,'pitch_style',return_value='low'):
            unidentified=tracker.voice('1',b'tone','auto',stopped=stop,wait=.03)
            self.assertLess(time.monotonic()-started,.2)
            self.assertEqual(unidentified['speaker_label'],'Voz sin identificar');self.assertIsNone(unidentified['speaker_index'])
            self.assertEqual(unidentified['voice_id'],river.VOICES['low'])
            tracker.observe('1','A');identified=tracker.voice('1',b'new tone','auto',stopped=stop)
        self.assertEqual(identified['speaker_label'],'Hablante 1');self.assertEqual(identified['voice_id'],unidentified['voice_id'])

    def test_inline_local_evidence_corrects_a_repeated_mismatch_without_meta(self):
        tracker=river.SpeakerTracker();stop=threading.Event()
        def low_pitch(_sample,evidence):
            evidence.update(f0_lower=112,f0_upper=141,voiced_windows=28)
            return 'low'
        tracker.observe('1','A')
        initial=tracker.voice('1',b'', 'auto',stopped=stop,advisory={'voice_register':'high','register_confidence':.9})
        with patch.object(river,'pitch_style',side_effect=low_pitch):
            for turn in ('2','2','3'):
                tracker.observe(turn,'A')
                result=tracker.voice(turn,bytes(57600),'auto',stopped=stop,advisory={})
                self.assertEqual(result['speaker_index'],initial['speaker_index'])
                self.assertEqual(result['voice_category'],'masculine' if turn=='3' else 'feminine')

    def test_labelled_uncertain_turns_have_distinct_catalog_voices(self):
        tracker=river.SpeakerTracker();stop=threading.Event();voices=[]
        for turn,label in enumerate(('A','B','A')):
            tracker.observe(turn,label)
            voices.append(tracker.voice(turn,b'', 'auto',stopped=stop,advisory={})['voice_id'])
        self.assertEqual(voices[0],voices[2]);self.assertNotEqual(voices[0],voices[1])

    def test_label_arriving_during_short_wait_is_used_without_waiting_for_turn_final(self):
        tracker=river.SpeakerTracker();stop=threading.Event();timer=threading.Timer(.03,lambda:tracker.observe('1','B'));timer.start()
        with patch.object(river,'pitch_style',return_value='high'):
            voice=tracker.voice('1',b'tone','auto',stopped=stop,wait=.2)
        timer.join();self.assertEqual(voice['speaker_label'],'Hablante 1');self.assertEqual(voice['voice_category'],'feminine')

    def test_unknown_turn_does_not_consume_voice_palette_or_reuse_previous_identity(self):
        tracker=river.SpeakerTracker();stop=threading.Event()
        with patch.object(river,'pitch_style',return_value='low'):
            tracker.voice('unknown',b'tone','auto',stopped=stop)
            tracker.observe('1','A');first=tracker.voice('1',b'tone','auto',stopped=stop)
            tracker.observe('2','B');second=tracker.voice('2',b'tone','auto',stopped=stop)
        self.assertEqual(first['voice_id'],river.VOICE_PALETTES['low'][0][1]);self.assertEqual(second['voice_id'],river.VOICE_PALETTES['low'][1][1])


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.counts={'muse':0,'cartesia':0,'meta':0,'tts_messages':0,'cancel':0};self.mixers=[]
        self.audio_seen=threading.Event();self.providers_closed=threading.Event();self.bad_meta=False;self.slow=False;self.burst=False;self.many_turns=False;self.pause_batch=False;self.close_http=False;self.voices=[];self.voice_contexts={};self.interleaved=False;self.hold_tts=False;self.output_values=[];self.expect_diarization=False;self.speaker_script=[]
        self.pcm=struct.pack('<h',1200)*960;self.agent_scenario=False;self.expected_meta_model='muse-spark-1.3'
        owner=self
        class Mixer:
            def __init__(self):self.closed=False;self.outputs=0;owner.mixers.append(self)
            def set_levels(self,**_):pass
            def push_original(self,raw):
                if self.closed:raise RuntimeError('closed')
            def push_translation(self,raw):
                if self.closed:raise RuntimeError('closed')
                self.outputs+=1;owner.audio_seen.set();owner.output_values.append(struct.unpack('<h',raw[:2])[0])
            def push_translation_paced(self,raw,*,stopped,timeout=4):
                if stopped.is_set():return False
                self.push_translation(raw);return True
            def finish(self,timeout=3):return True
            def close(self):self.closed=True
        self.mixer_factory=Mixer
        def muse(ws):
            self.counts['muse']+=1
            handshake=json.loads(ws.recv());self.assertEqual(handshake['mode'],'DIARIZATION' if self.expect_diarization else 'ENDPOINTING')
            ws.send(json.dumps({'sessionId':'synthetic'}));sent=False;turn=0;frames=0
            try:
                for raw in ws:
                    if isinstance(raw,bytes) and self.agent_scenario:
                        frames+=1
                        if frames in (1,76,151):
                            turn+=1
                            ws.send(json.dumps({'type':'speechStart','turnId':turn,'audioProcessedMs':(frames-1)*80}));ws.send(json.dumps({'type':'speaker','label':'A'}))
                        if frames in (75,150,175):ws.send(json.dumps({'type':'speechComplete','turnId':turn,'audioProcessedMs':frames*80,'transcript':'Same source phrase.'}))
                    elif isinstance(raw,bytes) and self.many_turns:
                        turn+=1
                        for event in [{'type':'speechStart','turnId':turn},{'type':'speaker','label':'A'},
                            {'type':'speechComplete','turnId':turn,'transcript':'Hello '+('synthetic source '*18)+'.'}]:ws.send(json.dumps(event))
                    elif isinstance(raw,bytes) and not sent:
                        sent=True
                        events=([event for number,label in enumerate(self.speaker_script,1) for event in [
                            {'type':'speechStart','turnId':number},{'type':'speaker','label':label},
                            {'type':'speechComplete','turnId':number,'transcript':'Same source phrase.'}]] if self.speaker_script else
                            [event for number in range(1,4) for event in [{'type':'speechStart','turnId':number},
                            {'type':'speechComplete','turnId':number,'transcript':'Hello.'}]] if self.pause_batch else
                            [{'type':'speechStart','turnId':1},{'type':'speechComplete','turnId':1,'transcript':'Hello.'}] if self.burst else
                            [{'type':'speechStart','turnId':1},{'type':'transcript','transcript':'Hello.'},
                            {'type':'transcript','transcript':'Hello. Again.'},{'type':'transcript','transcript':'Hello. Again.'}])
                        for event in events:ws.send(json.dumps(event))
                    elif isinstance(raw,str) and json.loads(raw)=={'type':'endStream'}:
                        if not self.many_turns and not self.pause_batch and not self.speaker_script and not self.agent_scenario:ws.send(json.dumps({'type':'speechComplete','turnId':1,'transcript':'Hello. Again.'}))
                        return
            except Exception:pass
        def cartesia(ws):
            self.counts['cartesia']+=1
            staged={};finished=[]
            try:
                for raw in ws:
                    event=json.loads(raw)
                    if event.get('cancel'):self.counts['cancel']+=1;continue
                    self.counts['tts_messages']+=1
                    if event['transcript'] and event['context_id'] not in self.voice_contexts:
                        self.voices.append(event['voice']);self.voice_contexts[event['context_id']]=event['voice']
                    if event['context_id'] in self.voice_contexts:self.assertEqual(event['voice'],self.voice_contexts[event['context_id']])
                    self.assertEqual(event['model_id'],river.SONIC_MODEL)
                    self.assertEqual(event['language'],'fr')
                    if self.interleaved or self.hold_tts:
                        identifier=event['context_id'];staged.setdefault(identifier,[])
                        if event['transcript']:
                            value=(list(staged).index(identifier)+1)*1000
                            staged[identifier].append({'type':'chunk','context_id':identifier,'data':base64.b64encode(struct.pack('<h',value)*960).decode()})
                        if event['continue'] is False:
                            staged[identifier].append({'type':'done','context_id':identifier});finished.append(identifier)
                            if self.interleaved and len(finished)==2:
                                for context in reversed(finished):
                                    for message in staged[context]:ws.send(json.dumps(message))
                        continue
                    if event['transcript']:
                        packets=[self.pcm*50]*2 if self.burst else [self.pcm]
                        for packet in packets:ws.send(json.dumps({'type':'chunk','context_id':event['context_id'],'data':base64.b64encode(packet).decode()}))
                    if event['continue'] is False:ws.send(json.dumps({'type':'done','context_id':event['context_id']}))
            except Exception:pass
        class Meta(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*_):pass
            def do_POST(self):
                owner.counts['meta']+=1
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.assertEqual(body['max_completion_tokens'],river.MAX_TOKENS)
                owner.assertTrue(body['stream'])
                owner.assertEqual(body['model'],owner.expected_meta_model)
                owner.assertEqual(body['reasoning_effort'],'minimal')
                owner.assertEqual(body['messages'][0]['role'],'developer')
                data=json.loads(body['messages'][1]['content'])
                owner.assertEqual(data['target_language'],'fr')
                owner.assertEqual(self.path,'/v1/chat/completions')
                if owner.bad_meta:
                    self.send_response(429);self.send_header('Content-Length','0');self.end_headers();return
                frames=[('data: '+json.dumps({'choices':[{'delta':{'content':delta}}]})+'\n\n').encode() for delta in ['Bonjour ', 'le monde.']]
                frames.append(b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(sum(map(len,frames))))
                if owner.close_http:self.send_header('Connection','close');self.close_connection=True
                self.end_headers()
                if owner.slow:time.sleep(.8)
                try:
                    for frame in frames:self.wfile.write(frame);self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        self.asr=serve(muse,'127.0.0.1',0,compression=None);self.tts=serve(cartesia,'127.0.0.1',0,compression=None)
        self.http=ThreadingHTTPServer(('127.0.0.1',0),Meta)
        for server in [self.asr,self.tts,self.http]:threading.Thread(target=server.serve_forever,daemon=True).start()
        self.patchers=[patch.dict(os.environ,{'BRIVANY_MUSE_API_KEY':'synthetic-only','BRIVANY_META_API_KEY':'synthetic-only','BRIVANY_META_MODEL':'muse-spark-1.3','BRIVANY_GROQ_API_KEY':'','BRIVANY_CARTESIA_API_KEY':'synthetic-only'}),
            patch.object(river,'MUSE_URL',f'ws://127.0.0.1:{self.asr.socket.getsockname()[1]}'),
            patch.object(river,'CARTESIA_URL',f'ws://127.0.0.1:{self.tts.socket.getsockname()[1]}'),
            patch.object(mt,'HTTPSConnection',lambda host,port,timeout: HTTPConnection('127.0.0.1',self.http.server_port,timeout=timeout))]
        for p in self.patchers:p.start()
        self.origin_port=getattr(self,'origin_port',19872)
        self.filter_decision={'skip':False,'kind':'speech','latency_ms':0}
        self.bridge=river.RiverBridge(self.origin_port,mixer_factory=self.mixer_factory,content_filter_factory=lambda:type('Classifier',(),{'classify':lambda _,pcm:self.filter_decision})()).start()

    def tearDown(self):
        self.bridge.close();self.asr.shutdown();self.tts.shutdown();self.http.shutdown();self.http.server_close()
        for p in reversed(self.patchers):p.stop()
        self.tmp.cleanup()

    def browser(self):
        return connect(f'ws://127.0.0.1:{self.bridge.port}/dub',origin=f'http://127.0.0.1:{self.origin_port}',proxy=None)

    def begin(self,ws,**options):
        ws.send(json.dumps({'type':'start','consent':True,'target_language':'fr','original_gain':0,**options}))
        self.assertEqual(json.loads(ws.recv(timeout=5))['type'],'ready')

    def test_actual_protocols_deduplicate_partials_and_reuse_connections(self):
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2)
            self.assertTrue(self.audio_seen.wait(4),'translation must start before endStream')
            ws.send(json.dumps({'type':'finish'}))
            events=[]
            while True:
                event=json.loads(ws.recv(timeout=5));events.append(event)
                if event['type'] in {'done','error'}:break
            self.assertEqual(events[-1]['type'],'done',events)
            self.assertEqual(events[-1]['segments'],2)
        self.assertEqual(self.counts['meta'],2)
        self.assertEqual(self.counts['muse'],1);self.assertEqual(self.counts['cartesia'],1)
        self.assertTrue(self.voices)
        self.assertTrue(all(voice==river.VOICES['low'] for voice in self.voices),'Uncertain samples must never silently choose the female fallback.')

    def test_song_clauses_do_not_request_translation_or_synthesis(self):
        self.filter_decision={'skip':True,'kind':'singing','latency_ms':2}
        self.pause_batch=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2);ws.send(json.dumps({'type':'finish'}));events=[]
            while True:
                event=json.loads(ws.recv(timeout=5));events.append(event)
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',events)
            self.assertEqual(event['segments'],0)
        self.assertEqual(self.counts['meta'],0);self.assertEqual(self.counts['tts_messages'],0)
        self.assertFalse(self.audio_seen.is_set())
        self.assertTrue(any(e['type']=='content-filter' and e['filtered'] for e in events))

    def test_translation_continues_during_clone_and_next_phrase_uses_cached_clone(self):
        from services.work.voice_agents import TranslationVoiceAgents
        self.agent_scenario=True;self.expect_diarization=True;entered=threading.Event();release=threading.Event();deleted=[];identifier='f161df88-b5a0-4ea8-aa21-6be12859f761'
        class Cloner:
            def clone(self,pcm,**options):entered.set();release.wait(3);return {'id':identifier}
            def delete(self,key):deleted.append(key)
        class Classifier:
            def classify(self,pcm):return {'kind':'speech','speech_score':.99,'singing_score':0.,'music_score':0.}
        agents=TranslationVoiceAgents(authorized=True,cloner_factory=Cloner,classifier_factory=Classifier)
        self.addCleanup(release.set);self.addCleanup(agents.close);self.bridge.voice_agents_factory=lambda:agents
        # Accelerated local protocol fixture, not a realtime/hardware claim.
        with patch.object(river.PCMRateGate,'accept',return_value=True),self.browser() as ws:
            self.begin(ws,continuous_input=True)
            for _ in range(150):ws.send(self.pcm*2);time.sleep(.005)
            self.assertTrue(entered.wait(2));self.assertTrue(self.audio_seen.wait(2));self.assertIsNone(agents.voice_for('A'))
            release.set();until=time.monotonic()+2
            while not agents.voice_for('A') and time.monotonic()<until:time.sleep(.01)
            self.assertEqual(agents.voice_for('A'),identifier)
            for _ in range(25):ws.send(self.pcm*2);time.sleep(.005)
            ws.send(json.dumps({'type':'finish'}));events=[]
            while True:
                event=json.loads(ws.recv(timeout=5));events.append(event)
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',events);self.assertEqual(event['segments'],3)
        self.assertNotEqual(self.voices[0],identifier);self.assertEqual(self.voices[-1],identifier)
        for thread in agents.threads:thread.join(2)
        self.assertEqual(deleted,[identifier])

    def speaker_sequence(self,style):
        self.expect_diarization=True;self.speaker_script=['A','B','A']
        with patch.object(river,'pitch_style',return_value=style) as pitch,self.browser() as ws:
            self.begin(ws,diarization=True,continuous_input=True);ws.send(self.pcm*2);ws.send(json.dumps({'type':'finish'}));events=[]
            while True:
                event=json.loads(ws.recv(timeout=5));events.append(event)
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event);self.assertEqual(event['segments'],3);self.assertEqual(pitch.call_count,2)
        voices=[row for row in events if row['type']=='voice-style']
        self.assertEqual([row['speaker_label'] for row in voices],['Hablante 1','Hablante 2','Hablante 1'])
        self.assertEqual([row['speaker_index'] for row in voices],[1,2,1])
        self.assertEqual([row['voice_id'] for row in voices],
            [river.VOICE_PALETTES[style][0][1],river.VOICE_PALETTES[style][1][1],river.VOICE_PALETTES[style][0][1]])
        self.assertEqual(self.voices,[row['voice_id'] for row in voices])
        self.assertEqual((self.counts['muse'],self.counts['cartesia'],self.counts['meta']),(1,1,3))

    def test_two_masculine_catalog_voices_stay_distinct_on_same_source_phrase_a_b_a(self):
        self.speaker_sequence('low')

    def test_two_feminine_catalog_voices_stay_distinct_on_same_source_phrase_a_b_a(self):
        self.speaker_sequence('high')

    def test_provider_connections_are_started_concurrently_and_ready_requires_both(self):
        original=river.connect;barrier=threading.Barrier(2)
        def transport(url,*args,**kwargs):
            barrier.wait(timeout=2)
            return original(url,*args,**kwargs)
        with patch.object(river,'connect',transport),self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2);ws.send(json.dumps({'type':'finish'}))
            while True:
                event=json.loads(ws.recv(timeout=5))
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event)
        self.assertEqual((self.counts['muse'],self.counts['cartesia']),(1,1))

    def test_stop_during_parallel_setup_closes_output_without_starting_translation(self):
        original=river.connect;opened=threading.Event();release=threading.Event()
        def transport(url,*args,**kwargs):
            socket=original(url,*args,**kwargs)
            if url==river.CARTESIA_URL:opened.set();release.wait(2)
            return socket
        try:
            with patch.object(river,'connect',transport),self.browser() as ws:
                ws.send(json.dumps({'type':'start','consent':True,'target_language':'fr'}));self.assertTrue(opened.wait(2))
                ws.send(json.dumps({'type':'stop'}));deadline=time.monotonic()+1
                while not self.mixers[0].closed and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue(self.mixers[0].closed);self.assertEqual(self.counts['meta'],0)
                release.set()
        finally:release.set()

    def test_four_second_cartesia_burst_flows_through_real_mixer_without_overflow(self):
        self.burst=True
        class Driver:
            def write(self,raw):pass
            def drain(self,timeout):return True
            def close(self):pass
        def factory():
            mixer=NativeMixer(Driver());self.mixers.append(mixer);return mixer
        self.bridge.mixer_factory=factory
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2);ws.send(json.dumps({'type':'finish'}))
            while True:
                event=json.loads(ws.recv(timeout=7))
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event)
            self.assertEqual(event['output_bytes'],48000*4)
            self.assertEqual(event['segments'],1)
            stats=event['native_audio']
            self.assertLessEqual(stats['maximum_queued_ms']['translation'],240)
            self.assertEqual(stats['rejected_pushes']['translation'],0)
            self.assertEqual(stats['accepted_bytes']['translation'],48000*4)
            self.assertEqual(stats['queued_ms']['translation'],0)
        self.assertEqual(self.counts['meta'],1)

    def test_prefetches_second_context_before_first_done_and_plays_interleaved_audio_in_source_order(self):
        # The provider withholds context 1 until context 2 has been requested,
        # then emits context 2 first. A serial wait-before-next-MT deadlocks.
        self.interleaved=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2);ws.send(json.dumps({'type':'finish'}));events=[]
            while True:
                event=json.loads(ws.recv(timeout=5));events.append(event)
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event);self.assertEqual(event['segments'],2)
        self.assertEqual(self.output_values,[1000,2000])
        stages=[row for row in events if row['type']=='stage-metrics']
        starts=[row for row in stages if row['stage']=='mt_start']
        first_done=next(row for row in stages if row['stage']=='tts_done' and row['segment_id']==starts[0]['segment_id'])
        self.assertLessEqual(starts[1]['at_ms'],first_done['at_ms'])
        for row in stages:
            self.assertNotIn('text',row)
            self.assertIsInstance(row['at_ms'],(int,float))
        caption_ids=[row['segment_id'] for row in events if row['type']=='transcript' and row.get('source')=='translation']
        self.assertEqual(list(dict.fromkeys(caption_ids)),[row['segment_id'] for row in starts])

    def test_stop_cancels_both_prefetched_contexts_and_never_opens_a_third(self):
        self.pause_batch=True;self.hold_tts=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2)
            deadline=time.monotonic()+3
            while len(self.voice_contexts)<2 and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(len(self.voice_contexts),2);self.assertEqual(self.counts['meta'],2)
            ws.send(json.dumps({'type':'stop'}))
            deadline=time.monotonic()+2
            while self.counts['cancel']<2 and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(self.counts['cancel'],2);self.assertTrue(self.mixers[0].closed)
            self.assertEqual(self.output_values,[]);self.assertEqual(self.counts['meta'],2)

    def test_http_close_after_first_translation_does_not_stop_next_fragment(self):
        self.close_http=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2)
            self.assertTrue(self.audio_seen.wait(4))
            ws.send(json.dumps({'type':'finish'}))
            while True:
                event=json.loads(ws.recv(timeout=5))
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event);self.assertEqual(event['segments'],2)
        self.assertEqual(self.counts['meta'],2)

    def test_continuous_input_does_not_pause_asr_for_pending_output_and_stop_remains_immediate(self):
        self.pause_batch=True;self.hold_tts=True
        with self.browser() as ws:
            self.begin(ws,continuous_input=True);ws.send(self.pcm*2);events=[];deadline=time.monotonic()+3
            while len(self.voice_contexts)<2 and time.monotonic()<deadline:
                try:events.append(json.loads(ws.recv(timeout=.05)))
                except TimeoutError:pass
            self.assertEqual(len(self.voice_contexts),2)
            # Continue realtime input while both output contexts are blocked.
            started=time.monotonic()
            for index in range(4):
                time.sleep(max(0,started+index*.08-time.monotonic()));ws.send(self.pcm*2)
            try:
                while True:events.append(json.loads(ws.recv(timeout=.05)))
            except TimeoutError:pass
            self.assertFalse(any(row['type']=='flow-control' and row.get('paused') for row in events))
            ws.send(json.dumps({'type':'stop'}));deadline=time.monotonic()+2
            while self.counts['cancel']<2 and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(self.counts['cancel'],2);self.assertTrue(self.mixers[0].closed)
            self.assertEqual(self.output_values,[]);self.assertEqual(self.counts['meta'],2)

    def test_continuous_input_requires_an_actual_boolean_before_opening_providers(self):
        with self.browser() as ws:
            ws.send(json.dumps({'type':'start','consent':True,'target_language':'fr','continuous_input':'true'}))
            event=json.loads(ws.recv(timeout=3));self.assertEqual(event['code'],'options')
        self.assertEqual(self.counts['meta'],0);self.assertEqual(self.counts['muse'],0);self.assertEqual(self.counts['cartesia'],0)

    def test_stop_cancels_inflight_translation_no_retry_or_audio_after_stop(self):
        self.slow=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2)
            deadline=time.monotonic()+2
            while not self.counts['meta'] and time.monotonic()<deadline:time.sleep(.01)
            ws.send(json.dumps({'type':'stop'}))
            deadline=time.monotonic()+2
            while not self.mixers[0].closed and time.monotonic()<deadline:time.sleep(.01)
            self.assertTrue(self.mixers[0].closed)
            self.assertFalse(self.audio_seen.is_set())
        self.assertEqual(self.counts['meta'],1)

    def test_provider_rejection_closes_all_without_retry(self):
        self.bad_meta=True
        with self.browser() as ws:
            self.begin(ws);ws.send(self.pcm*2)
            while True:
                event=json.loads(ws.recv(timeout=5))
                if event['type']=='error':break
            self.assertEqual(event['code'],'mt_rejected')
        self.assertEqual(self.counts['meta'],1);self.assertEqual(self.counts['tts_messages'],0)

    def test_continues_beyond_twelve_segments_and_2400_characters_with_manual_voice_change(self):
        self.many_turns=True
        self.bridge.clock=lambda:time.monotonic()*30
        with self.browser() as ws:
            ws.send(json.dumps({'type':'start','consent':True,'target_language':'fr','voice_mode':'masculine'}))
            self.assertTrue(json.loads(ws.recv(timeout=5))['continuous'])
            for index in range(15):
                if index==1:ws.send(json.dumps({'type':'voice_mode','mode':'feminine'}))
                ws.send(self.pcm*2)
                while True:
                    event=json.loads(ws.recv(timeout=5))
                    self.assertNotEqual(event['type'],'error',event)
                    if event['type']=='voice-style':
                        self.assertEqual(event['voice_category'],'masculine' if index==0 else 'feminine')
                    if event['type']=='usage':break
                time.sleep(.08)
            ws.send(json.dumps({'type':'finish'}))
            while True:
                event=json.loads(ws.recv(timeout=5))
                if event['type'] in {'done','error'}:break
            self.assertEqual(event['type'],'done',event)
            self.assertEqual(event['segments'],15);self.assertGreater(event['characters'],2400)
            self.assertGreater(event['session_elapsed_seconds'],30)
        self.assertEqual(self.counts['meta'],15)
        self.assertEqual(self.voices[0],river.VOICES['low'])
        self.assertTrue(all(voice==river.VOICES['high'] for voice in self.voices[1:]))

    def test_invalid_pcm_stops_session_before_translation(self):
        with self.browser() as ws:
            self.begin(ws);ws.send(b'\0'*100)
            event=json.loads(ws.recv(timeout=3));self.assertEqual(event['code'],'pcm')
        self.assertEqual(self.counts['meta'],0)

    def test_slow_first_upstream_write_does_not_turn_normally_arriving_frames_into_a_flood(self):
        original=river.connect
        class SlowFirstWrite:
            def __init__(self,socket):self.socket=socket;self.delayed=False
            def __getattr__(self,name):return getattr(self.socket,name)
            def send(self,value):
                if isinstance(value,bytes) and not self.delayed:self.delayed=True;time.sleep(.28)
                return self.socket.send(value)
        def transport(url,*a,**kw):
            socket=original(url,*a,**kw)
            return SlowFirstWrite(socket) if url==river.MUSE_URL else socket
        with patch.object(river,'connect',transport),self.browser() as ws:
            self.begin(ws);started=time.monotonic()
            for index in range(9):
                time.sleep(max(0,started+index*.08-time.monotonic()));ws.send(self.pcm*2)
            ws.send(json.dumps({'type':'finish'}))
            while True:
                event=json.loads(ws.recv(timeout=5))
                if event['type'] in ('done','error'):break
            self.assertEqual(event['type'],'done',event);self.assertEqual(event['input_bytes'],9*3840)


if __name__=='__main__':unittest.main()
