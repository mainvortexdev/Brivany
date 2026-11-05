"""Bounded Google Live Translate candidate. No audio/transcript persistence.

Wire schema follows googleapis/python-genai's LiveConnectConfig converter:
translationConfig is in generationConfig; transcription configs are on setup.
PCM conversion is a continuous, two-phase FIR, never reset between packets.
"""
from __future__ import annotations

import base64
import binascii
import json
import math
import os
import struct
import threading
import time

from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from packages.providers.dubbing import BYTES_PER_SECOND, MAX_INPUT_CHUNK, MAX_SESSION_SECONDS, SAMPLE_RATE, TranslationBridge
from packages.providers.live_voice import VoiceError

MODEL = "gemini-3.5-live-translate-preview"
URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
PROVIDER_SAMPLE_RATE = 16000
INPUT_FRAME_BYTES = PROVIDER_SAMPLE_RATE * 2 // 10  # Recommended 100 ms.
OUTPUT_FRAME_BYTES = BYTES_PER_SECOND // 10
DRAIN_SECONDS = 12
DRAIN_MIN_SECONDS = 4
COMPLETION_QUIET_SECONDS = .75


def dubbing_key():
    """Only the explicitly configured Brivany credential; no account fallback."""
    return os.environ.get("BRIVANY_GEMINI_API_KEY", "").strip()


def gemini_status():
    return {"provider": "Google Gemini", "model": MODEL, "configured": bool(dubbing_key()),
            "access_verified": False, "target_inference_ms": 500, "inference_verified": False,
            "max_seconds": MAX_SESSION_SECONDS, "drain_seconds": DRAIN_SECONDS,
            "sample_rate": SAMPLE_RATE, "provider_input_sample_rate": PROVIDER_SAMPLE_RATE,
            "channels": 1, "format": "pcm16", "input_frame_ms": 100,
            "languages": ["es", "en"], "source_languages": ["en", "es"],
            "source_language_mode": "automatic", "preview": True,
            "completion_method": "bounded_post_input_drain", "finalization_verified": False,
            "provider_input_consumed_acknowledged": False,
            "drain_min_seconds": DRAIN_MIN_SECONDS, "drain_quiet_seconds": COMPLETION_QUIET_SECONDS,
            "tail_silence_seconds_default": 0, "tail_silence_seconds_options": [0, 2],
            "padding_max_seconds": 2, "padding_experimental": True}


def start_options(value):
    if not isinstance(value, dict) or value.get("type") != "start" or value.get("consent") is not True:
        raise VoiceError("dubbing_consent", "Confirma el envío del audio del video a Google para traducirlo.")
    if set(value) - {"type", "consent", "source_language", "target_language", "max_seconds", "tail_silence_seconds"}:
        raise VoiceError("dubbing_options", "La sesión incluye opciones no admitidas.")
    source, target = value.get("source_language", "en"), value.get("target_language", "es")
    seconds = value.get("max_seconds", MAX_SESSION_SECONDS)
    padding = value.get("tail_silence_seconds", 0)
    if source not in {"en", "es"} or target not in {"en", "es"} or source == target or type(seconds) is not int or not 5 <= seconds <= MAX_SESSION_SECONDS:
        raise VoiceError("dubbing_options", "Elige inglés a español o español a inglés, de 5 a 60 segundos.")
    if type(padding) is not int or padding not in {0, 2}:
        raise VoiceError("dubbing_options", "El silencio final experimental admite solo 0 o 2 segundos.")
    key = dubbing_key()
    if not key:
        raise VoiceError("dubbing_not_configured", "Guarda una clave API de Gemini para conectar este proveedor.")
    if len(key) > 4096 or any(ord(character) < 33 or ord(character) > 126 for character in key) or key.startswith("auth_tokens/"):
        raise VoiceError("dubbing_key_format", "Configura una clave API de Gemini válida para el servidor.")
    return source, target, seconds


def setup_event(target):
    return {"setup": {"model": "models/" + MODEL,
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "translationConfig": {"targetLanguageCode": target, "echoTargetLanguage": False}},
            "inputAudioTranscription": {}, "outputAudioTranscription": {}}}


