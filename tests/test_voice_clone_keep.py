"""Local-only: per-speaker clone in inline video, keep/delete choice, kept list.

No Cartesia request: cloner, classifier and acoustic clusters are substitutes.
"""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from packages.providers import river_translation as river
from services.work import voice_agents as agents_module
from services.work.kept_voices import KeptVoices, delete_kept_voice
from services.work.voice_agents import TranslationVoiceAgents, set_voice_keep

CLONE_A = 'f161df88-b5a0-4ea8-aa21-6be12859f761'
CLONE_B = '0b7f6a52-3c1e-4d8a-9a7e-2f5b8c9d1e00'
SECOND = 48000


class Classifier:
    def classify(self, pcm):
        return {'kind':'speech', 'speech_score':.99, 'singing_score':0., 'music_score':0.}


class Cloner:
    def __init__(self, ids):
        self.ids = list(ids); self.deleted = []; self.persisted = []; self.cloned = []
    def __call__(self):
        return self
    def clone(self, pcm, **options):
        self.cloned.append((len(pcm), options)); return {'id':self.ids.pop(0)}
    def delete(self, identifier):
        self.deleted.append(identifier)
    def persist(self, identifier):
        self.persisted.append(identifier)


class Library:
    def __init__(self):
        self.rows = []
    def __call__(self):
        return self
    def add(self, identifier, *, name, language):
        self.rows.append((identifier, name, language))


def feed(agents, key, *, seconds=6, turns=2, offset=0.):
    for index in range(turns):
        start = offset + index * (seconds + 1)
        agents.observe(f'{key}-{offset}-{index}', key, b'\x01\x00' * (seconds * 24000), start, start + seconds)


