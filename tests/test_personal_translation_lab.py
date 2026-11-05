"""Local-only guards for the installed-extension observation relay."""
from copy import deepcopy
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from tools.personal_translation_lab import (
    Config, EXPECTED_BUILD, EXPECTED_VIDEO, Handler, ObservedPeer,
    PersonalLab, Server, safe_event, validate_observation,
)


def observation():
    return {'source_video_id': EXPECTED_VIDEO, 'brivany_build': EXPECTED_BUILD, 'protocol': 2,
        'stats': {'lag': 5., 'capture': 8., 'media': 3., 'source_anchor': 300., 'source_rate': 1.,
            'completed_voice_count': 1, 'completed_voices_with_signal': 1, 'signaled_voices': 1,
            'first_signal_after_capture_ms': 5000., 'initial_lag': 5., 'maximum_lag': 5.,
            'maximum_lag_growth': 0., 'completed_voices': [
                {'source_start': 0., 'source_end': 2., 'category': 'masculine', 'provisional': True,
                 'speaker': 1, 'rate': 1., 'audio_seconds': 2., 'wall_seconds': 2.,
                 'peak': .5, 'signal_measured': True}]}}


CUE = {'type': 'dub-cue', 'source_start_ms': 0., 'source_end_ms': 2000.,
       'voice_category': 'masculine', 'voice_category_provisional': True, 'speaker_index': 1}


class FakeRelay:
    def __init__(self, **options):
        self.options = options
        self.connected = True
        self.requests = self.closes = 0
        self.after_request = lambda: None

    def start(self):
        return self

    def status(self):
        return {'workspace_connected': self.connected}

    def request_video(self, **options):
        self.requests += 1
        self.after_request()
        return {'requested': True}

    def close(self):
        self.closes += 1


