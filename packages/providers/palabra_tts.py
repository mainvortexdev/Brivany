"""Incremental text -> Palabra Realtime TTS -> raw PCM16 LE mono at 24 kHz.

Wire reference: https://docs.palabra.ai/docs/streaming_api/realtime_tts
Checked 2026-10-30. This dedicated TTS endpoint does no ASR or translation.
One sentence is active at a time; a session reuses its voice and speech context.
No retry, fallback, media persistence, or provider latency guarantee is implied.
"""
from __future__ import annotations

import base64
import binascii
from collections import deque
import json
import logging
import socket
import threading
import time
from uuid import uuid4

from websockets.sync.client import connect

from packages.providers.live_voice import VoiceError
from packages.providers.palabra import palabra_key

URL = "wss://stream.palabra.ai/tts-api/v1/text-to-speech/stream"
MODEL = "auto"
LANGUAGES = frozenset({"en", "es", "fr"})
SAMPLE_RATE = 24000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_TEXT_CHARS = 24000
MAX_MESSAGE_CHARS = 1024
MAX_WIRE_BYTES = 1024 * 1024
MAX_AUDIO_CHUNK_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 60 * BYTES_PER_SECOND
MAX_GENERATION_SECONDS = 60
RECEIVE_TIMEOUT_SECONDS = 20
SAFE_ERROR_CODES = frozenset({"SERVICE_UNAVAILABLE", "SERVER_ERROR", "UNKNOWN_ERROR",
    "BAD_REQUEST", "BAD_PARAM", "VALIDATION_ERROR", "CONFLICT", "SESSION_NOT_FOUND",
    "VOICE_NOT_FOUND", "UNAUTHORIZED", "QUOTA_EXCEEDED", "RATE_LIMIT_EXCEEDED"})

# websocket debug logs can contain authentication headers and source text.
_WIRE_LOGGER = logging.Logger(__name__ + ".wire", level=logging.CRITICAL + 1)
_WIRE_LOGGER.addHandler(logging.NullHandler())


def tts_status():
    return {"provider": "Palabra", "model": MODEL, "configured": bool(palabra_key()),
        "languages": sorted(LANGUAGES), "text_streaming": True, "audio_streaming": True,
        "sample_rate": SAMPLE_RATE, "channels": 1, "format": "pcm16",
        "max_message_characters": MAX_MESSAGE_CHARS, "max_text_characters": MAX_TEXT_CHARS,
        "max_output_seconds": 60, "access_verified": False, "inference_verified": False,
        "inference_ms": None, "cancellation": "connection_abort",
        "voice_cloning": False, "prosody_from_source_audio": False}


def _error(code="palabra_tts_connection", message="La conexión de voz Palabra se interrumpió. No se reintentó."):
    return VoiceError(code, message)


def _event(raw):
    if not isinstance(raw, str) or len(raw) > MAX_WIRE_BYTES:
        raise _error("palabra_tts_protocol", "Palabra no devolvió un evento de voz válido.")
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise _error("palabra_tts_protocol", "Palabra no devolvió un evento de voz válido.") from None
    if not isinstance(value, dict) or not isinstance(value.get("data", {}), dict):
        raise _error("palabra_tts_protocol", "Palabra no devolvió un evento de voz válido.")
    if value.get("message_type") == "error":
        provider_code = value.get("data", {}).get("code")
        error = _error("palabra_tts_rejected", "Palabra rechazó la síntesis. Revisa acceso, saldo, voz y configuración.")
        error.provider_code = provider_code if isinstance(provider_code, str) and provider_code in SAFE_ERROR_CODES else None
        raise error
    return value


def _abort(connection):
    """Bypass the close handshake and send/receive locks, including on Windows."""
    transport = getattr(connection, "socket", None)
    if transport is not None:
        try:
            transport.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            transport.close()
        except OSError:
            pass