def wait(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(.01)
    return predicate()


class VoiceCloneKeepTests(unittest.TestCase):
    def agents(self, ids=(CLONE_A, CLONE_B)):
        self.cloner = Cloner(ids); self.library = Library()
        pool = TranslationVoiceAgents(language='en', authorized=True, cloner_factory=self.cloner,
                                      classifier_factory=Classifier, library_factory=self.library)
        self.addCleanup(pool.close)
        return pool

    def finish(self, pool):
        pool.close()
        for thread in pool.threads:
            thread.join(3)

    def test_acoustic_cluster_is_cloned_after_ten_seconds_of_clean_speech(self):
        pool = self.agents()
        feed(pool, 'acoustic:1', seconds=4, turns=2)
        time.sleep(.2)
        self.assertIsNone(pool.voice_for('acoustic:1'), '8 s must not trigger a clone')
        feed(pool, 'acoustic:1', seconds=4, turns=1, offset=20)
        self.assertTrue(wait(lambda: pool.voice_for('acoustic:1') == CLONE_A))
        self.assertEqual(self.cloner.cloned[0][1]['language'], 'en')
        self.assertIsNone(pool.voice_for('acoustic:2'))

    def test_invalid_keys_are_ignored(self):
        pool = self.agents()
        for key in ('acoustic:9', 'acoustic:x', 'AB', 'live:A'):
            feed(pool, key)
        time.sleep(.2)
        self.assertEqual(pool.status()['speakers'], [])

    def test_unkept_voice_is_deleted_when_the_session_ends(self):
        pool = self.agents()
        feed(pool, 'acoustic:1')
        self.assertTrue(wait(lambda: pool.voice_for('acoustic:1')))
        self.finish(pool)
        self.assertEqual(self.cloner.deleted, [CLONE_A])
        self.assertEqual((self.cloner.persisted, self.library.rows), ([], []))
        self.assertEqual(pool.status()['speakers'][0]['outcome'], 'deleted')

    def test_kept_voice_survives_session_and_enters_the_library(self):
        pool = self.agents()
        feed(pool, 'acoustic:1'); feed(pool, 'acoustic:2', offset=40)
        self.assertTrue(wait(lambda: pool.voice_for('acoustic:1') and pool.voice_for('acoustic:2')))
        speakers = {row['label']:row for row in pool.status()['speakers']}
        self.assertFalse(speakers['Hablante 1']['keep'])
        status = set_voice_keep(speakers['Hablante 1']['token'], True)
        self.assertTrue(next(row for row in status['speakers'] if row['label'] == 'Hablante 1')['keep'])
        # Changing your mind back and forth keeps only the last choice.
        set_voice_keep(speakers['Hablante 2']['token'], True); set_voice_keep(speakers['Hablante 2']['token'], False)
        self.finish(pool)
        self.assertEqual(self.cloner.persisted, [CLONE_A])
        self.assertEqual(self.cloner.deleted, [CLONE_B])
        self.assertEqual([row[0] for row in self.library.rows], [CLONE_A])
        self.assertTrue(self.library.rows[0][1].startswith('Hablante 1 · '))
        outcomes = {row['label']:row['outcome'] for row in pool.status()['speakers']}
        self.assertEqual(outcomes, {'Hablante 1':'kept', 'Hablante 2':'deleted'})

    def test_library_failure_deletes_instead_of_leaving_an_untracked_voice(self):
        pool = self.agents()
        class Broken:
            def __call__(self):return self
            def add(self, *_, **__):raise OSError('disk full')
        pool.library_factory = Broken()
        feed(pool, 'acoustic:1')
        self.assertTrue(wait(lambda: pool.voice_for('acoustic:1')))
        set_voice_keep(pool.status()['speakers'][0]['token'], True)
        self.finish(pool)
        self.assertEqual((self.cloner.deleted, self.cloner.persisted), ([CLONE_A], []))

    def test_keep_rejects_unknown_or_malformed_tokens(self):
        self.agents()
        for token, keep in (('0' * 32, True), ('nope', True), ('a' * 32, 'yes')):
            with self.assertRaises(ValueError):
                set_voice_keep(token, keep)


class TrackerResolverTests(unittest.TestCase):
    class Cluster:
        def associate(self, sample):
            return {'cluster':2, 'similarity':.9, 'reason':'matched', 'windows':1, 'latency_ms':0.}

    def tracker(self):
        resolved = []
        def resolver(key):
            resolved.append(key); return CLONE_A if key == 'acoustic:2' else None
        tracker = river.SpeakerTracker(voice_resolver=resolver)
        tracker.enable_acoustic(self.Cluster())
        tracker.associate('turn-1', b'sample')
        return tracker, resolved

    def test_auto_mode_uses_the_clone_of_the_acoustic_cluster(self):
        tracker, resolved = self.tracker()
        voice = tracker.voice('turn-1', b'', 'auto', stopped=threading.Event())
        self.assertEqual((voice['voice_id'], voice['cloned'], voice['method']), (CLONE_A, True, 'authorized_voice_clone'))
        self.assertEqual(resolved, ['acoustic:2'])

    def test_manual_voice_mode_never_uses_a_clone(self):
        tracker, resolved = self.tracker()
        voice = tracker.voice('turn-1', b'', 'masculine', stopped=threading.Event())
        self.assertFalse(voice['cloned']); self.assertEqual(resolved, [])


class KeptLibraryTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'kept.json'; self.library = KeptVoices(self.path)

    def test_stores_only_id_name_language_and_time(self):
        self.library.add(CLONE_A, name='Hablante 1 · prueba', language='en')
        row = json.loads(self.path.read_text(encoding='utf-8'))[0]
        self.assertEqual(set(row), {'id', 'name', 'language', 'kept_at'})
        self.assertEqual([item['id'] for item in self.library.list()], [CLONE_A])

    def test_delete_only_accepts_listed_voices_and_removes_after_provider_delete(self):
        deleted = []
        class Remote:
            def delete(self, identifier):deleted.append(identifier)
        self.library.add(CLONE_A, name='Hablante 1', language='en')
        with self.assertRaises(ValueError):
            delete_kept_voice(CLONE_B, library=self.library, cloner_factory=Remote)
        self.assertEqual(delete_kept_voice(CLONE_A, library=self.library, cloner_factory=Remote), [])
        self.assertEqual(deleted, [CLONE_A])

    def test_failed_provider_delete_keeps_the_local_entry(self):
        class Remote:
            def delete(self, identifier):raise OSError('offline')
        self.library.add(CLONE_A, name='Hablante 1', language='en')
        with self.assertRaises(OSError):
            delete_kept_voice(CLONE_A, library=self.library, cloner_factory=Remote)
        self.assertEqual(len(self.library.list()), 1)


if __name__ == '__main__':
    unittest.main()


class InlineVideoCloneTests(unittest.TestCase):
    """Real synchronized relay + River pipeline with loopback ASR/TTS fixtures."""
    def setUp(self):
        from tests.test_inline_timbre_pipeline import InlineTimbrePipelineTests
        self.inline = InlineTimbrePipelineTests('test_mt_starts_during_model_work_and_first_tts_waits_for_timbre')
        self.inline.setUp(); self.addCleanup(self.inline.doCleanups)
        self.inline.release_model.set()
        harness = self.inline.harness; self.observed = []; owner = self
        class Agents:
            def observe(self, turn, key, pcm, start, end):
                owner.observed.append((key, len(pcm), round(end - start, 3)))
            def voice_for(self, key):
                return CLONE_A if key == 'acoustic:1' else None
            def status(self):
                return {'agents':[], 'speakers':[]}
            def close(self):
                pass
        relay = harness.relay; original = relay.bridge_factory
        def build():
            bridge = original(); bridge.voice_agents_factory = Agents; return bridge
        relay.bridge_factory = build

    def test_inline_piece_feeds_its_acoustic_cluster_and_speaks_with_its_clone(self):
        harness = self.inline.harness
        with harness.socket(inline=True) as socket:
            socket.send(harness.fixture.pcm * 2)
            self.inline.collect_until(socket, lambda event: event.get('stage') == 'tts_request')
            socket.send(json.dumps({'type':'finish'}))
            events = self.inline.collect_until(socket, lambda event: event['type'] == 'done')
        self.assertTrue(self.observed, 'The inline piece must reach the clone agent')
        key, size, seconds = self.observed[0]
        self.assertEqual(key, 'acoustic:1')
        self.assertAlmostEqual(size / SECOND, seconds, places=2)
        self.assertEqual(harness.fixture.voices, [CLONE_A])


class DirectPacingTests(unittest.TestCase):
    """Direct capture sends phrases, not single words, at a catch-up pace."""
    def setUp(self):
        from tests.test_river_translation import PipelineTests
        self.pipeline = PipelineTests('test_actual_protocols_deduplicate_partials_and_reuse_connections')
        self.pipeline.setUp(); self.addCleanup(self.pipeline.tearDown)

    def test_word_deltas_are_grouped_into_phrases_with_one_pace(self):
        words = ['Hello ', 'my ', 'friend, ', 'this ', 'is ', 'a ', 'long ', 'sentence ', 'about ',
                 'cocoa ', 'farming ', 'and ', 'chocolate ', 'bars ', 'today.']
        class WordByWord:
            def stream(self, *_):
                for word in words:
                    time.sleep(.15)  # slower than the old 120 ms per-word flush
                    yield word
            def close(self):
                pass
        sent = []; original = river.connect
        class Recorder:
            def __init__(self, socket):self.socket = socket
            def send(self, message):
                event = json.loads(message)
                if 'transcript' in event:sent.append(event)
                return self.socket.send(message)
            def __getattr__(self, name):return getattr(self.socket, name)
        def connect(url, **options):
            socket = original(url, **options)
            return Recorder(socket) if url == river.CARTESIA_URL else socket
        self.pipeline.bridge.translator_factory = WordByWord
        with patch.object(river, 'connect', connect), self.pipeline.browser() as ws:
            self.pipeline.begin(ws); ws.send(self.pipeline.pcm * 2)
            ws.send(json.dumps({'type':'finish'}))
            while json.loads(ws.recv(timeout=15))['type'] not in {'done', 'error'}:
                pass
        first = [event for event in sent if event['context_id'] == sent[0]['context_id']]
        pieces = [event['transcript'] for event in first if event['transcript']]
        self.assertEqual(''.join(pieces), ''.join(words))
        self.assertLessEqual(len(pieces), 4, pieces)
        self.assertTrue(all(len(piece) >= river.DIRECT_FIRST_CHUNK or piece.rstrip().endswith('.') for piece in pieces[:-1]), pieces)
        self.assertFalse(any(piece.rstrip().endswith(',') for piece in pieces[:-1]), pieces)
        speeds = {event.get('generation_config', {}).get('speed') for event in first}
        self.assertEqual(len(speeds), 1, 'One pace per sentence')
        self.assertGreaterEqual(speeds.pop(), river.DIRECT_BASE_SPEED)

    def test_direct_speed_rises_with_backlog_and_is_bounded(self):
        self.assertEqual(river.direct_delivery_speed(0), river.DIRECT_BASE_SPEED)
        self.assertGreater(river.direct_delivery_speed(2), river.direct_delivery_speed(1))
        self.assertEqual(river.direct_delivery_speed(50), river.DIRECT_MAX_SPEED)
        self.assertEqual(river.direct_delivery_speed(-3), river.DIRECT_BASE_SPEED)


class DirectRecoveryAndLiveCloningTests(unittest.TestCase):
    """WorkLiveTranslation with local route/bridge substitutes; no devices."""
    def owner(self, failures=(), **options):
        from tests.test_work_translation import Route, Bridge
        from services.work.live_translation import WorkLiveTranslation
        self.bridges = []; script = list(failures); owner_self = self
        class Failing(Bridge):
            def handle(self, peer):
                if script:
                    code = script.pop(0); peer.recv(); peer.send(json.dumps({'type':'ready'}))
                    peer.send(json.dumps({'type':'error', 'code':code, 'message':'synthetic '+code}))
                    return
                super().handle(peer)
        def bridge(*args, **kwargs):
            value = Failing(*args, **kwargs); value.voice_agents = None; self.bridges.append(value); return value
        owner = WorkLiveTranslation(route_factory=Route, bridge_factory=bridge, output_factory=lambda **kw:None,
                                    configuration=lambda:{'configured':True, 'access_blocked':False},
                                    recovery_delay=.01, **options)
        self.addCleanup(owner.close); return owner

    def test_recoverable_failure_reconnects_without_stopping_the_session(self):
        owner = self.owner(['tts_timeout', 'translation_interrupted'])
        owner.start('en', 'auto')
        self.assertTrue(wait(lambda: len(self.bridges) == 3 and self.bridges[-1].inputs))
        status = owner.status()
        self.assertTrue(status['active']); self.assertEqual(status['recoveries'], 2); self.assertEqual(status['error'], '')

    def test_fatal_failure_still_stops_with_its_message(self):
        owner = self.owner(['cartesia_quota'])
        owner.start('en', 'auto')
        self.assertTrue(wait(lambda: owner.status()['state'] == 'error' and not owner.status()['active']))
        self.assertEqual(len(self.bridges), 1); self.assertEqual(owner.status()['error'], 'synthetic cartesia_quota')

    def test_repeated_failures_are_bounded(self):
        from services.work.live_translation import RECOVERY_LIMIT
        owner = self.owner(['tts_timeout'] * (RECOVERY_LIMIT + 3))
        owner.start('en', 'auto')
        self.assertTrue(wait(lambda: not owner.status()['active'], timeout=5))
        self.assertEqual(len(self.bridges), RECOVERY_LIMIT + 1)

    def test_cloning_toggles_mid_session_without_a_new_provider_session(self):
        made = []
        class Agents:
            def __init__(self, language):self.language = language; self.closed = False; made.append(self)
            def status(self):return {'agents':[], 'speakers':[]}
            def close(self):self.closed = True
        owner = self.owner(voice_agents_factory=Agents)
        owner.start('en', 'auto')
        self.assertTrue(wait(lambda: self.bridges and self.bridges[0].inputs))
        owner.set_voice_cloning(True, 'es')
        self.assertEqual(len(self.bridges), 1, 'Enabling cloning must not restart translation')
        self.assertIs(self.bridges[0].voice_agents, made[0]); self.assertTrue(owner.status()['voice_cloning_active'])
        count = len(self.bridges[0].inputs)
        self.assertTrue(wait(lambda: len(self.bridges[0].inputs) > count), 'Audio keeps flowing')
        owner.set_voice_cloning(False, 'es')
        self.assertTrue(made[0].closed); self.assertIsNone(self.bridges[0].voice_agents)
        self.assertEqual(len(self.bridges), 1)

    def test_clones_survive_reconnect_and_close_once_at_session_end(self):
        made = []
        class Agents:
            def __init__(self, language):self.closed = 0; made.append(self)
            def status(self):return {'agents':[], 'speakers':[]}
            def close(self):self.closed += 1
        owner = self.owner(['tts_timeout'], voice_agents_factory=Agents,
                           cloning_settings=lambda:{'enabled':True, 'language':'en'})
        owner.start('en', 'auto')
        self.assertTrue(wait(lambda: len(self.bridges) == 2 and self.bridges[-1].inputs))
        self.assertEqual(len(made), 1); self.assertIs(self.bridges[-1].voice_agents, made[0]); self.assertEqual(made[0].closed, 0)
        owner.close()
        self.assertTrue(wait(lambda: made[0].closed == 1))


class CloneContinuityTests(unittest.TestCase):
    """A ready clone keeps being used: short/borderline pieces and reconnects."""
    def tracker(self, session):
        tracker = river.SpeakerTracker(voice_resolver=lambda key: CLONE_A if key == 'acoustic:1' else None)
        tracker.enable_acoustic(session); return tracker

    def voice(self, tracker, turn):
        tracker.associate(turn, b'sample')
        return tracker.voice(turn, b'', 'auto', stopped=threading.Event())

    def test_short_piece_with_one_known_speaker_keeps_the_clone(self):
        class Session:
            def associate(self, sample):return {'cluster':None, 'similarity':None, 'reason':'invalid_sample', 'windows':0, 'latency_ms':0.}
            def only_cluster(self):return 1
        voice = self.voice(self.tracker(Session()), 't1')
        self.assertEqual((voice['voice_id'], voice['cloned'], voice['speaker_label']), (CLONE_A, True, 'Hablante 1'))

    def test_borderline_piece_uses_the_leading_speaker_without_learning(self):
        from packages.providers.acoustic_speakers import SessionSpeakers
        import numpy as np
        vectors = {}
        def extract(pcm):
            return {'available':True, 'reason':'speech_embedding', 'windows':1, 'latency_ms':0., 'embedding':vectors[pcm]}
        base = np.zeros(192, dtype=np.float32); base[0] = 1
        other = np.zeros(192, dtype=np.float32); other[1] = 1
        mixed = np.zeros(192, dtype=np.float32); mixed[0], mixed[1], mixed[2] = .58, .5, .643  # cos .58 vs .50
        vectors.update({b'a':base, b'b':other, b'm':mixed})
        session = SessionSpeakers(extractor=extract)
        session.associate(b'a'); session.associate(b'b')
        centre = session.clusters[1]['center'].copy()
        result = session.associate(b'm')
        self.assertEqual((result['cluster'], result['reason'], result.get('best_cluster')), (None, 'ambiguous_match', 1))
        self.assertTrue(np.allclose(centre, session.clusters[1]['center']), 'A tentative match must not train the cluster')
        tracker = self.tracker(session)
        tracker.associate('ta', b'a'); tracker.associate('tm', b'm')
        voice = tracker.voice('tm', b'', 'auto', stopped=threading.Event())
        self.assertEqual(voice['voice_id'], CLONE_A)

    def test_unknown_with_several_speakers_and_no_leader_stays_catalog(self):
        class Session:
            def associate(self, sample):return {'cluster':None, 'similarity':None, 'reason':'invalid_sample', 'windows':0, 'latency_ms':0.}
            def only_cluster(self):return None
        voice = self.voice(self.tracker(Session()), 't1')
        self.assertFalse(voice['cloned'])

    def test_reconnect_reuses_the_same_clusters(self):
        from tests.test_work_translation import Route, Bridge
        from services.work.live_translation import WorkLiveTranslation
        bridges = []; script = ['tts_timeout']
        class Failing(Bridge):
            def handle(self, peer):
                if script:
                    script.pop(); peer.recv(); peer.send(json.dumps({'type':'ready'}))
                    peer.send(json.dumps({'type':'error', 'code':'tts_timeout', 'message':'x'})); return
                super().handle(peer)
        def bridge(*a, **k):
            value = Failing(*a, **k); value.voice_agents = None; value.acoustic_session = None; bridges.append(value); return value
        owner = WorkLiveTranslation(route_factory=Route, bridge_factory=bridge, output_factory=lambda **kw:None,
                                    configuration=lambda:{'configured':True, 'access_blocked':False}, recovery_delay=.01)
        self.addCleanup(owner.close); owner.start('en', 'auto')
        self.assertTrue(wait(lambda: len(bridges) == 2 and bridges[-1].inputs))
        self.assertIsNotNone(bridges[0].acoustic_session)
        self.assertIs(bridges[0].acoustic_session, bridges[1].acoustic_session)

    def test_speaker_label_follows_the_cluster_number(self):
        class Session:
            def associate(self, sample):return {'cluster':3, 'similarity':.9, 'reason':'matched', 'windows':1, 'latency_ms':0.}
        voice = self.voice(self.tracker(Session()), 't1')
        self.assertEqual(voice['speaker_label'], 'Hablante 3')
