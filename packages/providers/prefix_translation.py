"""Bounded, in-memory transcription of a selected video's initial ten seconds."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from http.client import HTTPException, HTTPSConnection
import io
import json
import math
import re
import socket
import threading
import time
from uuid import uuid4
import wave

from .audio_content import SingingFilter
from .live_voice import VoiceError, muse_handshake
from .robust_voice_timbre import analyze_timbre

# Ten seconds (was seven) so translation and cloning can start ahead.
PREFIX_MS = 10000
PCM_BYTES_PER_MS = 48
PREFIX_BYTES = PREFIX_MS * PCM_BYTES_PER_MS
ASR_TIMEOUT = 10
MAX_RESPONSE_BYTES = 32768
MAX_PREFIX_TURNS = 16
MAX_ADVISORIES = 2
# Prepared opening translations: Spanish and English, so switching between the
# two most used targets never waits for a new translation of the opening.
PREPARED_TARGETS = ('es', 'en')
MAX_PREPARED_TRANSLATIONS = 12
PREPARED_TRANSLATION_WORKERS = 4
SONG_WINDOW_MS = 1000
SONG_STEP_MS = 750
EMOTIONS = frozenset({'neutral', 'calm', 'happy', 'sad', 'angry', 'excited'})


@dataclass(frozen=True, slots=True)
class PrefixProsody:
    emotion: str
    confidence: float
    voice_register: str
    register_confidence: float
    voice_timbre: str = 'uncertain'
    timbre_confidence: float = 0.
    timbre_source: str = 'meta_audio_timbre'

    def as_dict(self, target):
        return {'emotion': self.emotion, 'confidence': self.confidence,
                'source': 'meta_audio_inference', 'available': True,
                'applied': self.confidence >= .7 and target == 'en',
                'voice_register': self.voice_register, 'register_confidence': self.register_confidence,
                'voice_timbre': self.voice_timbre, 'timbre_confidence': self.timbre_confidence,
                'timbre_inference_source':self.timbre_source}


@dataclass(frozen=True, slots=True)
class PrefixTurn:
    turn_id: str
    start_ms: int
    end_ms: int
    speaker: str | None
    text: str = field(repr=False)
    content: str = 'unknown'
    prosody: PrefixProsody | None = None
    # ((target, translated text), ...) prepared before activation; memory only.
    translations: tuple[tuple[str, str], ...] = field(default=(), repr=False)

    def translation(self, target):
        return next((text for language, text in self.translations if language == target), None)


@dataclass(frozen=True, slots=True)
class PreparedPrefix:
    duration_ms: int
    resume_from_ms: int
    turns: tuple[PrefixTurn, ...]
    pcm: bytes = field(repr=False)
    preparation_metrics: tuple[tuple[str, float], ...] = field(default=(), repr=False)


def _check_cancelled(cancelled):
    if cancelled.is_set():
        raise VoiceError('prefix_cancelled', 'Se canceló la preparación del video.')


def _transcribe(pcm, *, cancelled, connection_factory=HTTPSConnection):
    """One verified TLS request, with no retry or raw provider errors."""
    _check_cancelled(cancelled)
    # Acoustic grouping supplies speaker identity after recognition. The
    # endpointing mode closes speech turns without waiting for ASR diarization.
    # The opening batch must keep speaker boundaries. Endpointing merged
    # multiple voices into one turn in the real 078 trial.
    settings = muse_handshake({'type': 'start', 'consent': True, 'mode': 'meeting', 'meetingConsent': True, 'language': 'es-ES'})
    authorization = settings.pop('authorization')['accessToken']
    settings.update(audioEncoding='WAV', languageBias=['Spanish', 'English', 'French'])
    settings.pop('partialMode')
    settings.pop('emitAudioProgress')
    boundary = 'brivany-' + uuid4().hex
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(24000)
        writer.writeframes(pcm)
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\n'
            f'Content-Type: application/json\r\n\r\n{json.dumps(settings)}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="prefix.wav"\r\n'
            'Content-Type: audio/wav\r\n\r\n').encode('utf-8') + buffer.getvalue() + f'\r\n--{boundary}--\r\n'.encode('ascii')
    connection = connection_factory('api.meta.ai', 443, timeout=ASR_TIMEOUT)
    finished = threading.Event()
    deadline = time.monotonic() + ASR_TIMEOUT
    active_socket = None
    response = None

    def check():
        _check_cancelled(cancelled)
        if time.monotonic() >= deadline:
            raise VoiceError('prefix_asr_timeout', 'Muse tardó demasiado en preparar el inicio del video.')

    def interrupt():
        while not finished.wait(.025):
            if cancelled.is_set() or time.monotonic() >= deadline:
                candidate = active_socket or getattr(connection, 'sock', None)
                if candidate is not None:
                    try:
                        candidate.shutdown(socket.SHUT_RDWR)
                    except (OSError, AttributeError):
                        pass
                    try:
                        candidate.close()
                    except (OSError, AttributeError):
                        pass
                return

    monitor = threading.Thread(target=interrupt, daemon=True, name='brivany-prefix-asr-deadline')
    monitor.start()
    try:
        connection.request('POST', '/v1/asr/transcribe', body=body, headers={
            'Authorization': authorization, 'Accept': 'application/json',
            'Content-Type': 'multipart/form-data; boundary=' + boundary})
        active_socket = getattr(connection, 'sock', None)
        check()
        response = connection.getresponse()
        if response.status == 429:
            raise VoiceError('prefix_asr_limit', 'Muse alcanzó su límite para preparar el video.')
        if response.status != 200:
            raise VoiceError('prefix_asr_rejected', 'Muse no aceptó la transcripción previa del video.')
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        check()
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError('Oversized prefix response')
        return json.loads(raw)
    except TimeoutError:
        check()
        raise VoiceError('prefix_asr_timeout', 'Muse tardó demasiado en preparar el inicio del video.') from None
    except (OSError, HTTPException):
        check()
        raise VoiceError('prefix_asr_unavailable', 'Se interrumpió la conexión con Muse al preparar el video.') from None
    except (ValueError, UnicodeError):
        raise VoiceError('prefix_asr_response', 'Muse devolvió una transcripción previa no válida.') from None
    finally:
        finished.set()
        monitor.join(.1)
        for resource in (response, connection):
            if resource is not None:
                try:
                    resource.close()
                except (OSError, HTTPException):
                    pass


def _parse_turns(value):
    duration = value.get('audioDurationMs') if isinstance(value, dict) else None
    rows = value.get('turns') if isinstance(value, dict) else None
    if (type(duration) is not int or abs(duration - PREFIX_MS) > 80 or
            not isinstance(rows, list) or len(rows) > MAX_PREFIX_TURNS):
        raise VoiceError('prefix_asr_response', 'Muse no confirmó los límites del inicio del video.')
    turns = []
    seen = set()
    resume = min(PREFIX_MS, duration)
    for row in rows:
        if not isinstance(row, dict):
            raise VoiceError('prefix_asr_response', 'Muse devolvió un turno de video no válido.')
        identifier, start, end = (row.get(key) for key in ('turnId', 'startMs', 'endMs'))
        text, speaker = row.get('transcript'), row.get('speaker')
        if (type(identifier) is not int or not -2147483648 <= identifier <= 2147483647 or identifier in seen or
                type(start) is not int or type(end) is not int or not 0 <= start <= duration or not 0 <= end <= duration or
                not isinstance(text, str) or len(text) > 800):
            raise VoiceError('prefix_asr_response', 'Muse devolvió un turno de video no válido.')
        seen.add(identifier)
        text = ' '.join(text.split())
        if not text or end <= start or end > PREFIX_MS:
            # The buffered API reports an unfinished turn with no text.
            # Resume live ASR at its start, preserving the unconfirmed tail.
            resume = min(resume, start)
            continue
        if not isinstance(speaker, str) or not re.fullmatch(r'[A-Z]', speaker):
            speaker = None
        turns.append(PrefixTurn(str(identifier), start, end, speaker, text))
    # If a finalized turn straddles the proposed boundary, resume from its
    # start as well. Neither a fragment nor its audio will be consumed twice.
    turns.sort(key=lambda turn: (turn.start_ms, turn.end_ms))
    for turn in reversed(turns):
        if turn.start_ms < resume < turn.end_ms:
            resume = turn.start_ms
    return tuple(turn for turn in turns if turn.end_ms <= resume), resume


def _advisory(factory, sample, cancelled):
    analyzer = None
    try:
        if cancelled.is_set():
            return None
        analyzer = factory()
        value = analyzer.analyze(sample, cancelled=cancelled)
        if not isinstance(value, dict) or value.get('available', True) is not True:
            return None
        emotion, confidence = value.get('emotion'), value.get('confidence')
        register, register_confidence = value.get('voice_register', 'uncertain'), value.get('register_confidence', 0.)
        timbre, timbre_confidence = value.get('voice_timbre', 'uncertain'), value.get('timbre_confidence', 0.)
        if (emotion not in EMOTIONS or register not in ('low', 'high', 'uncertain') or
                timbre not in ('masculine', 'feminine', 'uncertain') or
                any(type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= 1
                    for number in (confidence, register_confidence, timbre_confidence))):
            return None
        return PrefixProsody(emotion, float(confidence), register, float(register_confidence),timbre,float(timbre_confidence))
    except Exception:
        return None  # Optional analysis cannot invalidate a confirmed transcription.
    finally:
        if analyzer is not None:
            try:
                analyzer.close()
            except Exception:
                pass


def _confident_song(decision):
    """Require strong non-speech evidence before skipping transcription."""
    if decision.get('skip') is not True or not 0 <= decision.get('speech_score', 1) < .12:
        return None
    kind = decision.get('kind')
    if kind == 'music' and decision.get('music_score', 0) >= .75:
        return kind
    if kind == 'singing' and decision.get('singing_score', 0) >= .55:
        return kind
    return None


def _opening_song(raw, content_filter, cancelled):
    if _confident_song(content_filter.classify(raw)) is None:
        return None
    # The whole-clip classifier samples at most four windows. Verify the
    # spaces between them too, so a brief spoken passage can veto the skip.
    kinds = set()
    for start in range(0, PREFIX_MS - SONG_WINDOW_MS + 1, SONG_STEP_MS):
        _check_cancelled(cancelled)
        window = raw[start * PCM_BYTES_PER_MS:(start + SONG_WINDOW_MS) * PCM_BYTES_PER_MS]
        kind = _confident_song(content_filter.classify(window))
        if kind is None:
            return None
        kinds.add(kind)
    return 'singing' if 'singing' in kinds else 'music'


def translate_prepared(turns, *, cancelled, translator_factory, targets=PREPARED_TARGETS):
    """Translate confirmed speech turns into every prepared target, in parallel.

    Optional: any failure leaves that turn untranslated and the live path
    translates it normally. Returns (turns, metrics).
    """
    jobs = [(index, target) for index, turn in enumerate(turns) if turn.content == 'speech' and turn.text
            for target in targets][:MAX_PREPARED_TRANSLATIONS]
    if not jobs or translator_factory is None:
        return turns, {}
    started = time.monotonic()
    def run(job):
        index, target = job
        if cancelled.is_set():
            return job, None
        translator = None
        try:
            translator = translator_factory()
            turn = turns[index]
            duration = max(1, min(30000, turn.end_ms - turn.start_ms))
            stream = getattr(translator, 'stream_for_duration', None)
            deltas = stream(turn.text, target, [], duration_ms=duration) if callable(stream) else translator.stream(turn.text, target, [])
            text = ' '.join(''.join(deltas).split())
            return job, text[:800] if text and not cancelled.is_set() else None
        except Exception:
            return job, None
        finally:
            if translator is not None:
                try:
                    translator.close()
                except Exception:
                    pass
    results = {}
    with ThreadPoolExecutor(max_workers=PREPARED_TRANSLATION_WORKERS, thread_name_prefix='brivany-prefix-mt') as pool:
        for (index, target), text in pool.map(run, jobs):
            if text:
                results.setdefault(index, []).append((target, text))
    _check_cancelled(cancelled)
    updated = list(turns)
    for index, rows in results.items():
        updated[index] = replace(updated[index], translations=tuple(rows))
    return tuple(updated), {'translation_ms': round(max(0., (time.monotonic() - started) * 1000), 3),
                            'translations_prepared': sum(len(rows) for rows in results.values())}


def prepare_prefix(raw, *, cancelled, prosody_factory=None, content_filter_factory=None, transcriber=None, translator_factory=None):
    """Prepare exactly PREFIX_MS (ten seconds); keep provider data and PCM in memory."""
    started = time.monotonic()
    metrics = {}
    def elapsed(since):
        return round(max(0., (time.monotonic() - since) * 1000), 3)
    def measured():
        metrics['total_ms'] = elapsed(started)
        return tuple(metrics.items())
    _check_cancelled(cancelled)
    if not isinstance(raw, bytes) or len(raw) != PREFIX_BYTES:
        raise VoiceError('prefix_pcm', 'La preparación necesita siete segundos de audio PCM a 24 kHz.')
    gate_started = time.monotonic()
    try:
        content_filter = (content_filter_factory or SingingFilter)()
    except (ImportError, OSError, RuntimeError, ValueError):
        raise VoiceError('prefix_content_filter', 'No se pudo preparar el filtro de canciones.') from None
    song = _opening_song(raw, content_filter, cancelled)
    metrics['content_gate_ms'] = elapsed(gate_started)
    _check_cancelled(cancelled)
    if song:
        interval = PrefixTurn('opening-content', 0, PREFIX_MS, None, '', content=song)
        return PreparedPrefix(PREFIX_MS, PREFIX_MS, (interval,), raw, measured())
    asr_started = time.monotonic()
    value = (transcriber or _transcribe)(raw, cancelled=cancelled)
    metrics['asr_ms'] = elapsed(asr_started)
    _check_cancelled(cancelled)
    postprocess_started = time.monotonic()
    classification_started = time.monotonic()
    turns, resume = _parse_turns(value)
    classified = []
    samples = []
    for turn in turns:
        _check_cancelled(cancelled)
        sample = raw[turn.start_ms * PCM_BYTES_PER_MS:turn.end_ms * PCM_BYTES_PER_MS]
        decision = content_filter.classify(sample)
        kind = decision.get('kind')
        content = kind if (kind == 'speech' or kind in ('singing', 'music') and decision.get('skip') is True) else 'unknown'
        classified.append(replace(turn, content=content))
        samples.append(sample)
    metrics['turn_classification_ms'] = elapsed(classification_started)

    candidates = [index for index, turn in enumerate(classified)
                  if turn.content not in ('singing', 'music') and len(samples[index]) >= 9600][:MAX_ADVISORIES]
    speech_indices = [index for index, turn in enumerate(classified) if turn.content == 'speech']
    def local_timbres():
        local_started = time.monotonic()
        results = []
        for index in speech_indices:
            _check_cancelled(cancelled)
            result = analyze_timbre(samples[index])
            _check_cancelled(cancelled)
            results.append((index, result))
        return results, elapsed(local_started)

    # One local worker keeps the model's CPU work serial while two independent
    # remote advisory requests progress. The results merge only after both sets
    # finish, retaining the existing confidence/abstention policy.
    local_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='brivany-prefix-timbre') if speech_indices else None
    local_job = local_pool.submit(local_timbres) if local_pool else None
    try:
        if prosody_factory and candidates:
            prosody_started = time.monotonic()
            with ThreadPoolExecutor(max_workers=MAX_ADVISORIES, thread_name_prefix='brivany-prefix-prosody') as pool:
                jobs = {index: pool.submit(_advisory, prosody_factory, samples[index], cancelled) for index in candidates}
                for index, job in jobs.items():
                    classified[index] = replace(classified[index], prosody=job.result())
            metrics['prosody_ms'] = elapsed(prosody_started)
        if local_job:
            local_results, local_elapsed = local_job.result()
            metrics['local_timbre_ms'] = local_elapsed
        else:
            local_results = []
    finally:
        if local_pool:
            local_pool.shutdown(wait=True, cancel_futures=True)
    for index, timbre in local_results:
        _check_cancelled(cancelled)
        turn = classified[index]
        prior=turn.prosody or PrefixProsody('neutral',0.,'uncertain',0.)
        prior_confident=prior.voice_timbre in ('masculine','feminine') and prior.timbre_confidence>=.8
        if timbre['available'] or not prior_confident:
            classified[index]=replace(turn,prosody=replace(prior,voice_timbre=timbre['voice_timbre'],
                timbre_confidence=timbre['timbre_confidence'],timbre_source=timbre.get('timbre_inference_source','local_robust_voice_timbre')))
    _check_cancelled(cancelled)
    metrics['postprocess_ms'] = elapsed(postprocess_started)
    prepared_turns = tuple(classified)
    if translator_factory is not None:
        prepared_turns, translation_metrics = translate_prepared(prepared_turns, cancelled=cancelled, translator_factory=translator_factory)
        if 'translation_ms' in translation_metrics:
            metrics['translation_ms'] = translation_metrics['translation_ms']
    return PreparedPrefix(PREFIX_MS, resume, prepared_turns, raw, measured())