class PersonalObservationTests(unittest.TestCase):
    def test_configuration_and_explicit_opt_in_bound_the_trial(self):
        with self.assertRaises(ValueError):
            PersonalLab(Config())
        for kwargs in ({'seconds': 121}, {'seconds': True}, {'connect_timeout': 31},
                       {'relay_port': 48218}, {'port': 48217}, {'target': 'xx'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                Config(**kwargs)

    def test_loopback_relay_has_no_pre_run_provider_opening(self):
        built = []
        lab = PersonalLab(Config(), allow_paid=True, relay_factory=FakeRelay,
                          configure=lambda: None, bridge_builder=lambda: built.append(True)).open_relay()
        self.addCleanup(lab.close)
        self.assertEqual(lab.relay.options['port'], 48217)
        self.assertEqual(lab.relay.requests, 0)
        with self.assertRaises(ValueError):
            lab.build_bridge()
        with self.assertRaises(ValueError):
            lab.prepare_prefix(b'audio must not be consumed', cancelled=threading.Event())
        self.assertEqual(built, [])
        self.assertEqual(lab.counts['relay_sessions_started'], 0)
        self.assertEqual(lab.counts['prefix_preparations_started'], 0)

    def test_busy_production_port_does_not_retry_or_choose_a_fallback(self):
        calls = []
        class Busy(FakeRelay):
            def start(self):
                calls.append(self.options['port'])
                raise OSError('busy')
        lab = PersonalLab(Config(), allow_paid=True, relay_factory=Busy, configure=lambda: None)
        with self.assertRaisesRegex(RuntimeError, '48217'):
            lab.open_relay()
        self.assertEqual(calls, [48217])
        self.assertEqual(lab.error_code, 'relay_port_busy')

    def test_single_normal_request_stops_at_deadline_and_persists_no_media(self):
        clock = [1.]
        lab = PersonalLab(Config(seconds=10, connect_timeout=1), allow_paid=True,
                          clock=lambda: clock[0], relay_factory=FakeRelay, configure=lambda: None).open_relay()
        lab.relay.after_request = lambda: clock.__setitem__(0, 12.)
        with tempfile.TemporaryDirectory() as directory, patch('tools.personal_translation_lab.ROOT', Path(directory)):
            self.assertTrue(lab.start())
            lab.worker.join(2)
            self.assertFalse(lab.worker.is_alive())
            self.assertFalse(lab.start())
            self.assertEqual(lab.relay.requests, 1)
            self.assertEqual(lab.relay.closes, 1)
            reports = list(Path(directory).glob('tmp/selected-video/*'))
            self.assertEqual(len(reports), 1)
            saved = json.loads(reports[0].read_text(encoding='utf-8'))
        self.assertEqual(saved['error_code'], 'capture_not_started')
        self.assertEqual(saved['connection_diagnostics'], {
            'workspace_connected_observed': True, 'video_request_attempted': True,
            'video_selection_acknowledged': True, 'capture_bridge_started': False,
            'capture_pcm_received': False})
        self.assertFalse(saved['passed'])
        self.assertFalse(saved['physical_listening_verified'])
        self.assertFalse(saved['full_video_verified'])
        self.assertEqual(saved['consumption']['relay_sessions_started'], 0)

    def test_selection_failure_is_distinct_from_acknowledged_selection_without_capture(self):
        class RejectingRelay(FakeRelay):
            def request_video(self, **options):
                self.requests += 1
                raise ValueError('not selected')
        lab = PersonalLab(Config(seconds=10, connect_timeout=1), allow_paid=True,
                          relay_factory=RejectingRelay, configure=lambda: None).open_relay()
        with tempfile.TemporaryDirectory() as directory, patch('tools.personal_translation_lab.ROOT', Path(directory)):
            self.assertTrue(lab.start())
            lab.worker.join(2)
            report = lab.report()
        self.assertEqual(report['error_code'], 'video_request_failed')
        diagnostics = report['connection_diagnostics']
        self.assertTrue(diagnostics['workspace_connected_observed'])
        self.assertTrue(diagnostics['video_request_attempted'])
        self.assertFalse(diagnostics['video_selection_acknowledged'])
        self.assertFalse(diagnostics['capture_bridge_started'])
        self.assertFalse(diagnostics['capture_pcm_received'])

    def test_started_bridge_without_frontend_retains_unverified_result(self):
        clock = [1.]
        lab = PersonalLab(Config(seconds=10, connect_timeout=1), allow_paid=True,
                          clock=lambda: clock[0], relay_factory=FakeRelay, configure=lambda: None).open_relay()
        def delivery():
            lab.counts['relay_sessions_started'] = 1
            lab.counts['input_pcm_bytes'] = 3840
            clock[0] = 12.
        lab.relay.after_request = delivery
        with tempfile.TemporaryDirectory() as directory, patch('tools.personal_translation_lab.ROOT', Path(directory)):
            lab.start()
            lab.worker.join(2)
            report = lab.report()
        self.assertEqual(report['error_code'], 'frontend_unverified')
        self.assertTrue(report['connection_diagnostics']['capture_bridge_started'])
        self.assertTrue(report['connection_diagnostics']['capture_pcm_received'])

    def test_backend_sanitizer_keeps_measurements_but_drops_pcm_text_and_tokens(self):
        unsafe = {**CUE, 'pcm': 'secret bytes', 'text': 'original conversation', 'token': 'secret'}
        safe = safe_event(unsafe)
        self.assertNotIn('pcm', safe)
        self.assertNotIn('text', safe)
        self.assertNotIn('token', safe)
        self.assertEqual(safe['voice_category'], 'masculine')
        self.assertIsNone(safe_event({'type': 'transcript', 'text': 'do not persist'}))
        self.assertNotIn('code', safe_event({'type': 'error', 'code': 'free text with spaces'}))

    def test_frontend_measurement_must_match_emitted_voice_metadata(self):
        valid = observation()
        self.assertEqual(validate_observation(valid, published_count=1, sent_cues=[CUE]), valid['stats'])
        for field, value in [('category', 'feminine'), ('speaker', 2), ('provisional', False),
                             ('source_end', 2.5)]:
            invalid = deepcopy(valid)
            invalid['stats']['completed_voices'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_observation(invalid, published_count=1, sent_cues=[CUE])

    def test_clock_counts_build_and_unknown_payloads_are_rejected(self):
        valid = observation()
        changes = [lambda x: x.update(brivany_build='old-build'),
                   lambda x: x.update(source_video_id='other'),
                   lambda x: x.update(transcript='free text'),
                   lambda x: x['stats'].update(lag=1.),
                   lambda x: x['stats'].update(capture=float('nan')),
                   lambda x: x['stats'].update(completed_voice_count=2),
                   lambda x: x['stats'].update(completed_voices=[]),
                   lambda x: x['stats'].update(maximum_lag=4.),
                   lambda x: x['stats'].update(maximum_lag=8., maximum_lag_growth=1.)]
        for index, change in enumerate(changes):
            invalid = deepcopy(valid)
            change(invalid)
            with self.subTest(index=index), self.assertRaises(ValueError):
                validate_observation(invalid, published_count=1, sent_cues=[CUE])

    def test_report_does_not_promote_validated_metadata_to_full_quality_proof(self):
        lab = PersonalLab(Config(), allow_paid=True)
        lab.state, lab.started_clock, lab.deadline = 'running', 0., lab.clock() + 10
        lab.observe_backend(CUE)
        lab.observe_frontend(observation())
        report = lab.report()
        self.assertTrue(report['audio_output_detected'])
        self.assertTrue(report['frontend_source_identity_observed'])
        self.assertFalse(report['source_identity_verified'])
        self.assertFalse(report['passed'])
        self.assertFalse(report['public_speaker_match_verified'])
        self.assertIsNone(report['billing_amount'])

    def test_observed_peer_forwards_audio_without_retaining_it(self):
        class Peer:
            prepared_prefix = object()
            report_error = lambda *args: None
            def recv(self, **_kwargs): return b'\x00\x01'
            def send(self, raw): return raw
            def close(self): return None
        lab = PersonalLab(Config(), allow_paid=True)
        lab.state, lab.started_clock = 'running', lab.clock()
        peer = ObservedPeer(Peer(), lab)
        self.assertEqual(peer.recv(), b'\x00\x01')
        raw = json.dumps({**CUE, 'pcm': 'not persisted'})
        self.assertEqual(peer.send(raw), raw)
        self.assertEqual(lab.counts['input_pcm_bytes'], 2)
        self.assertEqual(lab.counts['backend_cues_sent'], 1)
        self.assertNotIn('"pcm"', json.dumps(lab.report()))
        self.assertNotIn('not persisted', json.dumps(lab.report()))


class PersonalLabHttpTests(unittest.TestCase):
    def setUp(self):
        self.lab = PersonalLab(Config(), allow_paid=True, relay_factory=FakeRelay, configure=lambda: None).open_relay()
        self.server = Server(('127.0.0.1', 0), Handler)
        self.server.lab = self.lab
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.origin = 'http://127.0.0.1:' + str(self.port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, method, path, body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.port, timeout=2)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_foreign_origin_host_and_malformed_run_cannot_arm_providers(self):
        for headers in ({'Host': 'localhost:' + str(self.port)}, {'Origin': 'https://foreign.test'}):
            self.assertEqual(self.request('GET', '/api/status', headers=headers)[0], 403)
        self.assertEqual(self.request('POST', '/api/run', '{}', {'Content-Type': 'application/json'})[0], 403)
        headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
        self.assertEqual(self.request('POST', '/api/run', '{"extra":true}', headers)[0], 400)
        self.assertEqual(self.request('POST', '/api/run', '[]', headers)[0], 400)
        self.assertEqual(self.lab.state, 'idle')
        self.assertEqual(self.lab.relay.requests, 0)

    def test_unarmed_observations_fail_and_status_contains_no_capability(self):
        headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
        status, _ = self.request('POST', '/api/observe', json.dumps(observation()), headers)
        self.assertEqual(status, 400)
        status, raw = self.request('GET', '/api/status')
        self.assertEqual(status, 200)
        parsed = json.loads(raw)
        self.assertEqual(parsed['state'], 'idle')
        self.assertEqual(parsed['relay_port'], 48217)
        self.assertTrue(parsed['normal_installed_extension_only'])
        self.assertNotIn('token', raw.decode())

    def test_personal_page_does_not_claim_zero_or_isolated_profile_position(self):
        status, raw = self.request('GET', '/')
        page = raw.decode('utf-8')
        self.assertEqual(status, 200)
        self.assertIn('Posición actual en Brave por medir', page)
        self.assertIn('Ensayo desde la posición actual en Brave', page)
        self.assertNotIn('Inicio de la prueba en 0:00', page)
        self.assertNotIn('Ensayo desde la posición indicada', page)
        self.assertNotIn('Brave ejecuta la extensión en un perfil aislado', page)


if __name__ == '__main__':
    unittest.main()
