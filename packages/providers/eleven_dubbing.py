"""ElevenLabs Realtime Translation adapter; no calls occur before explicit start.

This API is currently documented for enterprise workspaces. Local configuration
doesn't prove entitlement, quality, or <=500 ms inference. No retry or fallback.
"""
from __future__ import annotations
import base64
import binascii
import json
import os
import re
import threading
import time
from urllib.parse import urlencode
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from packages.providers.dubbing import TranslationBridge, BYTES_PER_SECOND, MAX_INPUT_CHUNK
from packages.providers.live_voice import VoiceError

URL = "wss://api.elevenlabs.io/v1/translation/realtime"
MODEL = "realtime-translation"
TTS_MODEL = "eleven_flash_v2_5"
DRAIN_SECONDS = 10


def eleven_key():
    return os.environ.get("BRIVANY_ELEVENLABS_API_KEY", "").strip() or os.environ.get("ELEVENLABS_API_KEY", "").strip()


def eleven_voice():
    value = os.environ.get("BRIVANY_ELEVENLABS_VOICE_ID", "").strip()
    return value if re.fullmatch(r"[A-Za-z0-9_-]{1,120}", value) else ""


def dubbing_status():
    return {"provider": "ElevenLabs", "model": MODEL, "tts_model": TTS_MODEL,
        "configured": bool(eleven_key()), "voice_configured": bool(eleven_voice()),
        "access_verified": False, "requires_enterprise_access": True,
        "target_inference_ms": 500, "inference_verified": False, "max_seconds": 60,
        "sample_rate": 24000, "channels": 1, "format": "pcm16", "languages": ["es", "en"],
        "source_language_required": True, "eagerness": "high"}


def start_options(value):
    if not isinstance(value, dict) or value.get("type") != "start" or value.get("consent") is not True:
        raise VoiceError("dubbing_consent", "Confirma el envío del audio del video a ElevenLabs.")
    if set(value) - {"type", "consent", "source_language", "target_language", "max_seconds"}:
        raise VoiceError("dubbing_options", "La sesión incluye opciones no admitidas.")
    target = value.get("target_language", "es")
    source = value.get("source_language", "en" if target == "es" else "es")
    seconds = value.get("max_seconds", 60)
    if source not in {"es", "en"} or target not in {"es", "en"} or source == target or type(seconds) is not int or not 5 <= seconds <= 60:
        raise VoiceError("dubbing_options", "Elige idiomas distintos (español e inglés) y una sesión de 5 a 60 segundos.")
    if not eleven_key(): raise VoiceError("dubbing_not_configured", "Guarda tu clave API de ElevenLabs para conectar el doblaje.")
    if not eleven_voice(): raise VoiceError("dubbing_voice_required", "Configura una voz de ElevenLabs disponible para esta cuenta antes de iniciar.")
    return source, target, seconds


def endpoint(source, target):
    return URL + "?" + urlencode({"target_language": target, "source_language": source,
        "voice_id": eleven_voice(), "input_format": "pcm_24000", "output_format": "pcm_24000",
        "tts_model_id": TTS_MODEL, "eagerness": "high", "apply_text_normalization": "off"})


ERRORS = {
    "auth_error": ("dubbing_access", "ElevenLabs rechazó el acceso. Comprueba la clave y el permiso Enterprise de Realtime Translation."),
    "rate_limited": ("dubbing_rate_limit", "ElevenLabs limitó las solicitudes. La sesión terminó sin reintentar."),
    "queue_overflow": ("dubbing_backlog", "ElevenLabs detectó audio enviado demasiado rápido. La sesión terminó."),
    "input_error": ("dubbing_audio_format", "ElevenLabs rechazó el formato de audio o las opciones de la sesión."),
    "transcriber_error": ("dubbing_transcriber", "La transcripción de ElevenLabs no está disponible."),
    "translation_error": ("dubbing_translation", "ElevenLabs no pudo traducir un segmento. Se detuvo para evitar una salida incompleta."),
    "audio_output_error": ("dubbing_output", "ElevenLabs no pudo generar un segmento de voz. Se detuvo para evitar una salida incompleta."),
    "quota_exceeded": ("dubbing_quota", "ElevenLabs indicó que el espacio de trabajo no tiene créditos disponibles."),
    "payment_issue": ("dubbing_payment", "ElevenLabs indicó un problema de pago o una suspensión del espacio de trabajo."),
    "unaccepted_terms": ("dubbing_terms", "Acepta en ElevenLabs los términos necesarios para Realtime Translation."),
    "error": ("dubbing_provider", "ElevenLabs no pudo completar la sesión de traducción.")}


