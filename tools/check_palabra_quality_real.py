"""Bounded, explicit Palabra evaluation with fixed offline synthetic speech.

--prepare uses Windows SAPI, not a provider. --allow-paid --case NAME opens
exactly one real session, without retries. Translated synthetic WAVs stay in
tmp and must never be attached to the development ledger. Summary reports have
no transcripts, keys, original user audio or claims of human intelligibility.
"""
from __future__ import annotations

import argparse
import array
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from urllib.parse import urlsplit
from urllib.request import urlopen
import wave

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'tmp/palabra-quality-real'
RATE = 24000
MAX_SECONDS = 20
PHRASES = {
    'en': ('Microsoft Zira Desktop', 'The meeting starts at three, not at five. Please do not open the door. If it rains, we will stay inside.'),
    'es': ('Microsoft Helena Desktop', 'La reunión empieza a las tres, no a las cinco. Por favor, no abras la puerta. Si llueve, nos quedaremos dentro.'),
}
CASES = {'en-es': ('en', 'es'), 'en-fr': ('en', 'fr'), 'es-en': ('es', 'en')}


def utc():
    return datetime.now(timezone.utc).isoformat()


def write_wave(path, pcm):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(RATE)
        output.writeframes(pcm)


def read_wave(path):
    with wave.open(str(path), 'rb') as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (1, 2, RATE, 'NONE'):
            raise ValueError('The fixture must be PCM16 mono 24 kHz.')
        count = source.getnframes()
        if not 0 < count <= RATE * MAX_SECONDS:
            raise ValueError('The fixed fixture exceeds the 20 second input budget.')
        return source.readframes(count)