def parse_event(raw, diagnostics=None):
    try:
        if not isinstance(raw, (str, bytes)) or len(raw) > 1024 * 1024:
            raise ValueError
        value = json.loads(raw)
        if not isinstance(value, dict): raise ValueError
    except (ValueError, UnicodeError, TypeError):
        raise VoiceError("dubbing_protocol", "Google envió un evento no válido.") from None
    if diagnostics is not None: diagnostics.observe(value)
    if "error" in value:
        # Never reflect the provider message, URL, credential, or supplied text.
        code = value["error"].get("code") if isinstance(value["error"], dict) else None
        if code in {401, 403}:
            raise VoiceError("dubbing_access", "Gemini rechazó el acceso. Revisa la clave y el acceso al modelo de traducción.")
        if code == 429:
            raise VoiceError("dubbing_quota", "Gemini alcanzó una cuota o límite. Revisa la facturación y espera antes de reintentar.")
        raise VoiceError("dubbing_rejected", "Gemini rechazó esta sesión de traducción. Revisa el acceso al modelo y la conexión.")
    if "goAway" in value:
        raise VoiceError("dubbing_incomplete", "Gemini solicitó cerrar la sesión antes de completar el doblaje.")
    return value


class PCM24To16:
    """Windowed-sinc low-pass resampler, 24 kHz -> 16 kHz, stateful 2/3.

    Both fractional phases are normalized for DC. A 33-tap Hann kernel cuts
    at 7.2 kHz and uses 16 future input samples (~0.67 ms). Finish pads only
    the filter boundary, producing floor(input_samples * 2/3) output samples.
    Chunk boundaries have no effect on the samples or duration.
    """
    HALF = 16

    def __init__(self):
        self.samples, self.base, self.total, self.output = [], 0, 0, 0
        self.closed = False
        self.phases = []
        for fraction in (0, .5):
            coefficients = []
            for offset in range(-self.HALF, self.HALF + 1):
                distance = fraction - offset
                sinc = .6 if distance == 0 else math.sin(math.pi * .6 * distance) / (math.pi * distance)
                window = .5 + .5 * math.cos(math.pi * distance / (self.HALF + 1))
                coefficients.append(sinc * window)
            gain = sum(coefficients)
            self.phases.append([coefficient / gain for coefficient in coefficients])

    def feed(self, data, final=False):
        if self.closed or not isinstance(data, bytes) or len(data) % 2:
            raise VoiceError("dubbing_audio_format", "La conversión necesita PCM16 continuo.")
        if data:
            self.samples.extend(struct.unpack("<" + "h" * (len(data) // 2), data))
            self.total += len(data) // 2
        converted = []
        limit = self.total * 2 // 3
        while self.output < limit:
            doubled_position = self.output * 3
            center, phase = divmod(doubled_position, 2)
            if not final and center + self.HALF >= self.total: break
            value = 0.0
            for offset, coefficient in zip(range(-self.HALF, self.HALF + 1), self.phases[phase]):
                index = center + offset
                if 0 <= index < self.total:
                    value += self.samples[index - self.base] * coefficient
            converted.append(max(-32768, min(32767, round(value))))
            self.output += 1
        keep_from = max(0, self.output * 3 // 2 - self.HALF)
        discard = min(len(self.samples), max(0, keep_from - self.base))
        if discard:
            del self.samples[:discard]
            self.base += discard
        if final:
            self.closed = True
            self.samples.clear()
        return struct.pack("<" + "h" * len(converted), *converted)


class GeminiEvents:
    TOP_FIELDS = ("setupComplete", "serverContent", "usageMetadata", "voiceActivity", "toolCall",
                  "toolCallCancellation", "goAway", "sessionResumptionUpdate", "error")
    CONTENT_FIELDS = ("modelTurn", "inputTranscription", "outputTranscription", "interimInputTranscription",
                      "generationComplete", "turnComplete", "interrupted", "waitingForInput",
                      "interactionStatus", "turnCompleteReason")
    BOOLEAN_FIELDS = ("generationComplete", "turnComplete", "interrupted", "waitingForInput")
    TRANSCRIPT_FIELDS = ("inputTranscription", "outputTranscription", "interimInputTranscription")

    def __init__(self):
        self.output_bytes, self.text_characters, self.event_count = 0, 0, 0
        self.top_fields = dict.fromkeys(self.TOP_FIELDS, 0)
        self.content_fields = dict.fromkeys(self.CONTENT_FIELDS, 0)
        self.boolean_signals = {field: {"true": 0, "false": 0, "invalid": 0} for field in self.BOOLEAN_FIELDS}
        self.transcription_finished = {field: {"true": 0, "false": 0, "invalid": 0} for field in self.TRANSCRIPT_FIELDS}
        self.unknown_top_fields, self.unknown_content_fields, self.idle_signals = 0, 0, 0
        self.inline_audio_parts = 0

    @staticmethod
    def observe_boolean(counters, value):
        counters["true" if value is True else "false" if value is False else "invalid"] += 1

    def observe(self, event):
        """Allowlisted field names, booleans and counters only; never raw values.

        generationComplete and transcription.finished are diagnostic observations.
        Generic Live documentation does not establish a final-input acknowledgement
        for this continuous translation model, so they do not change completion.
        """
        self.event_count += 1
        if self.event_count > 10000:
            raise VoiceError("dubbing_output_limit", "La sesión excedió el límite de eventos.")
        for field in event:
            if field in self.top_fields: self.top_fields[field] += 1
            else: self.unknown_top_fields += 1
        content = event.get("serverContent")
        if not isinstance(content, dict): return
        for field in content:
            if field in self.content_fields: self.content_fields[field] += 1
            else: self.unknown_content_fields += 1
        for field in self.BOOLEAN_FIELDS:
            if field in content: self.observe_boolean(self.boolean_signals[field], content[field])
        if content.get("interactionStatus") == "IDLE": self.idle_signals += 1
        for field in self.TRANSCRIPT_FIELDS:
            transcript = content.get(field)
            if isinstance(transcript, dict) and "finished" in transcript:
                self.observe_boolean(self.transcription_finished[field], transcript["finished"])
        turn = content.get("modelTurn")
        if isinstance(turn, dict) and isinstance(turn.get("parts"), list):
            self.inline_audio_parts += sum(isinstance(part, dict) and "inlineData" in part for part in turn["parts"])

    def summary(self):
        return {"events_received": self.event_count, "top_fields": dict(self.top_fields),
                "server_content_fields": dict(self.content_fields),
                "boolean_signals": {field: dict(counts) for field, counts in self.boolean_signals.items()},
                "transcription_finished": {field: dict(counts) for field, counts in self.transcription_finished.items()},
                "interaction_idle_signals": self.idle_signals,
                "inline_audio_parts": self.inline_audio_parts,
                "unknown_top_fields": self.unknown_top_fields, "unknown_server_content_fields": self.unknown_content_fields}

    def accept(self, event, record=True):
        if record: self.observe(event)
        content = event.get("serverContent")
        if content is None: return [], False
        if not isinstance(content, dict):
            raise VoiceError("dubbing_protocol", "El contenido de traducción no es válido.")
        normalized = []
        for name, source in (("inputTranscription", "original"), ("outputTranscription", "translation")):
            if name not in content: continue
            transcript = content[name]
            if not isinstance(transcript, dict) or not isinstance(transcript.get("text", ""), str):
                raise VoiceError("dubbing_protocol", "El subtítulo recibido no es válido.")
            text = transcript.get("text", "")
            self.text_characters += len(text)
            if len(text) > 10000 or self.text_characters > 100000:
                raise VoiceError("dubbing_output_limit", "La sesión excedió el límite de texto.")
            if text: normalized.append({"type": "transcript", "source": source, "text": text})
        turn = content.get("modelTurn", {})
        if not isinstance(turn, dict) or not isinstance(turn.get("parts", []), list):
            raise VoiceError("dubbing_protocol", "La voz recibida no es válida.")
        for part in turn.get("parts", []):
            if not isinstance(part, dict): raise VoiceError("dubbing_protocol", "La voz recibida no es válida.")
            if "inlineData" not in part: continue
            inline = part["inlineData"]
            if not isinstance(inline, dict): raise VoiceError("dubbing_audio_format", "La voz recibida no es PCM16 de 24 kHz.")
            mime = inline.get("mimeType", "")
            parameters = [item.strip().lower() for item in mime.split(";")] if isinstance(mime, str) else []
            if not parameters or parameters[0] != "audio/pcm" or "rate=24000" not in parameters[1:] or any(item.startswith("channels=") and item != "channels=1" for item in parameters[1:]):
                raise VoiceError("dubbing_audio_format", "La voz recibida no es PCM16 mono de 24 kHz.")
            try:
                encoded = inline["data"]
                if not isinstance(encoded, str): raise ValueError
                data = base64.b64decode(encoded, validate=True)
            except (KeyError, ValueError, binascii.Error):
                raise VoiceError("dubbing_audio_format", "El bloque de voz no es válido.") from None
            if not data or len(data) % 2 or len(data) > BYTES_PER_SECOND * 10:
                raise VoiceError("dubbing_audio_format", "El bloque de voz está vacío o fuera del límite.")
            self.output_bytes += len(data)
            if self.output_bytes > BYTES_PER_SECOND * 90:
                raise VoiceError("dubbing_output_limit", "La salida de doblaje excedió 90 segundos.")
            for offset in range(0, len(data), OUTPUT_FRAME_BYTES):
                normalized.append({"type": "audio", "audio": base64.b64encode(data[offset:offset + OUTPUT_FRAME_BYTES]).decode("ascii"), "sample_rate": SAMPLE_RATE})
        # The SDK prioritizes interactionStatus, when present, over turnComplete.
        status = content.get("interactionStatus")
        complete = status == "IDLE" if status not in {None, "INTERACTION_STATUS_UNSPECIFIED"} else content.get("turnComplete") is True
        return normalized, complete


class GeminiBridge(TranslationBridge):
    """One bounded local session; upstream input resampled and output paced."""
    def __init__(self, http_port, port=0, clock=None):
        super().__init__(http_port, port)
        self.clock = clock or time.monotonic

    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {"type": "error", "code": "dubbing_busy", "message": "Ya hay un doblaje activo. Detén esa sesión primero."})
            return
        upstream, reader, finisher = None, None, None
        stopped, finish_sent, output_pending = threading.Event(), threading.Event(), threading.Event()
        closing_at, first_input_at, first_output_ms = None, None, None
        input_ended_at, last_content_at = None, None
        sent_bytes, provider_bytes, provider_frames, stream_end_messages, padding_bytes = 0, 0, 0, 0, 0
        pending = bytearray()
        events, resampler = GeminiEvents(), PCM24To16()
        send_lock, terminal_lock = threading.Lock(), threading.Lock()

        def send(event):
            with send_lock:
                if not stopped.is_set(): self.send(browser, event)

        def metrics():
            return {"type": "metrics", "first_output_audio_ms": first_output_ms,
                    "inference_ms": None, "target_inference_ms": 500, "inference_verified": False,
                    "bytes_sent": sent_bytes, "provider_input_bytes": provider_bytes,
                    "provider_real_input_bytes": provider_bytes - padding_bytes,
                    "provider_input_sample_rate": PROVIDER_SAMPLE_RATE,
                    "padding_input_bytes": padding_bytes,
                    "padding_input_seconds": round(padding_bytes / (PROVIDER_SAMPLE_RATE * 2), 3),
                    "provider_input_seconds": round(provider_bytes / (PROVIDER_SAMPLE_RATE * 2), 3),
                    "output_bytes": events.output_bytes, "input_seconds": round(sent_bytes / BYTES_PER_SECOND, 3),
                    "provider_diagnostics": {**events.summary(), "input_audio_frames_sent": provider_frames,
                                             "audio_stream_end_messages_sent": stream_end_messages,
                                             "audio_stream_end_sent": finish_sent.is_set()}}

        def send_error(error):
            # Emit the bounded summary before errors, including failures before
            # any input audio or provider connection. No raw events are retained.
            with terminal_lock:
                with send_lock:
                    if stopped.is_set(): return
                    self.send(browser, metrics())
                    self.send(browser, {"type": "error", "code": error.code, "message": str(error)})
                    stopped.set()

        def complete_local(reason):
            # Dedicated Translate examples drain for a fixed time and close;
            # no documented final-input acknowledgement exists for this model.
            # This policy bounds local waiting, not completeness or inference.
            with terminal_lock:
                with send_lock:
                    if stopped.is_set(): return
                    closure = {"completion_method": "bounded_post_input_drain", "completion_reason": reason,
                               "provider_input_consumed_acknowledged": False, "finalization_verified": False,
                               "session_closed_locally": True}
                    self.send(browser, {**metrics(), **closure})
                    self.send(browser, {"type": "done", **closure})
                    stopped.set()

        def send_pcm(data, final=False):
            nonlocal provider_bytes, provider_frames
            pending.extend(data)
            while len(pending) >= INPUT_FRAME_BYTES or final and pending:
                size = min(INPUT_FRAME_BYTES, len(pending))
                frame = bytes(pending[:size]); del pending[:size]
                with send_lock:
                    if stopped.is_set(): return
                    upstream.send(json.dumps({"realtimeInput": {"audio": {"data": base64.b64encode(frame).decode("ascii"), "mimeType": "audio/pcm;rate=16000"}}}))
                    provider_bytes += size
                    provider_frames += 1

        def finish():
            nonlocal closing_at, finisher
            if closing_at is not None: return
            closing_at = self.clock()

            def finish_input():
                nonlocal input_ended_at, stream_end_messages, provider_bytes, provider_frames, padding_bytes
                try:
                    # This opt-in experiment supplies missing pause frames to a
                    # continuous translator. It is not a documented Google EOF
                    # guarantee and remains off unless selected for this session.
                    if stopped.is_set(): return
                    send_pcm(resampler.feed(b"", final=True), final=True)
                    for _ in range(tail_silence_seconds * 10):
                        # One wait per frame: exactly 2 s of optional input at
                        # 100 ms cadence, without accumulating scheduling credit.
                        if stopped.wait(.1): return
                        with send_lock:
                            if stopped.is_set(): return
                            upstream.send(json.dumps({"realtimeInput": {"audio": {
                                "data": base64.b64encode(bytes(INPUT_FRAME_BYTES)).decode("ascii"),
                                "mimeType": "audio/pcm;rate=16000"}}}))
                            padding_bytes += INPUT_FRAME_BYTES
                            provider_bytes += INPUT_FRAME_BYTES
                            provider_frames += 1
                    with send_lock:
                        if stopped.is_set(): return
                        upstream.send(json.dumps({"realtimeInput": {"audioStreamEnd": True}}))
                        stream_end_messages += 1
                        input_ended_at = self.clock()
                        finish_sent.set()
                except Exception as exc:
                    if stopped.is_set(): return
                    error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "La entrada de traducción se interrumpió al finalizar.")
                    try: send_error(error)
                    except ConnectionClosed: pass

            finisher = threading.Thread(target=finish_input, daemon=True)
            finisher.start()

        with self.connections_lock: self.connections.add(browser)
        try:
            first = browser.recv(timeout=8)
            if not isinstance(first, str): raise VoiceError("dubbing_options", "Falta la configuración de doblaje.")
            options = json.loads(first)
            source, target, seconds = start_options(options)
            tail_silence_seconds = options.get("tail_silence_seconds", 0)
            upstream = connect(URL, additional_headers={"x-goog-api-key": dubbing_key()},
                               open_timeout=8, close_timeout=2, max_size=1024 * 1024,
                               max_queue=8, compression=None, proxy=None)
            with self.connections_lock: self.connections.add(upstream)
            upstream.send(json.dumps(setup_event(target)))
            acknowledgement = parse_event(upstream.recv(timeout=8), events)
            if not isinstance(acknowledgement.get("setupComplete"), dict):
                raise VoiceError("dubbing_protocol", "Gemini no confirmó la configuración de traducción.")
            send({"type": "ready", "provider": "Google Gemini", "model": MODEL, "sample_rate": SAMPLE_RATE,
                  "max_seconds": seconds, "drain_seconds": DRAIN_SECONDS + tail_silence_seconds, "source_language": source,
                  "target_language": target, "source_language_mode": "automatic",
                  "drain_min_seconds": DRAIN_MIN_SECONDS, "drain_quiet_seconds": COMPLETION_QUIET_SECONDS,
                  "completion_method": "bounded_post_input_drain", "finalization_verified": False,
                  "tail_silence_seconds": tail_silence_seconds})
            started = pacing_at = self.clock()
            pacing_balance = .5

            def receive():
                nonlocal first_output_ms, last_content_at
                output_balance, output_pacing_at = .3, self.clock()
                try:
                    while not stopped.is_set():
                        try: raw = upstream.recv(timeout=.1)
                        except TimeoutError: continue
                        value = parse_event(raw, events)
                        normalized, _complete = events.accept(value, record=False)
                        if normalized:
                            output_pending.set()
                            last_content_at = self.clock()
                        try:
                            for event in normalized:
                                if stopped.is_set(): return
                                if event["type"] == "audio":
                                    if first_input_at is None:
                                        raise VoiceError("dubbing_protocol", "Gemini devolvió voz antes de recibir el audio del video.")
                                    now = self.clock()
                                    # Bound browser playback lead to 300 ms. The reader and
                                    # max_queue=8 apply backpressure instead of retaining output.
                                    duration = len(base64.b64decode(event["audio"])) / BYTES_PER_SECOND
                                    output_balance = min(.3, output_balance + now - output_pacing_at)
                                    wait = max(0, duration - output_balance)
                                    if wait and stopped.wait(wait): return
                                    output_pacing_at = self.clock()
                                    output_balance = max(0, output_balance + wait - duration)
                                    if first_output_ms is None:
                                        first_output_ms = round((self.clock() - first_input_at) * 1000, 2)
                                        send(metrics())
                                send(event)
                                last_content_at = self.clock()
                        finally: output_pending.clear()
                except ConnectionClosed:
                    if not stopped.is_set(): send_error(VoiceError("dubbing_incomplete", "Gemini se desconectó antes de completar la traducción."))
                except Exception as exc:
                    error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "La conexión de traducción se interrumpió.")
                    try: send_error(error)
                    except ConnectionClosed: pass
                finally: stopped.set()

            reader = threading.Thread(target=receive, daemon=True); reader.start()
            while not stopped.is_set():
                now = self.clock()
                if input_ended_at is not None:
                    elapsed = now - input_ended_at
                    if elapsed >= DRAIN_SECONDS:
                        complete_local("drain_budget"); break
                    quiet_since = max(input_ended_at, last_content_at if last_content_at is not None else input_ended_at)
                    if elapsed >= DRAIN_MIN_SECONDS and not output_pending.is_set() and now - quiet_since >= COMPLETION_QUIET_SECONDS:
                        complete_local("quiet_window"); break
                elif closing_at is None and now - started >= seconds:
                    finish(); send({"type": "input-ended", "reason": "session_limit"})
                try: message = browser.recv(timeout=.1)
                except TimeoutError: continue
                if isinstance(message, bytes):
                    if closing_at is not None: continue
                    if not message or len(message) > MAX_INPUT_CHUNK or len(message) % 2:
                        raise VoiceError("dubbing_audio_format", "Envía PCM16 mono de 24 kHz en bloques de hasta 200 ms.")
                    projected = sent_bytes + len(message)
                    if projected > seconds * BYTES_PER_SECOND:
                        raise VoiceError("dubbing_input_limit", "El audio superó el límite de esta sesión.")
                    now = self.clock()
                    pacing_balance = min(.5, pacing_balance + now - pacing_at); pacing_at = now
                    if len(message) / BYTES_PER_SECOND > pacing_balance:
                        raise VoiceError("dubbing_backlog", "El audio llegó más rápido que su reproducción. Reinicia el doblaje.")
                    pacing_balance -= len(message) / BYTES_PER_SECOND
                    if first_input_at is None: first_input_at = now
                    sent_bytes = projected
                    send_pcm(resampler.feed(message))
                else:
                    control = json.loads(message)
                    if control == {"type": "cancel"}:
                        with send_lock: stopped.set()
                        break
                    if control == {"type": "finish"}: finish()
                    else: raise VoiceError("dubbing_control", "Control de doblaje no válido.")
        except ConnectionClosed:
            pass
        except Exception as exc:
            if isinstance(exc, InvalidStatus) and exc.response.status_code in {401, 403}:
                error = VoiceError("dubbing_access", "Gemini rechazó el acceso. Revisa la clave y el acceso al modelo de traducción.")
            elif isinstance(exc, InvalidStatus) and exc.response.status_code == 429:
                error = VoiceError("dubbing_quota", "Gemini alcanzó una cuota o límite. Revisa la facturación antes de reintentar.")
            else:
                error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "No se pudo conectar Gemini. Revisa clave, acceso, saldo y conexión.")
            try: send_error(error)
            except ConnectionClosed: pass
        finally:
            with send_lock: stopped.set()
            if upstream: upstream.close()
            browser.close()
            if reader: reader.join(timeout=2)
            if finisher: finisher.join(timeout=2)
            with self.connections_lock:
                self.connections.discard(browser)
                if upstream: self.connections.discard(upstream)
            self.lock.release()
