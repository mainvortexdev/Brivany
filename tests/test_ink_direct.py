"""Local-only: Cartesia Ink-2 adapter and direct capture with speaker distinction.

No Cartesia, Muse or Meta request: Ink, clusters and providers are substitutes.
"""
import json
import threading
import time
import unittest
from unittest.mock import patch

from websockets.exceptions import ConnectionClosedOK

from packages.providers import ink_asr
from packages.providers import river_translation as river

SECOND = 48000


class InkAdapterTests(unittest.TestCase):
    def adapter(self):
        class Socket:
            def __init__(self):self.sent = []; self.release = threading.Event()
            def send(self, data):self.sent.append(data)
            def __iter__(self):
                self.release.wait(5); return iter(())
            def close(self):self.release.set()
        self.socket = Socket()
        ink = ink_asr.InkAsrSocket(connector=lambda *a, **k: self.socket, key='synthetic-only')
        self.addCleanup(ink.close); return ink

    def test_url_uses_ink2_pcm_24k_and_dated_version(self):
        url = ink_asr.ink_url()
        for part in ('/stt/turns/websocket', 'model=ink-2', 'encoding=pcm_s16le', 'sample_rate=24000', 'cartesia_version=2026-08-14'):
            self.assertIn(part, url)

    def test_events_map_to_muse_shape_with_audio_position(self):
        ink = self.adapter()
        ink.send(b'\x00\x00' * 24000)  # 1 s sent
        self.assertEqual(ink.translate({'type':'turn.start', 'turn_id':'7'}),
                         [{'type':'speechStart', 'turnId':'7', 'audioProcessedMs':1000.0}])
        self.assertEqual(ink.translate({'type':'turn.update', 'transcript':'Hola a'})[0]['transcript'], 'Hola a')
        final = ink.translate({'type':'turn.end', 'turn_id':'7', 'transcript':'Hola a todos.'})[0]
        self.assertEqual((final['type'], final['turnId'], final['transcript']), ('speechComplete', '7', 'Hola a todos.'))
        self.assertEqual(ink.translate({'type':'turn.eager_end', 'transcript':'Hola'}), [])
        self.assertEqual(ink.translate({'type':'error', 'message':'quota'})[0]['type'], 'error')

    def test_end_waits_for_the_open_turn_then_closes_cleanly(self):
        ink = self.adapter()
        ink.send(json.dumps({'type':'start'}))
        self.assertIn('sessionId', json.loads(ink.recv(timeout=1)))
        ink.translate({'type':'turn.start', 'turn_id':'1'})
        ink.send(json.dumps({'type':'endStream'}))
        self.assertNotIn('finalize', self.socket.sent, 'The turns endpoint rejects finalize')
        with self.assertRaises(TimeoutError):
            ink.recv(timeout=.2)  # still waiting for the open turn
        self.assertEqual(ink.translate({'type':'error', 'message':'closing'}), [], 'No failure while closing')
        for event in ink.translate({'type':'turn.end', 'turn_id':'1', 'transcript':'fin.'}):
            ink._put(event)
        self.assertEqual(json.loads(ink.recv(timeout=1))['type'], 'speechComplete')
        with self.assertRaises(ConnectionClosedOK):
            ink.recv(timeout=1)

    def test_missing_key_is_rejected(self):
        with self.assertRaises(ValueError):
            ink_asr.InkAsrSocket(connector=lambda *a, **k: None, key='')

    def test_status_requires_cartesia_not_muse_for_ink(self):
        with patch.dict('os.environ', {'BRIVANY_CARTESIA_API_KEY':'synthetic-only'}), \
             patch.object(river, 'muse_key', return_value=''):
            self.assertTrue(river.river_status(asr='ink')['stages']['asr'])
            self.assertFalse(river.river_status()['stages']['asr'])


TURNS = [
    [{'type':'turn.start', 'turn_id':'1'}, {'type':'turn.update', 'transcript':'Hola a todos.'},
     {'type':'turn.end', 'turn_id':'1', 'transcript':'Hola a todos.'}],
    [{'type':'turn.start', 'turn_id':'2'}, {'type':'turn.update', 'transcript':'Gracias por venir.'},
     {'type':'turn.end', 'turn_id':'2', 'transcript':'Gracias por venir.'}]]


class FakeInk:
    """Speaks Ink-2 events as Muse-shaped JSON after enough audio arrived."""
    def __init__(self, **_):
        # Each turn starts, then ends 2.4 s (30 frames) later, like real speech.
        self.queue = []; self.frames = 0
        self.script = {10:[TURNS[0][0]], 40:TURNS[0][1:], 50:[TURNS[1][0]], 80:TURNS[1][1:]}
    def send(self, data):
        if isinstance(data, bytes):
            self.frames += 1
            for event in self.script.pop(self.frames, []):
                self.queue.extend(json.dumps(item) for item in self._translate(event))
            return
        kind = json.loads(data).get('type')
        if kind == 'start':self.queue.append(json.dumps({'sessionId':'fake'}))
        elif kind == 'endStream':self.queue.append(None)
    def _translate(self, event):
        mapping = {'turn.start':'speechStart', 'turn.update':'transcript', 'turn.end':'speechComplete'}
        out = {'type':mapping[event['type']], 'audioProcessedMs':self.frames * 80}
        if 'turn_id' in event:out['turnId'] = event['turn_id']
        if 'transcript' in event:out['transcript'] = event['transcript']
        return [out]
    def recv(self, timeout=None):
        deadline = time.monotonic() + (timeout or 0)
        while not self.queue:
            if time.monotonic() >= deadline:raise TimeoutError()
            time.sleep(.005)
        item = self.queue.pop(0)
        if item is None:raise ConnectionClosedOK(None, None)
        return item
    def close(self):pass


