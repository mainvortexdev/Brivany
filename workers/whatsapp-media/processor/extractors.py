"""Metadata extraction only; neither library receives credentials or downloads files."""
from __future__ import annotations

import io
import json
import logging
import sys
import time
from urllib.parse import urlsplit

from secure_fetch import SafeHTTP, FetchRejected, public_post_url, validated_target


def gallery_metadata(source_url: str, http: SafeHTTP, max_items: int = 20) -> dict:
    import gallery_dl.config as config
    from gallery_dl import extractor
    from gallery_dl.extractor.common import Message
    import requests

    class SafeAdapter(requests.adapters.BaseAdapter):
        def send(self, request, **_kwargs):
            fetched = http.fetch(request.url, method=request.method, data=request.body, headers=request.headers)
            result = requests.Response()
            result.status_code, result.url = fetched.status, fetched.url
            result.headers = requests.structures.CaseInsensitiveDict(fetched.headers)
            result._content = fetched.body
            result.raw = io.BytesIO(fetched.body)
            result.request = request
            result.encoding = requests.utils.get_encoding_from_headers(result.headers) or "utf-8"
            return result

        def close(self):
            pass

    # Never load gallery-dl user config, cookies, account data or plugins.
    for name, value in {"cookies": None, "username": None, "password": None, "api": "graphql", "videos": "merged",
                        "audio": False, "previews": False, "sleep-request": 0, "retries": 0, "timeout": 15}.items():
        config.set(("extractor", "instagram"), name, value)
    instance = extractor.find(source_url)
    if not instance or instance.category != "instagram" or instance.subcategory not in ("post", "reel"):
        raise FetchRejected("extractor_source_mismatch")
    # gallery-dl constructs its session lazily in initialize(). Supply the
    # guarded session first so initialization never installs a default adapter.
    instance.session = requests.Session()
    instance.session.trust_env = False
    instance.session.mount("https://", SafeAdapter())
    instance.session.mount("http://", SafeAdapter())
    instance.initialize()
    caption, expected, items, seen = "", None, [], set()
    for kind, url, metadata in instance.items():
        if kind == Message.Directory:
            shortcode = metadata.get("post_shortcode")
            if shortcode and shortcode != urlsplit(source_url).path.strip("/").split("/")[-1]:
                raise FetchRejected("extractor_source_mismatch")
            caption = str(metadata.get("description") or "")[:12000]
            expected = metadata.get("count")
        elif kind == Message.Url:
            if not isinstance(url, str) or url in seen:
                continue
            validated_target(url, metadata=False, resolver=http.resolver)
            seen.add(url)
            extension = str(metadata.get("extension") or "").lower()
            video = bool(metadata.get("video_url")) or extension in ("mp4", "webm", "mov", "m4v")
            items.append({"url": url, "kind": "video" if video else "image", "index": int(metadata.get("num") or len(items) + 1),
                          "width": metadata.get("width"), "height": metadata.get("height")})
            if len(items) >= max_items:
                break
    return {"provider": "gallery-dl", "caption": caption, "media": items,
            "expectedMedia": expected if isinstance(expected, int) and expected >= len(items) else None}


def ytdlp_metadata(source_url: str, http: SafeHTTP, max_items: int = 20) -> dict:
    from yt_dlp import YoutubeDL
    from yt_dlp.networking import Request
    from yt_dlp.networking.common import Response
    from yt_dlp.networking.exceptions import HTTPError, RequestError

    class Quiet:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass

    class SafeYoutubeDL(YoutubeDL):
        def urlopen(self, request):
            if isinstance(request, str):
                request = Request(request)
            url = getattr(request, "url", None) or request.get_full_url()
            method = getattr(request, "method", None) or request.get_method()
            headers = getattr(request, "headers", {})
            try:
                fetched = http.fetch(url, method=method, data=getattr(request, "data", None), headers=headers)
                response = Response(io.BytesIO(fetched.body), fetched.url, fetched.headers, fetched.status)
                if fetched.status >= 400:
                    raise HTTPError(response)
                return response
            except FetchRejected as error:
                raise RequestError(str(error)) from error

    options = {"quiet": True, "no_warnings": True, "logger": Quiet(), "skip_download": True,
               "allowed_extractors": ["^instagram$"], "socket_timeout": 15, "extractor_retries": 0,
               "retries": 0, "cachedir": False, "usenetrc": False, "cookiefile": None,
               "cookiesfrombrowser": None, "username": None, "password": None, "check_formats": False,
               "playlistend": max_items, "lazy_playlist": True}
    with SafeYoutubeDL(options) as downloader:
        info = downloader.extract_info(source_url, download=False)
    if not isinstance(info, dict):
        raise FetchRejected("public_post_unavailable")
    original = info.get("webpage_url")
    if original and public_post_url(original) != source_url:
        raise FetchRejected("extractor_source_mismatch")
    caption = str(info.get("description") or info.get("title") or "")[:12000]
    entries = info.get("entries") or [info]
    expected = info.get("playlist_count") or (len(entries) if isinstance(entries, list) else None)
    items = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        candidates = [candidate for candidate in entry.get("formats", []) if candidate.get("url")
                      and candidate.get("protocol", "https") in ("https", "http") and candidate.get("vcodec") != "none"]
        if not candidates and entry.get("url"):
            candidates = [entry]
        if not candidates:
            continue
        # Progressive media only; remote playlists never reach ffmpeg.
        candidates.sort(key=lambda item: (item.get("acodec") != "none", min(int(item.get("height") or 0), 1080)))
        selected = candidates[-1]
        validated_target(selected["url"], metadata=False, resolver=http.resolver)
        items.append({"url": selected["url"], "kind": "video", "index": len(items) + 1,
                      "width": selected.get("width"), "height": selected.get("height"), "durationSeconds": entry.get("duration")})
        if len(items) >= max_items:
            break
    return {"provider": "yt-dlp", "caption": caption, "media": items,
            "expectedMedia": expected if isinstance(expected, int) and expected >= len(items) else None}


def extract(source_url: str, *, max_items=20, deadline=None) -> dict:
    source_url = public_post_url(source_url)
    http = SafeHTTP(deadline=deadline or time.monotonic() + 55)
    strategies = [ytdlp_metadata, gallery_metadata] if "/reel" in source_url else [gallery_metadata, ytdlp_metadata]
    reasons = []
    for strategy in strategies:
        try:
            result = strategy(source_url, http, max_items)
            if result["media"]:
                return {**result, "status": "available", "sourceUrl": source_url}
        except ImportError:
            reasons.append("extractor_not_installed")
        except Exception:
            # Never expose credentials, response HTML, caption or signed CDN URLs in error text.
            reasons.append("anonymous_public_extraction_unavailable")
    return {"status": "unavailable", "sourceUrl": source_url, "caption": "", "media": [],
            "expectedMedia": None, "reasons": sorted(set(reasons or ["public_media_unavailable"]))}


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    request = json.loads(sys.stdin.buffer.read(8192))
    print(json.dumps(extract(request["sourceUrl"], max_items=int(request.get("maxItems", 20)))))
