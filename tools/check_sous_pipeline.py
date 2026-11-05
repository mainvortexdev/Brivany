"""Real browser + Handler + SQLite Sous, deterministic local vision substitutes.

No API key, model, physical camera, inference benchmark or GPU is used. Artifacts
contain synthetic pixels and aggregate evidence only, never user pantry media.
"""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
from unittest.mock import patch

from PIL import Image

from services.h1.server import Handler, ROOT
from services.sous import SousService
from services.sous_vision import SousVisionService


def _result(observation):
    return {'observation': observation, 'metadata': {'provider': 'meta', 'model': 'sous-local-test-stub',
            'usage': {}, 'latency_ms': 0, 'cost_known': False, 'actual_cost_usd': None}}


def main():
    counts = {'inventory': 0, 'cooking': 0}; seen = []
    def inventory(image, mime):
        counts['inventory'] += 1
        return _result({'items': [{'label': 'Huevos', 'confidence': .5, 'expiry_date': None,
                        'expiry_provenance': 'unknown', 'source_reference': None}],
                        'limitations': ['Observación sintética local; no es reconocimiento real.'], 'freshness_verified': False})
    inventory.simulation = True
    def cooking(step, image, mime):
        counts['cooking'] += 1
        import hashlib
        seen.append(hashlib.sha256(image).hexdigest())
        return _result({'verdict': 'ready', 'observation': 'Criterio visual satisfecho en respuesta sintética.',
                        'evidence_notes': ['Sustituto determinista para comprobar estado y transporte.'],
                        'safety_verified': False, 'freshness_verified': False})
    cooking.simulation = True
    artifacts = ROOT / 'tmp/sous-pipeline'; artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-sous-pipeline-') as temporary:
        folder = Path(temporary)
        for index, color in enumerate(((20, 40, 60), (90, 110, 130)), 1):
            Image.new('RGB', (80, 60), color).save(folder / f'frame-{index}.png')
        sous = SousService(folder / 'sous')
        vision = SousVisionService(folder / 'vision', sous, inventory_provider=inventory, cooking_provider=cooking,
            status=lambda: {'configured': True, 'model': 'sous-local-test-stub'})
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.sous = sous; server.sous_vision = vision
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            # Any accidental nonlocal Python connection fails the checker.
            connect = socket.create_connection
            def local_only(address, *args, **kwargs):
                if address[0] not in ('127.0.0.1', 'localhost', '::1'): raise AssertionError('External network forbidden in Sous pipeline checker.')
                return connect(address, *args, **kwargs)
            environment = {**os.environ, 'BRIVANY_TEST_URL': f'http://127.0.0.1:{server.server_port}',
                'BRIVANY_SOUS_FIXTURES': str(folder), 'BRIVANY_SOUS_ARTIFACTS': str(artifacts)}
            with patch('socket.create_connection', side_effect=local_only):
                process = subprocess.run(['node', 'tools/check_sous_pipeline.cjs'], cwd=ROOT, env=environment,
                    capture_output=True, timeout=90, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if process.returncode: raise RuntimeError((process.stdout + process.stderr).decode('utf-8', errors='replace'))
            if counts != {'inventory': 1, 'cooking': 2} or len(set(seen)) != 2: raise AssertionError('Unexpected number or identity of substituted vision calls.')
            report = json.loads((artifacts / 'report.json').read_text(encoding='utf-8'))
            report.update({'checked_at': datetime.now(timezone.utc).isoformat(), 'provider_stub_calls': counts,
                'distinct_cooking_frames': len(set(seen)), 'real_meta_api_calls': 0, 'gpu_seconds': 0,
                'limitations': ['Real browser, local HTTP Handler and SQLite; deterministic provider substitutes.',
                    'No model recognition quality, latency, food safety or real provider billing tested.']})
            (artifacts / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            server.shutdown(); server.server_close(); thread.join(3)


if __name__ == '__main__': main()
