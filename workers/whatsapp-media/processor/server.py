"""Private HTTP contract. All processing/artifact routes require a service token."""
from __future__ import annotations

import hmac
import json
import mimetypes
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from contracts import Limits, artifact_path, cleanup_failed_job, configured_integer, valid_request_id

ROOT = Path(os.environ.get("MEDIA_JOB_DIRECTORY", "/tmp/vetsa-public-media"))
TOKEN = os.environ.get("MEDIA_PROCESSOR_TOKEN", "")
MODEL = Path(os.environ["YAMNET_MODEL_PATH"]) if os.environ.get("YAMNET_MODEL_PATH") else None
LOCK = threading.Lock()


class BoundedHTTPServer(ThreadingHTTPServer):
    """Bound request threads as well as the single CPU-intensive job."""
    daemon_threads = True
    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(configured_integer("MEDIA_HTTP_THREADS", 8, 2, 8))
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        request.settimeout(15)
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 5\r\nConnection: close\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "VetsaMedia/1"

    def log_message(self, *_args):
        pass  # URLs, source captions, tokens and artifact identifiers are private.

    def reply_json(self, status, value):
        encoded = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        if status in (429, 503):
            self.send_header("Retry-After", "5")
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self):
        return bool(TOKEN) and hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            self.reply_json(200, {"status": "ready"})
            return
        if not self.authorized():
            self.reply_json(401, {"error": "unauthorized"})
            return
        parts = path.split("/")
        if len(parts) != 5 or parts[:3] != ["", "v1", "artifacts"]:
            self.reply_json(404, {"error": "not_found"})
            return
        try:
            artifact = artifact_path(ROOT, unquote(parts[3]), unquote(parts[4]))
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(artifact.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(artifact.stat().st_size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with artifact.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, length=65536)
        except (ValueError, OSError):
            self.reply_json(404, {"error": "artifact_unavailable"})

    def do_POST(self):
        if not self.authorized():
            self.reply_json(401, {"error": "unauthorized"})
            return
        if urlsplit(self.path).path != "/v1/process":
            self.reply_json(404, {"error": "not_found"})
            return
        if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
            self.reply_json(400, {"error": "invalid_request"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError("invalid_request_size")
            self.connection.settimeout(15)
            request = json.loads(self.rfile.read(length))
        except (ValueError, OSError):
            self.reply_json(400, {"error": "invalid_request"})
            return
        if not LOCK.acquire(blocking=False):
            self.reply_json(429, {"error": "processor_busy"})
            return
        try:
            prune_expired()
            stored_bytes = sum(file.stat().st_size for directory in ROOT.iterdir() if directory.is_dir() and not directory.is_symlink()
                               for file in directory.iterdir() if file.is_file() and not file.is_symlink())
            storage_limit = configured_integer("MEDIA_STORAGE_BYTES", 800_000_000, 100_000, 800_000_000)
            if stored_bytes > storage_limit:
                self.reply_json(429, {"error": "artifact_storage_capacity"})
                return
            result = run_processing(request)
            self.reply_json(200, result)
        except ValueError as error:
            allowed = {"invalid_source_url", "only_public_post_or_reel_supported", "unsupported_profile", "invalid_request_id", "invalid_limits",
                       "invalid_processing_request", "request_id_conflict", "public_metadata_unavailable", "metadata_scope_mismatch"}
            code = str(error) if str(error) in allowed else "processing_unavailable"
            self.reply_json(409 if code == "request_id_conflict" else 400, {"error": code})
        except Exception:
            self.reply_json(503, {"error": "processing_unavailable"})
        finally:
            LOCK.release()


def prune_expired():
    for directory in ROOT.iterdir():
        if directory.is_dir() and not directory.is_symlink() and directory.resolve().parent == ROOT.resolve():
            if directory.stat().st_mtime + 900 <= time.time():
                shutil.rmtree(directory)


def run_processing(request):
    # Validate the cleanup target before starting a process. No client path is
    # ever passed to a shell, and timeout kills FFmpeg/extractor descendants too.
    request_id = valid_request_id(request.get("requestId")) if isinstance(request, dict) else None
    if not request_id:
        raise ValueError("invalid_processing_request")
    limits = Limits.from_request(request.get("limits"))
    target = ROOT / request_id
    existed_before = target.exists() or target.is_symlink()
    # Decoders/extractors do not need the parent's service credentials. Inherit
    # only runtime paths and locale, never arbitrary deployment secrets.
    runtime_names = {"PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
                     "HOME", "USERPROFILE", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
                     "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED"}
    environment = {**{name: value for name, value in os.environ.items() if name in runtime_names},
                   "MEDIA_JOB_DIRECTORY": str(ROOT),
                   **{name: str(limits.ffmpeg_threads) for name in
                      ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS")}}
    if MODEL is not None:
        environment["YAMNET_MODEL_PATH"] = str(MODEL)
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("pipeline_main.py"))],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=environment, start_new_session=os.name == "posix")
    try:
        stdout, _stderr = process.communicate(json.dumps(request).encode(), timeout=limits.cpu_seconds)
    except BaseException:
        if os.name == "posix":
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        else:
            process.kill()
        process.communicate()
        cleanup_failed_job(ROOT, request_id, existed_before=existed_before)
        raise
    try:
        if process.returncode or len(stdout) > 8_000_000:
            raise ValueError("processing_unavailable")
        output = json.loads(stdout)
        if not isinstance(output, dict) or output.get("ok") is not True:
            raise ValueError((output.get("error") or "processing_unavailable")
                             if isinstance(output, dict) and isinstance(output.get("error"), str) else "processing_unavailable")
        if not isinstance(output.get("result"), dict):
            raise ValueError("processing_unavailable")
        return output["result"]
    except (ValueError, TypeError):
        cleanup_failed_job(ROOT, request_id, existed_before=existed_before)
        raise


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("MEDIA_PROCESSOR_TOKEN must contain at least 32 characters")
    ROOT.mkdir(parents=True, exist_ok=True)
    if ROOT.is_symlink():
        raise SystemExit("MEDIA_JOB_DIRECTORY cannot be a symlink")
    # Invalid deployment ceilings fail at startup, before accepting requests.
    Limits.from_request()
    configured_integer("MEDIA_MAX_VIDEO_PIXELS", 16_777_216, 262_144, 16_777_216)
    configured_integer("MEDIA_MAX_IMAGE_PIXELS", 20_000_000, 262_144, 20_000_000)
    configured_integer("MEDIA_STORAGE_BYTES", 800_000_000, 100_000, 800_000_000)
    BoundedHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
