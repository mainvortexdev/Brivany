"""One explicit, bounded paid trial through the local relay.

Private media/text is never stored. An explicit review option may retain only
output for one hardcoded synthetic fixture in separate local review artifacts.

Example (after configuring the provider):
  python -X utf8 -B -m tools.measure_dubbing own-sample.wav --allow-paid --target es

The WAV must be PCM16 mono 24 kHz and at most 20 seconds. Do not add this command
to tools.verify: unlike its simulated suites, this command can consume credits.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4
import wave

from websockets.sync.client import connect

from services.activity import ActivityStore, ROOT
from packages.providers.gemini_dubbing import GeminiEvents
from tools.pcm_observation import PCMObservation

INPUT_RATE = 24000
INPUT_BYTES_PER_SECOND = INPUT_RATE * 2
CHUNK_BYTES = INPUT_BYTES_PER_SECOND * 40 // 1000
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_TRIAL_SECONDS = 20
PROVIDER_PRICES = {("Palabra", "speech-to-speech"): 0.04,
                   ("OpenAI", "gpt-realtime-translate"): 0.034,
                   ("Meta modular", "muse-m2m100-melodi"): None,
                   ("Google Gemini", "gemini-3.5-live-translate-preview"): None}


class TrialError(ValueError):
    """Only static local messages/codes may enter the persisted report."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def local_origin(value):
    try: parsed = urlsplit(value)
    except ValueError:
        raise TrialError("invalid_origin", "Usa una dirección HTTP local válida.") from None
    try: port = parsed.port
    except ValueError: port = None
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.username is not None or parsed.password is not None
            or port is None or not 1024 <= port <= 65535
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise TrialError("invalid_origin", "Usa una dirección HTTP local con puerto explícito, sin rutas ni credenciales.")
    return f"http://{parsed.hostname}:{port}"


def relay_url(value):
    if not isinstance(value, str):
        raise TrialError("relay_unavailable", "El servidor local no tiene un relay de doblaje disponible.")
    try: parsed = urlsplit(value)
    except ValueError:
        raise TrialError("invalid_relay", "El relay local no tiene una dirección válida.") from None
    try: port = parsed.port
    except ValueError: port = None
    if (parsed.scheme != "ws" or parsed.hostname != "127.0.0.1" or port is None
            or not 1024 <= port <= 65535 or parsed.path != "/dub"
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment):
        raise TrialError("invalid_relay", "El estado no indica un relay WS loopback válido.")
    return f"ws://127.0.0.1:{port}/dub"


