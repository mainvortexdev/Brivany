"""Serve the local inline-translation diagnostic and authorize one real trial."""
import argparse
import base64
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import math
import re
import secrets
from subprocess import TimeoutExpired
import threading
import wave

from services.h1.server import ROOT
from tools.run_isolated_inline import run_trial, trial_minimum_source_end


PAGE = ROOT / 'web/translation-lab.html'
PUBLIC_TRIAL = 'public_youtube_isolated_brave_inline_sync'
SAMPLE_RATE = 24000
MAX_SAMPLE_BYTES = 6 * SAMPLE_RATE * 2
MAX_CUE_REQUEST = 4 * (MAX_SAMPLE_BYTES // 3) + 1024
MAX_REPORT_BYTES = 1_000_000
OPENING_ERRORS = frozenset({'source_navigation_timeout','source_navigation_failed','source_player_timeout',
                            'source_identity_timeout','source_identity_mismatch','source_playback_timeout'})
OPENING_PHASES = frozenset({'navegar-video','esperar-reproductor','verificar-identidad','verificar-reproduccion'})
ERROR_MESSAGES = {
    'mt_timeout': 'Meta agotó el plazo de respuesta durante el ensayo.',
    'mt_unavailable': 'Se interrumpió la conexión con Meta.',
    'asr_rejected': 'Muse rechazó o interrumpió la transcripción.',
    'muse_rejected': 'Muse no confirmó la conexión de transcripción.',
    'cartesia_rejected': 'Cartesia rechazó la generación de voz.',
    'tts_timeout': 'Cartesia agotó el plazo de generación de voz.',
    'cartesia_quota': 'Cartesia alcanzó su cuota de voz. Restablece la cuota de la cuenta para volver a traducir.',
    'cartesia_limit': 'Cartesia alcanzó su límite de solicitudes simultáneas.',
    'ingress_backlog': 'La entrada de audio se acumuló mientras Muse dejaba de aceptarla. El video recuperó su audio original.',
    'prefix_busy': 'Otro video estaba en preparación.',
    'prefix_unavailable': 'La transcripción inicial de siete segundos no quedó disponible.',
    'prefix_protocol': 'El navegador y Brivany no pudieron completar la preparación inicial.',
    'source_interrupted': 'YouTube interrumpió la fuente de video antes de que terminara. El ensayo no acredita continuidad.',
    'source_identity_mismatch': 'No se pudo confirmar la identidad y la duración del video antes de activar la traducción.',
    'source_navigation_timeout': 'La navegación del video agotó su plazo antes de confirmar la página.',
    'source_navigation_failed': 'La navegación del video se interrumpió antes de confirmar la página.',
    'source_player_timeout': 'El reproductor del video no quedó visible dentro del plazo de apertura.',
    'source_identity_timeout': 'No se confirmaron a tiempo el video, su duración y la ausencia de anuncios.',
    'source_playback_timeout': 'El video no inició una reproducción estable a velocidad normal dentro del plazo.',
}


def now():
    return datetime.now(timezone.utc).isoformat()


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def fields(row, numbers=(), booleans=(), codes=()):
    if not isinstance(row, dict):
        return {}
    values = {key: row[key] for key in numbers if finite(row.get(key))}
    values.update({key: row[key] for key in booleans if type(row.get(key)) is bool})
    for key in codes:
        value = row.get(key)
        if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
            values[key] = value
    return values


def track_info(row):
    if not isinstance(row, dict):
        return None
    safe = fields(row, booleans=('isDefault', 'isOriginal', 'isDubbed', 'isAutoDubbed'))
    for key in ('id', 'languageCode', 'kind', 'audioTrackType'):
        value = row.get(key)
        if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,64}', value):
            safe[key] = value
    name = row.get('displayName')
    if isinstance(name, str) and len(name) <= 100 and all(ord(char) >= 32 for char in name):
        safe['displayName'] = name
    return safe


