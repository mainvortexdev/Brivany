"""HTTPS-only, allowlisted, DNS-pinned transport for public Instagram evidence."""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit


class FetchRejected(ValueError):
    pass


POST_HOSTS = frozenset({"instagram.com", "www.instagram.com", "m.instagram.com"})
API_HOSTS = frozenset({*POST_HOSTS, "i.instagram.com", "api.instagram.com", "graphql.instagram.com"})
CDN_SUFFIXES = ("cdninstagram.com", "fbcdn.net")


def public_post_url(value: str) -> str:
    import re
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 33 for c in value):
        raise FetchRejected("invalid_source_url")
    parts = urlsplit(value)
    if parts.scheme != "https" or parts.hostname not in POST_HOSTS or parts.username or parts.password or parts.port:
        raise FetchRejected("invalid_source_url")
    if not re.fullmatch(r"/(?:p|reel|reels|tv)/[A-Za-z0-9_-]{1,100}/?", parts.path):
        if re.fullmatch(r"/[A-Za-z0-9_.]{1,100}/?", parts.path):
            raise FetchRejected("unsupported_profile")
        raise FetchRejected("only_public_post_or_reel_supported")
    # Share query values are unnecessary to extract a specific post.
    return urlunsplit(("https", "www.instagram.com", parts.path.rstrip("/") + "/", "", ""))


def validated_target(url: str, *, metadata: bool = False, resolver=socket.getaddrinfo) -> tuple[str, str]:
    if not isinstance(url, str) or len(url) > 8192 or any(ord(c) < 33 for c in url):
        raise FetchRejected("invalid_target_url")
    parts = urlsplit(url)
    host = parts.hostname or ""
    allowed = host in API_HOSTS if metadata else any(host == suffix or host.endswith("." + suffix) for suffix in CDN_SUFFIXES)
    if parts.scheme != "https" or not allowed or parts.username or parts.password or parts.port not in (None, 443):
        raise FetchRejected("target_not_allowlisted")
    if any(piece in parts.path.lower() for piece in ("/accounts/login", "/challenge/", "/oauth/")):
        raise FetchRejected("public_access_required")
    try:
        addresses = [entry[4][0] for entry in resolver(host, 443, type=socket.SOCK_STREAM)]
        if not addresses:
            raise FetchRejected("dns_unavailable")
        for address in addresses:
            parsed = ipaddress.ip_address(address)
            if not parsed.is_global or (parsed.version == 6 and parsed.ipv4_mapped and not parsed.ipv4_mapped.is_global):
                raise FetchRejected("non_public_target")
    except FetchRejected:
        raise
    except (OSError, ValueError) as error:
        raise FetchRejected("dns_unavailable") from error
    return host, addresses[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    """Connect to the validated IP, retaining hostname SNI and certificate checks."""
    def __init__(self, host: str, address: str, timeout: float):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


@dataclass(frozen=True)
class Fetched:
    body: bytes
    status: int
    headers: dict[str, str]
    url: str


class SafeHTTP:
    def __init__(self, *, resolver=socket.getaddrinfo, connection=PinnedHTTPS, deadline: float | None = None):
        self.resolver, self.connection = resolver, connection
        self.deadline = deadline or time.monotonic() + 180

    def _open(self, url, *, metadata=False, method="GET", data=None, headers=None):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise FetchRejected("fetch_deadline")
        host, address = validated_target(url, metadata=metadata, resolver=self.resolver)
        if method not in ("GET", "HEAD", "POST") or (not metadata and method != "GET"):
            raise FetchRejected("method_not_allowed")
        parts = urlsplit(url)
        target = parts.path or "/"
        if parts.query:
            target += "?" + parts.query
        allowed = {"user-agent", "accept", "content-type", "referer", "x-ig-app-id", "x-csrftoken", "x-asbd-id",
                   "x-ig-www-claim", "x-requested-with", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"}
        cleaned = {str(k): str(v) for k, v in (headers or {}).items() if str(k).lower() in allowed
                   and "\r" not in str(v) and "\n" not in str(v)}
        cleaned.update({"Host": host, "Accept-Encoding": "identity"})
        conn = self.connection(host, address, min(20, remaining))
        try:
            conn.request(method, target, body=data, headers=cleaned)
            response = conn.getresponse()
            return conn, response
        except BaseException:
            conn.close()
            raise

    def _response(self, url, *, metadata, method="GET", data=None, headers=None):
        for _ in range(5):
            conn, response = self._open(url, metadata=metadata, method=method, data=data, headers=headers)
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                conn.close()
                if not location:
                    raise FetchRejected("invalid_redirect")
                url = urljoin(url, location)
                if response.status == 303 or (response.status in (301, 302) and method == "POST"):
                    method, data = "GET", None
                # The next hop is independently allowlisted, DNS-checked and pinned.
                continue
            return conn, response, url
        raise FetchRejected("too_many_redirects")

    def fetch(self, url, *, metadata=True, method="GET", data=None, headers=None, max_bytes=2_000_000):
        conn, response, final_url = self._response(url, metadata=metadata, method=method, data=data, headers=headers)
        try:
            length = response.getheader("Content-Length")
            if length and int(length) > max_bytes:
                raise FetchRejected("response_too_large")
            body = bytearray()
            while True:
                if time.monotonic() > self.deadline:
                    raise FetchRejected("fetch_deadline")
                chunk = response.read(min(65536, max_bytes + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise FetchRejected("response_too_large")
            return Fetched(bytes(body), response.status, dict(response.getheaders()), final_url)
        finally:
            conn.close()

    def download(self, url: str, destination: Path, *, max_bytes: int) -> dict:
        conn, response, final_url = self._response(url, metadata=False)
        try:
            if response.status != 200:
                raise FetchRejected("public_media_unavailable")
            declared = response.getheader("Content-Length")
            if declared and int(declared) > max_bytes:
                raise FetchRejected("media_byte_limit")
            kind = (response.getheader("Content-Type") or "").split(";", 1)[0].lower()
            if not kind.startswith(("image/", "video/", "audio/")) and kind != "application/octet-stream":
                raise FetchRejected("not_media")
            count = 0
            with destination.open("xb") as output:
                while True:
                    if time.monotonic() > self.deadline:
                        raise FetchRejected("fetch_deadline")
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > max_bytes:
                        raise FetchRejected("media_byte_limit")
                    output.write(chunk)
            return {"bytes": count, "mimeType": kind, "url": final_url}
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        finally:
            conn.close()
