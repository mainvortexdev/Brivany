"""Production Handler on loopback with temporary Sous and simulated vision only."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest

from PIL import Image

from services.h1.server import Handler
from services.sous import SousService, RECIPE
from services.sous_vision import SousVisionService


def image(color):
    output = BytesIO(); Image.new('RGB', (32, 24), color).save(output, format='PNG'); return output.getvalue()


def result(observation):
    return {'observation': observation, 'metadata': {'model': 'sous-local-test-stub', 'usage': {}, 'latency_ms': 0}}


class SousHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.counts = {'inventory': 0, 'cooking': 0}
        folder = Path(self.directory.name); sous = SousService(folder / 'sous')
        def inventory(raw, mime):
            self.counts['inventory'] += 1
            return result({'items': [{'label': 'Huevos', 'confidence': .5, 'expiry_date': None,
                           'expiry_provenance': 'unknown', 'source_reference': None}],
                           'limitations': ['Sustituto de prueba local.'], 'freshness_verified': False})
        inventory.simulation = True
        def cooking(step, raw, mime):
            self.counts['cooking'] += 1
            return result({'verdict': 'ready', 'observation': 'Criterio sintético satisfecho.',
                           'evidence_notes': ['Sustituto local.'], 'safety_verified': False, 'freshness_verified': False})
        cooking.simulation = True
        vision = SousVisionService(folder / 'vision', sous, inventory_provider=inventory, cooking_provider=cooking,
                                   status=lambda: {'configured': True, 'model': 'sous-local-test-stub'})
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.sous = sous; self.server.sous_vision = vision
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3); self.directory.cleanup()

    def call(self, method, path, body=None, headers=None):
        supplied = {'Origin': self.origin, 'Content-Type': 'application/json'}; supplied.update(headers or {})
        if isinstance(body, dict): body = json.dumps(body).encode()
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        connection.request(method, path, body=body, headers=supplied)
        response = connection.getresponse(); raw = response.read(); status = response.status; connection.close()
        return status, json.loads(raw)

    def test_manual_inventory_confirm_plan_and_event_use_actual_handler(self):
        item = {'label': 'Huevos', 'quantity': 4., 'unit': 'unit', 'confidence': .5, 'confirmed': False,
                'expiry_date': None, 'expiry_provenance': 'unknown', 'source_reference': None}
        status, response = self.call('POST', '/api/sous/items', item); self.assertEqual(status, 201)
        identifier = response['item']['id']
        self.assertEqual(self.call('POST', f'/api/sous/items/{identifier}/confirm', {'confirmed': True})[0], 200)
        vegetables = {**item, 'label': 'Verduras', 'quantity': 400., 'unit': 'g', 'confidence': 1., 'confirmed': True}
        self.assertEqual(self.call('POST', '/api/sous/items', vegetables)[0], 201)
        self.assertEqual(self.call('POST', '/api/sous/plan', {})[1]['eligibility']['status'], 'ready')
        self.assertEqual(self.call('POST', f'/api/sous/items/{identifier}/events', {'kind': 'consumed', 'amount': 1., 'unit': 'unit'})[0], 200)
        self.assertEqual(self.counts, {'inventory': 0, 'cooking': 0})

    def test_vision_status_and_invalid_headers_never_invoke_a_provider(self):
        status, readiness = self.call('GET', '/api/sous/vision/status')
        self.assertEqual(status, 200); self.assertTrue(readiness['configured']); self.assertFalse(readiness['access_verified'])
        frame = image((20, 40, 60)); path = '/api/sous/vision/inventory'
        self.assertEqual(self.call('POST', path, frame, {'Content-Type': 'image/png'})[0], 422)
        self.assertEqual(self.call('POST', path, frame, {'Content-Type': 'image/webp', 'X-Brivany-Consent': 'true'})[0], 415)
        self.assertEqual(self.call('POST', path, b'not-a-png', {'Content-Type': 'image/png', 'X-Brivany-Consent': 'true'})[0], 422)
        self.assertEqual(self.call('POST', path, frame, {'Content-Type': 'image/png', 'X-Brivany-Consent': 'true', 'Origin': 'https://outside.invalid'})[0], 403)
        self.assertEqual(self.counts, {'inventory': 0, 'cooking': 0})

    def test_vision_candidates_and_two_distinct_frames_are_simulated_and_revision_checked(self):
        first, second = image((20, 40, 60)), image((80, 100, 120))
        headers = {'Content-Type': 'image/png', 'X-Brivany-Consent': 'true'}
        status, candidates = self.call('POST', '/api/sous/vision/inventory', first, headers)
        self.assertEqual(status, 200); self.assertTrue(candidates['metadata']['simulation'])
        self.assertFalse(candidates['inventory_changed']); self.assertEqual(self.call('GET', '/api/sous/inventory')[1]['items'], [])
        _, started = self.call('POST', '/api/sous/sessions', {'recipe_id': RECIPE['id']}); session = started['session']
        path = f'/api/sous/vision/sessions/{session["id"]}/verify'
        self.assertEqual(self.call('POST', path, first, {**headers, 'X-Expected-Revision': '9'})[0], 409)
        status, observed = self.call('POST', path, first, {**headers, 'X-Expected-Revision': '1'})
        self.assertEqual(status, 200); self.assertEqual(observed['session']['current_step_id'], 'prepare')
        self.assertEqual(self.call('POST', path, first, {**headers, 'X-Expected-Revision': '2'})[0], 409)
        status, observed = self.call('POST', path, second, {**headers, 'X-Expected-Revision': '2'})
        self.assertEqual(status, 200); self.assertEqual(observed['session']['current_step_id'], 'vegetables')
        self.assertEqual(observed['session']['steps'][0]['completed_by'], 'test_meta_adapter')
        self.assertFalse(observed['session']['model_executed']); self.assertFalse(observed['session']['live_verification'])
        self.assertEqual(self.counts, {'inventory': 1, 'cooking': 2})


if __name__ == '__main__': unittest.main()
