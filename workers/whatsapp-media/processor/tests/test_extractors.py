import importlib.util
import io
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if (ROOT / ".test-deps").is_dir(): sys.path.insert(0, str(ROOT / ".test-deps"))
from extractors import gallery_metadata, ytdlp_metadata
from secure_fetch import Fetched, FetchRejected

SOURCE = "https://www.instagram.com/p/ABC_123/"
CDN = "https://scontent.cdninstagram.com/public.mp4"


class HTTP:
    def __init__(self): self.calls = []
    def resolver(self, *_args, **_kwargs): return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
    def fetch(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return Fetched(b'{"public":true}', 200, {"Content-Type": "application/json"}, url)


class ExtractorTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("gallery_dl") and importlib.util.find_spec("requests"), "gallery-dl/requests not installed")
    def test_gallery_initializes_guarded_session_before_reading_carousel_metadata(self):
        from gallery_dl.extractor.common import Message
        class Fake:
            category, subcategory = "instagram", "post"
            initialized = False
            session = None
            def initialize(self):
                self.initialized = True
                self.session.get("https://www.instagram.com/api/public")
            def items(self):
                if not self.initialized: raise AssertionError("uninitialized extractor")
                yield Message.Directory, "", {"post_shortcode": "ABC_123", "description": "Public carousel caption", "count": 2}
                yield Message.Url, CDN, {"num": 1, "extension": "mp4", "video_url": CDN}
                yield Message.Url, "https://scontent.cdninstagram.com/second.jpg", {"num": 2, "extension": "jpg"}
        http = HTTP()
        with patch("gallery_dl.extractor.find", return_value=Fake()): result = gallery_metadata(SOURCE, http)
        self.assertEqual(len(result["media"]), 2)
        self.assertEqual([item["kind"] for item in result["media"]], ["video", "image"])
        self.assertEqual(result["expectedMedia"], 2)
        self.assertEqual(http.calls[0][0], "https://www.instagram.com/api/public")

    @unittest.skipUnless(importlib.util.find_spec("yt_dlp"), "yt-dlp not installed")
    def test_ytdlp_requests_use_guarded_transport_and_progressive_media_only(self):
        from yt_dlp import YoutubeDL
        def fake_extract(downloader, url, download=False):
            self.assertFalse(download)
            self.assertIsNone(downloader.params["cookiefile"])
            self.assertFalse(downloader.params["usenetrc"])
            self.assertEqual(downloader.urlopen("https://www.instagram.com/api/public").read(), b'{"public":true}')
            return {"webpage_url": SOURCE, "description": "Public reel", "formats": [
                {"url": "https://scontent.cdninstagram.com/unsafe.m3u8", "protocol": "m3u8_native", "vcodec": "h264", "acodec": "aac"},
                {"url": CDN, "protocol": "https", "vcodec": "h264", "acodec": "aac"}]}
        http = HTTP()
        with patch.object(YoutubeDL, "extract_info", fake_extract): result = ytdlp_metadata(SOURCE, http)
        self.assertEqual(len(result["media"]), 1)
        self.assertEqual(result["media"][0]["url"], CDN)
        self.assertEqual(http.calls[0][0], "https://www.instagram.com/api/public")

    @unittest.skipUnless(importlib.util.find_spec("yt_dlp"), "yt-dlp not installed")
    def test_ytdlp_cannot_return_another_post_as_the_requested_source(self):
        from yt_dlp import YoutubeDL
        with patch.object(YoutubeDL, "extract_info", return_value={"webpage_url": "https://www.instagram.com/p/OTHER/", "formats": []}):
            with self.assertRaisesRegex(FetchRejected, "extractor_source_mismatch"): ytdlp_metadata(SOURCE, HTTP())


if __name__ == "__main__": unittest.main()
