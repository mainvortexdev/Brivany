"""Small synchronous MT requests with Meta M2M100 hosted by Cloudflare.

Input/output language codes follow the current official parameter schema, which
uses ISO codes despite older prose examples using English language names.
No conversation, tools, retry, fallback, or persistence is involved.
"""
from __future__ import annotations
import json
import io
import os
import re
import socket
import threading
import time
from http.client import HTTPException, HTTPSConnection
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener
from urllib.parse import urlsplit
from packages.providers.live_voice import NoRedirect, VoiceError, cloudflare_token

MODEL = "@cf/meta/m2m100-1.2b"
MAX_TEXT_CHARACTERS = 400
MAX_RESPONSE_BYTES = 65536
TIMEOUT_SECONDS = 5
MAX_ERROR_RESPONSE_BYTES = 8192
# Documented Workers AI errors; unknown codes aren't copied to diagnostics.
# https://developers.cloudflare.com/workers-ai/platform/errors/
SAFE_PROVIDER_ERROR_CODES = frozenset({3003, 3006, 3007, 3008, 3023, 3036, 3039,
    3040, 3041, 3042, 5004, 5005, 5007, 5016, 5018, 5019, 5035})


def _provider_error_codes(value):
    errors = value.get("errors", []) if isinstance(value, dict) else []
    if not isinstance(errors, list): return []
    codes = []
    for item in errors[:32]:
        code = item.get("code") if isinstance(item, dict) else None
        if type(code) is int and code in SAFE_PROVIDER_ERROR_CODES and code not in codes:
            codes.append(code)
    return codes[:8]


class TranslationError(VoiceError):
    """Only bounded timing, HTTP status and documented numeric codes are public."""
    def __init__(self, code, message, *, http_status=None, provider_error_codes=(), request_ms=None):
        super().__init__(code, message)
        self.http_status = http_status if type(http_status) is int and 100 <= http_status <= 599 else None
        self.provider_error_codes = _provider_error_codes({"errors": [{"code": item} for item in provider_error_codes]})
        self.request_ms = request_ms

    def diagnostics(self):
        return {"http_status": self.http_status, "provider_error_codes": list(self.provider_error_codes),
                "request_ms": self.request_ms, "inference_ms": None}


def _http_error_codes(error):
    """Never retain response messages, headers, raw body, URLs or request text."""
    try:
        body = error.read(MAX_ERROR_RESPONSE_BYTES + 1)
        if len(body) > MAX_ERROR_RESPONSE_BYTES: return []
        return _provider_error_codes(json.loads(body))
    except (OSError, ValueError, TypeError, HTTPException):
        return []
    finally:
        error.close()


def text_translation_status():
    account = os.environ.get("BRIVANY_CLOUDFLARE_ACCOUNT_ID", "").strip()
    return {"provider": "Cloudflare", "model_origin": "Meta", "model": MODEL,
        "configured": bool(re.fullmatch(r"[a-fA-F0-9]{32}", account) and cloudflare_token()),
        "max_text_characters": MAX_TEXT_CHARACTERS, "languages": ["en", "es"],
        "streaming": False, "inference_ms": None, "target_inference_ms": 500, "inference_verified": False}


