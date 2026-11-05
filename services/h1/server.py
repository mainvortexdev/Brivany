"""Servidor local: práctica, Muse en directo y voz Melodi, sin guardar audio."""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import socket
import select
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs

from pydantic import ValidationError

from packages.providers.meta import MetaProviderError, propose_guidance, provider_status
from packages.providers.live_voice import MuseBridge, VoiceError, PCM_TYPE, open_melodi, voice_status
from packages.providers.conversation import ConversationRequest, stream_reply
from services.h1.practice import PracticeRequest, SKILL_ID, SKILL_TITLE, inspect_practice, meta_context
from services.h1.human_skills import HumanSkillService, SkillServiceError, MAX_VIDEO_BYTES
from services.activity import ActivityStore, ActivityError
from packages.providers.palabra import PalabraBridge as TranslationBridge, dubbing_status
from packages.providers.eleven_dubbing import ElevenBridge, dubbing_status as eleven_status
from packages.providers.modular_dubbing import ModularBridge, modular_status
from packages.providers.river_translation import RiverBridge, river_status
from packages.providers.gemini_dubbing import GeminiBridge, gemini_status
from packages.providers.dubbing import TranslationBridge as OpenAITranslationBridge, dubbing_status as openai_translation_status
from services.spatial.media_access import MediaAccess

ROOT = Path(__file__).resolve().parents[2]
MAX_BODY_BYTES = 65536
MAX_REJECT_DRAIN_BYTES = 128 * 1024
REJECT_DRAIN_SECONDS = .2
META_LOCK = threading.Lock()
VOICE_LOCK = threading.Lock()
CONFIG_LOCK = threading.Lock()
CHAT_LOCK = threading.Lock()
HUMAN_SERVICE_LOCK = threading.Lock()
SPATIAL_SERVICE_LOCK = threading.Lock()
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/app": ("studio.html", "text/html; charset=utf-8"),
          "/app/": ("studio.html", "text/html; charset=utf-8"),
          "/practice": ("practice.html", "text/html; charset=utf-8"),
          "/human-skills": ("human-skills.html", "text/html; charset=utf-8"),
          "/human-skills/": ("human-skills.html", "text/html; charset=utf-8"),
          "/activity": ("activity.html", "text/html; charset=utf-8"),
          "/activity/": ("activity.html", "text/html; charset=utf-8"),
          "/dubbing": ("translate.html", "text/html; charset=utf-8"),
          "/dubbing/": ("translate.html", "text/html; charset=utf-8"),
          "/spaces": ("spaces.html", "text/html; charset=utf-8"),
          "/spaces/": ("spaces.html", "text/html; charset=utf-8"),
          "/viewer": ("spaces.html", "text/html; charset=utf-8"),
          "/sous": ("sous.html", "text/html; charset=utf-8"),
          "/styles.css": ("styles.css", "text/css; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8")}
for filename in ("studio.js", "context-engine.js", "voice-engine.js", "live-voice.js", "pcm-capture.js", "human-skills.js", "activity.js", "dubbing.js", "dub-capture.js", "dub-timing.js", "sw.js", "spaces.js", "spatial-viewer.js", "capture-review.js", "spatial-camera.js", "spatial-render.js", "spatial-physics.js", "desktop-client.js"):
    STATIC["/" + filename] = (filename, "text/javascript; charset=utf-8")
for filename in ("studio.css", "landing.css", "palette.css", "human-skills.css", "activity.css", "dubbing.css", "spaces.css"):
    STATIC["/" + filename] = (filename, "text/css; charset=utf-8")
STATIC['/spatial-preview.png']=('spatial-preview.png','image/png')
STATIC['/vendor/rapier/rapier.mjs']=('vendor/rapier/rapier.mjs','text/javascript; charset=utf-8')
STATIC['/sous.js']=('sous.js','text/javascript; charset=utf-8')
STATIC['/sous-voice.js']=('sous-voice.js','text/javascript; charset=utf-8')
STATIC['/floorplan.js']=('floorplan.js','text/javascript; charset=utf-8')
STATIC['/connections']=('connections.html','text/html; charset=utf-8')
STATIC['/connections.js']=('connections.js','text/javascript; charset=utf-8')
STATIC['/connections.css']=('connections.css','text/css; charset=utf-8')
STATIC['/typography.css']=('typography.css','text/css; charset=utf-8')
STATIC['/brand-wordmark.svg']=('brand-wordmark.svg','image/svg+xml')
STATIC['/reminders.js']=('reminders.js','text/javascript; charset=utf-8')
STATIC['/reconstruction-results.js']=('reconstruction-results.js','text/javascript; charset=utf-8')
STATIC['/room-view.js']=('room-view.js','text/javascript; charset=utf-8')
STATIC['/spatial-load.js']=('spatial-load.js','text/javascript; charset=utf-8')
STATIC['/youtube-source.js']=('youtube-source.js','text/javascript; charset=utf-8')
STATIC['/translate']=('translate.html','text/html; charset=utf-8')
STATIC['/translate/']=('translate.html','text/html; charset=utf-8')
STATIC['/translate.js']=('translate.js','text/javascript; charset=utf-8')
STATIC['/translate.css']=('translate.css','text/css; charset=utf-8')
STATIC['/video-file-source.js']=('video-file-source.js','text/javascript; charset=utf-8')
STATIC['/dub-tab-capture.js']=('dub-tab-capture.js','text/javascript; charset=utf-8')
STATIC['/social.js']=('social.js','text/javascript; charset=utf-8')
STATIC['/chat-requests.js']=('chat-requests.js','text/javascript; charset=utf-8')
STATIC['/spatial-presentation.js']=('spatial-presentation.js','text/javascript; charset=utf-8')
STATIC['/spatial-presentation.css']=('spatial-presentation.css','text/css; charset=utf-8')
STATIC['/spatial-assistant.js']=('spatial-assistant.js','text/javascript; charset=utf-8')
STATIC['/sous.css']=('sous.css','text/css; charset=utf-8')
for filename in ('postprocessing/EffectComposer.js','postprocessing/RenderPass.js','postprocessing/SSAOPass.js','postprocessing/OutputPass.js','postprocessing/ShaderPass.js','postprocessing/MaskPass.js','postprocessing/Pass.js','shaders/CopyShader.js','shaders/SSAOShader.js','shaders/OutputShader.js','math/SimplexNoise.js'):
    STATIC['/vendor/three/addons/'+filename]=('vendor/three/addons/'+filename,'text/javascript; charset=utf-8')