def parse_event(raw):
    if not isinstance(raw, str): raise VoiceError("dubbing_protocol", "ElevenLabs envió un evento no válido.")
    event = json.loads(raw)
    if not isinstance(event, dict): raise VoiceError("dubbing_protocol", "ElevenLabs envió un evento no válido.")
    kind = event.get("message_type")
    if kind in ERRORS: raise VoiceError(*ERRORS[kind])
    if isinstance(kind, str) and kind.endswith("_error"):
        raise VoiceError("dubbing_provider", "ElevenLabs interrumpió la traducción. Revisa acceso y configuración.")
    return event


class ElevenEvents:
    def __init__(self):
        self.output_bytes = 0; self.text_characters = 0

    def accept(self, event):
        kind = event.get("message_type")
        if kind == "status" and event.get("status") == "stopped": return {"type": "closed"}
        if kind == "audio":
            if type(event.get("sample_rate")) is not int or event["sample_rate"] != 24000:
                raise VoiceError("dubbing_audio_format", "ElevenLabs devolvió una frecuencia distinta a PCM de 24 kHz.")
            encoded = event.get("data")
            if not isinstance(encoded, str) or len(encoded) > 640000: raise VoiceError("dubbing_audio_format", "El bloque de audio no es válido.")
            try: audio = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error): raise VoiceError("dubbing_audio_format", "El bloque de audio no es válido.") from None
            if not audio or len(audio) % 2: raise VoiceError("dubbing_audio_format", "El bloque PCM está vacío o incompleto.")
            self.output_bytes += len(audio)
            if self.output_bytes > BYTES_PER_SECOND * 90: raise VoiceError("dubbing_output_limit", "La salida de doblaje excedió 90 segundos.")
            return {"type": "audio", "audio": encoded, "sample_rate": 24000, "elapsed_ms": None}
        if kind in {"final_transcript", "translation"}:
            text = event.get("text")
            if not isinstance(text, str) or len(text) > 10000: raise VoiceError("dubbing_protocol", "El subtítulo no es válido.")
            self.text_characters += len(text)
            if self.text_characters > 100000: raise VoiceError("dubbing_output_limit", "El texto excedió el límite de la sesión.")
            # Events represent full segments. Partial transcripts are deliberately
            # omitted until the UI supports replacement semantics.
            return {"type": "transcript", "text": text + (" " if text and not text[-1].isspace() else ""),
                    "source": "original" if kind == "final_transcript" else "translation", "elapsed_ms": None}
        return None