def prepare():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    executable = shutil.which('ffmpeg')
    if not executable:
        raise ValueError('Local FFmpeg is needed to normalize offline fixtures.')
    fixtures = {}
    for language, (voice, phrase) in PHRASES.items():
        native, normalized = DIRECTORY / f'{language}-sapi.wav', DIRECTORY / f'{language}-24k.wav'
        script = DIRECTORY / f'prepare-{language}.ps1'
        script.write_text("""param([string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$fixtureSynth=[System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $fixtureSynth.SelectVoice('%s')
  $fixtureSynth.Rate=0
  $fixtureSynth.Volume=100
  $fixtureSynth.SetOutputToWaveFile($Destination)
  $fixtureSynth.Speak('%s')
  $fixtureSynth.SetOutputToNull()
} finally { $fixtureSynth.Dispose() }
""" % (voice, phrase.replace("'", "''")), encoding='utf-8-sig')
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        for command in (["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), str(native)],
                        [executable, '-hide_banner', '-loglevel', 'error', '-i', str(native), '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s16le', '-y', str(normalized)]):
            result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=30, creationflags=flags)
            if result.returncode:
                raise ValueError('The fixed offline fixture could not be generated; no provider was contacted.')
        pcm = read_wave(normalized)
        fixtures[language] = {'path': normalized.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(normalized.read_bytes()).hexdigest(),
                              'pcm_sha256': hashlib.sha256(pcm).hexdigest(), 'seconds': len(pcm) / 48000,
                              'phrase_sha256': hashlib.sha256(phrase.encode()).hexdigest(), 'voice': voice, 'synthetic': True}
    manifest = {'prepared_at': utc(), 'status': 'prepared_offline', 'external_calls': 0, 'fixtures': fixtures,
                'case_directions': CASES, 'french_input_voice_available': False}
    (DIRECTORY / 'fixtures.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


def load_fixture(language):
    manifest = json.loads((DIRECTORY / 'fixtures.json').read_text(encoding='utf-8'))
    item = manifest['fixtures'][language]
    path = (ROOT / item['path']).resolve()
    expected_path = (DIRECTORY / f'{language}-24k.wav').resolve()
    if path != expected_path or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError('The approved offline fixture changed.')
    if item['phrase_sha256'] != hashlib.sha256(PHRASES[language][1].encode()).hexdigest():
        raise ValueError('The fixture does not match this version of the known phrase.')
    pcm = read_wave(path)
    if hashlib.sha256(pcm).hexdigest() != item['pcm_sha256']:
        raise ValueError('The fixed PCM changed.')
    return pcm, item


def concept_screen(text, language):
    """A transparent lexical screen; passing is not semantic/human validation."""
    normalized = ''.join(char for char in unicodedata.normalize('NFKD', text.lower()) if not unicodedata.combining(char))
    patterns = {
        'en': {'time_three': r'\b(three|3)\b', 'not_five': r'\bnot\s+(?:at\s+)?(?:five|5)\b',
               'door_negation': r"(?:do not|don't|not to|never)\s+open\s+(?:the\s+)?door", 'conditional_rain': r'\bif\b.{0,100}\brain',
               'stay_inside': r'\b(?:stay|remain)\b.{0,30}\b(?:inside|indoors)\b'},
        'es': {'time_three': r'\b(tres|3)\b', 'not_five': r'\bno\b.{0,20}\b(cinco|5)\b',
               'door_negation': r'\bno\b.{0,15}\b(?:abras|abra|abran|abrir|abrais)\b.{0,20}\bpuerta\b',
               'conditional_rain': r'\bsi\b.{0,50}\b(?:llueve|lloviera|lluvia)\b',
               'stay_inside': r'\b(?:quedaremos|quedamos|quedaremos|permaneceremos|permanecemos)\b.{0,30}\b(?:dentro|casa|interior)\b'},
        'fr': {'time_three': r'\b(trois|3)\b', 'not_five': r'\b(?:pas|non)\b.{0,20}\b(cinq|5)\b',
               'door_negation': r"(?:n['’ ]|ne\s).{0,12}ouvr.{0,12}pas.{0,20}\bporte\b",
               'conditional_rain': r"\b(?:si|s['’]il)\b.{0,40}\b(?:pleut|pleuvait)\b",
               'stay_inside': r'\b(?:resterons|restons|demeurerons|rester)\b.{0,35}\b(?:interieur|maison|dedans)\b'},
    }
    checks = {name: bool(re.search(pattern, normalized)) for name, pattern in patterns[language].items()}
    return {'method': 'fixed_concepts_lexical_screen_not_semantic_proof', 'checks': checks,
            'all_concepts_observed': all(checks.values()), 'translation_quality_verified': False}


def pcm_summary(pcm):
    samples = array.array('h'); samples.frombytes(pcm)
    if sys.byteorder != 'little': samples.byteswap()
    if not samples: return {'samples': 0, 'duration_seconds': 0, 'has_signal': False}
    clipped = sum(abs(value) >= 32760 for value in samples)
    windows = []
    for start in range(0, len(samples), RATE // 50):
        window = samples[start:start + RATE // 50]
        windows.append(math.sqrt(sum((value / 32768) ** 2 for value in window) / len(window)))
    run = longest = 0
    for rms in windows:
        run = run + 20 if rms < .003 else 0; longest = max(longest, run)
    return {'samples': len(samples), 'duration_seconds': round(len(samples) / RATE, 4), 'has_signal': any(samples),
            'peak': round(max(abs(value) for value in samples) / 32768, 6),
            'rms': round(math.sqrt(sum((value / 32768) ** 2 for value in samples) / len(samples)), 6),
            'clipped_fraction': round(clipped / len(samples), 8), 'longest_low_energy_run_ms': longest,
            'low_energy_runs_are_not_proof_of_stutter': True}


def collect_caption(captions, event):
    """Append confirmed parts unless the relay explicitly declares replacement."""
    key = (event.get('turn_id'), event.get('segment_id'))
    if event.get('operation') == 'replace':
        captions[key] = event['text']
    else:
        captions[key] = (captions.get(key, '') + event['text'])[-12000:]


def run_case(name, *, play_native=False, source_auto=False):
    source, target = CASES[name]
    pcm, fixture = load_fixture(source)
    with urlopen('http://127.0.0.1:8765/api/dubbing/status?provider=palabra', timeout=5) as response:
        status = json.load(response)
    endpoint = urlsplit(status.get('websocket_url', ''))
    if not status.get('configured') or not status.get('available') or endpoint.scheme != 'ws' or endpoint.hostname not in {'127.0.0.1', 'localhost'} or endpoint.path != '/dub' or endpoint.username:
        raise ValueError('A configured local Palabra relay is required.')
    report = {'format': 'brivany-palabra-quality-real-1', 'started_at': utc(), 'case': name, 'source_language': 'auto' if source_auto else source, 'fixture_language': source, 'target_language': target,
              'purpose': 'Evaluate fixed negation, numbers and conditional concepts plus decoded translated signal and real-time relay delivery.',
              'source_synthetic': True, 'source_sha256': fixture['sha256'], 'input_seconds': len(pcm) / 48000,
              'maximum_provider_sessions': 1, 'automatic_retries': 0, 'provider_session_attempts': 0,
              'estimated_input_cost_usd': round(len(pcm) / 48000 / 60 * .04, 6), 'actual_billed_usd': None,
              'estimate_basis': 'Prior 0.04 USD/min reference; not an invoice or a hard spending cap.',
              'transcripts_persisted': False, 'translated_synthetic_audio_saved_locally': True, 'source_user_media_used': False,
              'physical_speaker_capture': False, 'human_listening_verified': False, 'translation_quality_verified': False,
              'full_youtube_capture_verified': False, 'audible_latency_verified': False, 'native_monitoring_requested': play_native, 'status': 'failed'}
    socket = native = None
    translated = bytearray(); captions = {}; arrivals = []; failures = []; sender = None
    try:
        if play_native:
            from packages.providers.native_audio import open_native_audio
            native = open_native_audio(); native.set_levels(original=0, translation=.85)
        socket = connect(status['websocket_url'], origin='http://127.0.0.1:8765', open_timeout=5, close_timeout=2, max_size=1048576, compression=None, proxy=None)
        report['provider_session_attempts'] = 1
        socket.send(json.dumps({'type': 'start', 'consent': True, 'source_language': 'auto' if source_auto else source, 'target_language': target,
                                'max_seconds': min(MAX_SECONDS, max(5, math.ceil(len(pcm) / 48000))), 'quality_mode': 'contextual_live', 'audio_output': 'browser'}))
        ready = json.loads(socket.recv(timeout=20))
        if ready.get('type') != 'ready':
            report['provider_error_code'] = ready.get('code'); raise ValueError('The real provider session was not acknowledged.')
        report['provider_profile_verified'] = ready.get('quality_mode_effective') == 'contextual_live'
        started = time.monotonic()
        def send_source():
            try:
                for offset in range(0, len(pcm), 1920):
                    time.sleep(max(0, started + offset / 48000 - time.monotonic())); socket.send(pcm[offset:offset + 1920])
                time.sleep(max(0, started + len(pcm) / 48000 - time.monotonic())); socket.send(json.dumps({'type': 'finish'}))
            except Exception as error: failures.append(type(error).__name__)
        sender = threading.Thread(target=send_source, daemon=True); sender.start(); deadline = started + MAX_SECONDS + 20
        while time.monotonic() < deadline:
            event = json.loads(socket.recv(timeout=max(.1, deadline - time.monotonic())))
            if event.get('type') == 'error': report['provider_error_code'] = event.get('code'); raise ValueError('Real provider or relay returned an error.')
            if event.get('type') == 'audio':
                chunk = base64.b64decode(event['audio'], validate=True)
                if len(chunk) % 2 or len(translated) + len(chunk) > 48000 * 40: raise ValueError('The bounded translated PCM output is invalid.')
                now = time.monotonic() - started; arrivals.append((now, len(chunk) / 48000))
                translated.extend(chunk)
                if native: native.push_translation(chunk)
            elif event.get('type') == 'transcript' and event.get('source') == 'translation' and isinstance(event.get('text'), str):
                collect_caption(captions, event)
            elif event.get('type') == 'metrics':
                report['first_output_audio_ms'] = event.get('first_output_audio_ms')
            elif event.get('type') == 'done': report['provider_done'] = True; break
        if sender: sender.join(2)
        if native: report['native_drain_completed'] = native.finish(timeout=5)
        if failures or not report.get('provider_done') or not translated: raise ValueError('The bounded real session did not finish with translated audio.')
        report['status'] = 'completed_real_provider_signal_and_concept_screen_pending_human_listening'
    except Exception as error:
        report['failure_type'] = type(error).__name__
    finally:
        if socket: socket.close()
        if sender: sender.join(2)
        if native:
            try: native.close()
            except Exception: report['native_close_failed'] = True
        report['pcm'] = pcm_summary(bytes(translated))
        report['concept_screen'] = concept_screen(' '.join(captions.values()), target)
        report['translated_chunks'] = len(arrivals)
        if arrivals:
            report['first_received_pcm_ms'] = round(arrivals[0][0] * 1000, 2)
            report['maximum_interchunk_receive_gap_ms'] = round(max((b[0] - a[0] for a, b in zip(arrivals, arrivals[1:])), default=0) * 1000, 2)
            report['receive_timing_is_not_physical_playback_timing'] = True
        directory = DIRECTORY / (name + ('-auto' if source_auto else '') + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S'))
        directory.mkdir(parents=True, exist_ok=True)
        if translated:
            output = directory / 'translated-synthetic.wav'; write_wave(output, bytes(translated))
            report['translated_audio_path'] = output.relative_to(ROOT).as_posix()
        report['finished_at'] = utc(); (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true'); parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--case', choices=CASES); parser.add_argument('--play-native', action='store_true'); parser.add_argument('--source-auto', action='store_true')
    args = parser.parse_args()
    if args.prepare:
        if args.allow_paid or args.case or args.play_native or args.source_auto: parser.error('Preparation must be separate from provider execution.')
        print(json.dumps(prepare(), ensure_ascii=False, indent=2)); return 0
    if not args.allow_paid or not args.case: parser.error('Use --prepare offline, or explicitly --allow-paid --case NAME for one real session.')
    result = run_case(args.case, play_native=args.play_native, source_auto=args.source_auto)
    return 0 if result['status'].startswith('completed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