class InkDirectPipelineTests(unittest.TestCase):
    """Real River relay in direct capture; Ink, clusters, Meta and Sonic local."""
    def setUp(self):
        from tests.test_river_translation import PipelineTests
        self.pipeline = PipelineTests('test_actual_protocols_deduplicate_partials_and_reuse_connections')
        self.pipeline.setUp(); self.addCleanup(self.pipeline.tearDown)
        self.pipeline.bridge.asr_provider = 'ink'

    def run_turns(self, clusters, agents=None):
        order = list(clusters)
        class Clusters:
            def associate(self, sample):
                return {'cluster':order.pop(0) if order else None, 'similarity':.9, 'reason':'new_cluster', 'windows':1, 'latency_ms':0.}
        muse_before = self.pipeline.counts['muse']
        if agents:self.pipeline.bridge.voice_agents = agents
        with patch.object(ink_asr, 'InkAsrSocket', FakeInk), patch.object(river, 'SessionSpeakers', Clusters), \
             patch.object(river, 'warm_speaker_embedding', return_value=True), \
             patch.object(river.PCMRateGate, 'accept', return_value=True), self.pipeline.browser() as ws:
            self.pipeline.begin(ws, continuous_input=True, diarization=True)
            for _ in range(110):
                ws.send(self.pipeline.pcm * 2); time.sleep(.004)
            ws.send(json.dumps({'type':'finish'})); events = []
            while True:
                event = json.loads(ws.recv(timeout=10)); events.append(event)
                if event['type'] in {'done', 'error'}:break
        self.assertEqual(event['type'], 'done', events[-3:])
        self.assertEqual(self.pipeline.counts['muse'], muse_before, 'The Ink path must not open Muse')
        return [row for row in events if row['type'] == 'voice-style']

    def test_two_speakers_get_two_labels_and_two_distinct_voices(self):
        voices = self.run_turns([1, 2])
        self.assertEqual([row['speaker_label'] for row in voices], ['Hablante 1', 'Hablante 2'])
        self.assertEqual(len({row['voice_id'] for row in voices}), 2, voices)
        self.assertTrue(all(row['speaker_source'] == 'local_acoustic_embedding' for row in voices))

    def test_same_speaker_keeps_one_voice(self):
        voices = self.run_turns([1, 1])
        self.assertEqual({row['speaker_label'] for row in voices}, {'Hablante 1'})
        self.assertEqual(len({row['voice_id'] for row in voices}), 1)

    def test_turn_samples_feed_clone_agents_by_cluster(self):
        seen = []
        class Agents:
            def observe(self, turn, key, pcm, start, end):seen.append((key, round(end - start, 3), round(len(pcm) / SECOND, 3)))
            def voice_for(self, key):return None
            def status(self):return {'agents':[], 'speakers':[]}
            def close(self):pass
        self.run_turns([1, 2], agents=Agents())
        self.assertEqual([row[0] for row in seen], ['acoustic:1', 'acoustic:2'])
        self.assertTrue(all(row[1] == row[2] for row in seen), seen)


class LiveVoiceSuppressionTests(InkDirectPipelineTests):
    """While captions drive the dub, live audio only identifies speakers."""
    def test_suppressed_live_path_makes_no_translation_or_speech_but_tracks_voice(self):
        seen = []
        class Agents:
            def observe(self, turn, key, pcm, start, end):seen.append(key)
            def voice_for(self, key):return 'clone-1' if key == 'acoustic:1' else None
            def status(self):return {'agents':[], 'speakers':[]}
            def close(self):pass
        self.pipeline.bridge.live_voice_suppressed = lambda: True
        meta_before = self.pipeline.counts['meta']; tts_before = self.pipeline.counts['tts_messages']
        voices = self.run_turns([1, 1], agents=Agents())
        self.assertEqual(voices, [], 'No live voice while captions are scheduled')
        self.assertEqual((self.pipeline.counts['meta'], self.pipeline.counts['tts_messages']), (meta_before, tts_before))
        self.assertEqual(seen, ['acoustic:1', 'acoustic:1'], 'Clone samples keep flowing')
        self.assertEqual(self.pipeline.bridge.voice_hint_value, 'clone-1', 'The scheduler gets the speaker clone')

    # The parent tests run with the live voice active; do not repeat them here.
    test_two_speakers_get_two_labels_and_two_distinct_voices = None
    test_same_speaker_keeps_one_voice = None
    test_turn_samples_feed_clone_agents_by_cluster = None


if __name__ == '__main__':
    unittest.main()