class ElevenBridge(TranslationBridge):
    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {"type": "error", "code": "dubbing_busy", "message": "Ya hay un doblaje activo. Detén esa sesión primero."}); return
        upstream, reader = None, None
        stopped = threading.Event()
        closing_at, first_input_at, first_output_ms = None, None, None
        sent_bytes, pacing_balance = 0, .5
        events = ElevenEvents()
        with self.connections_lock: self.connections.add(browser)
        try:
            raw = browser.recv(timeout=8)
            if not isinstance(raw, str): raise VoiceError("dubbing_options", "Falta la configuración de doblaje.")
            source, target, seconds = start_options(json.loads(raw))
            upstream = connect(endpoint(source, target), additional_headers={"xi-api-key": eleven_key()},
                open_timeout=8, close_timeout=2, max_size=1024*1024, max_queue=8, compression=None, proxy=None)
            with self.connections_lock: self.connections.add(upstream)
            deadline, initialized, running = time.monotonic()+10, False, False
            while not initialized or not running:
                remaining = deadline-time.monotonic()
                if remaining <= 0: raise VoiceError("dubbing_setup_timeout", "ElevenLabs no confirmó el inicio dentro del límite.")
                event = parse_event(upstream.recv(timeout=remaining))
                if event.get("message_type") == "session_started": initialized = True
                if event.get("message_type") == "status" and event.get("status") == "started": running = True
            self.send(browser, {"type": "ready", "provider": "ElevenLabs", "model": MODEL, "sample_rate": 24000,
                                "max_seconds": seconds})
            started = pacing_at = time.monotonic()

            def finish():
                nonlocal closing_at
                if closing_at is None:
                    closing_at = time.monotonic(); upstream.send(json.dumps({"message_type": "end_of_stream"}))

            def receive():
                nonlocal first_output_ms
                try:
                    while not stopped.is_set():
                        try: raw = upstream.recv(timeout=.25)
                        except TimeoutError: continue
                        normalized = events.accept(parse_event(raw))
                        if not normalized: continue
                        if normalized["type"] == "closed":
                            if closing_at is None: raise VoiceError("dubbing_incomplete", "ElevenLabs cerró la traducción antes de finalizar la entrada.")
                            self.send(browser, {"type": "metrics", "first_output_audio_ms": first_output_ms,
                                "inference_ms": None, "target_inference_ms": 500, "inference_verified": False,
                                "bytes_sent": sent_bytes, "output_bytes": events.output_bytes, "input_seconds": round(sent_bytes/BYTES_PER_SECOND,3)})
                            self.send(browser, {"type": "done"}); return
                        if normalized["type"] == "audio" and first_output_ms is None and first_input_at is not None:
                            first_output_ms = round((time.monotonic()-first_input_at)*1000,2)
                            self.send(browser, {"type": "metrics", "first_output_audio_ms": first_output_ms,
                                "inference_ms": None, "target_inference_ms": 500, "inference_verified": False})
                        self.send(browser, normalized)
                except ConnectionClosed:
                    if not stopped.is_set():
                        try: self.send(browser, {"type": "error", "code": "dubbing_incomplete", "message": "ElevenLabs se desconectó antes de completar la voz traducida."})
                        except ConnectionClosed: pass
                except Exception as exc:
                    error = exc if isinstance(exc, VoiceError) else VoiceError("dubbing_connection", "La conexión con ElevenLabs se interrumpió.")
                    try: self.send(browser, {"type": "error", "code": error.code, "message": str(error)})
                    except ConnectionClosed: pass
                finally: stopped.set()

            reader = threading.Thread(target=receive,daemon=True); reader.start()
            while not stopped.is_set():
                now = time.monotonic()
                if closing_at is not None:
                    if now-closing_at > DRAIN_SECONDS: raise VoiceError("dubbing_drain_timeout", "ElevenLabs no terminó la voz dentro del límite de cierre.")
                elif now-started >= seconds:
                    finish(); self.send(browser,{"type":"input-ended","reason":"session_limit"})
                try: message = browser.recv(timeout=.25)
                except TimeoutError: continue
                if isinstance(message,bytes):
                    if closing_at is not None: continue
                    if not message or len(message)>MAX_INPUT_CHUNK or len(message)%2:
                        raise VoiceError("dubbing_audio_format", "Envía PCM16 mono de 24 kHz en bloques de hasta 200 ms.")
                    if sent_bytes+len(message)>seconds*BYTES_PER_SECOND: raise VoiceError("dubbing_input_limit", "El audio superó el límite de la prueba.")
                    now = time.monotonic(); pacing_balance=min(.5,pacing_balance+now-pacing_at); pacing_at=now
                    if len(message)/BYTES_PER_SECOND > pacing_balance: raise VoiceError("dubbing_backlog", "El audio llegó más rápido que su reproducción.")
                    pacing_balance -= len(message)/BYTES_PER_SECOND
                    if first_input_at is None: first_input_at=time.monotonic()
                    upstream.send(json.dumps({"message_type":"input_audio_chunk","audio_base_64":base64.b64encode(message).decode("ascii")}))
                    sent_bytes+=len(message)
                else:
                    control=json.loads(message)
                    if control=={"type":"cancel"}: break
                    if control=={"type":"finish"}: finish()
                    else: raise VoiceError("dubbing_control", "Control de doblaje no válido.")
        except ConnectionClosed: pass
        except Exception as exc:
            if isinstance(exc,VoiceError): error=exc
            elif isinstance(exc,InvalidStatus) and exc.response.status_code in {401,403}: error=VoiceError(*ERRORS["auth_error"])
            elif isinstance(exc,InvalidStatus) and exc.response.status_code==429: error=VoiceError(*ERRORS["rate_limited"])
            else: error=VoiceError("dubbing_connection", "No se pudo conectar ElevenLabs. Revisa acceso Enterprise, clave, voz y conexión.")
            try: self.send(browser,{"type":"error","code":error.code,"message":str(error)})
            except ConnectionClosed: pass
        finally:
            stopped.set()
            if upstream: upstream.close()
            browser.close()
            if reader: reader.join(timeout=1)
            with self.connections_lock:
                self.connections.discard(browser)
                if upstream: self.connections.discard(upstream)
            self.lock.release()
