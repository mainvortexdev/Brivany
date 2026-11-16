"""Muse ASR and Melodi Cartesia TTS. Credentials stay on the local server."""
from __future__ import annotations
from packages.providers.provider_access import endpoint, demo_headers

import json
import logging
import os
from pathlib import Path
import re
import threading
import time
import tomllib
import subprocess
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

MUSE_MODEL = "muse-voice-transcribe-1.0"
MUSE_URL = "wss://api.meta.ai/v1/asr/realtime"
MELODI_MODEL = "sonic-3.6-2026-08-27"
MELODI_SPEAKER = "3597a26f-80ef-4bd5-8101-9699bc764917"
PCM_TYPE = "audio/pcm; rate=24000; channels=1; format=s16le"


class VoiceError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def muse_key():
    return os.environ.get("BRIVANY_MUSE_API_KEY", "").strip() or os.environ.get("BRIVANY_META_API_KEY", "").strip()


def cloudflare_token(refresh=False):
    token = os.environ.get("BRIVANY_CLOUDFLARE_API_TOKEN", "").strip()
    if token:
        return token
    if os.environ.get("BRIVANY_CLOUDFLARE_USE_WRANGLER") == "true":
        # Read the existing local development login; never copy it into the project.
        path = Path.home() / "AppData/Roaming/xdg.config/.wrangler/config/default.toml"
        try:
            config = tomllib.loads(path.read_text(encoding="utf-8"))
            expiry = str(config.get("expiration_time", ""))
            expired = not expiry or datetime.fromisoformat(expiry.replace("Z", "+00:00")) <= datetime.now(timezone.utc)
            if refresh and expired:
                cli = Path(os.environ.get("APPDATA", "")) / "npm/node_modules/wrangler/bin/wrangler.js"
                if cli.is_file():
                    result = subprocess.run(["node", str(cli), "auth", "token", "--json"],
                                            capture_output=True, text=True, timeout=25,
                                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    if result.returncode == 0:
                        return str(json.loads(result.stdout).get("token", ""))
            return str(config.get("oauth_token", ""))
        except (OSError, ValueError, TypeError):
            pass
        except subprocess.TimeoutExpired:
            pass
    return ""


def voice_status():
    from packages.providers.cartesia_melodi import speech_status
    return {
        "asr": {"provider": "Meta", "model": MUSE_MODEL, "configured": bool(muse_key())},
        "tts": speech_status(),
        "reply": "meta-conversation" if os.environ.get("BRIVANY_META_API_KEY") and os.environ.get("BRIVANY_META_MODEL") else "local-coaching",
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def open_melodi(text,language='es',speed=1):
    """Return cancellable streamed PCM from the user's language-specific voice."""
    from packages.providers.cartesia_melodi import open_cartesia_speech
    return open_cartesia_speech(text,language,speed=speed)


def muse_handshake(options):
    if not isinstance(options, dict) or options.get("type") != "start" or options.get("consent") is not True:
        raise VoiceError("consent_required", "Activa el permiso para enviar audio a Muse.")
    mode = options.get("mode", "practice")
    if mode not in {"practice", "meeting", "english"} or options.get("language") not in {"es-ES", "en-US"}:
        raise VoiceError("invalid_session", "Revisa el modo y el idioma de escucha.")
    if mode == "meeting" and options.get("meetingConsent") is not True:
        raise VoiceError("meeting_consent", "Confirma el permiso de esta reunión antes de escuchar.")
    key = muse_key()
    if not key:
        raise VoiceError("asr_not_configured", "Añade BRIVANY_MUSE_API_KEY en .env y reinicia Brivany.")
    return {"authorization": {"accessToken": "Bearer " + key}, "audioEncoding": "PCM_24KHZ",
            "model": MUSE_MODEL, "mode": "DIARIZATION" if mode == "meeting" else "ENDPOINTING",
            "partialMode": "CUMULATIVE", "emitAudioProgress": False,
            "languageBias": ["Spanish", "English"] if mode == "english" else
                            ["English" if options["language"] == "en-US" else "Spanish"],
            "keywords": ["Brivany", "Melodi"]}


class MuseEvents:
    """Cumulative partials and asynchronous finals are correlated by turnId."""
    def __init__(self):
        self.active = None
        self.turns = {}
        self.done = set()
        self.speaker_turn = None

    def accept(self, event):
        kind = event.get("type")
        if kind == "error":
            raise VoiceError("asr_rejected", "Muse interrumpió la transcripción. Revisa acceso, cuota y conexión.")
        if kind == "speechStart":
            self.active = str(event.get("turnId"))
            self.turns[self.active] = {"at": max(0, event.get("audioProcessedMs", 0)) / 1000}
            if len(self.turns) > 100:
                self.turns.pop(next(iter(self.turns)))
            return {"type": "speech-start", "id": self.active}
        if kind == "speaker":
            self.speaker_turn = None
            label = event.get("label", "")
            if not isinstance(label,str) or not re.fullmatch(r"[A-Z]",label):return None
            turn = str(event['turnId']) if event.get('turnId') is not None else self.active
            at = event.get('audioProcessedMs')
            timed = type(at) in (int, float) and 0 <= at < float('inf')
            if event.get('turnId') is None and timed:
                # A speaker label covers the span immediately before it, even
                # when another turn has opened before the event reaches us.
                turn = max((identifier for identifier in reversed(self.turns) if self.turns[identifier]['at'] < at / 1000),
                    key=lambda identifier: self.turns[identifier]['at'], default=None)
            row = self.turns.get(turn)
            if row is not None and (not timed or at >= row.get('speaker_at', -1)):
                row['speaker'] = label
                if timed:row['speaker_at'] = at
                self.speaker_turn = turn
        if kind not in {"transcript", "speechComplete"}:
            return None
        final = kind == "speechComplete"
        turn = str(event.get("turnId")) if final else self.active
        # ENDPOINTING/DIARIZATION finalize only on speechComplete, never partial.final.
        if turn is None or (final and turn in self.done):
            return None
        text = event.get("transcript", "")
        if not isinstance(text, str):
            return None
        metadata = self.turns.get(turn, {})
        if final:
            self.done.add(turn)
            if len(self.done) > 500:
                self.done.clear()
                self.done.add(turn)
        return {"type": "transcript", "id": turn, "text": text[:10000], "final": final,
                "at": metadata.get("at", 0), "speaker": metadata.get("speaker"), "source": "muse_transcription"}


class MusePace:
    """Bound real-time input; allow only a small replay after actual silence."""
    def __init__(self,barge_in=False):
        self.barge_in=barge_in;self.sent=0;self.credit=0;self.silent=0

    def audio(self,data,elapsed):
        self.sent+=len(data)
        self.silent=min(4,self.silent+1) if len(data)==3840 and not any(data) else 0
        if (self.sent-self.credit)/48000>elapsed+2:
            raise VoiceError('audio_backlog','El audio llegó demasiado rápido. Reinicia la escucha.')

    def resume(self,control):
        frames=control.get('replay_frames')
        if not self.barge_in or set(control)!={'type','replay_frames'} or type(frames) is not int or not 1<=frames<=min(4,self.silent):
            raise VoiceError('invalid_control','Reanudación de voz no válida.')
        self.credit+=frames*3840;self.silent=0


class MuseBridge:
    """Loopback WebSocket relay. One session; bounded buffers; no audio persistence."""
    def __init__(self, http_port, port=0):
        self.http_port = http_port
        self.port = port
        self.lock = threading.Lock()
        self.server = None

    def start(self):
        from websockets.sync.server import serve
        origins = [f"http://{host}:{self.http_port}" for host in ("127.0.0.1", "localhost")]
        logger = logging.getLogger("brivany.voice.websocket")
        logger.handlers = [logging.NullHandler()]; logger.propagate = False
        self.server = serve(self.handle, "127.0.0.1", self.port, origins=origins, logger=logger,
                            process_request=self.check_request, max_size=16384, max_queue=8,
                            compression=None, close_timeout=2)
        self.port = self.server.socket.getsockname()[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def check_request(self, connection, request):
        if request.path != "/live" or request.headers.get("Host") not in {
                f"localhost:{self.port}", f"127.0.0.1:{self.port}"}:
            return connection.respond(403, "Dirección local requerida.")

    def close(self):
        if self.server:
            self.server.shutdown()

    def handle(self, browser):
        from websockets.sync.client import connect
        from websockets.exceptions import ConnectionClosed
        if not self.lock.acquire(blocking=False):
            browser.send(json.dumps({"type": "error", "code": "asr_busy", "message": "Ya hay una escucha activa. Termínala primero."}))
            return
        upstream = None
        try:
            first = browser.recv(timeout=8)
            if not isinstance(first, str):
                raise VoiceError("invalid_session", "Falta la configuración de la sesión.")
            options=json.loads(first)
            handshake = muse_handshake(options)
            pace=MusePace(options.get('bargeIn') is True and options.get('mode')!='meeting')
            upstream = connect(endpoint(MUSE_URL), additional_headers=demo_headers(), open_timeout=15, close_timeout=2,
                               max_size=65536, max_queue=8, compression=None, proxy=None)
            upstream.send(json.dumps(handshake))
            ack = json.loads(upstream.recv(timeout=15))
            if not isinstance(ack.get("sessionId"), str):
                raise VoiceError("asr_rejected", "Muse no aceptó la sesión. Revisa la clave y el acceso al modelo.")
            browser.send(json.dumps({"type": "ready", "model": MUSE_MODEL}))
            events = MuseEvents()
            finished = threading.Event()

            def receive():
                try:
                    for raw in upstream:
                        if not isinstance(raw, str):
                            continue
                        normalized = events.accept(json.loads(raw))
                        if normalized:
                            browser.send(json.dumps(normalized, ensure_ascii=False))
                except VoiceError as exc:
                    try:
                        browser.send(json.dumps({"type": "error", "code": exc.code, "message": str(exc)}))
                    except ConnectionClosed:
                        pass
                except Exception:
                    try:
                        browser.send(json.dumps({"type": "error", "code": "asr_connection", "message": "La conexión con Muse se interrumpió. Reinicia la escucha."}))
                    except ConnectionClosed:
                        pass
                finally:
                    finished.set()
                    browser.close()

            reader = threading.Thread(target=receive, daemon=True)
            reader.start()
            start = time.monotonic()
            while not finished.is_set():
                message = browser.recv(timeout=12)
                if time.monotonic() - start > 55 * 60:
                    raise VoiceError("session_limit", "La sesión llegó a 55 minutos. Inicia una nueva escucha.")
                if isinstance(message, bytes):
                    if not message or len(message) > 7680 or len(message) % 2:
                        raise VoiceError("invalid_audio", "Formato de audio inválido.")
                    pace.audio(message,time.monotonic()-start)
                    upstream.send(message)
                else:
                    control=json.loads(message)
                    if control=={'type':'endStream'}:
                        upstream.send(message);finished.wait(8);break
                    if isinstance(control,dict) and control.get('type')=='resumeSpeech':pace.resume(control)
                    else:raise VoiceError("invalid_control", "Control de voz no válido.")
        except ConnectionClosed:
            pass
        except Exception as exc:
            error = exc if isinstance(exc, VoiceError) else VoiceError("asr_connection", "No se pudo iniciar Muse. Revisa la clave, la conexión y el acceso al modelo.")
            try:
                browser.send(json.dumps({"type": "error", "code": error.code, "message": str(error)}))
            except ConnectionClosed:
                pass
        finally:
            if upstream:
                upstream.close()
            self.lock.release()