def protocol_info(row):
    safe = fields(row, numbers=('at', 'start', 'end', 'speaker', 'confidence', 'timbre_confidence', 'duration_ms', 'resume_from_ms', 'start_ms',
                               'synthesis_speed', 'cluster', 'similarity', 'windows', 'latency_ms', 'duration_budget_ms', 'source_word_count', 'translated_word_count',
                               'segment_index', 'request_ms', 'request_to_first_ms', 'request_to_last_chunk_ms', 'last_chunk_to_done_ms',
                               'attempts', 'recoveries', 'total_attempts', 'total_recoveries'),
                  booleans=('available', 'duration_budget_applied', 'voice_category_provisional', 'partial'),
                  codes=('type', 'stage', 'phase', 'source_phase', 'code', 'category', 'register', 'reason', 'timing_quality', 'voice_timbre', 'timbre_source'))
    if safe.get('phase') not in {'start', 'end', 'request', 'headers', 'sse', 'sse_tail'}:
        safe.pop('phase', None)
    if safe.get('stage') == 'cue_ready' and type(row.get('published_ahead')) is bool:
        safe['published_ahead'] = row['published_ahead']
    if safe.get('type') == 'error' and type(row.get('provider_status')) is int and 100 <= row['provider_status'] <= 599:
        safe['provider_status'] = row['provider_status']
    if safe.get('stage') == 'cue_ready':
        for key in ('leading_padding_ms', 'trailing_padding_ms'):
            if finite(row.get(key)) and 0 <= row[key] <= 170:
                safe[key] = row[key]
    if 'segment_index' in safe and (type(safe['segment_index']) is not int or not 1 <= safe['segment_index'] <= 128):
        safe.pop('segment_index')
    for key in ('request_ms', 'request_to_first_ms', 'request_to_last_chunk_ms', 'last_chunk_to_done_ms'):
        if key in safe and not 0 <= safe[key] <= 180000:
            safe.pop(key)
    for key in ('attempts', 'recoveries', 'total_attempts', 'total_recoveries'):
        if key in safe and (type(safe[key]) is not int or not 0 <= safe[key] <= 512):
            safe.pop(key)
    return safe