STATIC.update({"/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
               "/icon.svg": ("icon.svg", "image/svg+xml"),
               "/icon-192.png": ("icon-192.png", "image/png"),
               "/icon-512.png": ("icon-512.png", "image/png")})
for filename in ("three.module.js", "three.core.js", "addons/controls/OrbitControls.js", "addons/controls/TransformControls.js",
                 "addons/loaders/GLTFLoader.js", "addons/utils/BufferGeometryUtils.js"):
    STATIC['/vendor/three/'+filename]=('vendor/three/'+filename,'text/javascript; charset=utf-8')


def load_local_config(path: Path = ROOT / ".env") -> None:
    """Lee solo claves conocidas; no ejecuta expansión ni reemplaza el entorno."""
    allowed = {"BRIVANY_META_API_KEY", "BRIVANY_META_MODEL", "BRIVANY_META_BASE_URL", "BRIVANY_META_AUDIO_MODEL",
               "BRIVANY_MUSE_API_KEY", "BRIVANY_GROQ_API_KEY", "BRIVANY_CARTESIA_API_KEY", "BRIVANY_CLOUDFLARE_ACCOUNT_ID", "BRIVANY_CLOUDFLARE_API_TOKEN",
               "BRIVANY_CLOUDFLARE_USE_WRANGLER", "BRIVANY_HUMAN_SKILLS_MODEL", "BRIVANY_SOUS_MODEL", "BRIVANY_OPENAI_API_KEY", "BRIVANY_PALABRA_API_KEY",
               "BRIVANY_ELEVENLABS_API_KEY", "BRIVANY_ELEVENLABS_VOICE_ID", "BRIVANY_GEMINI_API_KEY",
               "BRIVANY_GOOGLE_CLIENT_ID", "BRIVANY_GOOGLE_CLIENT_SECRET", "BRIVANY_WHATSAPP_ACCESS_TOKEN",
               "BRIVANY_META_APP_SECRET", "BRIVANY_WHATSAPP_VERIFY_TOKEN",
               "BRIVANY_META_SOCIAL_USER_TOKEN", "BRIVANY_FACEBOOK_PAGE_TOKEN",
               "BRIVANY_INSTAGRAM_ACCESS_TOKEN", "BRIVANY_META_ADS_ACCESS_TOKEN"}
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key in allowed and value:
            os.environ.setdefault(key, value)


def save_meta_key(key, path=None):
    save_local_secret(key, "BRIVANY_META_API_KEY", path)


def save_dubbing_key(key, path=None):
    save_local_secret(key, "BRIVANY_PALABRA_API_KEY", path)


def save_eleven_key(key, path=None):
    save_local_secret(key, "BRIVANY_ELEVENLABS_API_KEY", path)


def save_gemini_key(key, path=None):
    save_local_secret(key, "BRIVANY_GEMINI_API_KEY", path)


def save_openai_key(key, path=None):
    save_local_secret(key, "BRIVANY_OPENAI_API_KEY", path)


