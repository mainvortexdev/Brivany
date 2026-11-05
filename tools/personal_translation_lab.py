"""One opt-in observation through the installed extension's normal Work relay.

This server never navigates a browser, reloads an extension or accesses browser
internals. It owns 127.0.0.1:48217 or fails; it cannot attach to or replace a
running desktop relay. Provider factories are armed only by POST /api/run.
Audio/transcripts/capability tokens are never included in diagnostic records.
"""
from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from http.client import HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import threading
import time

from services.h1.server import ROOT
from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN, BRIVANY_EXTENSION_PORT
from services.work.selected_video import SelectedVideoError, SelectedVideoHub
from services.work.sync_relay import SyncRelay

EXPECTED_VIDEO = 'sr_iLGKNsxU'
EXPECTED_BUILD = '0.4.8-recorder-gap-050'
PROTOCOL = 2
MAX_BODY = 65536
REPORT_TYPE = 'personal_brave_normal_work_relay_observation'
CODE = re.compile(r'[A-Za-z0-9_.-]{1,80}\Z')
ERRORS = {
    'relay_port_busy': 'El puerto 48217 está ocupado. El banco no modifica el enlace activo ni elige otro puerto.',
    'providers_unavailable': 'No están disponibles los tres servicios de traducción configurados.',
    'workspace_timeout': 'La extensión instalada no conectó su canal Work dentro del plazo del ensayo.',
    'video_request_failed': 'La extensión no confirmó la selección del video activo.',
    'provider_error': 'El recorrido de traducción notificó un error; consulta su código saneado.',
    'capture_not_started': 'Terminó la observación sin abrir una sesión de captura ni recibir audio del video.',
    'frontend_unverified': 'Terminó la observación; faltan mediciones suficientes del reproductor para verificar su calidad.',
    'stopped': 'Ensayo detenido; los resultados no acreditan una reproducción completa.',
}


def now():
    return datetime.now(timezone.utc).isoformat()


def number(value, minimum=0, maximum=1_000_000):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


@dataclass(frozen=True)
class Config:
    seconds: int = 120
    connect_timeout: int = 20
    target: str = 'en'
    port: int = 49198
    relay_port: int = BRIVANY_EXTENSION_PORT

    def __post_init__(self):
        if type(self.seconds) is not int or not 10 <= self.seconds <= 120:
            raise ValueError('La observación debe durar entre 10 y 120 segundos.')
        if type(self.connect_timeout) is not int or not 1 <= self.connect_timeout <= min(30, self.seconds):
            raise ValueError('El plazo de conexión debe caber en la observación, con un máximo de 30 segundos.')
        if self.target not in ('en', 'es', 'fr'):
            raise ValueError('Idioma de destino no válido.')
        if type(self.port) is not int or not 0 <= self.port <= 65535 or self.port == BRIVANY_EXTENSION_PORT:
            raise ValueError('Puerto HTTP local no válido.')
        if self.relay_port != BRIVANY_EXTENSION_PORT or type(self.relay_port) is not int:
            raise ValueError('El ensayo personal requiere exclusivamente el puerto normal 48217.')


def safe_event(value):
    """Copy only enumerated diagnostics; never retain an original event."""
    if not isinstance(value, dict) or value.get('type') not in {
        'ready', 'source-progress', 'source-turn', 'source-skipped', 'prefix-used',
        'live-asr-connected', 'live-asr-start', 'stage-metrics', 'dub-cue', 'error', 'done', 'usage'
    }:
        return None
    result = {'type': value['type']}
    for key in ('source_start_ms', 'source_end_ms', 'processed_ms', 'duration_ms', 'resume_from_ms',
                'speaker_index', 'at_ms', 'sample_rate', 'confidence', 'timbre_confidence', 'latency_ms',
                'synthesis_speed', 'duration_budget_ms', 'source_word_count', 'translated_word_count'):
        if number(value.get(key)):
            result[key] = value[key]
    for key in ('stage', 'phase', 'code', 'reason', 'voice_category', 'timing_quality', 'voice_timbre', 'timbre_source'):
        if isinstance(value.get(key), str) and CODE.fullmatch(value[key]):
            result[key] = value[key]
    for key in ('available', 'voice_category_provisional', 'duration_budget_applied'):
        if type(value.get(key)) is bool:
            result[key] = value[key]
    usage = value.get('usage')
    if isinstance(usage, dict):
        result['usage'] = {key: usage[key] for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'attempts')
                           if type(usage.get(key)) is int and 0 <= usage[key] <= 2_147_483_647}
    return result


