"""Consent-gated Sous vision actions, persistent call caps, ephemeral trust bridge.

Only call metadata and image hashes are journaled. Inputs and raw responses are
never written to disk. A provider failure may still be billed: its cost remains
unknown and consumes one of the session's bounded attempts.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
from uuid import UUID, uuid4

from packages.providers.meta import MetaProviderError
from packages.providers.sous_vision import (analyze_inventory, verify_cooking_step, vision_provider_status,
                                           validate_image, InventoryObservation, CookingObservation)
from services.sous import SousService, SousError


def _fail(code, message, status=422): raise SousError(code, message, status)
def _stamp(): return datetime.now(timezone.utc).isoformat()


def _identifier(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value: raise ValueError()
    except (ValueError, TypeError, AttributeError): _fail('invalid_vision_session', 'Sesión visual no válida.')
    return value


class _EphemeralAdapter:
    simulation = False
    def __init__(self): self.local = threading.local()

    @contextmanager
    def issue(self, frame_hash, step_id, observation):
        self.local.ticket = (frame_hash, step_id, observation)
        try: yield
        finally: self.local.ticket = None

    def verify(self, request):
        ticket = getattr(self.local, 'ticket', None)
        self.local.ticket = None
        if ticket is None or ticket[:2] != (request['frame_sha256'], request['step_id']):
            _fail('vision_ticket_required', 'No existe una respuesta visual confiable para este fotograma.', 409)
        return {'frame_sha256': ticket[0], 'observation': ticket[2]['observation'], 'verdict': ticket[2]['verdict']}


class SousVisionService:
    def __init__(self, root, sous, *, inventory_provider=analyze_inventory, cooking_provider=verify_cooking_step,
                 status=vision_provider_status, max_frames_per_session=120):
        self.root = Path(root).absolute()
        if self.root.resolve() != self.root: _fail('sous_storage', 'La carpeta visual local no es válida.', 409)
        if type(max_frames_per_session) is not int or not 1 <= max_frames_per_session <= 120: _fail('invalid_vision_limit', 'El límite visual debe estar entre 1 y 120.')
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / 'sous-vision.sqlite3'
        if self.database.resolve() != self.database: _fail('sous_storage', 'La base visual local no es válida.', 409)
        self.sous, self.inventory_provider, self.cooking_provider, self.provider_status = sous, inventory_provider, cooking_provider, status
        self.limit = max_frames_per_session; self.adapter = _EphemeralAdapter()
        self.inventory_simulation = getattr(inventory_provider, 'simulation', False) is True
        self.cooking_simulation = getattr(cooking_provider, 'simulation', False) is True
        self.adapter.simulation = self.cooking_simulation
        self.trusted_sous = SousService(sous.root, meta_adapter=self.adapter)
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS vision_calls(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,operation TEXT NOT NULL,frame_sha256 TEXT NOT NULL,state TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,operation,frame_sha256))')

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.database, timeout=10)
        try:
            db.execute('BEGIN IMMEDIATE'); yield db; db.commit()
        except Exception: db.rollback(); raise
        finally: db.close()

    def readiness(self):
        status = self.provider_status()
        return {'provider': 'meta', 'configured': status.get('configured') is True, 'model': status.get('model'),
                'access_verified': False, 'image_compatibility_verified': False, 'explicit_consent_required': True,
                'max_image_bytes': 2 * 1024 * 1024, 'max_edge': 1280, 'max_frames_per_session': self.limit,
                'calls_per_action': 1, 'automatic_retries': 0, 'raw_media_stored': False,
                'monetary_limit_enforced': False, 'actual_cost_usd': None}

    def _prepare(self, image, mime_type, consent):
        if consent is not True: _fail('vision_consent_required', 'Autoriza explícitamente enviar esta imagen a Meta.')
        try: validate_image(image, mime_type)
        except MetaProviderError as error: _fail(error.code, error.message)
        if self.provider_status().get('configured') is not True: _fail('meta_not_configured', 'Configura un modelo Meta con visión antes de continuar.', 503)
        return hashlib.sha256(image).hexdigest()

    def _reserve(self, session_id, operation, frame_hash):
        identifier = str(uuid4())
        with self._db() as db:
            count = db.execute('SELECT count(*) FROM vision_calls WHERE session_id=?', (session_id,)).fetchone()[0]
            if count >= self.limit: _fail('vision_frame_limit', 'Se alcanzó el límite de llamadas visuales de esta sesión.', 429)
            if db.execute('SELECT 1 FROM vision_calls WHERE session_id=? AND operation=? AND frame_sha256=?', (session_id, operation, frame_hash)).fetchone():
                _fail('vision_duplicate_frame', 'Ese fotograma ya fue enviado para esta operación; no se repitió.', 409)
            metadata = {'cost_known': False, 'actual_cost_usd': None, 'api_calls_attempted': 1}
            db.execute('INSERT INTO vision_calls VALUES(?,?,?,?,?,?,?)', (identifier, session_id, operation, frame_hash, 'pending', json.dumps(metadata), _stamp()))
        return identifier

    def _finish(self, identifier, state, metadata):
        with self._db() as db: db.execute('UPDATE vision_calls SET state=?,metadata=? WHERE id=?', (state, json.dumps(metadata, allow_nan=False), identifier))

    @staticmethod
    def _metadata(result, *, simulation=False):
        value = result.get('metadata', {})
        if not isinstance(value, dict): _fail('invalid_vision_response', 'Metadatos visuales no válidos.')
        # Explicit allowlist: never persist arbitrary provider bodies or echo a
        # secret field from a substituted transport.
        model = value.get('model')
        from packages.providers.meta import MODEL_PATTERN
        if not isinstance(model, str) or not MODEL_PATTERN.fullmatch(model): _fail('invalid_vision_response', 'Modelo de respuesta no válido.')
        usage = value.get('usage', {})
        latency = value.get('latency_ms')
        if type(latency) is not int or latency < 0: _fail('invalid_vision_response', 'Latencia de respuesta no válida.')
        return {'provider': 'meta', 'model': model, 'latency_ms': latency,
                'usage': {key: usage[key] for key in ('input_tokens', 'output_tokens', 'total_tokens') if isinstance(usage, dict) and type(usage.get(key)) is int and usage[key] >= 0},
                'cost_known': False, 'actual_cost_usd': None, 'api_calls_attempted': 1,
                'safety_verified': False, 'freshness_verified': False,
                'simulation': simulation, 'model_executed': not simulation}

    def analyze_inventory(self, image, mime_type, *, consent, session_id=None):
        frame_hash = self._prepare(image, mime_type, consent)
        session_id = str(uuid4()) if session_id is None else _identifier(session_id)
        call_id = self._reserve(session_id, 'inventory', frame_hash)
        try:
            result = self.inventory_provider(image, mime_type)
            observation = InventoryObservation.model_validate(result['observation'])
            metadata = self._metadata(result, simulation=self.inventory_simulation)
            self._finish(call_id, 'completed', metadata)
        except Exception as error:
            self._finish(call_id, 'failed_unknown', {'cost_known': False, 'actual_cost_usd': None, 'api_calls_attempted': 1,
                         'error_code': error.code if isinstance(error, MetaProviderError) else 'invalid_vision_response'})
            if isinstance(error, MetaProviderError): _fail(error.code, error.message, 502)
            if isinstance(error, SousError): raise
            _fail('invalid_vision_response', 'La lectura visual no fue válida; no se añadió inventario.', 502)
        return {'session_id': session_id, 'call_id': call_id, 'frame_sha256': frame_hash,
                'candidates': [{**item.model_dump(), 'requires_confirmation': True} for item in observation.items],
                'limitations': observation.limitations, 'inventory_changed': False, 'metadata': metadata}

    def verify_cooking_step(self, session_id, image, mime_type, *, consent, expected_revision):
        session_id = _identifier(session_id)
        frame_hash = self._prepare(image, mime_type, consent)
        current = self.sous.get_session(session_id)
        if type(expected_revision) is not int or current['revision'] != expected_revision: _fail('session_conflict', 'La sesión cambió; actualiza antes de enviar.', 409)
        if current['mode'] != 'manual' or current['current_step_id'] is None: _fail('invalid_vision_session', 'La visión usa un paso actual de una sesión manual.', 409)
        if current['observations_count'] >= current['max_frames']: _fail('session_frame_limit', 'La sesión alcanzó su límite de lecturas.', 429)
        step = next(item for item in current['steps'] if item['id'] == current['current_step_id'])
        call_id = self._reserve(session_id, 'cooking', frame_hash)
        try:
            result = self.cooking_provider({'id': step['id'], 'criterion': step['criterion']}, image, mime_type)
            observation = CookingObservation.model_validate(result['observation']).model_dump()
            metadata = self._metadata(result, simulation=self.cooking_simulation)
            # This ticket never leaves this request thread; direct HTTP callers
            # cannot inject a result or reuse it through Sous.verify_step.
            with self.adapter.issue(frame_hash, step['id'], observation):
                session = self.trusted_sous.verify_step(session_id, {'expected_revision': expected_revision, 'step_id': step['id'],
                    'evidence': {'source': 'meta', 'frame_sha256': frame_hash, 'verdict': 'uncertain', 'observation': 'Pendiente de resultado visual confiable.'}})
            self._finish(call_id, 'completed', metadata)
        except Exception as error:
            self._finish(call_id, 'failed_unknown', {'cost_known': False, 'actual_cost_usd': None, 'api_calls_attempted': 1,
                         'error_code': error.code if isinstance(error, (SousError, MetaProviderError)) else 'invalid_vision_response'})
            if isinstance(error, SousError): raise
            if isinstance(error, MetaProviderError): _fail(error.code, error.message, 502)
            _fail('invalid_vision_response', 'La observación no pudo aplicarse; no se repitió.', 502)
        return {'session': session, 'metadata': metadata, 'call_id': call_id, 'frame_sha256': frame_hash}
