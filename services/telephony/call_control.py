"""Telnyx Call Control v2. Only explicit outbound requests can create calls.

Webhooks are authenticated, journalled once, then handled outside the HTTP
request. The journal holds operational metadata, never speech or an objective.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import quote, urlsplit
from uuid import UUID, uuid5, NAMESPACE_URL

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from packages.runtime_paths import CONFIG_PATH
from .common import ProviderError, TelephonyError, clean_text, masked
from .realtime import LiveProviders
from .safety import CallSafety, MAX_CALL_SECONDS, limits
from .telnyx import TelnyxAPI

APP_NAME = 'Brivany Melodi Call Control'
TERMINAL = {'completed', 'failed', 'canceled', 'interrupted'}
OBJECTIVE = 'Conversa con el usuario en español con la naturalidad y la voz de Melodi. No ejecutes acciones externas.'
ENV_KEYS = {'TELNYX_API_KEY', 'TELNYX_CONNECTION_ID', 'TELNYX_FROM_NUMBER',
            'WEBHOOK_BASE_URL', 'TELNYX_PUBLIC_KEY', 'BRIVANY_TELNYX_CONTROL_TOKEN',
            'BRIVANY_TELNYX_CONTROL_PORT', 'BRIVANY_TELNYX_API_KEY'}


def load_environment(path=CONFIG_PATH):
    if Path(path).is_file():
        for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
            if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
                continue
            key, value = (part.strip() for part in line.split('=', 1))
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                value = value[1:-1]
            if key in ENV_KEYS and value:
                os.environ.setdefault(key, value)


def rd_number(value):
    if not isinstance(value, str) or not re.fullmatch(r'\+1(?:809|829|849)[0-9]{7}', value):
        raise TelephonyError('Usa un número dominicano E.164: +1809, +1829 o +1849 y siete dígitos más.')
    return value


def request_id(value):
    try:
        if isinstance(value, str) and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise TelephonyError('La solicitud necesita un id UUID válido.')


def public_origin(value):
    try:
        if not isinstance(value, str) or len(value) > 2048 or re.search(r'\s', value):
            raise ValueError()
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')
                or parsed.port not in (None, 443) or parsed.hostname in ('localhost', '127.0.0.1', '::1')):
            raise ValueError()
    except (ValueError, TypeError):
        raise TelephonyError('WEBHOOK_BASE_URL debe ser un origen HTTPS público sin ruta.') from None
    return value.rstrip('/')


def public_key(value):
    try:
        raw = bytes.fromhex(value) if re.fullmatch(r'[a-fA-F0-9]{64}', value) else base64.b64decode(value, validate=True)
        return Ed25519PublicKey.from_public_bytes(raw)
    except (ValueError, TypeError):
        raise TelephonyError('TELNYX_PUBLIC_KEY no es una clave Ed25519 válida.') from None


def valid_signature(key, payload, signature, timestamp, *, now=None):
    try:
        if (not isinstance(timestamp, str) or not re.fullmatch(r'[0-9]{10,12}', timestamp)
                or abs((time.time() if now is None else now) - int(timestamp)) > 300
                or not isinstance(signature, str) or len(signature) > 128):
            return False
        public_key(key).verify(base64.b64decode(signature, validate=True), timestamp.encode() + b'|' + payload)
        return True
    except (ValueError, TypeError, InvalidSignature, TelephonyError):
        return False


@dataclass(frozen=True)
class ControlConfig:
    connection_id: str
    from_number: str = field(repr=False)
    origin: str
    verification_key: str = field(repr=False)
    token: str = field(repr=False)
    port: int = 8791

    def __post_init__(self):
        if not isinstance(self.connection_id, str) or not re.fullmatch(r'[0-9]{1,30}', self.connection_id):
            raise TelephonyError('TELNYX_CONNECTION_ID debe ser el ID de la aplicación Call Control.')
        rd_number(self.from_number)
        public_origin(self.origin)
        public_key(self.verification_key)
        if not isinstance(self.token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', self.token):
            raise TelephonyError('Configura un token local exclusivo para el servicio de llamadas.')
        if type(self.port) is not int or not 1 <= self.port <= 65535:
            raise TelephonyError('Puerto local de Call Control no válido.')

    @classmethod
    def environment(cls):
        load_environment()
        try:
            port = int(os.getenv('BRIVANY_TELNYX_CONTROL_PORT', '8791'))
        except ValueError:
            raise TelephonyError('Puerto local de Call Control no válido.') from None
        return cls(os.getenv('TELNYX_CONNECTION_ID', ''), os.getenv('TELNYX_FROM_NUMBER', ''),
                   os.getenv('WEBHOOK_BASE_URL', ''), os.getenv('TELNYX_PUBLIC_KEY', ''),
                   os.getenv('BRIVANY_TELNYX_CONTROL_TOKEN', ''), port)

    @property
    def webhook(self):
        return self.origin.rstrip('/') + '/webhooks/telnyx'


@dataclass
class Runtime:
    destination: str
    mode: str
    objective: str = field(repr=False)
    message: str = field(repr=False)
    capability: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    ended: threading.Event = field(default_factory=threading.Event)
    media_claimed: bool = False
    cancel_requested: bool = False
    safety: CallSafety = field(default_factory=CallSafety, repr=False)
    media: object = field(default=None, repr=False)


class CallControl:
    def __init__(self, path, config, api, *, voice_ready=None, start_worker=True, clock=time.monotonic):
        self.config, self.api = config, api
        self.voice_ready = voice_ready or LiveProviders.configured
        self.clock = clock
        self.lock = threading.RLock()
        self.wake, self.closed = threading.Event(), threading.Event()
        self.runtime = {}
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS cc_calls (
                id TEXT PRIMARY KEY, fingerprint TEXT, destination TEXT, mode TEXT,
                state TEXT, control_id TEXT UNIQUE, created REAL, answered REAL,
                finished REAL, cause TEXT, duration REAL, error TEXT, metrics TEXT);
            CREATE TABLE IF NOT EXISTS cc_events (
                id TEXT PRIMARY KEY, call_id TEXT, kind TEXT, occurred REAL,
                fields TEXT, processed INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS cc_actions (
                call_id TEXT, kind TEXT, state TEXT, PRIMARY KEY(call_id,kind));
        ''')
        if 'end_reason' not in {column[1] for column in self.db.execute('PRAGMA table_info(cc_calls)')}:
            self.db.execute("ALTER TABLE cc_calls ADD COLUMN end_reason TEXT DEFAULT ''")
        self.db.execute("UPDATE cc_calls SET state='interrupted', error='Servicio reiniciado; no se remarca.' WHERE state NOT IN ('completed','failed','canceled','interrupted')")
        self.db.commit()
        self.worker = threading.Thread(target=self._work, daemon=True, name='telnyx-webhook-actions') if start_worker else None
        self.watchdog = threading.Thread(target=self._watch_safety, daemon=True, name='telnyx-call-safety') if start_worker else None
        if self.worker:
            self.worker.start()
            self.watchdog.start()

    def info(self):
        return {'configured': True, 'outbound': bool(self.voice_ready()), 'provider': 'telnyx',
                'transport': 'call_control_v2', 'incoming': 'mobile', 'voicemail': False,
                'caller_id': masked(self.config.from_number),
                'limits': limits(),
                'reason': '' if self.voice_ready() else 'Configura la voz de Melodi antes de conversar.'}

    def status(self, identifier):
        request_id(identifier)
        with self.lock:
            row = self.db.execute('SELECT * FROM cc_calls WHERE id=?', (identifier,)).fetchone()
            if not row:
                return {'id': identifier, 'state': 'not-found'}
            return {'id': identifier, 'state': row['state'], 'destination': row['destination'],
                    'caller_id': masked(self.config.from_number), 'mode': row['mode'],
                    'hangup_cause': row['cause'], 'duration_seconds': row['duration'],
                    'end_reason': row['end_reason'] or '',
                    'result': row['error'] or '', 'conversation': json.loads(row['metrics'] or '{}')}

    def _update(self, identifier, **values):
        with self.lock:
            columns = ','.join(key + '=?' for key in values)
            self.db.execute('UPDATE cc_calls SET ' + columns + ' WHERE id=?', (*values.values(), identifier))
            self.db.commit()

    def start(self, value):
        if (not isinstance(value, dict) or value.get('confirmed') is not True
                or set(value) - {'id', 'to', 'mode', 'objective', 'message', 'confirmed'}):
            raise TelephonyError('Confirma explícitamente la llamada y revisa sus campos.')
        identifier, destination = request_id(value.get('id')), rd_number(value.get('to'))
        mode = value.get('mode', 'conversation')
        if mode not in ('conversation', 'message'):
            raise TelephonyError('El modo debe ser conversation o message.')
        objective = clean_text(value.get('objective', OBJECTIVE), 600)
        message = clean_text(value.get('message', 'Hola, esta es una prueba de voz de Brivany. Hasta luego.'), 600)
        if mode == 'conversation' and not self.voice_ready():
            raise TelephonyError('Configura Muse, Meta y Cartesia antes de llamar con Melodi.')
        fingerprint = hmac.new(self.config.token.encode(), json.dumps([destination, mode, objective, message]).encode(), hashlib.sha256).hexdigest()
        with self.lock:
            if self.closed.is_set():
                raise TelephonyError('El servicio de llamadas está cerrado.')
            existing = self.db.execute('SELECT fingerprint FROM cc_calls WHERE id=?', (identifier,)).fetchone()
            if existing:
                if not hmac.compare_digest(existing['fingerprint'], fingerprint):
                    raise TelephonyError('Ese id ya pertenece a otro encargo; no se ha vuelto a marcar.')
                return self.status(identifier)
            if self.db.execute("SELECT 1 FROM cc_calls WHERE state NOT IN ('completed','failed','canceled','interrupted')").fetchone():
                raise TelephonyError('Espera a que termine la llamada anterior o aclara su estado.')
            self.db.execute('INSERT INTO cc_calls (id,fingerprint,destination,mode,state,created) VALUES (?,?,?,?,?,?)',
                            (identifier, fingerprint, masked(destination), mode, 'preparing', time.time()))
            self.db.commit()
            self.runtime[identifier] = Runtime(destination, mode, objective, message, safety=CallSafety(clock=self.clock))
        try:
            data = self.api.request('POST', '/calls', {
                'connection_id': self.config.connection_id, 'to': destination,
                'from': self.config.from_number, 'webhook_url': self.config.webhook,
                'client_state': base64.b64encode(identifier.encode()).decode(),
                'command_id': identifier, 'timeout_secs': 30, 'time_limit_secs': MAX_CALL_SECONDS,
            }).get('data') or {}
            control = data.get('call_control_id') if isinstance(data, dict) else None
            if not isinstance(control, str) or not 1 <= len(control) <= 1024:
                raise ProviderError('Telnyx no devolvió el identificador de llamada.', uncertain=True)
            with self.lock:
                row = self.db.execute('SELECT control_id,state FROM cc_calls WHERE id=?', (identifier,)).fetchone()
                if row['control_id'] and row['control_id'] != control:
                    raise ProviderError('Los identificadores de la llamada no coinciden.', uncertain=True)
                self._update(identifier, control_id=control, **({'state': 'dialing'} if row['state'] == 'preparing' else {}))
            if self.runtime[identifier].cancel_requested:
                self.action(identifier, 'hangup')
        except ProviderError as error:
            with self.lock:
                row = self.db.execute('SELECT state,control_id FROM cc_calls WHERE id=?', (identifier,)).fetchone()
                if not row['control_id'] and row['state'] not in TERMINAL:
                    self._update(identifier, state='uncertain' if error.uncertain else 'failed',
                                 error='Envío no confirmado; consulta el estado antes de volver a llamar.' if error.uncertain else str(error))
            if not error.uncertain:
                self.runtime[identifier].ended.set()
                raise
        return self.status(identifier)

    def receive(self, body, signature, timestamp):
        if not valid_signature(self.config.verification_key, body, signature, timestamp):
            raise PermissionError('Firma Telnyx no válida.')
        try:
            event = json.loads(body)['data']
            event_id, kind, payload = event['id'], event['event_type'], event['payload']
            if (not isinstance(event_id, str) or not 1 <= len(event_id) <= 128
                    or not isinstance(kind, str) or not re.fullmatch(r'[a-z_.]{1,80}', kind)
                    or not isinstance(payload, dict)):
                raise ValueError()
            control = payload['call_control_id']
            if not isinstance(control, str) or not 1 <= len(control) <= 1024:
                raise ValueError()
            occurred = datetime.fromisoformat(event['occurred_at'].replace('Z', '+00:00')).timestamp()
        except (ValueError, TypeError, KeyError, AttributeError):
            raise TelephonyError('Evento Telnyx no válido.') from None
        if payload.get('connection_id') is not None and str(payload['connection_id']) != self.config.connection_id:
            return False
        with self.lock:
            row = self.db.execute('SELECT * FROM cc_calls WHERE control_id=?', (control,)).fetchone()
            if row is None:
                try:
                    identifier = request_id(base64.b64decode(payload.get('client_state', ''), validate=True).decode())
                except (ValueError, UnicodeError):
                    return False
                row = self.db.execute('SELECT * FROM cc_calls WHERE id=?', (identifier,)).fetchone()
                if not row or row['control_id'] or row['state'] in TERMINAL or identifier not in self.runtime:
                    return False
                self._update(identifier, control_id=control, error='')
            identifier = row['id']
            runtime = self.runtime.get(identifier)
            # Persist only bounded operational fields, never the webhook body.
            fields = {key: str(payload[key])[:128] for key in ('hangup_cause', 'hangup_source', 'sip_hangup_cause') if payload.get(key) is not None}
            cursor = self.db.execute('INSERT OR IGNORE INTO cc_events (id,call_id,kind,occurred,fields) VALUES (?,?,?,?,?)',
                                     (event_id, identifier, kind, occurred, json.dumps(fields)))
            self.db.commit()
            if not cursor.rowcount:
                return False
            if kind == 'call.hangup' and row['state'] not in TERMINAL:
                duration = max(0., occurred - row['answered']) if row['answered'] is not None else 0.
                self._update(identifier, state='completed' if row['answered'] is not None else 'failed',
                             finished=occurred, duration=round(duration, 3), cause=fields.get('hangup_cause', 'unknown'))
                if runtime:
                    runtime.ended.set()
            elif kind == 'call.answered' and row['state'] not in TERMINAL:
                self._update(identifier, state='in-progress', answered=row['answered'] or occurred)
                if runtime:
                    runtime.safety.connected()
            elif kind == 'call.initiated' and row['state'] in ('preparing', 'dialing', 'uncertain'):
                self._update(identifier, state='ringing')
        self.wake.set()
        return True

    def media_url(self, identifier):
        runtime = self.runtime.get(identifier)
        if not runtime:
            raise TelephonyError('Sesión de voz no disponible.')
        return self.config.origin.replace('https://', 'wss://', 1).rstrip('/') + '/media/telnyx/' + identifier + '/' + runtime.capability

    def media_runtime(self, identifier, capability):
        with self.lock:
            runtime = self.runtime.get(identifier)
            if (not runtime or runtime.mode != 'conversation' or runtime.ended.is_set()
                    or runtime.media_claimed or not hmac.compare_digest(runtime.capability, capability)
                    or self.status(identifier)['state'] != 'in-progress'):
                raise PermissionError('Stream no autorizado.')
            runtime.media_claimed = True
            return runtime

    def action(self, identifier, kind, body=None):
        with self.lock:
            row = self.db.execute('SELECT * FROM cc_calls WHERE id=?', (identifier,)).fetchone()
            if not row or row['state'] in TERMINAL or not row['control_id']:
                return False
            if self.db.execute('SELECT 1 FROM cc_actions WHERE call_id=? AND kind=?', (identifier, kind)).fetchone():
                return False
            self.db.execute('INSERT INTO cc_actions VALUES (?,?,?)', (identifier, kind, 'sending'))
            self.db.commit()
        try:
            self.api.request('POST', '/calls/' + quote(row['control_id'], safe='') + '/actions/' + kind,
                             {**(body or {}), 'command_id': str(uuid5(NAMESPACE_URL, identifier + '/' + kind))})
            outcome = 'sent'
        except TelephonyError:
            outcome = 'uncertain'
            self._update(identifier, error='No se pudo confirmar la acción ' + kind + '; no se repite automáticamente.')
        with self.lock:
            self.db.execute('UPDATE cc_actions SET state=? WHERE call_id=? AND kind=?', (outcome, identifier, kind))
            self.db.commit()
        return outcome == 'sent'

    def process_one(self):
        with self.lock:
            event = self.db.execute('SELECT * FROM cc_events WHERE processed=0 ORDER BY rowid LIMIT 1').fetchone()
        if not event:
            return False
        identifier, kind = event['call_id'], event['kind']
        runtime = self.runtime.get(identifier)
        if runtime and not runtime.ended.is_set():
            if kind == 'call.answered':
                if runtime.mode == 'message':
                    self.action(identifier, 'speak', {'payload': runtime.message, 'payload_type': 'text', 'voice': 'female', 'language': 'es-MX'})
                else:
                    self.action(identifier, 'streaming_start', {'stream_url': self.media_url(identifier),
                        'stream_track': 'inbound_track', 'stream_codec': 'PCMU',
                        'stream_bidirectional_mode': 'rtp', 'stream_bidirectional_codec': 'PCMU'})
            elif runtime.mode == 'message' and kind in ('call.speak.ended', 'call.playback.ended'):
                self.action(identifier, 'hangup')
        with self.lock:
            self.db.execute('UPDATE cc_events SET processed=1 WHERE id=?', (event['id'],))
            self.db.commit()
        return True

    def _work(self):
        while not self.closed.is_set():
            if not self.process_one():
                self.wake.wait(.5)
                self.wake.clear()

    def check_safety(self):
        closed = 0
        with self.lock:
            pending = list(self.runtime.items())
        for identifier, runtime in pending:
            reason = runtime.safety.reason()
            if reason and not runtime.ended.is_set() and self.status(identifier)['state'] not in TERMINAL:
                runtime.cancel_requested = True
                runtime.ended.set()
                message = {'user_silence': 'Llamada cerrada tras 15 segundos sin voz del usuario.',
                           'communication_timeout': 'No se pudo establecer la comunicación en 15 segundos.',
                           'maximum_duration': 'Se alcanzó el límite absoluto de 90 segundos.'}[reason]
                self._update(identifier, end_reason=reason, error=message)
                self.action(identifier, 'hangup')
                closed += 1
        return closed

    def _watch_safety(self):
        while not self.closed.wait(.1):
            self.check_safety()

    def cancel(self, identifier):
        request_id(identifier)
        with self.lock:
            runtime = self.runtime.get(identifier)
            if runtime:
                runtime.cancel_requested = True
                runtime.ended.set()
        self.action(identifier, 'hangup')
        return self.status(identifier)

    def close(self):
        self.closed.set()
        self.wake.set()
        for identifier, runtime in list(self.runtime.items()):
            if not runtime.ended.is_set():
                self.action(identifier, 'hangup')
                runtime.ended.set()
        if self.worker:
            self.worker.join(22)
            self.watchdog.join(22)
        with self.lock:
            self.db.close()