def read_status(origin, provider="palabra"):
    if provider not in {"palabra", "meta", "gemini", "openai"}: raise TrialError("unexpected_model", "Elige una ruta de prueba admitida.")
    request = Request(origin + "/api/dubbing/status?provider=" + provider, headers={"Origin": origin, "Accept": "application/json"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=5) as response:
            payload = response.read(65537)
        if len(payload) > 65536: raise ValueError("oversized")
        status = json.loads(payload)
        if not isinstance(status, dict): raise ValueError("shape")
    except Exception:
        raise TrialError("status_unavailable", "No se pudo consultar el estado local de doblaje.") from None
    if status.get("configured") is not True:
        raise TrialError("not_configured", "No hay proveedor configurado: no se abrió una sesión ni se intentó inferencia.")
    if status.get("available") is not True:
        raise TrialError("relay_unavailable", "El relay no está disponible: no se abrió una sesión ni se intentó inferencia.")
    expected={"palabra":"Palabra","meta":"Meta modular","gemini":"Google Gemini","openai":"OpenAI"}[provider]
    if status.get("provider") != expected:
        raise TrialError("unexpected_model", "El estado no coincide con el proveedor solicitado; no se abrió una sesión.")
    provider_price(status)
    return status, relay_url(status.get("websocket_url"))


def provider_price(status):
    if not isinstance(status.get("provider"), str) or not isinstance(status.get("model"), str):
        raise TrialError("unexpected_model", "El estado no identifica una ruta de proveedor válida.")
    identity = (status.get("provider"), status.get("model"))
    if identity not in PROVIDER_PRICES:
        raise TrialError("unexpected_model", "Este ensayo solo admite rutas previstas; no se abrió ninguna sesión.")
    return PROVIDER_PRICES[identity]


def read_wav(path):
    source = Path(path).resolve()
    if not source.is_file() or source.suffix.lower() != ".wav" or not 44 <= source.stat().st_size <= MAX_SOURCE_BYTES:
        raise TrialError("invalid_wav", "Selecciona un WAV PCM16 mono de 24 kHz y hasta 20 segundos.")
    content = source.read_bytes()
    if len(content) > MAX_SOURCE_BYTES:
        raise TrialError("invalid_wav", "El WAV supera el límite de tamaño.")
    import io
    try:
        with wave.open(io.BytesIO(content), "rb") as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            if (audio.getnchannels() != 1 or audio.getsampwidth() != 2 or rate != INPUT_RATE
                    or audio.getcomptype() != "NONE" or not 0 < frames / rate <= MAX_TRIAL_SECONDS):
                raise ValueError("format")
            pcm = audio.readframes(frames)
            if len(pcm) != frames * 2: raise ValueError("incomplete")
    except (OSError, EOFError, ValueError, wave.Error):
        raise TrialError("invalid_wav", "El WAV debe ser PCM16 mono de 24 kHz, completo y de hasta 20 segundos.") from None
    return pcm, {"filename": source.name, "sha256": hashlib.sha256(content).hexdigest(),
                 "size_bytes": len(content), "duration_seconds": frames / rate,
                 "sample_rate": rate, "channels": 1, "format": "pcm16"}


def output_path(value):
    directory = ROOT / "tmp" / "dubbing-measurements"
    path = Path(value).resolve() if value else directory / (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8] + ".json")
    try: path.resolve().relative_to((ROOT / "tmp").resolve())
    except ValueError:
        raise TrialError("invalid_output", "Guarda el informe JSON dentro de tmp/ del proyecto.") from None
    if path.suffix.lower() != ".json" or path.exists():
        raise TrialError("invalid_output", "El informe debe ser un archivo JSON nuevo.")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def message(raw):
    if not isinstance(raw, str) or len(raw) > 2 * 1024 * 1024:
        raise TrialError("relay_protocol", "El relay envió un evento inválido.")
    try: value = json.loads(raw)
    except ValueError:
        raise TrialError("relay_protocol", "El relay envió un evento inválido.") from None
    if not isinstance(value, dict): raise TrialError("relay_protocol", "El relay envió un evento inválido.")
    return value


def provider_error(event):
    code = event.get("code", "")
    safe = code if isinstance(code, str) and re.fullmatch(r"(?:dubbing|modular|mt|asr|tts)_[a-z_]{1,50}", code) else "relay_error"
    return TrialError(safe, "La sesión de prueba no se completó; consulta acceso, saldo y conexión.")


def safe_gemini_diagnostics(value):
    """Only documented counters, never arbitrary field names or provider values."""
    if not isinstance(value, dict): return None
    def counts(mapping, names):
        return {name: mapping[name] for name in names if isinstance(mapping, dict)
            and type(mapping.get(name)) is int and 0 <= mapping[name] <= 1000000}
    result = counts(value, ("events_received", "interaction_idle_signals", "inline_audio_parts",
        "unknown_top_fields", "unknown_server_content_fields", "input_audio_frames_sent", "audio_stream_end_messages_sent"))
    for group, names in (("top_fields", GeminiEvents.TOP_FIELDS), ("server_content_fields", GeminiEvents.CONTENT_FIELDS)):
        result[group] = counts(value.get(group), names)
    for group, names in (("boolean_signals", GeminiEvents.BOOLEAN_FIELDS), ("transcription_finished", GeminiEvents.TRANSCRIPT_FIELDS)):
        mapping = value.get(group)
        result[group] = {name: counts(mapping.get(name), ("true", "false", "invalid")) for name in names
            if isinstance(mapping, dict) and isinstance(mapping.get(name), dict)}
    if type(value.get("audio_stream_end_sent")) is bool: result["audio_stream_end_sent"] = value["audio_stream_end_sent"]
    return result


