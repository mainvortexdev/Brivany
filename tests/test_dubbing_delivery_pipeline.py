"""Check real TTS request timing guidance with local protocol substitutes."""
import base64
import json
import threading
import time
import unittest
from unittest.mock import patch

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from packages.providers import river_translation as river
from tests import test_sync_relay as sync_fixture
from packages.providers.prefix_translation import PreparedPrefix,PrefixTurn,PREFIX_BYTES
from services.work.video_prefix import VideoPrefixCache,Entry


class DubbingDeliveryPipelineTests(unittest.TestCase):
    def run_delivery(self, source, parts, *, padded=False, tts_error=None):
        harness=sync_fixture.SynchronizedPipelineTests(
            'test_partials_never_trigger_mt_final_cue_has_real_boundaries_and_no_native_output')
        harness.setUp()
        requests=[]

        class Translator:
            def stream(self,*_):yield from parts
            def close(self):pass

        def tts(socket):
            try:
                for raw in socket:
                    event=json.loads(raw)
                    if event.get('cancel'):continue
                    requests.append(event)
                    if tts_error:
                        socket.send(json.dumps({'type':'error','context_id':event['context_id'],**tts_error}))
                        continue
                    if event['transcript']:
                        audio = harness.fixture.pcm
                        if padded:
                            audio = bytes(4800) + audio + bytes(4800)
                        socket.send(json.dumps({'type':'chunk','context_id':event['context_id'],
                            'data':base64.b64encode(audio).decode()}))
                    if event['continue'] is False:
                        socket.send(json.dumps({'type':'done','context_id':event['context_id']}))
            except ConnectionClosed:pass

        server=serve(tts,'127.0.0.1',0,compression=None)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        harness.expressive=False;harness.translator_factory=Translator
        harness.final_text=source;harness.release.set()
        try:
            with patch.object(river,'CARTESIA_URL',f'ws://127.0.0.1:{server.socket.getsockname()[1]}'),harness.socket(inline=True) as socket:
                socket.send(harness.fixture.pcm*2);socket.send(json.dumps({'type':'finish'}))
                events=[]
                while True:
                    event=json.loads(socket.recv(timeout=4));events.append(event)
                    if event['type'] in {'done','error'}:break
                self.assertEqual(event['type'],'error' if tts_error else 'done',event)
                self.assertEqual(harness.handshakes[0]['mode'],'DIARIZATION')
            self.assertEqual(''.join(row['transcript'] for row in requests),''.join(parts))
            return requests,events
        finally:
            server.shutdown();harness.tearDown()

    def test_expanded_translation_uses_spoken_words_not_short_source(self):
        translation='Ne changez pas les douze kilos et ne les ajoutez pas.'
        requests,events=self.run_delivery('Do not.',[translation])
        self.assertTrue(requests)
        self.assertTrue(all(row['generation_config']['speed']==1.5 for row in requests))
        cue=next(row for row in events if row['type']=='dub-cue')
        self.assertEqual((cue['source_start_ms'],cue['source_end_ms']),(100,1040))

    def test_short_translation_does_not_inherit_dense_source_acceleration(self):
        requests,_=self.run_delivery('Do not change any of these values or omit anything here.', ['Non.'])
        self.assertTrue(all('speed' not in row.get('generation_config',{}) for row in requests))

    def test_inline_cue_removes_only_synthesis_edge_padding_and_reports_it(self):
        _, events = self.run_delivery('Owned speech.', ['Parole propre.'], padded=True)
        cue = next(row for row in events if row['type'] == 'dub-cue')
        raw = base64.b64decode(cue['pcm_base64'])
        ready = next(row for row in events if row.get('stage') == 'cue_ready')
        done = next(row for row in events if row.get('stage') == 'tts_done')
        self.assertAlmostEqual(ready['leading_padding_ms'], 70, delta=1)
        self.assertAlmostEqual(ready['trailing_padding_ms'], 70, delta=1)
        self.assertAlmostEqual(done['audio_ms'] - ready['audio_ms'], 140, delta=2)
        self.assertEqual(len(raw) / 48, ready['audio_ms'])
        self.assertEqual((cue['source_start_ms'], cue['source_end_ms']), (100, 1040))

    def test_provider_quota_is_actionable_without_replaying_or_exporting_provider_text(self):
        requests,events=self.run_delivery('Owned speech.',['Parole propre.'],tts_error={
            'status_code':402,'error_code':'quota_exceeded','message':'untrusted provider body','request_id':'unsafe'})
        error=events[-1]
        self.assertEqual((error['code'],error['provider_status']),('cartesia_quota',402))
        self.assertIn('cuota',error['message'])
        self.assertEqual(len(requests),1)
        self.assertFalse(any(row['type'] in {'dub-cue','done'} for row in events))
        self.assertNotIn('untrusted provider body',json.dumps(events))
        self.assertNotIn('unsafe',json.dumps(events))

    def test_streaming_continuations_keep_the_first_delivery_guidance(self):
        parts=['Voici une première phrase assez longue avec les douze kilos. Et',
               ' voici la deuxième phrase à conserver intégralement.']
        requests,_=self.run_delivery('Short source.',parts)
        self.assertGreaterEqual(len(requests),2)
        self.assertEqual(len({row['context_id'] for row in requests}),1)
        self.assertTrue(all(row['generation_config']['speed']==1.5 for row in requests))

    def test_completed_tts_duration_guides_a_later_request_for_the_same_catalog_voice(self):
        harness=sync_fixture.SynchronizedPipelineTests(
            'test_partials_never_trigger_mt_final_cue_has_real_boundaries_and_no_native_output')
        harness.setUp();requests=[]
        class Translator:
            def stream(self,*_):yield 'One two three four five six seven.'
            def close(self):pass
        turns=tuple(PrefixTurn(str(i),i*2000,(i+1)*2000,None,'Owned source phrase.','unknown',None) for i in range(3))
        prepared=PreparedPrefix(7000,7000,turns,bytes(PREFIX_BYTES))
        source='youtube:sr_iLGKNsxU';identifier='r'*32
        pairing=harness.relay.issue_pairing();token=harness.relay.pair(pairing['code'],sync_fixture.ORIGIN)['token']
        harness.relay.video_prefix=VideoPrefixCache(lambda *_args,**_kwargs:prepared)
        harness.relay.video_prefix.entries['test']=Entry(identifier,token,source,0,time.monotonic()+600,prepared)
        def tts(socket):
            try:
                for raw in socket:
                    event=json.loads(raw)
                    if event.get('cancel'):continue
                    requests.append(event)
                    # A produced 3.44 s waveform for a 2 s source slot exposes
                    # slow synthesis, independent of HTTP wait or playback rate.
                    socket.send(json.dumps({'type':'chunk','context_id':event['context_id'],
                        'data':base64.b64encode(harness.fixture.pcm*86).decode()}))
                    if event['continue'] is False:
                        time.sleep(.04)
                        socket.send(json.dumps({'type':'done','context_id':event['context_id']}))
            except ConnectionClosed:pass
        server=serve(tts,'127.0.0.1',0,compression=None)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        harness.translator_factory=Translator;harness.expressive=False
        try:
            with patch.object(river,'CARTESIA_URL',f'ws://127.0.0.1:{server.socket.getsockname()[1]}'),harness.socket(
                inline=True,token=token,prefix_options={'prefix_id':identifier,'prefix_source':source,'prefix_position_ms':0}) as socket:
                socket.send(json.dumps({'type':'finish'}));events=[]
                while True:
                    event=json.loads(socket.recv(timeout=4));events.append(event)
                    self.assertNotEqual(event['type'],'error',event)
                    if event['type']=='done':break
            self.assertEqual(len(requests),3)
            self.assertEqual(len({request['voice'] for request in requests}),1)
            self.assertEqual(requests[0]['generation_config']['speed'],1.167)
            self.assertEqual(requests[-1]['generation_config']['speed'],1.5)
            self.assertTrue(all(request['transcript']=='One two three four five six seven.' for request in requests))
            self.assertEqual(len([event for event in events if event['type']=='dub-cue']),3)
            done=[event for event in events if event.get('stage')=='tts_done']
            self.assertEqual(len(done), 3)
            self.assertTrue(all(event['audio_ms']==3440 and event['translated_word_count']==7 for event in done))
            self.assertTrue(all(event['request_to_last_chunk_ms'] >= 0 and event['last_chunk_to_done_ms'] >= 30 for event in done))
        finally:
            server.shutdown();harness.tearDown()