def save_local_secret(key, variable, path=None):
    """Persist one credential locally without returning, logging, or interpolating it."""
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=|:\-]{20,2048}", key):
        raise ValueError("invalid_key")
    path = path or ROOT / ".env"
    with CONFIG_LOCK:
        text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
        lines = [line for line in text.splitlines() if line.split("=", 1)[0].strip() != variable]
        lines.append(variable + "=" + key)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             prefix=".env.", suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                output.write("\n".join(lines) + "\n")
            os.replace(temporary, path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        os.environ[variable] = key


class Handler(BaseHTTPRequestHandler):
    server_version = "BrivanyH1"

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_args):
        # No registra transcripciones, URLs, errores del proveedor ni credenciales.
        pass

    def send_headers(self, status, content_type, length=None, chunked=False, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        if chunked:
            self.send_header("Transfer-Encoding", "chunked")
        if filename is not None:
            if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,160}',filename):raise ValueError('Invalid attachment name')
            self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self)")
        bridge = getattr(self.server, "voice_bridge", None)
        websocket = f" ws://127.0.0.1:{bridge.port}" if bridge else ""
        dubbing = getattr(self.server, "translation_bridge", None)
        if dubbing: websocket += f" ws://127.0.0.1:{dubbing.port}"
        eleven = getattr(self.server, "eleven_bridge", None)
        if eleven: websocket += f" ws://127.0.0.1:{eleven.port}"
        modular = getattr(self.server, "modular_bridge", None)
        if modular: websocket += f" ws://127.0.0.1:{modular.port}"
        river = getattr(self.server, "river_bridge", None)
        if river: websocket += f" ws://127.0.0.1:{river.port}"
        gemini = getattr(self.server, "gemini_bridge", None)
        if gemini: websocket += f" ws://127.0.0.1:{gemini.port}"
        openai = getattr(self.server, "openai_translation_bridge", None)
        if openai: websocket += f" ws://127.0.0.1:{openai.port}"
        spatial_page=urlsplit(self.path).path in {'/spaces','/spaces/','/viewer'}
        youtube_page=urlsplit(self.path).path.rstrip('/') in {'/dubbing','/translate'}
        wasm=" 'wasm-unsafe-eval'" if spatial_page else ''
        embedded=" blob:" if spatial_page else ''
        youtube_scripts=' https://www.youtube.com' if youtube_page else ''
        youtube_frames='; frame-src https://www.youtube.com' if youtube_page else "; frame-src 'none'"
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'"+wasm+youtube_scripts+"; style-src 'self'; img-src 'self' data:"+embedded+"; media-src 'self' blob:; connect-src 'self'"+embedded + websocket + youtube_frames+"; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()

    def send_bytes(self, status, payload: bytes, content_type: str):
        self.send_headers(status, content_type, len(payload))
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def send_json(self, status, data):
        self.send_bytes(status, json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8"), "application/json; charset=utf-8")

    def error(self, status, code, message):
        self.send_json(status, {"error": {"code": code, "message": message}})

    def reject_before_body(self, status, code, message):
        """Send a rejection immediately, then boundedly drain a known raw body.

        Closing while a client's separate body packet is arriving can reset a
        Windows TCP connection before the client reads our rejection. Draining
        is never used after a handler has started reading/parsing its body, and
        never decodes chunked or malformed framing. No body bytes are retained.
        """
        self.close_connection = True
        try:
            self.error(status, code, message)
            self.wfile.flush()
        except (OSError, ValueError):
            return
        if self.headers.get("Transfer-Encoding") is not None:
            return
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
            return
        remaining = min(int(lengths[0]), MAX_REJECT_DRAIN_BYTES)
        if not remaining:
            return
        previous_timeout = self.connection.gettimeout()
        deadline = time.monotonic() + REJECT_DRAIN_SECONDS
        try:
            while remaining:
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                self.connection.settimeout(left)
                chunk = self.rfile.read1(min(remaining, 8192))
                if not chunk:
                    break
                remaining -= len(chunk)
        except (OSError, ValueError):
            pass
        finally:
            try:
                self.connection.settimeout(previous_timeout)
            except OSError:
                pass

    def local_request(self):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            self.reject_before_body(403, "invalid_host", "Este prototipo solo acepta su dirección local.")
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{host}" for host in hosts}:
            self.reject_before_body(403, "invalid_origin", "Abre la práctica desde su dirección local.")
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        route = urlsplit(self.path).path
        if route.startswith('/api/personal/'):
            from services.personal_http import get
            get(self,route);return
        if route.startswith('/api/integrations/'):
            from services.connections_http import get
            get(self,route);return
        if route.startswith('/api/sous/'):
            self.sous_get(route);return
        if route.startswith('/api/spatial/'):
            if route.startswith('/api/spatial/assistant/'):
                from services.spatial.assistant_http import get
                get(self,route);return
            self.spatial_get(route)
        elif route == "/api/activity" or route.startswith("/api/activity/"):
            self.activity_get(route)
        elif route == "/api/translation/status" or (route == "/api/dubbing/status" and parse_qs(urlsplit(self.path).query).get('provider',['river'])[0] == 'river'):
            status = river_status()
            bridge = getattr(self.server, 'river_bridge', None)
            status['websocket_url'] = f'ws://127.0.0.1:{bridge.port}/dub' if bridge else None
            lock=getattr(bridge,'lock',None)
            status['busy']=bool(lock and lock.locked())
            status['available'] = bool(bridge and not status['busy'] and status['configured'] and not status['access_blocked'] and status['native_output']['available'])
            self.send_json(200,status)
        elif route == "/api/dubbing/status":
            provider = parse_qs(urlsplit(self.path).query).get("provider", ["palabra"])[0]
            if provider not in {"palabra", "elevenlabs", "meta", "gemini", "openai"}:
                self.error(422, "dubbing_provider", "Elige un proveedor de doblaje disponible.")
                return
            status_function, bridge_name = {
                "palabra": (dubbing_status, "translation_bridge"),
                "elevenlabs": (eleven_status, "eleven_bridge"),
                "meta": (modular_status, "modular_bridge"),
                "gemini": (gemini_status, "gemini_bridge"),
                "openai": (openai_translation_status, "openai_translation_bridge"),
            }[provider]
            status = status_function()
            status["target_audible_delay_ms"] = 500
            status["audible_delay_verified"] = False
            status["physical_playback_measured"] = False
            bridge = getattr(self.server, bridge_name, None)
            status["websocket_url"] = f"ws://127.0.0.1:{bridge.port}/dub" if bridge else None
            status["available"] = status["configured"] and bridge is not None and (provider != "elevenlabs" or status["voice_configured"])
            self.send_json(200, status)
        elif route == "/api/human-skills" or route.startswith("/api/human-skills/"):
            try:
                service = self.human_skill_service()
                parts = route.removeprefix("/api/human-skills").strip("/").split("/")
                if parts == [""]: self.send_json(200, service.library())
                elif len(parts) == 2 and parts[0] == "jobs": self.send_json(200, {"job": service.job(parts[1])})
                elif len(parts) == 1: self.send_json(200, {"skill": service.get(parts[0])})
                else: self.error(404, "not_found", "Recurso no disponible.")
            except SkillServiceError as exc: self.error(exc.status, exc.code, str(exc))
        elif route == "/api/status":
            live = voice_status()
            bridge = getattr(self.server, "voice_bridge", None)
            live["websocket_url"] = f"ws://127.0.0.1:{bridge.port}/live" if bridge else None
            live["asr"]["available"] = live["asr"]["configured"] and bridge is not None
            self.send_json(200, {"provider": provider_status(),
                                 "skill": {"title": SKILL_TITLE, "id": SKILL_ID, "status": "draft"},
                                 "media_policy": "explicit-live-provider-consent", "voice": live})
        elif route in STATIC:
            name, content_type = STATIC[route]
            self.send_bytes(200, (ROOT / "web" / name).read_bytes(), content_type)
        else:
            self.error(404, "not_found", "Recurso no disponible.")

    def activity_get(self, route):
        try:
            store = getattr(self.server, "activity_store", None) or ActivityStore()
            if route == "/api/activity":
                query = parse_qs(urlsplit(self.path).query)
                before = int(query["before"][0]) if "before" in query else None
                if before is not None and before <= 0: raise ActivityError("Página inválida.")
                self.send_json(200, store.listing(before=before))
                return
            match = re.fullmatch(r"/api/activity/([0-9a-f-]{36})/evidence/([0-7])", route)
            if not match: raise ActivityError("Recurso no disponible.")
            data, item = store.read_evidence(match[1], int(match[2]))
            content_type = "image/png" if item["label"].endswith(".png") else "text/plain; charset=utf-8"
            self.send_bytes(200, data, content_type)
        except (ActivityError, ValueError):
            self.error(404, "activity_unavailable", "Registro o evidencia no disponible; comprueba su integridad.")
        except (OSError, sqlite3.Error):
            self.error(503, "activity_storage", "No se pudo leer la bitácora local.")

    def do_POST(self):
        if not self.local_request():
            return
        route = urlsplit(self.path).path
        if route.startswith('/api/personal/'):
            from services.personal_http import post
            post(self,route);return
        if route.startswith('/api/integrations/'):
            from services.connections_http import post
            post(self,route);return
        if route.startswith('/api/sous/'):
            self.sous_post(route);return
        if route.startswith('/api/spatial/'):
            if route.startswith('/api/spatial/assistant/'):
                from services.spatial.assistant_http import post
                post(self,route,CHAT_LOCK);return
            self.spatial_post(route)
            return
        if route.startswith("/api/human-skills/"):
            self.human_skill_post(route)
            return
        if route not in {"/api/practice", "/api/voice/speech", "/api/voice/turn", "/api/config/meta", "/api/config/dubbing"}:
            self.reject_before_body(404, "not_found", "Recurso no disponible.")
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self.reject_before_body(415, "json_required", "Envía una transcripción como JSON; no se aceptan archivos.")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_BODY_BYTES or self.headers.get("Transfer-Encoding"):
            self.reject_before_body(413, "body_limit", "La solicitud está vacía o supera el límite de 64 KiB.")
            return
        if route == "/api/voice/speech":
            self.speech(length)
            return
        if route == "/api/voice/turn":
            self.conversation(length)
            return
        if route in {"/api/config/meta", "/api/config/dubbing"}:
            if not self.headers.get("Origin") or length > 4096:
                self.reject_before_body(403, "local_form_required", "Usa el formulario local de Brivany.")
                return
            try:
                body = json.loads(self.rfile.read(length))
                expected = {"key", "provider"} if route == "/api/config/dubbing" else {"key"}
                if not isinstance(body, dict) or set(body) != expected:
                    raise ValueError("invalid_key")
                if route == "/api/config/dubbing" and body["provider"] not in {"palabra", "elevenlabs", "gemini", "openai"}:
                    raise ValueError("invalid_key")
                if route == "/api/config/meta": save_meta_key(body["key"])
                elif body["provider"] == "palabra": save_dubbing_key(body["key"])
                elif body["provider"] == "gemini": save_gemini_key(body["key"])
                elif body["provider"] == "openai": save_openai_key(body["key"])
                else: save_eleven_key(body["key"])
            except (ValueError, TypeError):
                self.error(422, "invalid_key", "Revisa la clave: pégala completa, sin espacios ni saltos de línea.")
                return
            except OSError:
                self.error(500, "config_write_failed", "No se pudo guardar la configuración local.")
                return
            self.send_json(200, {"saved": True})
            return
        try:
            request = PracticeRequest.model_validate_json(self.rfile.read(length))
        except (ValidationError, ValueError):
            self.error(422, "invalid_practice", "Revisa la transcripción (máximo 12 000 caracteres), duración (hasta 600 s), procedencia y consentimiento para Meta.")
            return
        result = inspect_practice(request)
        if request.use_meta:
            if not META_LOCK.acquire(blocking=False):
                self.error(409, "meta_busy", "Hay una consulta a Meta en curso. Espera a que termine.")
                return
            try:
                response = propose_guidance(meta_context(request, result))
                result["mode"] = "meta"
                result["guidance"] = response["guidance"]
                result["meta"] = {key: response.get(key) for key in ("provider", "model", "latency_ms", "usage")}
                # Las sugerencias del modelo nunca cambian los veredictos deterministas.
            except MetaProviderError as exc:
                self.error(502, exc.code, str(exc))
                return
            finally:
                META_LOCK.release()
        self.send_json(200, result)

    def sous_service(self):
        from services.sous import SousService
        with HUMAN_SERVICE_LOCK:
            if not hasattr(self.server,'sous'):self.server.sous=SousService(ROOT/'.local'/'sous')
            return self.server.sous

    def sous_get(self,route):
        from services.sous import SousError
        try:
            if route=='/api/sous/voice/status':
                from services.sous_voice import serve_status
                serve_status(self);return
            service=self.sous_service()
            if route=='/api/sous/vision/status':self.send_json(200,self.sous_vision_service().readiness());return
            if route=='/api/sous/inventory':self.send_json(200,service.inventory());return
            if route=='/api/sous/catalog':self.send_json(200,service.catalog());return
            if route=='/api/sous/preferences':self.send_json(200,{'preferences':service.preferences()});return
            if route=='/api/sous/shopping':self.send_json(200,{'shopping':service.shopping_list()});return
            match=re.fullmatch('/api/sous/sessions/([0-9a-f-]{36})',route)
            if match:self.send_json(200,service.get_session(match[1]));return
            self.error(404,'sous_not_found','Recurso de Sous no disponible.')
        except SousError as exc:self.error(exc.status,exc.code,str(exc))
        except (OSError,sqlite3.Error,ValueError):self.error(503,'sous_storage','No se pudo leer el almacenamiento de Sous.')

    def sous_post(self,route):
        from services.sous import SousError
        if route=='/api/sous/voice/turn':
            from services.sous_voice import serve_turn
            serve_turn(self,CHAT_LOCK);return
        if route.startswith('/api/sous/vision/'):
            self.sous_vision_post(route);return
        if not self.headers.get('Origin'):
            self.reject_before_body(403,'local_form_required','Usa Sous desde Brivany local.');return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:length=0
        if not 0<length<=16384 or self.headers.get('Transfer-Encoding'):
            self.reject_before_body(413,'sous_body_limit','La solicitud supera el límite.');return
        if self.headers.get('Content-Type','').split(';')[0].strip()!='application/json':
            self.reject_before_body(415,'json_required','Envía los datos como JSON.');return
        try:
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError()
            value=json.loads(raw)
            if not isinstance(value,dict):raise ValueError()
            service=self.sous_service()
            if route=='/api/sous/items':self.send_json(201,{'item':service.save_item(value)});return
            if route=='/api/sous/plan':self.send_json(200,service.plan_meals(value));return
            if route=='/api/sous/preferences':self.send_json(200,{'preferences':service.save_preferences(value)});return
            if route=='/api/sous/shopping':self.send_json(200,{'shopping':service.save_shopping_list(value)});return
            if route=='/api/sous/shopping/from-plan':self.send_json(200,{'shopping':service.add_plan_to_shopping(value)});return
            if route=='/api/sous/sessions':self.send_json(201,{'session':service.start_session(value)});return
            match=re.fullmatch('/api/sous/items/([0-9a-f-]{36})/(confirm|events)',route)
            if match:
                item_id,action=match.groups()
                self.send_json(200,(service.confirm_item if action=='confirm' else service.log_event)(item_id,value));return
            match=re.fullmatch('/api/sous/sessions/([0-9a-f-]{36})/verify',route)
            if match:self.send_json(200,{'session':service.verify_step(match[1],value)});return
            self.error(404,'sous_not_found','Recurso de Sous no disponible.')
        except SousError as exc:self.error(exc.status,exc.code,str(exc))
        except (ValueError,TypeError,KeyError,ValidationError):self.error(422,'sous_request','Revisa los datos de Sous.')
        except (OSError,sqlite3.Error):self.error(503,'sous_storage','No se pudo guardar el estado de Sous.')

    def sous_vision_service(self):
        from services.sous_vision import SousVisionService
        sous=self.sous_service()
        with HUMAN_SERVICE_LOCK:
            if not hasattr(self.server,'sous_vision'):
                self.server.sous_vision=SousVisionService(ROOT/'.local'/'sous-vision',sous)
            return self.server.sous_vision

    def sous_vision_post(self,route):
        from services.sous import SousError
        from packages.providers.meta import MetaProviderError
        if not self.headers.get('Origin'):
            self.reject_before_body(403,'local_form_required','Usa el formulario local de Sous.');return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:length=0
        if not 0<length<=2*1024*1024 or self.headers.get('Transfer-Encoding'):
            self.reject_before_body(413,'sous_image_limit','La imagen debe ocupar como máximo 2 MiB.');return
        mime=self.headers.get('Content-Type','').split(';')[0].strip()
        if mime not in {'image/jpeg','image/png'}:
            self.reject_before_body(415,'sous_image_type','Usa una imagen PNG o JPEG.');return
        if self.headers.get('X-Brivany-Consent')!='true':
            self.reject_before_body(422,'sous_vision_consent','Confirma el envío de esta imagen a Meta.');return
        try:
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError()
            service=self.sous_vision_service()
            if route=='/api/sous/vision/inventory':
                self.send_json(200,service.analyze_inventory(raw,mime,consent=True,session_id=self.headers.get('X-Session-Id')));return
            match=re.fullmatch('/api/sous/vision/sessions/([0-9a-f-]{36})/verify',route)
            if match:
                revision=int(self.headers.get('X-Expected-Revision','-1'))
                self.send_json(200,service.verify_cooking_step(match[1],raw,mime,consent=True,expected_revision=revision));return
            self.error(404,'sous_not_found','Acción visual no disponible.')
        except (SousError,MetaProviderError) as exc:self.error(getattr(exc,'status',502),exc.code,str(exc))
        except (ValueError,TypeError,KeyError,ValidationError):self.error(422,'sous_vision_request','Revisa imagen, sesión y revisión.')
        except (OSError,sqlite3.Error):self.error(503,'sous_vision_storage','No se pudo completar la observación local.')

    def spatial_service(self):
        from services.spatial.jobs import SpatialService
        with SPATIAL_SERVICE_LOCK:
            if not hasattr(self.server,'spatial'):
                self.server.spatial=SpatialService(ROOT/'.local'/'spatial')
            if not hasattr(self.server,'spatial_media_access'):
                self.server.spatial_media_access=MediaAccess()
            return self.server.spatial

    def spatial_scene(self, service, identifier):
        result=service.scene(identifier)
        result['asset_urls']={asset['id']:self.server.spatial_media_access.issue(f"/api/spatial/assets/{identifier}/{asset['id']}") for asset in result['scene']['assets']}
        result['assets']=[{'id':key,'url':value} for key,value in result['asset_urls'].items()]
        result['export_url']=self.server.spatial_media_access.issue(f'/api/spatial/scenes/{identifier}/export')
        result['media_expires_in_seconds']=self.server.spatial_media_access.ttl_seconds
        reference_set=result['scene'].get('reference_set_id')
        if reference_set:
            from services.spatial.references import ReferenceSetService
            references=ReferenceSetService(service.root).get(reference_set)
            for frame in references['frames']:
                frame['url']=self.server.spatial_media_access.issue(f"/api/spatial/reference-images/{reference_set}/{frame['id']}")
            result['references']=references
        if result['scene']['origin']=='room_reconstruction':
            from services.spatial.jobs import SpatialServiceError
            from services.spatial.capture import jpeg_size
            from services.spatial.room_dispatch import completed_room_dispatch,RoomDispatchError
            scene=result['scene'];provenance=scene['reconstruction'];capture_id=scene['capture_id']
            try:
                receipt=completed_room_dispatch(service.root,provenance['job_id'])
                space=service.get_space(identifier);available={frame['id']:frame for frame in space['frames']}
                if (receipt['identity_sha256']!=provenance['dispatch_identity'] or receipt['capture_id']!=capture_id or
                    receipt['source_sha256']!=provenance['source_sha256'] or receipt['source_sha256']!=space['capture']['source']['sha256'] or
                    [frame['id'] for frame in receipt['source_frames']]!=scene['source_frame_ids']):raise ValueError('source')
                frames=[]
                for source in receipt['source_frames']:
                    frame=available[source['id']]
                    if frame['sha256']!=source['source_frame_sha256'] or frame['at_seconds']!=source['at_seconds']:raise ValueError('frame')
                    raw,_,_=service.frame(capture_id,frame['id'])
                    if jpeg_size(raw)!=(frame['width'],frame['height']):raise ValueError('dimensions')
                    frames.append({**{key:frame[key] for key in ('id','at_seconds','sha256','width','height')},
                        'url':self.server.spatial_media_access.issue(f"/api/spatial/frames/{capture_id}/{frame['id']}")})
                result['source_views']={'scope':'capture_frames_not_photo_registration','frames':frames}
            except (RoomDispatchError,ValueError,TypeError,KeyError):
                raise SpatialServiceError('room_source_changed','Los fotogramas de origen ya no coinciden con la superficie multivista.',409)
        return result

    def spatial_review_service(self):
        from services.spatial.review import CaptureReviewService
        service=self.spatial_service()
        with SPATIAL_SERVICE_LOCK:
            if not hasattr(self.server,'spatial_reviews'):
                self.server.spatial_reviews=CaptureReviewService(service.root)
            return self.server.spatial_reviews

    def spatial_review_urls(self, result):
        for item in result['objects']:
            item['mask_url']=self.server.spatial_media_access.issue(f"/api/spatial/masks/{result['capture_id']}/{item['id']}")
        return result

    def spatial_get(self,route):
        from services.spatial.jobs import SpatialServiceError
        from services.spatial.review import CaptureReviewError
        from services.spatial.references import ReferenceSetError,ReferenceSetService
        from services.spatial.floorplan import FloorPlanService,FloorPlanError
        from services.spatial.dispatch import DispatchError
        from services.spatial.ingest import SpatialIngestService,SpatialIngestError
        from services.spatial.room_ingest import RoomIngestService,RoomIngestError
        from services.spatial.presentation import PresentationService,PresentationError
        from workers.spatial_runtime import SpatialWorkerError
        try:
            service=self.spatial_service()
            if route=='/api/spatial/spaces':
                self.send_json(200,service.library());return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/presentation',route)
            if match:self.send_json(200,PresentationService(service).get(match[1]));return
            if route=='/api/spatial/reconstruction/status':
                from workers.spatial_runtime import read_lock,readiness
                from services.spatial.modal_transport import ModalTransport
                lock=read_lock();transport=ModalTransport(service.root,lock)
                self.send_json(200,{'worker':readiness(lock),'transport':transport.preflight(),'gpu_execution_verified':False,'automatic_dispatch':False});return
            match=re.fullmatch(r'/api/spatial/captures/([0-9a-f-]{36})/results',route)
            if match:
                self.send_json(200,SpatialIngestService(service).list_results(match[1]));return
            match=re.fullmatch(r'/api/spatial/captures/([0-9a-f-]{36})/room-results',route)
            if match:
                self.send_json(200,RoomIngestService(service).list_results(match[1]));return
            match=re.fullmatch(r'/api/spatial/dispatch/([0-9a-f-]{36})',route)
            if match:
                from services.spatial.dispatch import SpatialDispatch
                from services.spatial.budget import SpatialBudget
                from services.spatial.review import CaptureReviewService
                dispatch=SpatialDispatch(service.root,CaptureReviewService(service.root),SpatialBudget(service.root/'budget.sqlite3'))
                self.send_json(200,dispatch.inspect(match[1]));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/floorplan',route)
            if match:self.send_json(200,FloorPlanService(service).get(match[1]));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/floorplan/settings',route)
            if match:
                from services.spatial.plan_settings import PlanSettingsService
                self.send_json(200,PlanSettingsService(service).get(match[1]));return
            match=re.fullmatch(r'/api/spatial/reference-images/([0-9a-f-]{36})/(frame-[0-9]{4})',route)
            if match:
                if not self.server.spatial_media_access.verify(route,parse_qs(urlsplit(self.path).query,keep_blank_values=True)):
                    self.error(403,'media_link_expired','Actualiza el espacio para ver sus referencias.');return
                data,mime,_=ReferenceSetService(service.root).image(*match.groups())
                self.send_bytes(200,data,mime);return
            match=re.fullmatch(r'/api/spatial/captures/([0-9a-f-]{36})/review',route)
            if match:
                result=self.spatial_review_service().get(match[1])
                self.send_json(200,self.spatial_review_urls(result));return
            match=re.fullmatch(r'/api/spatial/(masks|packages)/([0-9a-f-]{36})/([a-z0-9-]{1,64})',route)
            if match:
                if not self.server.spatial_media_access.verify(route,parse_qs(urlsplit(self.path).query,keep_blank_values=True)):
                    self.error(403,'media_link_expired','Actualiza la captura para renovar el enlace.');return
                kind,capture_id,item_id=match.groups();reviews=self.spatial_review_service()
                data,mime,name=(reviews.mask if kind=='masks' else reviews.package)(capture_id,item_id)
                self.send_headers(200,mime,len(data),filename=name if kind=='packages' else None)
                self.wfile.write(data);return
            match=re.fullmatch(r'/api/spatial/(spaces|scenes|jobs)/([0-9a-f-]{36})',route)
            if match:
                kind,identifier=match.groups()
                result=({'space':service.get_space(identifier)} if kind=='spaces' else {'job':service.get_job(identifier)} if kind=='jobs' else self.spatial_scene(service,identifier))
                if kind=='spaces':
                    space=result['space']
                    for frame in space.get('frames',[]):
                        frame['url']=self.server.spatial_media_access.issue(f"/api/spatial/frames/{space['capture_id']}/{frame['id']}")
                self.send_json(200,result);return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/export',route)
            if match:
                if not self.server.spatial_media_access.verify(route,parse_qs(urlsplit(self.path).query,keep_blank_values=True)):
                    self.error(403,'media_link_expired','Actualiza el espacio antes de exportar.');return
                data,mime,name=service.export_scene(match[1])
                self.send_headers(200,mime,len(data),filename=name)
                self.wfile.write(data);return
            match=re.fullmatch(r'/api/spatial/(assets|frames)/([0-9a-f-]{36})/([a-z][a-z0-9_-]{0,79})',route)
            if match:
                if not self.server.spatial_media_access.verify(route,parse_qs(urlsplit(self.path).query,keep_blank_values=True)):
                    self.error(403,'media_link_expired','Actualiza el espacio para renovar el acceso al archivo.');return
                kind,identifier,asset_id=match.groups()
                data,mime,_name=service.asset(identifier,asset_id) if kind=='assets' else service.frame(identifier,asset_id)
                self.send_bytes(200,data,mime);return
            self.error(404,'spatial_not_found','El recurso espacial no está disponible.')
        except (SpatialServiceError,CaptureReviewError,ReferenceSetError,FloorPlanError,DispatchError,SpatialIngestError,RoomIngestError,PresentationError) as exc:self.error(exc.status,exc.code,str(exc))
        except SpatialWorkerError as exc:self.error(503,exc.code,str(exc))
        except (ValueError,TypeError,KeyError,ValidationError):self.error(422,'spatial_request','Revisa la solicitud del espacio.')
        except (OSError,sqlite3.Error):self.error(503,'spatial_storage','No se pudo leer el almacenamiento local.')

    def spatial_post(self,route):
        from services.spatial.jobs import SpatialServiceError
        from services.spatial.review import CaptureReviewError
        from services.spatial.floorplan import FloorPlanService,FloorPlanError
        from services.spatial.ingest import SpatialIngestService,SpatialIngestError
        from services.spatial.room_ingest import RoomIngestService,RoomIngestError
        from services.spatial.presentation import PresentationService,PresentationError
        if not self.headers.get('Origin'):
            self.reject_before_body(403,'local_form_required','Usa Espacios desde la interfaz local.');return
        body_started=False
        try:
            length=int(self.headers.get('Content-Length','0'))
            upload=route=='/api/spatial/captures'
            if not 0<length<=(25*1024*1024 if upload else 65536) or self.headers.get('Transfer-Encoding'):
                self.reject_before_body(413,'spatial_body_limit','La solicitud está vacía o supera el límite.');return
            if self.headers.get('Content-Type','').split(';')[0].strip()!=('video/mp4' if upload else 'application/json'):
                self.reject_before_body(415,'spatial_content_type','Elige un MP4 o una solicitud JSON válida.');return
            body_started=True
            payload=self.rfile.read(length)
            if len(payload)!=length:raise ValueError('incomplete')
            service=self.spatial_service()
            if upload:
                filename=unquote(self.headers.get('X-Filename','capture.mp4'))
                self.send_json(202,service.queue_capture(filename,payload));return
            value=json.loads(payload)
            if not isinstance(value,dict):raise ValueError('shape')
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/presentation',route)
            if match:self.send_json(200,PresentationService(service).save(match[1],value));return
            match=re.fullmatch(r'/api/spatial/dispatch/([0-9a-f-]{36})/import',route)
            if match:
                self.send_json(201,SpatialIngestService(service).import_result(match[1],value));return
            match=re.fullmatch(r'/api/spatial/room-dispatch/([0-9a-f-]{36})/import',route)
            if match:
                self.send_json(201,RoomIngestService(service).import_result(match[1],value));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/floorplan',route)
            if match:
                if set(value)-{'expected_revision','references','annotations','uncertainty_zones','cut_height'} or 'expected_revision' not in value:raise ValueError('fields')
                self.send_json(200,FloorPlanService(service).get(match[1],**value));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/floorplan/settings',route)
            if match:
                from services.spatial.plan_settings import PlanSettingsService
                self.send_json(200,PlanSettingsService(service).save(match[1],value));return
            match=re.fullmatch(r'/api/spatial/captures/([0-9a-f-]{36})/(review|prepare)',route)
            if match:
                capture_id,operation=match.groups();reviews=self.spatial_review_service()
                if operation=='review':
                    self.send_json(200,self.spatial_review_urls(reviews.save(capture_id,value)));return
                result=reviews.prepare(capture_id,value)
                result['download_url']=self.server.spatial_media_access.issue(f"/api/spatial/packages/{capture_id}/{result['package_id']}")
                self.send_json(201,result);return
            if route=='/api/spatial/spaces/demo':
                if set(value)-{'title'}:raise ValueError('fields')
                self.send_json(202,service.create_demo(value.get('title','Mi espacio de prueba')));return
            match=re.fullmatch(r'/api/spatial/jobs/([0-9a-f-]{36})/cancel',route)
            if match:
                if value:raise ValueError('fields')
                self.send_json(200,{'job':service.cancel_job(match[1])});return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/(transforms|reset)',route)
            if match:
                identifier,operation=match.groups()
                if operation=='transforms':service.update_transforms(identifier,value)
                else:
                    if set(value)!={'expected_revision'}:raise ValueError('fields')
                    service.reset_scene(identifier,value['expected_revision'])
                self.send_json(200,self.spatial_scene(service,identifier));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/(undo|redo|layouts)',route)
            if match:
                identifier,operation=match.groups()
                if operation=='layouts':
                    self.send_json(201,{'layout':service.save_layout(identifier,value)});return
                if set(value)!={'expected_revision'}:raise ValueError('fields')
                (service.undo_scene if operation=='undo' else service.redo_scene)(identifier,value['expected_revision'])
                self.send_json(200,self.spatial_scene(service,identifier));return
            match=re.fullmatch(r'/api/spatial/scenes/([0-9a-f-]{36})/layouts/([0-9a-f-]{36})/apply',route)
            if match:
                if set(value)!={'expected_revision'}:raise ValueError('fields')
                identifier,layout_id=match.groups()
                service.apply_layout(identifier,layout_id,value['expected_revision'])
                self.send_json(200,self.spatial_scene(service,identifier));return
            self.error(404,'spatial_not_found','La acción espacial no está disponible.')
        except (SpatialServiceError,CaptureReviewError,FloorPlanError,SpatialIngestError,RoomIngestError,PresentationError) as exc:self.error(exc.status,exc.code,str(exc))
        except (ValueError,TypeError,KeyError,ValidationError):(self.error if body_started else self.reject_before_body)(422,'spatial_request','Revisa el archivo o los cambios del espacio.')
        except (OSError,sqlite3.Error):(self.error if body_started else self.reject_before_body)(503,'spatial_storage','No se pudo guardar el espacio en este equipo.')

    def human_skill_service(self):
        with HUMAN_SERVICE_LOCK:
            if not hasattr(self.server, "human_skills"):
                self.server.human_skills = HumanSkillService(ROOT / ".local" / "human-skills")
            return self.server.human_skills

    def human_skill_post(self, route):
        if not self.headers.get("Origin"):
            self.reject_before_body(403, "local_form_required", "Usa Human-skills desde la interfaz local.")
            return
        body_started=False
        try:
            length = int(self.headers.get("Content-Length", "0"))
            is_upload = route == "/api/human-skills/jobs"
            limit = MAX_VIDEO_BYTES if is_upload else 4096
            if not 0 < length <= limit or self.headers.get("Transfer-Encoding"):
                raise SkillServiceError("body_limit", "La solicitud está vacía o supera el tamaño permitido.", 413)
            service = self.human_skill_service()
            mime = self.headers.get("Content-Type", "").split(";")[0].strip()
            if is_upload:
                if mime != "video/mp4": raise SkillServiceError("mp4_required", "Selecciona un video MP4.", 415)
                if self.headers.get("X-Brivany-Consent") != "true":
                    raise SkillServiceError("video_consent_required", "Autoriza el envío de este video a Meta antes de analizarlo.", 422)
                raw = self.headers.get("X-Brivany-Metadata", "")
                if not raw or len(raw) > 9000: raise ValueError()
                metadata = json.loads(unquote(raw))
                if not isinstance(metadata, dict) or set(metadata) != {"filename", "goal"}: raise ValueError()
                body_started=True
                video = self.rfile.read(length)
                if len(video) != length: raise ValueError()
                job = service.start(video, metadata["filename"], metadata["goal"])
                self.send_json(200 if job["status"] == "complete" else 202, {"job": job})
            else:
                parts = route.removeprefix("/api/human-skills/").split("/")
                if len(parts) != 2 or parts[1] != "progress":
                    raise SkillServiceError("not_found", "Recurso no disponible.", 404)
                if mime != "application/json": raise SkillServiceError("json_required", "Envía los pasos de práctica como JSON.", 415)
                body_started=True
                value = json.loads(self.rfile.read(length))
                self.send_json(200, {"skill": service.progress(parts[0], value)})
        except SkillServiceError as exc: (self.error if body_started else self.reject_before_body)(exc.status, exc.code, str(exc))
        except (ValueError, TypeError, KeyError): (self.error if body_started else self.reject_before_body)(422, "invalid_skill_request", "Revisa el archivo y el objetivo de la habilidad.")
        except OSError: (self.error if body_started else self.reject_before_body)(500, "skill_storage_failed", "No se pudo guardar la habilidad en este equipo.")

    def do_DELETE(self):
        if not self.local_request(): return
        route = urlsplit(self.path).path
        if not route.startswith("/api/human-skills/") or not self.headers.get("Origin"):
            self.reject_before_body(403, "local_form_required", "Usa Human-skills desde la interfaz local.")
            return
        try:
            self.human_skill_service().delete(route.removeprefix("/api/human-skills/"))
            self.send_json(200, {"deleted": True})
        except SkillServiceError as exc: self.error(exc.status, exc.code, str(exc))
        except OSError: self.error(500, "skill_storage_failed", "No se pudo borrar la habilidad de este equipo.")

    def speech(self, length):
        try:
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or body.get("consent") is not True:
                self.error(422, "voice_consent", "Activa Melodi para enviar a Cartesia el texto que se va a leer.")
                return
            if set(body) - {"text", "consent", "language", "speed"} or not isinstance(body.get("text"), str) or not 0 < len(body["text"].strip()) <= 1800:
                self.error(422, "invalid_speech", "El texto de voz debe tener entre 1 y 1800 caracteres.")
                return
            from packages.providers.cartesia_melodi import language_code, speech_speed
            language=language_code(body.get('language','es'))
            speed=speech_speed(body.get('speed',1))
        except VoiceError as error:
            self.error(422,error.code,str(error));return
        except (ValueError, TypeError):
            self.error(422, "invalid_speech", "Revisa el texto de voz.")
            return
        if not VOICE_LOCK.acquire(blocking=False):
            self.error(409, "voice_busy", "Hay una voz en preparación. Espera un momento.")
            return
        sent_headers, owns_voice_lock = False, True
        monitor_done=threading.Event();monitor=None
        try:
            with open_melodi(body["text"],language=language,speed=speed) as response:
                # Interrupt an idle upstream read when fetch is aborted, even
                # if Cartesia hasn't delivered the next PCM frame yet.
                if isinstance(getattr(self,'connection',None),socket.socket):
                    def observe_disconnect():
                        while not monitor_done.wait(.1):
                            try:
                                readable,_,_=select.select([self.connection],[],[],0)
                                if readable and not self.connection.recv(1,socket.MSG_PEEK):
                                    response.close();return
                            except (OSError,ValueError):
                                response.close();return
                    monitor=threading.Thread(target=observe_disconnect,daemon=True);monitor.start()
                first = response.read1(4096)
                if not first:
                    raise VoiceError("empty_audio", "Cartesia devolvió audio vacío.")
                self.close_connection = True
                self.protocol_version = "HTTP/1.1"
                self.send_headers(200, PCM_TYPE, chunked=True)
                sent_headers = True
                size, chunk = 0, first
                while chunk:
                    size += len(chunk)
                    if size > 4_800_000:
                        raise OSError("Audio limit")
                    self.wfile.write(f"{len(chunk):X}\r\n".encode() + chunk + b"\r\n")
                    self.wfile.flush()
                    chunk = response.read1(4096)
            # Publish EOF only after the upstream is closed and the next
            # sentence may acquire the single synthesis slot.
            VOICE_LOCK.release()
            owns_voice_lock = False
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except VoiceError as exc:
            if not sent_headers:
                self.error(503 if exc.code == "tts_not_configured" else 502, exc.code, str(exc))
        except (OSError, TimeoutError):
            if not sent_headers:
                self.error(502, "voice_connection", "La conexión de voz se interrumpió.")
        finally:
            monitor_done.set()
            if monitor:monitor.join(timeout=.2)
            if owns_voice_lock:
                VOICE_LOCK.release()

    def conversation(self, length):
        try:
            value = ConversationRequest.model_validate_json(self.rfile.read(length))
        except (ValueError, ValidationError):
            self.error(422, "invalid_turn", "Revisa el mensaje (hasta 1200 caracteres), historial y permiso de envío.")
            return
        if not CHAT_LOCK.acquire(blocking=False):
            self.error(409, "chat_busy", "Hay una respuesta en curso. Espera un momento.")
            return
        self.close_connection = True
        sent = False
        cancelled=threading.Event();monitor_done=threading.Event();monitor=None
        if isinstance(getattr(self,'connection',None),socket.socket):
            def observe_disconnect():
                while not monitor_done.wait(.05):
                    try:
                        readable,_,_=select.select([self.connection],[],[],0)
                        if readable and not self.connection.recv(1,socket.MSG_PEEK):cancelled.set();return
                    except (OSError,ValueError):cancelled.set();return
            monitor=threading.Thread(target=observe_disconnect,daemon=True);monitor.start()
        try:
            for event in stream_reply(value,cancelled=cancelled):
                if not sent:
                    self.send_headers(200, "application/x-ndjson; charset=utf-8"); sent = True
                self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode()); self.wfile.flush()
        except VoiceError as error:
            if sent:
                try:
                    self.wfile.write((json.dumps({"type": "error", "message": str(error)}) + "\n").encode()); self.wfile.flush()
                except OSError:
                    pass
            else:
                self.error(502, error.code, str(error))
        except OSError:
            pass
        finally:
            monitor_done.set()
            if monitor is not None:monitor.join(.2)
            CHAT_LOCK.release()


def start_application_bridges(server):
    """The same production voice/translation stack for web and Desktop.

    These factories only open loopback listeners. Provider sessions begin when
    a user starts capture; retired translation engines are not started here.
    """
    bridges=[]
    try:
        for name,factory in [('voice_bridge',MuseBridge),('river_bridge',RiverBridge)]:
            bridge=factory(server.server_port).start();bridges.append(bridge);setattr(server,name,bridge)
        return bridges
    except Exception:
        for bridge in reversed(bridges):bridge.close()
        raise


def main():
    parser = argparse.ArgumentParser(description="Brivany H1: práctica local de oratoria")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("El puerto debe estar entre 1024 y 65535.")
    load_local_config()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    bridges=[]
    try:
        bridges=start_application_bridges(server)
        print(f"Brivany: http://127.0.0.1:{args.port}", flush=True)
        print("Traducción integrada: /dubbing · Muse Voice → Meta Spark → Cartesia. Solo se envía audio al iniciar.", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for bridge in reversed(bridges):bridge.close()
        if hasattr(server,'spatial'):server.spatial.close()
        server.server_close()


if __name__ == "__main__":
    main()