def run_trial(origin, endpoint, target, pcm, source, *, provider_status=None, source_language=None, synthetic_review=None, gemini_tail_silence=0, palabra_partials=False):
    status = provider_status or {"provider": "OpenAI", "model": "gpt-realtime-translate"}
    price = provider_price(status)
    is_palabra = status["provider"] == "Palabra"
    is_modular = status["provider"] == "Meta modular"
    is_gemini = status["provider"] == "Google Gemini"
    if type(palabra_partials) is not bool or palabra_partials and not is_palabra:
        raise TrialError("invalid_partial_mode", "La prueba de hipótesis parciales solo admite Palabra.")
    if type(gemini_tail_silence) is not int or gemini_tail_silence not in {0,2} or gemini_tail_silence and not is_gemini:
        raise TrialError("invalid_padding", "La prueba de silencio adicional solo admite Gemini y 0 o 2 segundos.")
    if is_palabra or is_modular or is_gemini:
        source_language = source_language or ("en" if target == "es" else "es")
        if source_language not in {"en", "es"} or source_language == target:
            raise TrialError("invalid_languages", "Elige idiomas de origen y destino distintos (inglés/español).")
        if is_modular and (source_language, target) != ("en", "es"):
            raise TrialError("invalid_languages", "La ruta modular inicial admite inglés a español.")
    started = datetime.now(timezone.utc)
    report = {"started_at": started.isoformat(), "status": "failed", "source": source,
              "target_language": target, "source_language": source_language if is_palabra or is_modular or is_gemini else None,
              "provider": status["provider"], "model": status["model"],
              "maximum_sessions": 1, "automatic_retries": 0, "input_chunk_ms": 40,
              "configured_trial_limit_seconds": max(5, math.ceil(source["duration_seconds"])),
              "input_bytes_sent": 0, "output_audio_chunks": 0, "output_audio_bytes": 0,
              "output_formats": [], "translated_text_characters": 0, "original_text_characters": 0,
              "max_audio_queue_estimate_ms": 0.0,
              "connect_ms": None, "first_input_audio_to_first_output_audio_ms": None,
              "first_output_relative_input_end_ms": None, "input_end_to_done_ms": None,
              "relay_first_output_audio_ms": None, "first_tts_chunk_generation_ms": None, "inference_ms": None,
              "mt_request_ms": [], "tts_first_audio_ms": [], "mt_requests_started": None, "tts_requests_started": None,
              "first_asr_partial_ms": None, "first_segment_ready_ms": None, "asr_received_input_ms": None,
              "segment_wait_ms": [], "segment_ready_to_first_audio_ms": [],
              "target_inference_ms": 500, "target_status": "unverified",
              "target_audible_delay_ms": 500, "audible_delay_verified": False, "physical_playback_measured": False,
              "palabra_translate_partials_requested": palabra_partials if is_palabra else None,
              "palabra_translate_partials_observed": None,
              "estimated_base_service_usd": round(source["duration_seconds"] / 60 * price, 6) if price is not None else None,
              "estimate_rate_usd_per_minute": price, "estimate_basis": "input_audio_duration_only" if price is not None else "unknown_modular_chain_cost",
              "actual_billed_usd": None, "external_calls": 0, "provider_ready": False, "provider_settings": None,
              "gpu_seconds": None, "audio_persisted": False, "transcripts_persisted": False,
              "provider_finalization_verified": None,
              "session_closed_locally": False, "local_close_method": None, "local_close_reason": None,
              "full_translation_verified": False,
              "provider_diagnostics": None,
              "experimental_tail_silence_seconds": gemini_tail_silence,
              "provider_input_bytes": None, "provider_input_sample_rate": None, "padding_input_bytes": None,
              "padding_input_seconds": None, "provider_real_input_bytes": None,
              "limitations": [f"La estimación usa ${price}/min y solo la duración del audio; no es una factura ni un máximo garantizado." if price is not None else "Coste de la cadena modular desconocido: no se inventa una tarifa por minuto ni un coste cero.",
                  "La primera salida medida incluye red y contexto; no es inferencia interna ni calidad oída.",
                  "El timing TTS opcional es generación hasta el primer chunk; no incluye ASR, traducción o red.",
                  "No se mide reproducción física ni sincronía semántica con el video.",
                  "external_calls cuenta una sesión solicitada al relay; no es telemetría de facturación del proveedor."]}
    if is_modular:
        report["limitations"].append("Tiempos MT/TTS de petición incluyen red y servicio; asr_received_input_ms es duración PCM enviada al recibir el primer parcial, no progreso de reconocimiento.")
    if is_gemini:
        report["estimate_basis"] = "published_input_and_output_audio_rates"
        report["estimate_input_rate_usd_per_minute"] = .0053
        report["estimate_output_rate_usd_per_minute"] = .0315
        report["limitations"][0] = "Estimación a tarifas publicadas de $0.0053/min entrada y $0.0315/min salida; no es factura ni aplica cuotas gratuitas o consumo declarado por Google."
        report["limitations"].append("Gemini usa un cierre local acotado; no confirma que el proveedor consumió toda la entrada o entregó toda su cola.")
    report["limitations"].append("La referencia de fin de entrada es el último PCM enviado, no el final acústico del habla; su diferencia con primer audio no es inferencia interna.")
    socket, reader = None, None
    stop, received_done = threading.Event(), threading.Event()
    first_input_at, first_output_at, input_finished_at, done_at = None, None, None, None
    failure = []
    formats = {}
    playback_until = 0.0
    pcm_observation = PCMObservation()
    connection_started = time.monotonic()
    try:
        socket = connect(endpoint, origin=origin, open_timeout=5, close_timeout=2,
                         max_size=2*1024*1024, max_queue=8, compression=None, proxy=None)
        options = {"type": "start", "consent": True, "target_language": target,
                   "max_seconds": report["configured_trial_limit_seconds"]}
        if is_palabra or is_modular or is_gemini or status["provider"] == "OpenAI": options["source_language"] = source_language
        if is_palabra: options["translate_partials"] = palabra_partials
        if is_gemini: options["tail_silence_seconds"] = gemini_tail_silence
        socket.send(json.dumps(options))
        report["external_calls"] = 1
        ready = message(socket.recv(timeout=30))
        if ready.get("type") == "error": raise provider_error(ready)
        if ready.get("type") != "ready" or ready.get("sample_rate") != INPUT_RATE:
            raise TrialError("relay_protocol", "El relay no confirmó una sesión compatible.")
        if ready.get("max_seconds") != report["configured_trial_limit_seconds"]:
            raise TrialError("relay_protocol", "El relay no confirmó el límite de duración solicitado.")
        if (("provider" in ready and ready["provider"] != status["provider"])
                or ("model" in ready and ready["model"] != status["model"])):
            raise TrialError("relay_protocol", "El proveedor confirmó una ruta distinta a la prevista.")
        report["provider_ready"] = True
        if is_palabra and type(ready.get("translate_partials_observed")) is bool:
            report["palabra_translate_partials_observed"] = ready["translate_partials_observed"]
        if is_palabra and isinstance(ready.get("provider_settings"), dict):
            settings = ready["provider_settings"]
            queue = settings.get("queue")
            # Keep only public language enums and numeric/bool queue fields. A
            # future server event must not make arbitrary metadata persistent.
            report["provider_settings"] = {"source_language": settings.get("source_language") if settings.get("source_language") in {"en", "es"} else None,
                "target_language": settings.get("target_language") if settings.get("target_language") in {"en", "es"} else None,
                "queue": {key: queue[key] for key in ("desired_queue_level_ms", "max_queue_level_ms", "auto_tempo", "min_tempo", "max_tempo")
                          if isinstance(queue, dict) and key in queue and type(queue[key]) in {int, float, bool} and math.isfinite(queue[key])} if isinstance(queue, dict) else None}
            observed = settings.get("observed_fields")
            if isinstance(observed, dict):
                report["provider_settings"]["observed_fields"] = {name: observed.get(name) is True for name in ("source_language", "target_language")}
                report["provider_settings"]["observed_fields"]["queue"] = {name: isinstance(observed.get("queue"), dict) and observed["queue"].get(name) is True for name in ("desired_queue_level_ms", "max_queue_level_ms", "auto_tempo", "min_tempo", "max_tempo")}
            path = settings.get("observed_path")
            report["provider_settings"]["observed_path"] = path if path in {"pipeline", "task.pipeline"} else None
            shape = settings.get("shape")
            def safe_keys(values):
                return [value for value in values if isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", value)][:24] if isinstance(values, list) else []
            if isinstance(shape, dict):
                report["provider_settings"]["shape"] = {"keys": safe_keys(shape.get("keys")), "objects": {
                    key: safe_keys(value) for key, value in list(shape.get("objects", {}).items())[:24]
                    if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key)} if isinstance(shape.get("objects"), dict) else {}}
            if settings.get("warning") == "metadata_unavailable": report["provider_settings"]["warning"] = "metadata_unavailable"
        report["connect_ms"] = round((time.monotonic() - connection_started) * 1000, 2)

        def receive():
            nonlocal playback_until, first_output_at, done_at
            try:
                while not stop.is_set():
                    try: event = message(socket.recv(timeout=.25))
                    except TimeoutError: continue
                    kind = event.get("type")
                    if kind == "error": raise provider_error(event)
                    if synthetic_review is not None and kind in {"audio", "transcript"}:
                        try: synthetic_review.collect(event)
                        except ValueError:
                            raise TrialError("synthetic_review_limit", "La revisión sintética recibió contenido fuera de sus límites.") from None
                    if kind == "done":
                        done_at = time.monotonic()
                        if event.get("session_closed_locally") is True: report["session_closed_locally"] = True
                        if type(event.get("finalization_verified")) is bool: report["provider_finalization_verified"] = event["finalization_verified"]
                        method, reason = event.get("completion_method"), event.get("completion_reason")
                        if method in {"bounded_post_input_drain", "bounded_local_drain"}: report["local_close_method"] = method
                        if reason in {"quiet_window", "drain_budget"}: report["local_close_reason"] = reason
                        received_done.set(); return
                    if kind == "audio":
                        rate, channels, encoding = event.get("sample_rate"), event.get("channels", 1), event.get("format", "pcm16")
                        if type(rate) is not int or not 8000 <= rate <= 96000 or type(channels) is not int or channels not in {1, 2} or encoding != "pcm16":
                            raise TrialError("relay_audio_format", "El formato de salida no es compatible con la medición.")
                        try: data = base64.b64decode(event.get("audio", ""), validate=True)
                        except (TypeError, ValueError, binascii.Error):
                            raise TrialError("relay_audio_format", "El bloque de salida no es PCM válido.") from None
                        if not data or len(data) % (channels * 2):
                            raise TrialError("relay_audio_format", "El bloque de salida está vacío o incompleto.")
                        arrived = time.monotonic()
                        if first_input_at is None:
                            raise TrialError("relay_protocol", "La salida llegó antes de enviar audio de entrada.")
                        try: pcm_observation.feed(data, rate, channels, (arrived-first_input_at)*1000)
                        except ValueError:
                            raise TrialError("relay_audio_format", "La salida PCM cambió de formato o excedió el límite de observación.") from None
                        if report["output_audio_chunks"] == 0:
                            generation = event.get("tts_chunk_generation_ms")
                            if type(generation) in {int, float} and math.isfinite(generation) and 0 <= generation <= 120000:
                                report["first_tts_chunk_generation_ms"] = generation
                        if report["first_input_audio_to_first_output_audio_ms"] is None and first_input_at is not None:
                            first_output_at = arrived
                            report["first_input_audio_to_first_output_audio_ms"] = round((first_output_at-first_input_at)*1000, 2)
                        report["output_audio_chunks"] += 1; report["output_audio_bytes"] += len(data)
                        playback_until = max(playback_until, arrived + .035) + len(data)/(rate*channels*2)
                        report["max_audio_queue_estimate_ms"] = round(max(report["max_audio_queue_estimate_ms"],
                            (playback_until-arrived)*1000), 2)
                        if report["output_audio_bytes"] > MAX_OUTPUT_BYTES:
                            raise TrialError("relay_output_limit", "La salida excedió el límite de la prueba.")
                        key = (rate, channels, encoding)
                        formats[key] = formats.get(key, 0) + len(data)
                    elif kind == "transcript":
                        text = event.get("text")
                        if not isinstance(text, str) or len(text) > 10000:
                            raise TrialError("relay_protocol", "El relay envió texto inválido.")
                        field = "original_text_characters" if event.get("source") == "original" else "translated_text_characters"
                        report[field] += len(text)
                        if report[field] > 100000: raise TrialError("relay_output_limit", "El texto excedió el límite de la prueba.")
                    elif kind == "metrics":
                        if is_gemini:
                            for name in ("provider_input_bytes", "provider_real_input_bytes", "padding_input_bytes"):
                                value=event.get(name)
                                if type(value) is int and 0<=value<=4000000: report[name]=value
                            if event.get("provider_input_sample_rate")==16000: report["provider_input_sample_rate"]=16000
                            value=event.get("padding_input_seconds")
                            if type(value) in {int,float} and math.isfinite(value) and 0<=value<=2: report["padding_input_seconds"]=value
                        if is_gemini and isinstance(event.get("provider_diagnostics"), dict):
                            report["provider_diagnostics"] = safe_gemini_diagnostics(event["provider_diagnostics"])
                        if type(event.get("finalization_verified")) is bool:
                            report["provider_finalization_verified"] = event["finalization_verified"]
                        observed = event.get("first_output_audio_ms")
                        if type(observed) in {int, float} and math.isfinite(observed) and observed >= 0:
                            report["relay_first_output_audio_ms"] = observed
                        # Only per-segment events add timing samples; final counters
                        # may repeat the last sample and must not duplicate it.
                        for name in ("mt_request_ms", "tts_first_audio_ms", "segment_wait_ms", "segment_ready_to_first_audio_ms"):
                            value = event.get(name)
                            if event.get("segment_id") and type(value) in {int, float} and math.isfinite(value) and 0 <= value <= 120000:
                                if len(report[name]) >= 100: raise TrialError("relay_output_limit", "Demasiadas métricas de segmento.")
                                report[name].append(value)
                        for name in ("first_asr_partial_ms", "first_segment_ready_ms", "asr_received_input_ms"):
                            value = event.get(name)
                            if type(value) in {int, float} and math.isfinite(value) and 0 <= value <= 120000:
                                report[name] = value
                        for name in ("mt_requests_started", "tts_requests_started"):
                            value = event.get(name)
                            if type(value) is int and 0 <= value <= 1000: report[name] = value
            except Exception as error:
                failure.append(error if isinstance(error, TrialError) else TrialError("relay_disconnected", "La conexión se cerró antes de completar la prueba."))
            finally:
                stop.set()

        reader = threading.Thread(target=receive, daemon=True); reader.start()
        first_input_at = time.monotonic()
        for offset in range(0, len(pcm), CHUNK_BYTES):
            wait = first_input_at + offset / INPUT_BYTES_PER_SECOND - time.monotonic()
            if wait > 0: stop.wait(wait)
            if stop.is_set(): break
            chunk = pcm[offset:offset+CHUNK_BYTES]
            socket.send(chunk); report["input_bytes_sent"] += len(chunk)
        if not stop.is_set():
            wait = first_input_at + len(pcm) / INPUT_BYTES_PER_SECOND - time.monotonic()
            if wait > 0: stop.wait(wait)
            if not stop.is_set():
                input_finished_at = time.monotonic()
                socket.send(json.dumps({"type": "finish"}))
        if not stop.wait(15+gemini_tail_silence):
            raise TrialError("relay_drain_timeout", "La salida no terminó dentro del límite de cierre.")
        if failure: raise failure[0]
        if not received_done.is_set() or report["output_audio_bytes"] == 0 or report["input_bytes_sent"] != len(pcm):
            raise TrialError("incomplete_trial", "La sesión terminó sin completar entrada y salida de audio.")
        report["status"] = "passed"
    except KeyboardInterrupt:
        report["error_code"] = "trial_interrupted"
    except Exception as error:
        report["error_code"] = error.code if isinstance(error, TrialError) else "trial_connection_failed"
    finally:
        stop.set()
        if socket is not None:
            try: socket.close()
            except Exception: pass
        if reader is not None: reader.join(timeout=3)
        report["pcm_observation"] = pcm_observation.flush()
        report["limitations"].append("RMS en ventanas de 20 ms observa energía PCM, no demuestra habla, inteligibilidad, naturalidad ni reproducción física. La llegada del primer bloque puede preceder a una señal con energía.")
        if input_finished_at is not None:
            if first_output_at is not None: report["first_output_relative_input_end_ms"] = round((first_output_at-input_finished_at)*1000, 2)
            if done_at is not None: report["input_end_to_done_ms"] = round((done_at-input_finished_at)*1000, 2)
        report["output_formats"] = [dict(sample_rate=rate, channels=channels, format=encoding,
            bytes=count, duration_seconds=round(count/(rate*channels*2), 3))
            for (rate, channels, encoding), count in sorted(formats.items())]
        if is_gemini:
            output_seconds = sum(count/(rate*channels*2) for (rate, channels, _), count in formats.items())
            actual_input_seconds=(report["provider_input_bytes"]/32000 if report["provider_input_sample_rate"]==16000 and report["provider_input_bytes"] is not None
                else report["input_bytes_sent"] / INPUT_BYTES_PER_SECOND)
            report["estimate_uses_provider_input_counter"]=report["provider_input_bytes"] is not None
            report["estimated_base_service_usd"] = round(
                actual_input_seconds / 60 * .0053 + output_seconds / 60 * .0315, 6)
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
    return report