def sanitize_report(path):
    if not path or path.stat().st_size > MAX_REPORT_BYTES:
        return None
    report = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(report, dict) or report.get('type') != PUBLIC_TRIAL:
        return None
    safe = fields(report,
                  numbers=('browser_voice_played', 'browser_cues_with_signal', 'last_processed_ms', 'requested_video_position',
                           'provider_trial_max_seconds', 'activation_to_capture_ms', 'activation_to_first_picture_ms', 'activation_to_first_signal_ms',
                           'source_capture_anchor_ms', 'required_source_end_ms', 'completed_source_end_ms'),
                  booleans=('passed', 'public_source_playing', 'public_speaker_match_verified', 'physical_listening_verified',
                            'no_new_window', 'audio_output_detected', 'ephemeral_sample_delivered', 'prefill_requested',
                            'continuity_trial', 'ended_by_trial_limit', 'source_interrupted', 'source_interruption_reported'),
                  codes=('source_identity_error',))
    safe['type'] = PUBLIC_TRIAL
    safe['report_file'] = path.name
    safe['billing_amount'] = None
    safe['cues'] = [fields(row, numbers=('speaker', 'source', 'source_end', 'picture', 'rate', 'duration', 'played', 'wall',
                                        'audio_peak', 'sample_rate', 'onset_ms', 'activation_onset_ms', 'activation_signal_ms', 'sync_error_ms'),
                          booleans=('completed', 'recovered_gap', 'provisional'), codes=('category', 'timing_quality')) for row in report.get('cues', [])[:64]]
    safe['protocol'] = [protocol_info(row) for row in report.get('protocol', [])[:512]]
    safe['timing_quality_counts'] = [fields(row, numbers=('published', 'signaled', 'completed'), codes=('quality',))
                                     for row in report.get('timing_quality_counts', [])[:8]]
    fallback = report.get('original_fallback')
    if isinstance(fallback, dict):
        safe['original_fallback'] = fields(fallback, numbers=('observed_seconds', 'classified_song_seconds', 'other_seconds'))
        safe['original_fallback']['intervals'] = [fields(row, numbers=('start', 'end'))
                                                  for row in fallback.get('intervals', [])[:128]]
    quality = report.get('continuity_quality')
    if isinstance(quality, dict):
        safe['continuity_quality'] = fields(quality,
                                            numbers=('maximum_nonsong_fallback_seconds', 'observed_nonsong_fallback_seconds',
                                                     'verified_source_end_ms', 'unplayed_published_cues',
                                                     'maximum_allowed_lag_seconds', 'maximum_observed_lag_seconds',
                                                     'maximum_allowed_lag_growth_seconds', 'maximum_observed_lag_growth_seconds'), booleans=('passed',))
        safe['continuity_quality']['missing_intervals'] = [fields(row, numbers=('start_ms', 'end_ms'), codes=('timing_quality',))
                                                           for row in quality.get('missing_intervals', [])[:64]]
    safe['media_lag'] = fields(report.get('media_lag'), numbers=('initial_seconds', 'maximum_seconds', 'final_seconds', 'maximum_growth_seconds'))
    if isinstance(report.get('production_audio_diagnostics'), dict):
        safe['production_audio_diagnostics'] = fields(report['production_audio_diagnostics'],
            numbers=('signaled_voices', 'completed_voice_count', 'completed_voices_with_signal',
                     'first_signal_after_capture_ms', 'recorder_gap_recoveries'))
    audio = report.get('source_audio')
    if isinstance(audio, dict):
        safe['source_audio'] = fields(audio, numbers=('playback_rate', 'default_playback_rate'), codes=('browser_language',))
        safe['source_audio']['selected_track'] = track_info(audio.get('selected_track'))
        safe['source_audio']['available_tracks'] = [track_info(row) for row in audio.get('available_tracks', [])[:40] if isinstance(row, dict)]
        safe['source_audio']['selected_is_dubbed'] = audio.get('selected_is_dubbed') if type(audio.get('selected_is_dubbed')) is bool else None
        safe['source_audio']['capture'] = fields(audio.get('capture'), numbers=('context_sample_rate', 'declared_sample_rate', 'declared_sample_size', 'declared_channels'))
    safe['recorder_track'] = fields(report.get('recorder_track'), numbers=('width', 'height', 'frameRate'))
    safe['source_lifecycle'] = fields(report.get('source_lifecycle'), numbers=('time',),
                                      booleans=('connected', 'selected', 'paused'))
    identity = report.get('source_identity')
    if isinstance(identity, dict):
        safe['source_identity'] = fields(identity, booleans=('prefix_asr_may_precede_ready_check',), codes=('expected_video_id',))
        for stage in ('ready', 'before_activation', 'final'):
            if isinstance(identity.get(stage), dict):
                safe['source_identity'][stage] = fields(identity[stage],
                    numbers=('wall_ms', 'media_duration_seconds', 'player_duration_seconds', 'response_length_seconds',
                             'initial_length_seconds', 'source_time_seconds', 'playback_rate', 'ready_state', 'network_state', 'media_error_code'),
                    booleans=('paused', 'ended', 'ad_showing', 'video_ids_match', 'durations_agree', 'verified'),
                    codes=('page_video_id', 'player_video_id', 'response_video_id', 'initial_video_id'))
    lifecycle = report.get('source_lifecycle')
    if isinstance(lifecycle, dict):
        safe['source_lifecycle']['events'] = [fields(row, numbers=('time', 'ready', 'wall_ms', 'duration_seconds', 'network', 'media_error_code'), booleans=('selected', 'paused', 'ended'),
                                                     codes=('type',)) for row in lifecycle.get('events', [])[:80]]
    safe['error_code'] = next((row.get('code') for row in reversed(safe['protocol']) if row.get('type') == 'error'), None)
    opening_error=report.get('error_code');opening_phase=report.get('opening_phase')
    if isinstance(opening_error,str) and opening_error in OPENING_ERRORS:
        safe['error_code'] = opening_error
        if isinstance(opening_phase,str) and opening_phase in OPENING_PHASES:
            safe['opening_phase'] = opening_phase
    if not safe['error_code']:
        safe['error_code'] = safe.get('source_identity_error') or ('source_interrupted' if safe.get('source_interrupted') else None)
    safe['consumption'] = fields(report.get('consumption'), numbers=('pipeline_ready_events_observed', 'muse_live_input_started', 'muse_live_session_acks_observed',
                                 'prefix_mt_attempts_observed', 'live_mt_attempts_observed', 'prefix_tts_requests_observed',
                                 'live_tts_requests_observed', 'live_prosody_stages_started'))
    safe['consumption']['billing_amount'] = None
    prefix = report.get('prefix')
    if isinstance(prefix, dict):
        safe['prefix'] = fields(prefix,
                                numbers=('duration_ms', 'resume_from_ms', 'position_ms', 'pcm_sent_ms', 'elapsed_ms',
                                         'video_seconds_before_activation', 'activation_position_ms', 'capture_anchor_ms',
                                         'used_duration_ms', 'live_asr_start_ms', 'replay_overlap_ms', 'repeated_cue_starts',
                                         'observed_prefix_cues', 'observed_live_cues', 'completed_live_cues', 'required_live_cues',
                                         'completed_live_source_end_ms', 'required_live_source_end_ms',
                                         'songs_skipped', 'prepared_songs'),
                                booleans=('prepared_before_activation', 'diagnostic_partial', 'original_unchanged', 'attached', 'exact_boundary',
                                          'songs_without_dub', 'prepared_speech_played', 'verified'), codes=('error_code',))
        safe['prefix']['turns'] = [fields(row, numbers=('start_ms', 'end_ms'), codes=('content',))
                                   for row in prefix.get('turns', [])[:16]]
        phases=prefix.get('preparation_metrics')
        if isinstance(phases,dict):
            safe['prefix']['preparation_metrics']={key:phases[key] for key in (
                'content_gate_ms','asr_ms','turn_classification_ms','prosody_ms','local_timbre_ms',
                'postprocess_ms','total_ms','capture_receive_ms')
                if finite(phases.get(key)) and 0<=phases[key]<=60000}
        if not safe['error_code']:
            safe['error_code'] = safe['prefix'].get('error_code')
    return safe


