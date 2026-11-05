"""Bounded speech-to-speech translation relay; no audio or transcript persistence.

Protocol: official Realtime Translation client/server events, checked 2026-10-27.
Elapsed stream alignment and observed first-audio delay aren't model inference.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import os
import threading
import time

from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed

from packages.providers.live_voice import VoiceError

MODEL = "gpt-realtime-translate"
URL = "wss://api.openai.com/v1/realtime/translations?model=" + MODEL
SAMPLE_RATE = 24000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_INPUT_CHUNK = 9600
MAX_SESSION_SECONDS = 60
DRAIN_SECONDS = 10
OUTPUT_FRAME_BYTES = 1920  # 40 ms PCM16 mono 24 kHz.
OUTPUT_LEAD_SECONDS = .3


def dubbing_key():
    # A credential from another local application is not an implicit opt-in.
    return os.environ.get("BRIVANY_OPENAI_API_KEY", "").strip()


def dubbing_status():
    return {"provider": "OpenAI", "model": MODEL, "configured": bool(dubbing_key()),
            "access_verified": False, "target_inference_ms": 500, "inference_verified": False,
            "target_audible_delay_ms": 500, "audible_delay_verified": False, "physical_playback_measured": False,
            "max_seconds": MAX_SESSION_SECONDS, "drain_seconds": DRAIN_SECONDS,
            "sample_rate": SAMPLE_RATE, "channels": 1, "format": "pcm16",
            "input_frame_ms": 200, "languages": ["es", "en"],
            "source_language_mode": "automatic", "source_language_enforced": False}


def start_options(value):
    if not isinstance(value, dict) or value.get("type") != "start" or value.get("consent") is not True:
        raise VoiceError("dubbing_consent", "Confirma el envío del audio del video al proveedor de doblaje.")
    if set(value) - {"type", "consent", "source_language", "target_language", "max_seconds"}:
        raise VoiceError("dubbing_options", "La sesión incluye opciones no admitidas.")
    language, seconds = value.get("target_language", "es"), value.get("max_seconds", 60)
    if not isinstance(language, str) or language not in {"es", "en"} or type(seconds) is not int or not 5 <= seconds <= MAX_SESSION_SECONDS:
        raise VoiceError("dubbing_options", "Elige español o inglés y una sesión de 5 a 60 segundos.")
    source = value.get("source_language", "en" if language == "es" else "es")
    if not isinstance(source, str) or source not in {"en", "es"} or source == language:
        raise VoiceError("dubbing_options", "Elige idiomas de origen y destino distintos: español e inglés.")
    if not dubbing_key():
        raise VoiceError("dubbing_not_configured", "Guarda una clave API de OpenAI para conectar el doblaje.")
    if len(dubbing_key()) > 4096 or any(ord(character) < 33 or ord(character) > 126 for character in dubbing_key()):
        raise VoiceError("dubbing_key_format", "Configura una clave API de OpenAI válida para el servidor.")
    return language, seconds


def parse_event(raw):
    if not isinstance(raw, str): raise VoiceError("dubbing_protocol", "El proveedor envió un evento no válido.")
    event = json.loads(raw)
    if not isinstance(event, dict): raise VoiceError("dubbing_protocol", "El proveedor envió un evento no válido.")
    if event.get("type") == "error":
        raise VoiceError("dubbing_rejected", "El proveedor rechazó la sesión de doblaje. Revisa acceso, saldo y conexión.")
    return event


class TranslationEvents:
    """Validate deltas and deduplicate by event ID, never by alignment time."""
    def __init__(self):
        self.seen = set()
        self.output_bytes = 0
        self.text_characters = 0

    def accept(self, event):
        identifier = event.get("event_id")
        if identifier is not None:
            if not isinstance(identifier, str) or not 1 <= len(identifier) <= 512:
                raise VoiceError("dubbing_protocol", "Identificador de evento no válido.")
            if identifier in self.seen: return None
            if len(self.seen) >= 10000: raise VoiceError("dubbing_output_limit", "La sesión excedió el límite de eventos.")
            self.seen.add(identifier)
        kind = event.get("type")
        elapsed = event.get("elapsed_ms")
        if elapsed is not None and (type(elapsed) not in {int, float} or not math.isfinite(elapsed) or elapsed < 0):
            raise VoiceError("dubbing_protocol", "La alineación del audio no es válida.")
        if kind == "session.output_audio.delta":
            if event.get("sample_rate", SAMPLE_RATE) != SAMPLE_RATE or event.get("channels", 1) != 1 or event.get("format", "pcm16") != "pcm16":
                raise VoiceError("dubbing_audio_format", "El proveedor devolvió un formato de audio no admitido.")
            encoded = event.get("delta")
            if not isinstance(encoded, str): raise VoiceError("dubbing_audio_format", "El bloque de voz no es válido.")
            try: data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error): raise VoiceError("dubbing_audio_format", "El bloque de voz no es válido.") from None
            if not data or len(data) % 2 or len(data) > BYTES_PER_SECOND * 10:
                raise VoiceError("dubbing_audio_format", "El bloque de voz está vacío o fuera del límite.")
            self.output_bytes += len(data)
            if self.output_bytes > BYTES_PER_SECOND * 90:
                raise VoiceError("dubbing_output_limit", "La salida de doblaje excedió 90 segundos.")
            return {"type": "audio", "audio": encoded, "sample_rate": SAMPLE_RATE, "elapsed_ms": elapsed}
        if kind in {"session.output_transcript.delta", "session.input_transcript.delta"}:
            delta = event.get("delta")
            if not isinstance(delta, str) or len(delta) > 10000:
                raise VoiceError("dubbing_protocol", "El subtítulo recibido no es válido.")
            self.text_characters += len(delta)
            if self.text_characters > 100000: raise VoiceError("dubbing_output_limit", "La sesión excedió el límite de texto.")
            return {"type": "transcript", "text": delta, "elapsed_ms": elapsed,
                    "source": "translation" if kind == "session.output_transcript.delta" else "original"}
        if kind == "session.closed": return {"type": "closed"}
        return None


class TranslationBridge:
    """One local session, bounded duration and input rate, no automatic retries."""
    def __init__(self, http_port, port=0):
        self.http_port, self.port = http_port, port
        self.lock = threading.Lock()
        self.server = None
        self.connections = set()
        self.connections_lock = threading.Lock()

    def start(self):
        logger = logging.getLogger("brivany.dubbing.websocket")
        logger.handlers = [logging.NullHandler()]; logger.propagate = False
        self.server = serve(self.handle, "127.0.0.1", self.port,
            origins=[f"http://{host}:{self.http_port}" for host in ("localhost", "127.0.0.1")],
            process_request=self.check_request, logger=logger, max_size=16384, max_queue=8,
            compression=None, close_timeout=2)
        self.port = self.server.socket.getsockname()[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def check_request(self, connection, request):
        if request.path != "/dub" or request.headers.get("Host") not in {f"localhost:{self.port}", f"127.0.0.1:{self.port}"}:
            return connection.respond(403, "Dirección local requerida.")

    def close(self):
        with self.connections_lock: connections = list(self.connections)
        for connection in connections: connection.close()
        if self.server: self.server.shutdown()

    @staticmethod
    def send(browser, event):
        browser.send(json.dumps(event, ensure_ascii=False, allow_nan=False))

    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {"type": "error", "code": "dubbing_busy", "message": "Ya hay un doblaje activo. Detén esa sesión primero."})
            return
        upstream, reader = None, None
        stopped, drained = threading.Event(), threading.Event()
        closing_at = None
        close_sent = False
        first_input_at, first_output_ms = None, None
        sent_bytes, provider_bytes = 0, 0
        pacing_balance, pacing_at = .5, None
        pending = bytearray()
        events = TranslationEvents()
        send_lock = threading.Lock()
        close_lock = threading.Lock()

        def send(value):
            with send_lock:
                if not stopped.is_set(): self.send(browser, value)

        def fail(error):
            with send_lock:
                if stopped.is_set(): return
                try: self.send(browser, {"type": "error", "code": error.code, "message": str(error)})
                finally: stopped.set()

        def stop_output():
            with send_lock: stopped.set()

        with self.connections_lock: self.connections.add(browser)
        try:
            first = browser.recv(timeout=8)
            if not isinstance(first, str): raise VoiceError("dubbing_options", "Falta la configuración de doblaje.")
            options = json.loads(first)
            language, seconds = start_options(options)
            source = options.get("source_language", "en" if language == "es" else "es")
            upstream = connect(URL, additional_headers={"Authorization": "Bearer " + dubbing_key()},
                               open_timeout=8, close_timeout=2, max_size=1024*1024, max_queue=8,
                               compression=None, proxy=None)
            with self.connections_lock: self.connections.add(upstream)
            if parse_event(upstream.recv(timeout=8)).get("type") != "session.created":
                raise VoiceError("dubbing_protocol", "No se pudo crear la sesión de traducción.")
            upstream.send(json.dumps({"type": "session.update", "session": {"audio": {
                "input": {"noise_reduction": None, "transcription": None}, "output": {"language": language}}}}))
            if parse_event(upstream.recv(timeout=8)).get("type") != "session.updated":
                raise VoiceError("dubbing_protocol", "No se pudo configurar el idioma de traducción.")
            send({"type": "ready", "model": MODEL, "provider": "OpenAI", "sample_rate": SAMPLE_RATE,
                  "max_seconds": seconds, "drain_seconds": DRAIN_SECONDS,
                  "source_language_requested": source, "source_language_mode": "automatic",
                  "source_language_enforced": False})
            started = time.monotonic()
            pacing_at = started

            def flush(final=False):
                nonlocal provider_bytes
                # The service consumes 200 ms frames. A final partial frame is
                # forwarded unchanged; session.close performs the documented
                # input flush, so no synthetic silence or padding is fabricated.
                while len(pending) >= MAX_INPUT_CHUNK or (final and pending):
                    amount = min(len(pending), MAX_INPUT_CHUNK)
                    chunk = bytes(pending[:amount]); del pending[:amount]
                    upstream.send(json.dumps({"type": "session.input_audio_buffer.append", "audio": base64.b64encode(chunk).decode("ascii")}))
                    provider_bytes += len(chunk)

            def finish():
                nonlocal closing_at, close_sent
                if closing_at is None:
                    closing_at = time.monotonic(); flush(final=True)
                    with close_lock:
                        upstream.send(json.dumps({"type": "session.close"}))
                        close_sent = True

            def receive():
                nonlocal first_output_ms
                output_balance, output_pacing_at = OUTPUT_LEAD_SECONDS, time.monotonic()
                try:
                    while not stopped.is_set():
                        try: raw = upstream.recv(timeout=.25)
                        except TimeoutError: continue
                        normalized = events.accept(parse_event(raw))
                        if not normalized: continue
                        if normalized["type"] == "closed":
                            with close_lock: requested_close = close_sent
                            if not requested_close: raise VoiceError("dubbing_incomplete", "El proveedor cerró la traducción antes de finalizar la entrada.")
                            # Completion and cancellation are serialized with
                            # every packet; no output can follow a terminal state.
                            with send_lock:
                                if stopped.is_set(): return
                                drained.set()
                                self.send(browser, {"type": "metrics", "first_output_audio_ms": first_output_ms,
                                    "inference_ms": None, "target_inference_ms": 500, "inference_verified": False,
                                    "bytes_sent": sent_bytes, "provider_input_bytes": provider_bytes,
                                    "output_bytes": events.output_bytes,
                                    "input_seconds": round(sent_bytes / BYTES_PER_SECOND, 3),
                                    "provider_finalization_verified": True})
                                self.send(browser, {"type": "done", "finalization_verified": True})
                                stopped.set()
                            return
                        if normalized["type"] != "audio":
                            send(normalized); continue
                        audio = base64.b64decode(normalized["audio"])
                        for offset in range(0, len(audio), OUTPUT_FRAME_BYTES):
                            chunk = audio[offset:offset + OUTPUT_FRAME_BYTES]
                            duration = len(chunk) / BYTES_PER_SECOND
                            now = time.monotonic()
                            output_balance = min(OUTPUT_LEAD_SECONDS, output_balance + now - output_pacing_at)
                            wait = max(0, duration - output_balance)
                            until = now + wait
                            while wait > 0:
                                if stopped.wait(min(.01, wait)): return
                                wait = until - time.monotonic()
                            if stopped.is_set(): return
                            output_pacing_at = time.monotonic()
                            output_balance = max(0, min(OUTPUT_LEAD_SECONDS, output_balance + output_pacing_at - now) - duration)
                            with send_lock:
                                if stopped.is_set(): return
                                if first_output_ms is None and first_input_at is not None:
                                    first_output_ms = round((time.monotonic() - first_input_at) * 1000, 2)
                                    self.send(browser, {"type": "metrics", "first_output_audio_ms": first_output_ms,
                                        "inference_ms": None, "target_inference_ms": 500, "inference_verified": False})
                                # elapsed_ms remains an alignment mark of the
                                # original delta, never a per-slice inference time.
                                self.send(browser, {**normalized, "audio": base64.b64encode(chunk).decode("ascii")})
                except ConnectionClosed:
                    if not stopped.is_set():
                        try: fail(VoiceError("dubbing_incomplete", "La traducción se desconectó antes de completar la salida."))
                        except ConnectionClosed: pass
                except Exception as exc:
                    error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "La conexión de doblaje se interrumpió.")
                    try: fail(error)
                    except ConnectionClosed: pass
                finally: stop_output()

            reader = threading.Thread(target=receive, daemon=True); reader.start()
            while not stopped.is_set():
                now = time.monotonic()
                if closing_at is not None:
                    if now - closing_at > DRAIN_SECONDS:
                        raise VoiceError("dubbing_drain_timeout", "El proveedor no terminó el doblaje dentro del límite de cierre.")
                elif now - started >= seconds:
                    finish(); send({"type": "input-ended", "reason": "session_limit"})
                try: message = browser.recv(timeout=.25)
                except TimeoutError: continue
                if isinstance(message, bytes):
                    if closing_at is not None: continue
                    if not message or len(message) > MAX_INPUT_CHUNK or len(message) % 2:
                        raise VoiceError("dubbing_audio_format", "Envía PCM16 mono de 24 kHz en bloques de hasta 200 ms.")
                    projected = sent_bytes + len(message)
                    if projected > seconds * BYTES_PER_SECOND:
                        raise VoiceError("dubbing_input_limit", "El audio superó el límite de esta sesión.")
                    now = time.monotonic()
                    pacing_balance = min(.5, pacing_balance + now - pacing_at)
                    pacing_at = now
                    if len(message) / BYTES_PER_SECOND > pacing_balance:
                        raise VoiceError("dubbing_backlog", "El audio llegó más rápido que su reproducción. Reinicia el doblaje.")
                    pacing_balance -= len(message) / BYTES_PER_SECOND
                    if first_input_at is None: first_input_at = time.monotonic()
                    sent_bytes = projected; pending.extend(message); flush()
                else:
                    control = json.loads(message)
                    if control == {"type": "cancel"}:
                        stop_output(); break
                    if control == {"type": "finish"}: finish()
                    else: raise VoiceError("dubbing_control", "Control de doblaje no válido.")
        except ConnectionClosed:
            pass
        except Exception as exc:
            error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "No se pudo conectar el doblaje. Revisa la clave API, acceso, saldo y conexión.")
            try: fail(error)
            except ConnectionClosed: pass
        finally:
            stop_output()
            if upstream: upstream.close()
            browser.close()
            if reader: reader.join(timeout=1)
            with self.connections_lock:
                self.connections.discard(browser)
                if upstream: self.connections.discard(upstream)
            self.lock.release()