def main():
    parser = argparse.ArgumentParser(description="Un ensayo real de doblaje, máximo 20 s; puede consumir créditos.")
    parser.add_argument("wav", help="Audio propio/autorizado, WAV PCM16 mono 24 kHz, hasta 20 s")
    parser.add_argument("--target", choices=["es", "en"], default="es")
    parser.add_argument("--provider", choices=["palabra", "meta", "gemini", "openai"], default="palabra")
    parser.add_argument("--source", choices=["en", "es"], help="Idioma original; por defecto el opuesto al destino. Meta modular admite EN→ES.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--output", help="JSON nuevo dentro de tmp/; por defecto genera un nombre único")
    parser.add_argument("--allow-paid", action="store_true", help="Confirma ejecutar una única sesión que puede consumir créditos")
    parser.add_argument("--review-synthetic", action="store_true", help="Solo fixture sintética fija: conservar voz y subtítulos de salida para revisión local")
    parser.add_argument("--gemini-tail-silence", type=int, choices=[0,2], default=0,
        help="Experimental: 2 s de silencio adicional al terminar; contabilizados aparte y potencialmente facturables")
    parser.add_argument("--palabra-partials", action="store_true", help="Experimental: traducir hipótesis parciales para comprobar si adelanta voz útil")
    args = parser.parse_args()
    if not args.allow_paid: parser.error("Añade --allow-paid para solicitar expresamente una única prueba real.")
    try:
        origin = local_origin(args.base_url)
        pcm, source = read_wav(args.wav)
        path = output_path(args.output)
        status, endpoint = read_status(origin, args.provider)
        source_language = args.source or ("en" if args.target == "es" else "es")
        review = None
        if args.review_synthetic:
            if (source_language, args.target) != ("en", "es"):
                raise TrialError("synthetic_review_direction", "La muestra de revisión fija usa inglés a español.")
            from tools.synthetic_dubbing_review import SyntheticReview
            try: review = SyntheticReview(args.wav)
            except ValueError:
                raise TrialError("synthetic_review_fixture", "La revisión solo admite la fixture sintética fija validada por SHA-256.") from None
            if source["sha256"] != review.source_metadata()["sha256"]:
                raise TrialError("synthetic_review_fixture", "La fixture cambió entre lecturas; no se abrió una sesión.")
        if status["provider"] == "Palabra" and source_language == args.target:
            raise TrialError("invalid_languages", "Elige idiomas de origen y destino distintos para Palabra.")
    except (TrialError, OSError) as error:
        parser.exit(2, (str(error) if isinstance(error, TrialError) else "No se pudo preparar la prueba local.") + "\n")
    report = run_trial(origin, endpoint, args.target, pcm, source, provider_status=status, source_language=source_language,
        synthetic_review=review,gemini_tail_silence=args.gemini_tail_silence,palabra_partials=args.palabra_partials)
    if review is not None:
        try:
            review_result = review.finish()
            report["synthetic_review"] = review_result
            report["audio_persisted"] = True
            report["transcripts_persisted"] = True
            report["limitations"].append("Revisión optativa de fixture sintética fija: voz y texto de salida conservados aparte en tmp/; no evaluación humana de calidad.")
        except (ValueError, OSError):
            report["synthetic_review"] = {"status": "unavailable"}
    with path.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2, ensure_ascii=False, allow_nan=False)
    ActivityStore().add({"kind": "test", "status": report["status"],
        "title": "Ensayo funcional de doblaje · objetivo 500 ms sin verificar",
        "summary": ("Una sesión real solicitada al relay; " + ("entrada enviada y voz de salida observada." if report["status"] == "passed" else "ensayo fallido; código " + report.get("error_code", "unknown") + ".")
            + " El informe conserva contadores y tiempos; la revisión optativa solo conserva una fixture sintética fija en archivos aparte, nunca audio privado. Cierre local e integralidad de la traducción se distinguen: un resultado funcional no demuestra flush del proveedor, 500 ms ni calidad audible."),
        "external_calls": report["external_calls"], "gpu_seconds": None}, [path])
    print(json.dumps({"status": report["status"], "report": path.relative_to(ROOT).as_posix(),
        "first_input_audio_to_first_output_audio_ms": report["first_input_audio_to_first_output_audio_ms"],
        "inference_ms": None, "target_audible_delay_ms":500,"audible_delay_verified":False,"target_status": "unverified"}, ensure_ascii=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__": raise SystemExit(main())