class Lab:
    def __init__(self, *, position, target, long_trial=False, extended=False, minimum_source_end=None):
        self.position = position
        self.target = target
        self.long_trial = long_trial or extended
        self.extended = extended
        self.minimum_source_end=trial_minimum_source_end(minimum_source_end,long_trial=self.long_trial,extended=extended)
        self.lock = threading.Lock()
        self.state = 'idle'
        self.started_at = None
        self.finished_at = None
        self.error = None
        self.report = None
        self.token = secrets.token_urlsafe(32)
        self.sample = None

    def status(self):
        with self.lock:
            return {'state': self.state, 'started_at': self.started_at, 'finished_at': self.finished_at,
                    'error': self.error, 'report': self.report, 'target': self.target, 'position': self.position,
                    'prefix_requested': self.position == 0,
                    'continuity_trial': self.long_trial, 'required_live_cues': 4 if self.long_trial else 1,
                    'extended_trial': self.extended,
                    'required_live_source_end_ms': self.minimum_source_end*1000 if self.long_trial else 0,
                    'required_source_end_ms': self.minimum_source_end*1000,
                    'maximum_nonsong_fallback_seconds': 1 if self.long_trial else None,
                    'maximum_allowed_lag_seconds': 8 if self.long_trial else None,
                    'maximum_allowed_lag_growth_seconds': 3 if self.long_trial else None,
                    'observation_limit_seconds': 150 if self.extended else 60 if self.long_trial else 28,
                    'sample_url': '/api/sample.wav' if self.sample else None,
                    'sample_start_ms': self.sample[0] if self.sample else None,
                    'sample_end_ms': self.sample[1] if self.sample else None}

    def start(self, origin):
        with self.lock:
            if self.state != 'idle':
                return False
            self.state = 'running'
            self.started_at = now()
        threading.Thread(target=self._run, args=(origin,), daemon=True, name='inline-translation-lab').start()
        return True

    def _run(self, origin):
        report = None
        error = None
        passed = False
        try:
            result, path, counts = run_trial(position=self.position, target=self.target, prefix=self.position == 0,
                                             long_trial=self.long_trial, extended=self.extended, minimum_source_end=self.minimum_source_end,
                                             allow_paid=True, cue_sink=origin + '/diagnostic-cue',
                                             cue_token=self.token, log=lambda _: None)
            report = sanitize_report(path)
            if report:
                report['relay_sessions_started'] = counts['relay_sessions_started']
                report['prefix_preparations_started'] = counts['prefix_preparations_started']
                report['consumption'].update(counts)
            passed = result == 0 and bool(report and report.get('passed'))
            if not passed:
                error = (ERROR_MESSAGES.get(report.get('error_code'), 'El ensayo terminó por debajo de las condiciones de reproducción verificadas.')
                         if report else 'La prueba no dejó un informe de diagnóstico. Revisa la configuración local de Brivany.')
        except (OSError, ValueError, RuntimeError, TypeError, TimeoutExpired):
            error = 'El ensayo se interrumpió antes de poder recuperar su informe.'
        finally:
            with self.lock:
                self.report = report
                self.error = error
                self.state = 'passed' if passed else 'failed'
                self.finished_at = now()

    def store_sample(self, data):
        if not isinstance(data, dict) or set(data) != {'source_start_ms', 'source_end_ms', 'sample_rate', 'pcm_base64'}:
            return False
        start = data['source_start_ms']
        end = data['source_end_ms']
        if not finite(start) or not finite(end) or start < 0 or end <= start or type(data['sample_rate']) is not int or data['sample_rate'] != SAMPLE_RATE:
            return False
        pcm = base64.b64decode(data['pcm_base64'], validate=True)
        if not 0 < len(pcm) <= MAX_SAMPLE_BYTES or len(pcm) % 2 or not any(pcm):
            return False
        output = BytesIO()
        with wave.open(output, 'wb') as writer:
            writer.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            writer.writeframes(pcm)
        with self.lock:
            if self.state != 'running' or self.sample:
                return False
            self.sample = (start, end, output.getvalue())
        return True


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def _send(self, code, data, mime='application/json; charset=utf-8'):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-src https://www.youtube.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    @property
    def expected_host(self):
        return f'127.0.0.1:{self.server.server_port}'

    def _local(self):
        return self.client_address[0] == '127.0.0.1' and self.headers.get('Host') == self.expected_host

    def _body(self, maximum):
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
            raise ValueError('Unsupported body framing')
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 <= length <= maximum:
            raise ValueError('Body exceeds limit')
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError('Incomplete body')
        return json.loads(raw) if raw else {}

    def do_GET(self):
        if not self._local():
            return self._send(403, {'error': 'Origen local requerido.'})
        if self.path == '/':
            try:
                page = PAGE.read_bytes()
            except OSError:
                return self._send(503, {'error': 'La interfaz de diagnóstico no está disponible.'})
            return self._send(200, page, 'text/html; charset=utf-8')
        if self.path == '/api/status':
            return self._send(200, self.server.lab.status())
        if self.path == '/api/sample.wav':
            sample = self.server.lab.sample
            if sample:
                return self._send(200, sample[2], 'audio/wav')
        self._send(404, {'error': 'Recurso no disponible.'})

    def do_POST(self):
        if not self._local():
            return self._send(403, {'error': 'Origen local requerido.'})
        lab = self.server.lab
        if self.path == '/api/run':
            origin = 'http://' + self.expected_host
            if self.headers.get('Origin') != origin:
                return self._send(403, {'error': 'El ensayo se inicia desde esta página local.'})
            try:
                if self._body(16) != {}:
                    raise ValueError('Unexpected request')
            except (ValueError, OSError):
                return self._send(400, {'error': 'Solicitud de diagnóstico no válida.'})
            return self._send(202 if lab.start(origin) else 409, lab.status())
        if self.path == '/diagnostic-cue':
            authorization = self.headers.get('Authorization', '').encode('utf-8')
            if not hmac.compare_digest(authorization, ('Bearer ' + lab.token).encode('utf-8')):
                return self._send(403, {'error': 'Muestra no autorizada.'})
            try:
                stored = lab.store_sample(self._body(MAX_CUE_REQUEST))
            except (ValueError, TypeError, OSError):
                stored = False
            return self._send(200 if stored else 400, {'stored': stored})
        self._send(404, {'error': 'Recurso no disponible.'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--position', type=int, default=0)
    parser.add_argument('--target', choices=('en', 'es', 'fr'), default='en')
    parser.add_argument('--long', action='store_true', help='Require four completed dubbed cues after the prepared prefix.')
    parser.add_argument('--extended', action='store_true', help='Verify two source minutes with at most 150 seconds of observation.')
    parser.add_argument('--minimum-source-end', type=float, default=None, help='Require completed dubbed source coverage within the current observation budget.')
    args = parser.parse_args()
    if not 0 <= args.position <= 3600 or not 0 <= args.port <= 65535:
        parser.error('Invalid local port or source position')
    if (args.long or args.extended) and args.position != 0:
        parser.error('--long and --extended require preparation from the beginning')
    try:trial_minimum_source_end(args.minimum_source_end,long_trial=args.long,extended=args.extended)
    except ValueError as error:parser.error(str(error))
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        server.lab = Lab(position=args.position, target=args.target, long_trial=args.long, extended=args.extended,
                         minimum_source_end=args.minimum_source_end)
        print(f'http://127.0.0.1:{server.server_port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