def validate_observation(value, *, published_count, sent_cues):
    """Accept explicit numeric evidence, not arbitrary browser/page payloads.

    Seconds: lag/capture/media/source_anchor and row intervals/durations.
    Milliseconds: first_signal_after_capture_ms. No URLs or free text accepted.
    """
    if (not isinstance(value, dict) or set(value) != {'source_video_id', 'brivany_build', 'protocol', 'stats'} or
            value['source_video_id'] != EXPECTED_VIDEO or value['brivany_build'] != EXPECTED_BUILD or
            type(value['protocol']) is not int or value['protocol'] != PROTOCOL):
        raise ValueError('Identidad, versión o protocolo de observación no coincidente.')
    stats = value['stats']
    required = {'lag', 'capture', 'media', 'completed_voice_count', 'completed_voices_with_signal', 'signaled_voices',
                'first_signal_after_capture_ms', 'source_anchor', 'source_rate', 'completed_voices'}
    optional = {'initial_lag', 'maximum_lag', 'maximum_lag_growth'}
    if not isinstance(stats, dict) or not required <= set(stats) or set(stats) - required - optional:
        raise ValueError('Esquema de métricas no válido.')
    for key in ('lag', 'capture', 'media'):
        if not number(stats[key], 0, 180):
            raise ValueError('Reloj no válido.')
    if (not number(stats['source_anchor'], 0, 86400) or not number(stats['source_rate'], .25, 4) or
            abs(stats['lag'] - max(0, stats['capture'] - stats['media'])) > .3 or
            stats['media'] > stats['capture'] + .3):
        raise ValueError('Relojes de fuente y reproducción incoherentes.')
    first = stats['first_signal_after_capture_ms']
    if first is not None and not number(first, 0, 180000):
        raise ValueError('Tiempo de primera señal no válido.')
    for key in ('completed_voice_count', 'completed_voices_with_signal', 'signaled_voices'):
        if type(stats[key]) is not int or not 0 <= stats[key] <= 512:
            raise ValueError('Contador de voces no válido.')
    if not 0 <= stats['completed_voices_with_signal'] <= stats['completed_voice_count'] <= published_count:
        raise ValueError('Las voces completas exceden las enviadas por el backend.')
    if not stats['completed_voices_with_signal'] <= stats['signaled_voices'] <= published_count:
        raise ValueError('Contadores de señal incoherentes.')
    rows = stats['completed_voices']
    row_keys = {'source_start', 'source_end', 'category', 'provisional', 'speaker', 'rate',
                'audio_seconds', 'wall_seconds', 'peak', 'signal_measured'}
    if not isinstance(rows, list) or len(rows) != min(32, stats['completed_voice_count']):
        raise ValueError('Lista de voces no válida.')
    clean_rows = []
    prior = -1.
    for row in rows:
        if not isinstance(row, dict) or set(row) != row_keys:
            raise ValueError('Fila de voz no válida.')
        if (not number(row['source_start'], 0, 180) or not number(row['source_end'], 0, 180) or
                row['source_end'] <= row['source_start'] or row['source_start'] < prior - .03 or
                row['source_end'] > stats['capture'] + .3 or not number(row['rate'], .5, 2) or
                not number(row['audio_seconds'], .001, 30) or not number(row['wall_seconds'], 0, 45) or
                not number(row['peak'], 0, 4) or row['category'] not in ('masculine', 'feminine', 'uncertain') or
                type(row['provisional']) is not bool or type(row['signal_measured']) is not bool or
                row['speaker'] is not None and (type(row['speaker']) is not int or not 1 <= row['speaker'] <= 32)):
            raise ValueError('Valores de voz no válidos.')
        match = next((cue for cue in sent_cues if
                      abs(cue['source_start_ms'] / 1000 - row['source_start']) <= .1 and
                      abs(cue['source_end_ms'] / 1000 - row['source_end']) <= .1 and
                      cue.get('voice_category') == row['category'] and
                      cue.get('speaker_index') == row['speaker'] and
                      (cue.get('voice_category_provisional') is True) == row['provisional']), None)
        if match is None:
            raise ValueError('La voz observada no coincide con un intervalo enviado.')
        prior = row['source_end']
        clean_rows.append(dict(row))
    signaled_rows = sum(row['signal_measured'] and row['peak'] > .01 for row in rows)
    if signaled_rows > stats['completed_voices_with_signal']:
        raise ValueError('La señal de las filas excede el contador.')
    if len(rows) == stats['completed_voice_count'] and signaled_rows != stats['completed_voices_with_signal']:
        raise ValueError('La señal de las filas no concuerda con el total.')
    for key in optional & set(stats):
        if not number(stats[key], 0, 180):
            raise ValueError('Máximo de retraso no válido.')
    if 'maximum_lag' in stats and stats['maximum_lag'] + .03 < stats['lag']:
        raise ValueError('El retraso actual supera su máximo.')
    if optional <= set(stats) and (stats['maximum_lag'] + .03 < stats['initial_lag'] or
            stats['maximum_lag_growth'] + .03 < max(0, stats['maximum_lag'] - stats['initial_lag'])):
        raise ValueError('Crecimiento de retraso incoherente.')
    return {**{key: stats[key] for key in required | optional if key in stats and key != 'completed_voices'},
            'completed_voices': clean_rows}


