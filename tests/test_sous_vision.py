"""Mock HTTP image actions only; no provider, camera, GPU or billing is exercised."""
import base64
from contextlib import closing
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from PIL import Image

from packages.providers.meta import MetaProviderError
from packages.providers import sous_vision as provider
from services.sous import SousService, SousError, RECIPE
from services.sous_vision import SousVisionService


def pixels(color=(30, 60, 90), size=(64, 48)):
    target = BytesIO(); Image.new('RGB', size, color).save(target, format='PNG'); return target.getvalue()


def inventory():
    return {'items': [{'label': 'Huevos', 'confidence': .7, 'expiry_date': None,
                       'expiry_provenance': 'unknown', 'source_reference': None}],
            'limitations': ['Lectura visual pendiente de confirmación.'], 'freshness_verified': False}


def cooking(verdict='ready'):
    return {'verdict': verdict, 'observation': 'Las verduras se ven cortadas.',
            'evidence_notes': ['Sólo criterio visual.'], 'safety_verified': False, 'freshness_verified': False}


def response(observation):
    return json.dumps({'status': 'completed', 'model': 'muse-spark-1.3', 'output': [
        {'type': 'message', 'status': 'completed', 'role': 'assistant',
         'content': [{'type': 'output_text', 'text': json.dumps(observation)}]}],
        'usage': {'input_tokens': 100, 'output_tokens': 40, 'total_tokens': 140,
                  'unknown_private_field': 'never-persist'}}).encode()


def result(observation):
    return {'observation': observation, 'metadata': {'provider': 'meta', 'model': 'muse-spark-1.3',
            'usage': {'input_tokens': 100, 'output_tokens': 40}, 'latency_ms': 12,
            'raw_response': 'never-persist', 'image_base64': 'never-persist', 'actual_cost_usd': .123}}


class SousVisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sous = SousService(self.root / 'sous')
        self.image = pixels()
        self.environment = patch.dict('os.environ', {'BRIVANY_META_API_KEY': 'synthetic-test-secret',
            'BRIVANY_META_MODEL': 'muse-spark-1.3', 'BRIVANY_SOUS_MODEL': 'muse-spark-1.3'}, clear=True)
        self.environment.start(); self.addCleanup(self.environment.stop)

    def vision(self, **kwargs):
        return SousVisionService(self.root / 'vision', self.sous, **kwargs)

    def session(self): return self.sous.start_session({'recipe_id': RECIPE['id']})

    def test_inventory_http_has_one_bounded_image_structured_output_and_no_server_storage(self):
        with patch.object(provider, '_post_json', return_value=response(inventory())) as post:
            observed = provider.analyze_inventory(self.image, 'image/png')
        self.assertEqual(post.call_count, 1)
        key, raw = post.call_args.args
        self.assertEqual(key, 'synthetic-test-secret')
        payload = json.loads(raw)
        self.assertFalse(payload['store']); self.assertFalse(payload['stream'])
        self.assertTrue(payload['text']['format']['strict'])
        self.assertEqual(payload['max_output_tokens'], 1800)
        image = payload['input'][0]['content'][1]
        self.assertEqual(base64.b64decode(image['image_url'].split(',', 1)[1]), self.image)
        self.assertIn('dato no confiable', payload['instructions'])
        self.assertNotIn('tools', payload)
        self.assertFalse(observed['metadata']['cost_known']); self.assertIsNone(observed['metadata']['actual_cost_usd'])
        self.assertNotIn('unknown_private_field', observed['metadata']['usage'])

    def test_malformed_image_size_mime_and_unconfigured_model_make_no_http_call(self):
        with patch.object(provider, '_post_json') as post:
            for image, mime in ((b'fake', 'image/png'), (self.image, 'image/jpeg'),
                                (self.image, 'image/gif'), (pixels(size=(1281, 20)), 'image/png')):
                with self.assertRaises(MetaProviderError): provider.analyze_inventory(image, mime)
            with patch.dict('os.environ', {'BRIVANY_META_API_KEY': ''}):
                with self.assertRaises(MetaProviderError): provider.analyze_inventory(self.image, 'image/png')
        post.assert_not_called()

    def test_dates_and_safety_claims_in_model_output_fail_closed(self):
        invalid = inventory(); invalid['items'][0].update(expiry_date='2026-10-30', expiry_provenance='unknown')
        printed_without_quote = inventory(); printed_without_quote['items'][0].update(expiry_date='2026-10-30', expiry_provenance='printed_label')
        for observation in (invalid, printed_without_quote, {**cooking(), 'safety_verified': True}, {**cooking(), 'advance': True}):
            with patch.object(provider, '_post_json', return_value=response(observation)) as post:
                with self.assertRaises(MetaProviderError):
                    if 'items' in observation: provider.analyze_inventory(self.image, 'image/png')
                    else: provider.verify_cooking_step({'id': 'prepare', 'criterion': 'Verduras cortadas'}, self.image, 'image/png')
                self.assertEqual(post.call_count, 1)
        accepted = inventory(); accepted['items'][0].update(expiry_date='2026-10-30', expiry_provenance='printed_label', source_reference='Vence 30/10/2026')
        with patch.object(provider, '_post_json', return_value=response(accepted)):
            self.assertEqual(provider.analyze_inventory(self.image, 'image/png')['observation']['items'][0]['expiry_provenance'], 'printed_label')

    def test_timeout_and_incomplete_response_are_never_retried_or_echoed(self):
        with patch.object(provider, '_post_json', side_effect=TimeoutError('private transport details')) as post:
            with self.assertRaises(MetaProviderError) as error: provider.analyze_inventory(self.image, 'image/png')
        self.assertEqual(post.call_count, 1); self.assertNotIn('private transport', str(error.exception))
        bad = json.loads(response(inventory())); bad['status'] = 'incomplete'
        with patch.object(provider, '_post_json', return_value=json.dumps(bad).encode()) as post:
            with self.assertRaises(MetaProviderError): provider.analyze_inventory(self.image, 'image/png')
        self.assertEqual(post.call_count, 1)

    def test_explicit_consent_and_readiness_require_no_network_and_inventory_is_not_auto_saved(self):
        with patch.object(provider, '_post_json', return_value=response(inventory())) as post:
            vision = self.vision()
            self.assertTrue(vision.readiness()['configured']); self.assertFalse(vision.readiness()['access_verified'])
            post.assert_not_called()
            with self.assertRaises(SousError): vision.analyze_inventory(self.image, 'image/png', consent=False)
            post.assert_not_called()
            observed = vision.analyze_inventory(self.image, 'image/png', consent=True)
        self.assertEqual(post.call_count, 1)
        self.assertTrue(observed['candidates'][0]['requires_confirmation'])
        self.assertFalse(observed['inventory_changed']); self.assertEqual(self.sous.inventory()['items'], [])
        self.assertIsNone(observed['metadata']['actual_cost_usd'])

    def test_trusted_results_advance_only_after_two_distinct_meta_frames(self):
        with patch.object(provider, '_post_json', return_value=response(cooking())) as post:
            vision = self.vision(); session = self.session()
            first = vision.verify_cooking_step(session['id'], self.image, 'image/png', consent=True, expected_revision=1)
            self.assertEqual(first['session']['current_step_id'], 'prepare')
            self.assertEqual(first['session']['steps'][0]['ready_streak'], 1)
            second = vision.verify_cooking_step(session['id'], pixels((70, 80, 90)), 'image/png', consent=True, expected_revision=2)
            self.assertEqual(second['session']['current_step_id'], 'vegetables')
            self.assertEqual(second['session']['steps'][0]['completed_by'], 'meta_live')
        self.assertEqual(post.call_count, 2)
        self.assertFalse(second['metadata']['safety_verified']); self.assertFalse(second['metadata']['freshness_verified'])
        self.assertIsNone(second['metadata']['actual_cost_usd'])

    def test_arbitrary_public_meta_claim_has_no_ticket_and_cannot_advance(self):
        vision = self.vision(); session = self.session()
        payload = {'expected_revision': 1, 'step_id': 'prepare', 'evidence': {'source': 'meta', 'frame_sha256': 'a' * 64,
                   'observation': 'Pretend ready', 'verdict': 'ready'}}
        with self.assertRaises(SousError): vision.trusted_sous.verify_step(session['id'], payload)
        with self.assertRaises(SousError): self.sous.verify_step(session['id'], payload)
        self.assertEqual(self.sous.get_session(session['id'])['observations_count'], 0)

    def test_persisted_call_cap_counts_failures_and_duplicate_frames_make_no_second_call(self):
        session_id = str(uuid4())
        with patch.object(provider, '_post_json', side_effect=TimeoutError()) as post:
            vision = self.vision(max_frames_per_session=1)
            with self.assertRaises(SousError): vision.analyze_inventory(self.image, 'image/png', consent=True, session_id=session_id)
            reopened = self.vision(max_frames_per_session=1)
            with self.assertRaises(SousError) as error:
                reopened.analyze_inventory(pixels((90, 80, 70)), 'image/png', consent=True, session_id=session_id)
        self.assertEqual(error.exception.code, 'vision_frame_limit'); self.assertEqual(post.call_count, 1)
        with patch.object(provider, '_post_json', return_value=response(inventory())) as post:
            vision = self.vision(); identifier = str(uuid4())
            vision.analyze_inventory(self.image, 'image/png', consent=True, session_id=identifier)
            with self.assertRaises(SousError): vision.analyze_inventory(self.image, 'image/png', consent=True, session_id=identifier)
        self.assertEqual(post.call_count, 1)

    def test_journal_contains_only_allowlisted_metadata_not_image_or_raw_response(self):
        vision = self.vision(inventory_provider=lambda image, mime: result(inventory()))
        observed = vision.analyze_inventory(self.image, 'image/png', consent=True)
        with closing(sqlite3.connect(vision.database)) as db:
            rows = db.execute('SELECT frame_sha256,metadata FROM vision_calls').fetchall()
        self.assertEqual(rows[0][0], observed['frame_sha256'])
        self.assertNotIn('never-persist', rows[0][1]); self.assertNotIn('image_base64', rows[0][1])
        self.assertNotIn('Huevos', rows[0][1]); self.assertNotIn('synthetic-test-secret', rows[0][1])
        self.assertEqual(json.loads(rows[0][1])['actual_cost_usd'], None)
        self.assertFalse(any(path.suffix in {'.png', '.jpg', '.mp4'} for path in self.root.rglob('*')))

    def test_stale_revision_or_replay_is_rejected_before_a_paid_attempt(self):
        vision = self.vision(); session = self.session()
        with patch.object(provider, '_post_json') as post:
            with self.assertRaises(SousError): vision.verify_cooking_step(session['id'], self.image, 'image/png', consent=True, expected_revision=9)
            replay = self.sous.start_session({'recipe_id': RECIPE['id'], 'mode': 'replay_mock'})
            with self.assertRaises(SousError): vision.verify_cooking_step(replay['id'], self.image, 'image/png', consent=True, expected_revision=1)
        post.assert_not_called()


if __name__ == '__main__': unittest.main()