class PalabraTTSSession:
    """Lazy, reusable TTS transport for one fixed EN/ES/FR target language.

    ``session(text_or_fragments)`` returns a readable PCM stream. For full duplex
    incremental input, use ``start_sentence()`` and ``stream.send_text(...)``
    from the LLM writer while another thread reads the stream. Mark the final
    fragment ``is_eos=True`` or finish with ``send_text('', is_eos=True)``.
    Closing a partial stream aborts its
    connection; the next sentence opens a fresh one with clean speech context.
    ``close()`` is terminal and never waits for connect, send, recv, or a join.
    """
    def __init__(self, language="es", *, _connect=None):
        if not isinstance(language, str) or language not in LANGUAGES:
            raise _error("palabra_tts_language", "La voz Palabra admite español, inglés o francés en esta ruta.")
        self.language = language
        self._connect = _connect or connect
        self._state_lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._connection = None
        self._active = None
        self._closed = False
        self._text_times = deque()

    def close(self):
        with self._state_lock:
            self._closed = True
            connection, stream = self._connection, self._active
            self._connection = self._active = None
        if stream is not None:
            stream._cancelled.set()
            stream._pending = b""
        _abort(connection)

    def _disconnect(self, stream):
        with self._state_lock:
            if self._active is not stream:
                return
            connection = self._connection
            self._connection = self._active = None
        _abort(connection)

    def _release(self, stream):
        with self._state_lock:
            if self._active is stream:
                self._active = None

    def start_sentence(self):
        with self._state_lock:
            if self._closed:
                raise _error("palabra_tts_closed", "La sesión de voz Palabra está cerrada.")
            if self._active is not None:
                raise _error("palabra_tts_busy", "Termina o cancela la frase de voz anterior.")
            stream = PalabraTTSStream(self)
            self._active = stream
            connection = self._connection
        try:
            if connection is None:
                key = palabra_key()
                if not key:
                    raise _error("palabra_tts_not_configured", "Configura la clave API de Palabra para generar voz.")
                connection = self._connect(URL, additional_headers={"Authorization": "Bearer " + key},
                    open_timeout=8, close_timeout=0, max_size=MAX_WIRE_BYTES, max_queue=8,
                    compression=None, proxy=None, logger=_WIRE_LOGGER)
                with self._state_lock:
                    aborted = self._closed or stream._cancelled.is_set()
                    if not aborted:
                        self._connection = connection
                if aborted:
                    _abort(connection)
                    raise _error("palabra_tts_closed", "La sesión de voz Palabra está cerrada.")
                connection.send(json.dumps({"type": "init", "language": self.language, "model": MODEL,
                    "voice_options": {"voice_id": "default_low", "speed": 1.0, "deaccent_strength": 0.0},
                    "output": {"format": "pcm", "sample_rate": SAMPLE_RATE}}))
                reply = _event(connection.recv(timeout=8))
                if reply.get("message_type") != "init_response":
                    raise _error("palabra_tts_protocol", "Palabra no confirmó los ajustes de voz.")
                # The acknowledgement schema isn't guaranteed; reject explicit
                # contradictions without inventing missing observed metadata.
                output = reply.get("data", {}).get("output", {})
                if not isinstance(output, dict) or any(name in output and output[name] != expected
                    for name, expected in (("format", "pcm"), ("sample_rate", SAMPLE_RATE), ("channels", 1))):
                    raise _error("palabra_tts_format", "Palabra indicó un formato de audio distinto al solicitado.")
            stream._check()
            return stream
        except VoiceError:
            stream.close()
            raise
        except Exception:
            stream.close()
            raise _error() from None

    def __call__(self, text, language=None):
        if language is not None and language != self.language:
            raise _error("palabra_tts_language", "Inicia otra sesión para cambiar el idioma de voz.")
        if isinstance(text, str):
            if not text.strip() or len(text) > MAX_TEXT_CHARS:
                raise _error("palabra_tts_text", "Envía una frase no vacía dentro del límite de texto.")
        else:
            try:
                text = iter(text)
            except TypeError:
                raise _error("palabra_tts_text", "La voz requiere texto o fragmentos de texto.") from None
        stream = self.start_sentence()

        def feed():
            try:
                if isinstance(text, str):
                    stream.send_text(text, is_eos=True)
                else:
                    for fragment in text:
                        stream._check()
                        stream.send_text(fragment)
                    stream.send_text("", is_eos=True)
            except Exception as exc:
                if not stream._cancelled.is_set():
                    stream._error = exc if isinstance(exc, VoiceError) else _error("palabra_tts_text", "El flujo de texto para voz se interrumpió.")
                    self._disconnect(stream)

        threading.Thread(target=feed, name="palabra-tts-text", daemon=True).start()
        return stream

    synthesize = __call__

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class PalabraTTSStream:
    """Bounded PCM reader and incremental text writer for a single sentence."""
    def __init__(self, session):
        self._session = session
        self.generation_id = uuid4().hex
        self._cancelled = threading.Event()
        self._pending = b""
        self._error = None
        self._last = self._eos = False
        self._text_pending = ""
        self._text_chars = self._audio_bytes = 0
        self._started = time.monotonic()
        self._own_session = False
        self.headers = {"Content-Type": "audio/pcm; rate=24000; channels=1; format=s16le"}

    def _check(self):
        if self._error is not None:
            raise self._error
        if self._cancelled.is_set():
            raise _error("palabra_tts_closed", "La frase de voz Palabra está cerrada.")

    def send_text(self, text, *, is_eos=False):
        if (not isinstance(text, str) or len(text) > MAX_TEXT_CHARS or
                type(is_eos) is not bool):
            raise _error("palabra_tts_text", "Envía fragmentos de texto dentro del límite de voz.")
        with self._session._send_lock:
            self._check()
            if self._eos or self._text_chars + len(text) > MAX_TEXT_CHARS:
                raise _error("palabra_tts_text", "La frase de voz terminó o excedió su límite de texto.")
            combined = self._text_pending + text
            if is_eos and not combined:
                raise _error("palabra_tts_text", "La voz no recibió texto para sintetizar.")
            # Retain one character so a final empty local delta becomes a
            # non-empty provider EOS message. No undocumented empty-text
            # handling or whole-sentence buffering is required.
            wire_text = combined if is_eos else combined[:-1]
            self._text_pending = "" if is_eos else combined[-1:]
            self._text_chars += len(text)
            for offset in range(0, len(wire_text), MAX_MESSAGE_CHARS):
                times = self._session._text_times
                # Stay below the documented 50 text messages/s, cancellably.
                while len(times) >= 40:
                    delay = 1 - (time.monotonic() - times[0])
                    if delay <= 0:
                        times.popleft()
                    else:
                        self._cancelled.wait(delay)
                        self._check()
                self._check()
                try:
                    self._session._connection.send(json.dumps({"type": "text",
                        "text": wire_text[offset:offset + MAX_MESSAGE_CHARS],
                        "is_eos": is_eos and offset + MAX_MESSAGE_CHARS >= len(wire_text),
                        "generation_id": self.generation_id}, ensure_ascii=True))
                except Exception:
                    self._check()
                    raise _error() from None
                times.append(time.monotonic())
            self._eos = is_eos

    def read(self, size=1920):
        if type(size) is not int or size <= 0 or size > MAX_AUDIO_CHUNK_BYTES:
            raise ValueError("El tamaño de lectura debe estar entre 1 y 262144 bytes.")
        if self._cancelled.is_set():
            return b""
        deadline = min(self._started + MAX_GENERATION_SECONDS, time.monotonic() + RECEIVE_TIMEOUT_SECONDS)
        try:
            self._check()
            while not self._pending and not self._last:
                self._check()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise _error("palabra_tts_timeout", "Palabra no completó la voz dentro del límite de espera.")
                try:
                    connection = self._session._connection
                    if connection is None:
                        self._check()
                        raise _error()
                    raw = connection.recv(timeout=min(.2, remaining))
                except TimeoutError:
                    continue
                event = _event(raw)
                kind, data = event.get("message_type"), event.get("data", {})
                if kind == "warning":
                    continue
                if kind != "audio_chunk":
                    raise _error("palabra_tts_protocol", "Palabra envió un evento de voz inesperado.")
                if data.get("generation_id") != self.generation_id:
                    # A finished prior generation can have late transport data.
                    # Never mix uncorrelated or stale output into this sentence.
                    continue
                encoded = data.get("audio", "")
                if not isinstance(encoded, str) or len(encoded) > MAX_AUDIO_CHUNK_BYTES * 4 // 3 + 4:
                    raise _error("palabra_tts_format", "Palabra devolvió audio fuera del límite.")
                try:
                    pcm = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    raise _error("palabra_tts_format", "Palabra no devolvió audio PCM válido.") from None
                if (len(pcm) % 2 or len(pcm) > MAX_AUDIO_CHUNK_BYTES or
                    ("size" in data and (type(data["size"]) is not int or data["size"] != len(pcm))) or
                    (pcm and "size" not in data) or
                    type(data.get("last_chunk")) is not bool):
                    raise _error("palabra_tts_format", "Palabra no devolvió PCM16 sin contenedor válido.")
                self._audio_bytes += len(pcm)
                if self._audio_bytes > MAX_OUTPUT_BYTES:
                    raise _error("palabra_tts_limit", "La frase excedió el límite de audio de voz.")
                self._pending, self._last = pcm, data["last_chunk"]
            if self._cancelled.is_set():
                return b""
            self._check()
            result, self._pending = self._pending[:size], self._pending[size:]
            if self._cancelled.is_set():
                self._pending = b""
                return b""
            if self._last and not self._pending:
                self._session._release(self)
            return result
        except Exception as exc:
            if self._cancelled.is_set():
                return b""
            self._session._disconnect(self)
            if isinstance(exc, VoiceError):
                raise
            self._check()
            raise _error() from None

    read1 = read

    def close(self):
        self._cancelled.set()
        self._pending = b""
        if self._own_session:
            self._session.close()
        elif self._last:
            self._session._release(self)
        else:
            self._session._disconnect(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def open_palabra_tts(text, language="es"):
    """Standalone readable PCM response; caller must close it in all cases."""
    session = PalabraTTSSession(language)
    try:
        stream = session(text)
        stream._own_session = True
        return stream
    except Exception:
        session.close()
        raise