def translate_text(text, source="en", target="es", *, opener=None):
    """Translate one bounded segment; request_ms includes transport and service.

    The injected opener is for local transport tests. Production always creates
    an opener that refuses redirects; credentials never enter a URL or result.
    """
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARACTERS:
        raise VoiceError("mt_input_limit", "Traduce un fragmento de entre 1 y 400 caracteres.")
    if not isinstance(source, str) or not isinstance(target, str) or source not in {"en", "es"} or target not in {"en", "es"} or source == target:
        raise VoiceError("mt_languages", "Elige idiomas distintos: inglés y español.")
    account = os.environ.get("BRIVANY_CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account):
        raise VoiceError("mt_not_configured", "Configura la cuenta y autorización de Cloudflare para traducir.")
    token = cloudflare_token(refresh=True)
    if not token: raise VoiceError("mt_not_configured", "Configura la autorización de Cloudflare para traducir.")
    payload = {"text": text.strip(), "source_lang": source, "target_lang": target}
    request = Request(f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODEL}",
        data=json.dumps(payload, ensure_ascii=True).encode("utf-8"), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"})
    started = time.monotonic()
    try:
        with (opener or build_opener(NoRedirect())).open(request, timeout=TIMEOUT_SECONDS) as response:
            http_status = getattr(response, "status", None)
            if not response.headers.get("Content-Type", "").lower().startswith("application/json"):
                raise TranslationError("mt_invalid_response", "Cloudflare no devolvió una traducción JSON válida.",
                    http_status=http_status, request_ms=round((time.monotonic()-started)*1000, 2))
            body = response.read(MAX_RESPONSE_BYTES + 1)
        request_ms = round((time.monotonic()-started)*1000,2)
        if len(body) > MAX_RESPONSE_BYTES:
            raise TranslationError("mt_output_limit", "La traducción excedió el límite de respuesta.",
                http_status=http_status, request_ms=request_ms)
        result = json.loads(body)
        if not isinstance(result, dict) or result.get("success") is not True or not isinstance(result.get("result"), dict):
            raise TranslationError("mt_invalid_response", "Cloudflare no confirmó una traducción válida.",
                http_status=http_status, provider_error_codes=_provider_error_codes(result), request_ms=request_ms)
        translated = result["result"].get("translated_text")
        if not isinstance(translated, str) or not translated.strip() or len(translated) > 2400:
            raise TranslationError("mt_invalid_response", "Cloudflare devolvió una traducción vacía o fuera del límite.",
                http_status=http_status, request_ms=request_ms)
        return {"text": translated.strip(), "model": MODEL, "provider": "Cloudflare", "model_origin": "Meta",
            "source_language": source, "target_language": target, "request_ms": request_ms, "inference_ms": None,
            "http_status": http_status if type(http_status) is int else None, "provider_error_codes": []}
    except HTTPError as exc:
        status = exc.code; codes = _http_error_codes(exc)
        raise TranslationError("mt_rejected", f"Cloudflare rechazó la traducción (HTTP {status}). Revisa acceso, cuota y credenciales.",
            http_status=status, provider_error_codes=codes,
            request_ms=round((time.monotonic()-started)*1000, 2)) from None
    except (URLError, TimeoutError, OSError, HTTPException):
        raise TranslationError("mt_unavailable", "La conexión de traducción se interrumpió. No se reintentó automáticamente.",
            request_ms=round((time.monotonic()-started)*1000, 2)) from None
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise TranslationError("mt_invalid_response", "La respuesta de traducción no tiene un formato válido.",
            request_ms=round((time.monotonic()-started)*1000, 2)) from None


class _TranslationReply(io.BytesIO):
    def __init__(self, body, status, content_type):
        super().__init__(body)
        self.status = status
        self.headers = {"Content-Type": content_type}


class _CloudflareKeepAliveOpener:
    """One origin, one serial HTTP/1.1 connection, and no automatic retry.

    The optional factory changes the transport only for loopback tests. It cannot
    change the accepted production request URL, method, headers or model path.
    """
    def __init__(self, account, *, _connection_factory=None):
        self._path = f"/client/v4/accounts/{account}/ai/run/{MODEL}"
        self._factory = _connection_factory or HTTPSConnection
        self._request_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._connection = None
        self._active_socket = None
        self._active = False
        self._closed = False

    def close(self):
        # Separate from the request lock: cancellation never waits for a request.
        # On Windows an in-flight recv may still need its existing socket timeout;
        # its result is discarded and this session cannot start another request.
        with self._state_lock:
            self._closed = True
            connection, active_socket, active = self._connection, self._active_socket, self._active
            self._connection = None
            self._active_socket = None
        connection_socket = getattr(connection, "sock", None)
        for candidate in (active_socket, connection_socket):
            if candidate is not None:
                try: candidate.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                try: candidate.close()
                except OSError: pass
        if connection is not None:
            # HTTPConnection.close also closes its response's buffered file. That
            # can wait behind a reader's lock; let the request owner close it.
            if not active: connection.close()

    def _validate(self, request):
        try:
            parsed = urlsplit(request.full_url)
            port = parsed.port
        except ValueError:
            raise VoiceError("mt_transport_origin", "La traducción requiere el endpoint fijo de Cloudflare.") from None
        if (parsed.scheme != "https" or parsed.hostname != "api.cloudflare.com" or
            port not in {None, 443} or parsed.username is not None or parsed.password is not None or
            parsed.path != self._path or parsed.query or parsed.fragment or request.get_method() != "POST"):
            raise VoiceError("mt_transport_origin", "La traducción requiere el endpoint fijo de Cloudflare.")
        headers = {name.lower(): value for name, value in request.header_items()}
        if (set(headers) != {"authorization", "content-type", "accept"} or
            not isinstance(headers.get("authorization"), str) or
            not headers["authorization"].startswith("Bearer ") or not headers["authorization"][7:].strip() or
            len(headers["authorization"]) > 8192 or "\r" in headers["authorization"] or "\n" in headers["authorization"] or
            headers.get("content-type") != "application/json" or headers.get("accept") != "application/json" or
            not isinstance(request.data, bytes) or len(request.data) > 8192):
            raise VoiceError("mt_transport_headers", "La petición de traducción contiene opciones no admitidas.")
        return headers

    def open(self, request, timeout=TIMEOUT_SECONDS):
        headers = self._validate(request)
        with self._request_lock:
            with self._state_lock:
                if self._closed:
                    raise VoiceError("mt_session_closed", "La sesión de traducción está cerrada.")
                if self._connection is None:
                    self._connection = self._factory("api.cloudflare.com", 443, timeout=timeout)
                connection = self._connection
                self._active = True
            response = None
            try:
                # HTTPConnection does not replay a failed request. A server-side
                # Connection: close also ends this session after this response.
                connection.timeout = timeout
                if connection.sock is not None: connection.sock.settimeout(timeout)
                connection.request("POST", self._path, body=request.data, headers=headers)
                with self._state_lock:
                    self._active_socket = connection.sock
                    cancelled = self._closed
                if cancelled:
                    raise OSError("Translation session closed")
                response = connection.getresponse()
                status, content_type = response.status, response.getheader("Content-Type", "")
                body = response.read((MAX_RESPONSE_BYTES if 200 <= status < 300 else MAX_ERROR_RESPONSE_BYTES) + 1)
                with self._state_lock:
                    cancelled = self._closed
                    self._active_socket = None
                if cancelled:
                    raise OSError("Translation session closed")
                if response.will_close or not 200 <= status < 300 or len(body) > MAX_RESPONSE_BYTES:
                    self.close()
                if not 200 <= status < 300:
                    raise HTTPError(request.full_url, status, "Cloudflare rejected translation", {}, io.BytesIO(body))
                return _TranslationReply(body, status, content_type)
            except (OSError, HTTPException):
                self.close()
                raise
            finally:
                if response is not None:
                    response.close()
                with self._state_lock:
                    closed = self._closed
                    self._active = False
                # A cancellation can race the lazy socket connect inside
                # request(); close that local connection even if detached above.
                if closed:
                    candidate = getattr(connection, "sock", None)
                    if candidate is not None:
                        try: candidate.shutdown(socket.SHUT_RDWR)
                        except OSError: pass
                    connection.close()


class CloudflareTranslationSession:
    """Callable M2M100 translator with a connection scoped to one dubbing session.

    Reuses TLS/HTTP transport for subsequent segments while the provider keeps
    it alive. It does not reduce the first cold connection or assert a latency.
    All text, response and diagnostic validation stays in ``translate_text``.
    """
    def __init__(self, *, _connection_factory=None):
        account = os.environ.get("BRIVANY_CLOUDFLARE_ACCOUNT_ID", "").strip()
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account):
            raise VoiceError("mt_not_configured", "Configura la cuenta y autorización de Cloudflare para traducir.")
        self._opener = _CloudflareKeepAliveOpener(account, _connection_factory=_connection_factory)

    def __call__(self, text, source="en", target="es"):
        try:
            return translate_text(text, source, target, opener=self._opener)
        except VoiceError:
            self.close()
            raise

    def close(self):
        self._opener.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