class ObservedPeer:
    def __init__(self, peer, lab):
        self.peer = peer
        self.lab = lab
        self.prepared_prefix = getattr(peer, 'prepared_prefix', None)
        self.report_error = getattr(peer, 'report_error', None)

    def recv(self, timeout=8):
        raw = self.peer.recv(timeout=timeout)
        if isinstance(raw, bytes):
            with self.lab.lock:
                self.lab.counts['input_pcm_bytes'] += len(raw)
        return raw

    def send(self, raw):
        if isinstance(raw, str):
            try:
                event = json.loads(raw)
            except (TypeError, ValueError):
                event = None
            self.lab.observe_backend(event)
        return self.peer.send(raw)

    def close(self):
        return self.peer.close()


class ObservedBridge:
    def __init__(self, bridge, lab):
        self.bridge, self.lab = bridge, lab

    def __getattr__(self, key):
        return getattr(self.bridge, key)

    @property
    def lock(self):
        return self.bridge.lock

    @lock.setter
    def lock(self, value):
        self.bridge.lock = value

    def handle(self, peer):
        return self.bridge.handle(ObservedPeer(peer, self.lab))

    def close(self):
        return self.bridge.close()


class PersonalLab:
    def __init__(self, config, *, allow_paid=False, clock=time.monotonic, relay_factory=SyncRelay,
                 configure=None, bridge_builder=None):
        if allow_paid is not True:
            raise ValueError('El banco personal requiere --allow-paid explícito.')
        self.config, self.clock = config, clock
        self.relay_factory, self.configure, self.bridge_builder = relay_factory, configure, bridge_builder
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.state = 'idle'
        self.error_code = None
        self.started_at = self.finished_at = None
        self.started_clock = self.deadline = None
        self.relay = self.worker = None
        self.relay_closed = False
        self.events = deque(maxlen=2048)
        self.sent_cues = deque(maxlen=256)
        self.frontend = None
        self.frontend_observations = 0
        self.verified_models = ()
        self.caption_translators = []
        self.report_file = None
        self.workspace_connected_observed = False
        self.video_request_attempted = False
        self.video_selection_acknowledged = False
        self.counts = {key: 0 for key in ('relay_sessions_started', 'prefix_preparations_started',
            'prefix_muse_batch_attempts', 'prefix_meta_prosody_attempts', 'live_meta_prosody_attempts',
            'input_pcm_bytes', 'backend_cues_sent')}

    def open_relay(self):
        """Bind the production port once. No desktop process is stopped."""
        if self.relay is not None:
            raise ValueError('El enlace ya fue preparado.')
        if self.configure is not None:
            self.configure()
        else:
            from services.h1.server import load_local_config
            from packages.providers.river_translation import river_status
            from packages.providers.meta_prosody import verified_audio_models
            load_local_config()
            status = river_status()
            if not status['configured'] or status['access_blocked']:
                raise RuntimeError(ERRORS['providers_unavailable'])
            self.verified_models = verified_audio_models(ROOT / '.local/translation/meta-audio-access.json')
        def reject_legacy(_selected):
            raise SelectedVideoError('Este banco requiere traducción dentro de la pestaña mediante el enlace Work.')
        relay = self.relay_factory(port=BRIVANY_EXTENSION_PORT, automatic_origin=BRIVANY_EXTENSION_ORIGIN,
            video_hub=SelectedVideoHub(on_translate=reject_legacy), bridge_factory=self.build_bridge,
            inline_settings=lambda: {'target': self.config.target, 'voice': 'auto'}, prefix_factory=self.prepare_prefix)
        try:
            relay.start()
        except OSError:
            self.error_code = 'relay_port_busy'
            raise RuntimeError(ERRORS['relay_port_busy']) from None
        self.relay = relay
        return self

    def _armed(self):
        return self.state == 'running' and not self.cancelled.is_set() and self.deadline is not None and self.clock() < self.deadline

    def counted_connection(self, counter):
        owner = self
        class CountedConnection(HTTPSConnection):
            def request(self, *args, **kwargs):
                with owner.lock:
                    owner.counts[counter] += 1
                return super().request(*args, **kwargs)
        return CountedConnection

    def build_bridge(self):
        with self.lock:
            if not self._armed() or self.counts['relay_sessions_started']:
                raise ValueError('El banco permite una única sesión dentro del ensayo activo.')
            self.counts['relay_sessions_started'] += 1
        if self.bridge_builder is not None:
            bridge = self.bridge_builder()
        else:
            from packages.providers.river_translation import RiverBridge
            from packages.providers.meta_prosody import MetaProsodySession
            from packages.providers.caption_prefetch import CaptionPrefetch
            def prefetch(target, *, translator_factory, epoch):
                def translator():
                    created = translator_factory()
                    with self.lock:
                        self.caption_translators.append(created)
                    return created
                return CaptionPrefetch(target, translator_factory=translator, epoch=epoch)
            bridge = RiverBridge(0, allow_synchronized=True, caption_prefetch_factory=prefetch,
                prosody_factory=lambda: MetaProsodySession(verified_models=self.verified_models,
                    _connection_factory=self.counted_connection('live_meta_prosody_attempts')))
        return ObservedBridge(bridge, self)

    def prepare_prefix(self, raw, *, cancelled):
        with self.lock:
            if not self._armed() or self.counts['prefix_preparations_started']:
                raise ValueError('El banco permite una apertura de siete segundos dentro del ensayo activo.')
            self.counts['prefix_preparations_started'] += 1
        from packages.providers.prefix_translation import prepare_prefix, _transcribe
        from packages.providers.meta_prosody import MetaProsodySession
        return prepare_prefix(raw, cancelled=cancelled,
            transcriber=lambda pcm, *, cancelled: _transcribe(pcm, cancelled=cancelled,
                connection_factory=self.counted_connection('prefix_muse_batch_attempts')),
            prosody_factory=lambda: MetaProsodySession(verified_models=self.verified_models,
                _connection_factory=self.counted_connection('prefix_meta_prosody_attempts')))

    def observe_backend(self, raw):
        event = safe_event(raw)
        if event is None:
            return
        with self.lock:
            if self.state != 'running':
                return
            event['observed_ms'] = round((self.clock() - self.started_clock) * 1000, 3)
            self.events.append(event)
            if event['type'] == 'dub-cue' and 'source_start_ms' in event and 'source_end_ms' in event:
                self.counts['backend_cues_sent'] += 1
                self.sent_cues.append(event)
            if event['type'] == 'error':
                self.error_code = 'provider_error'

    def observe_frontend(self, value):
        with self.lock:
            if not self._armed():
                raise ValueError('No hay un ensayo activo para esta observación.')
            clean = validate_observation(value, published_count=self.counts['backend_cues_sent'], sent_cues=list(self.sent_cues))
            self.frontend, self.frontend_observations = clean, self.frontend_observations + 1

    def start(self):
        with self.lock:
            if self.state != 'idle' or self.relay is None or self.relay_closed:
                return False
            self.state, self.started_at = 'running', now()
            self.started_clock = self.clock()
            self.deadline = self.started_clock + self.config.seconds
            self.worker = threading.Thread(target=self._run, daemon=True, name='brivany-personal-translation-lab')
            self.worker.start()
            return True

    def _run(self):
        try:
            connect_deadline = min(self.deadline, self.started_clock + self.config.connect_timeout)
            while not self.cancelled.is_set() and not self.relay.status().get('workspace_connected'):
                if self.clock() >= connect_deadline:
                    self.error_code = 'workspace_timeout'
                    return
                self.cancelled.wait(.05)
            if self.cancelled.is_set():
                return
            with self.lock:
                self.workspace_connected_observed = True
            remaining = self.deadline - self.clock()
            if remaining <= 0:
                self.error_code = 'workspace_timeout'
                return
            try:
                with self.lock:
                    self.video_request_attempted = True
                self.relay.request_video(timeout=min(5, remaining))
                with self.lock:
                    self.video_selection_acknowledged = True
            except ValueError:
                self.error_code = 'video_request_failed'
                return
            while not self.cancelled.is_set() and self.clock() < self.deadline and self.error_code is None:
                self.cancelled.wait(.05)
        finally:
            self.close_relay()
            with self.lock:
                self.state, self.finished_at = 'failed', now()
                if self.error_code is None:
                    if self.cancelled.is_set():
                        self.error_code = 'stopped'
                    elif not self.counts['relay_sessions_started'] and not self.counts['input_pcm_bytes']:
                        self.error_code = 'capture_not_started'
                    else:
                        self.error_code = 'frontend_unverified'
                report = self.report()
            folder = ROOT / 'tmp/selected-video'
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / ('personal-sync-' + str(time.time_ns()) + '.json')
            path.write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')
            with self.lock:
                self.report_file = path.name

    def close_relay(self):
        with self.lock:
            if self.relay is None or self.relay_closed:
                return
            self.relay_closed = True
        self.relay.close()

    def close(self):
        self.cancelled.set()
        self.close_relay()
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(timeout=3)

    def report(self):
        """An observed delivery is not evidence that a browser played it."""
        with self.lock:
            front = self.frontend
            events = list(self.events)
            counts = dict(self.counts)
            counts['meta_caption_prefetch_attempts'] = sum(getattr(t, 'total_attempts', 0) for t in self.caption_translators)
            counts['muse_live_session_acks_observed'] = sum(e['type'] == 'live-asr-connected' for e in events)
            counts['live_mt_attempts_observed'] = sum(e.get('stage') == 'mt_attempt' for e in events)
            counts['tts_requests_observed'] = sum(e.get('stage') == 'tts_request' for e in events)
            counts['billing_amount'] = None
            cues = []
            if front:
                for row in front['completed_voices']:
                    cues.append({'speaker': row['speaker'], 'category': row['category'], 'provisional': row['provisional'],
                        'source': row['source_start'], 'source_end': row['source_end'], 'rate': row['rate'],
                        'duration': row['audio_seconds'], 'wall': row['wall_seconds'], 'completed': True,
                        'audio_peak': row['peak'] if row['signal_measured'] else None, 'timing_quality': 'frontend_observation'})
            return {'type': REPORT_TYPE, 'report_file': self.report_file, 'passed': False,
                'started_at': self.started_at, 'finished_at': self.finished_at,
                'provider_trial_max_seconds': self.config.seconds, 'backend_events': events,
                'backend_cues_sent': counts['backend_cues_sent'], 'last_processed_ms': max((e.get('processed_ms', 0) for e in events), default=0),
                'consumption': counts, 'frontend_metrics': front, 'frontend_observations': self.frontend_observations,
                'connection_diagnostics': {
                    'workspace_connected_observed': self.workspace_connected_observed,
                    'video_request_attempted': self.video_request_attempted,
                    'video_selection_acknowledged': self.video_selection_acknowledged,
                    'capture_bridge_started': counts['relay_sessions_started'] > 0,
                    'capture_pcm_received': counts['input_pcm_bytes'] > 0},
                'source_video_id': EXPECTED_VIDEO if front else None,
                'frontend_source_identity_observed': bool(front), 'source_identity_verified': False,
                'browser_voice_played': front['completed_voice_count'] if front else None,
                'browser_cues_with_signal': front['completed_voices_with_signal'] if front else None,
                'audio_output_detected': bool(front and front['completed_voices_with_signal'] > 0),
                'physical_listening_verified': False, 'public_speaker_match_verified': False,
                'full_video_verified': False, 'cues': cues, 'protocol': events[-512:], 'billing_amount': None,
                'error_code': self.error_code, 'sample_url': None,
                'scope': 'Normal Work relay only; frontend metrics are validated numeric reports, not human listening or full-video proof.'}

    def status(self):
        with self.lock:
            workspace = bool(self.relay and not self.relay_closed and self.relay.status().get('workspace_connected'))
            return {'state': self.state, 'started_at': self.started_at, 'finished_at': self.finished_at,
                'error': ERRORS.get(self.error_code), 'report': self.report() if self.state != 'idle' else None,
                'target': self.config.target, 'position': None, 'prefix_requested': False,
                'continuity_trial': False, 'observation_limit_seconds': self.config.seconds,
                'sample_url': None, 'workspace_connected': workspace, 'relay_port': BRIVANY_EXTENSION_PORT,
                'normal_installed_extension_only': True}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def local(self, *, post=False):
        expected = f'127.0.0.1:{self.server.server_port}'
        origin = self.headers.get('Origin')
        return (self.client_address[0] == '127.0.0.1' and self.headers.get_all('Host') == [expected] and
                (origin == 'http://' + expected if post else origin in (None, 'http://' + expected)))

    def send(self, status, value, mime='application/json; charset=utf-8'):
        body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-src https://www.youtube.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def body(self, maximum):
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get('Transfer-Encoding') or len(lengths) != 1:
            raise ValueError('Invalid request framing')
        length = int(lengths[0])
        if not 0 <= length <= maximum or self.headers.get_content_type() != 'application/json':
            raise ValueError('Invalid request body')
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError('Incomplete body')
        return json.loads(raw)

    def do_GET(self):
        if not self.local():
            return self.send(403, {'error': 'Origen local exacto requerido.'})
        if self.path == '/api/status':
            return self.send(200, self.server.lab.status())
        if self.path == '/':
            page = (ROOT / 'web/translation-lab.html').read_text(encoding='utf-8')
            page = re.sub(r'<p id="detail">.*?</p>', '<p id="detail">Este banco usa la extensión ya instalada mediante el enlace normal de Work. No recarga ni instala software. Sin observaciones del reproductor, solo verifica entrega del backend.</p>', page)
            page = page.replace('Brave está preparando el inicio del video y comprobando el audio del doblaje. El resultado aparecerá aquí.', 'Esperando el canal Work y midiendo la entrega del backend. El sonido requiere observaciones del reproductor.')
            page = re.sub(r'(<div id="video-label"[^>]*>).*?(</div>)', r'\1Tecnonauta · Video de referencia · Posición actual en Brave por medir\2', page)
            page = re.sub(r'(<small id="test-plan"[^>]*>).*?(</small>)', r'\1Solicita el video en su posición actual en Brave. El inicio aún no está medido.\2', page)
            page = re.sub(r'(<strong id="handoff-title"[^>]*>).*?(</strong>)', r'\1Posición actual en Brave\2', page)
            page = re.sub(r'(<p id="handoff-detail"[^>]*>).*?(</p>)', r'\1La posición de inicio se mide en el reproductor de Brave.\2', page)
            page = page.replace('Ensayo desde la posición indicada, con hasta', 'Ensayo desde la posición actual en Brave, con hasta')
            page = page.replace('Inicio desde la posición de prueba', 'Inicio desde la posición actual en Brave')
            page = page.replace('El doblaje captura desde este punto. Este ensayo no reutiliza la transcripción de apertura de siete segundos.',
                                'El banco solicita el video en la posición actual en Brave. La posición de inicio aún no está medida.')
            page = page.replace("running:'Capturando y midiendo…'", "running:'Solicitando video y observando…'")
            return self.send(200, page.encode('utf-8'), 'text/html; charset=utf-8')
        self.send(404, {'error': 'Recurso no disponible.'})

    def do_POST(self):
        if not self.local(post=True):
            return self.send(403, {'error': 'Origen local exacto requerido.'})
        try:
            if self.path == '/api/observe':
                self.server.lab.observe_frontend(self.body(MAX_BODY))
                return self.send(200, {'observed': True})
            if self.path in ('/api/run', '/api/stop'):
                if self.body(16) != {}:
                    raise ValueError('Unexpected fields')
                if self.path == '/api/stop':
                    self.server.lab.close()
                    return self.send(200, self.server.lab.status())
                started = self.server.lab.start()
                return self.send(202 if started else 409, self.server.lab.status())
        except (ValueError, TypeError, OSError):
            return self.send(400, {'error': 'Observación o solicitud no válida.'})
        self.send(404, {'error': 'Recurso no disponible.'})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_close(self):
        try:
            if getattr(self, 'lab', None) is not None:
                self.lab.close()
        finally:
            super().server_close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-paid', action='store_true', required=True,
                        help='Permit one bounded translation trial after the local Run button.')
    parser.add_argument('--seconds', type=int, default=120)
    parser.add_argument('--connect-timeout', type=int, default=20)
    parser.add_argument('--target', choices=('en', 'es', 'fr'), default='en')
    parser.add_argument('--port', type=int, default=49198)
    args = parser.parse_args(argv)
    try:
        config = Config(seconds=args.seconds, connect_timeout=args.connect_timeout, target=args.target, port=args.port)
        lab = PersonalLab(config, allow_paid=args.allow_paid).open_relay()
    except (ValueError, RuntimeError, OSError) as error:
        parser.exit(2, str(error) + '\n')
    try:
        with Server(('127.0.0.1', config.port), Handler) as server:
            server.lab = lab
            print(f'http://127.0.0.1:{server.server_port}/', flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        lab.close()


if __name__ == '__main__':
    main()
