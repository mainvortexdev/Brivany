"""HTTP real en loopback; Meta siempre sustituida, sin medios ni costo."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
from email.message import Message
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from packages.providers.meta import MetaProviderError
from services.h1.server import Handler, META_LOCK, MAX_REJECT_DRAIN_BYTES, REJECT_DRAIN_SECONDS, load_local_config, save_meta_key, save_dubbing_key, save_eleven_key, save_gemini_key, save_openai_key


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def call(self, method, path, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        supplied = {"Content-Type": "application/json"}
        supplied.update(headers or {})
        connection.request(method, path, json.dumps(body).encode() if body is not None else None, supplied)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_private_files_and_upload_routes_unavailable(self):
        for route in ("/.env", "/../.env", "/contracts/models.py", "/api/upload"):
            with self.subTest(route=route):
                self.assertEqual(self.call("GET", route)[0], 404)

    def test_cross_origin_and_forged_host_rejected(self):
        for headers in ({"Origin": "https://unrelated.example"}, {"Host": "unrelated.example"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.call("POST", "/api/practice", {}, headers)[0], 403)

    def test_plain_text_and_oversized_bodies_rejected(self):
        self.assertEqual(self.call("POST", "/api/practice", {}, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("POST", "/api/practice", {"transcript": "x" * 66000})[0], 413)

    def test_rejections_remain_readable_when_body_arrives_after_headers(self):
        class DelayedBodyConnection(HTTPConnection):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs); self.sends = 0
            def send(self, data):
                self.sends += 1
                if self.sends == 2:
                    time.sleep(.003)  # Deterministically lets the server reject headers first.
                return super().send(data)
        origin = f"http://127.0.0.1:{self.server.server_port}"
        cases = [
            ("/api/practice", b"{}", {"Content-Type": "text/plain"}, 415),
            ("/api/practice", b"x" * 66000, {"Content-Type": "application/json"}, 413),
            ("/api/unknown", b"{}", {"Content-Type": "application/json"}, 404),
            ("/api/practice", b"{}", {"Host": "unrelated.example"}, 403),
            ("/api/practice", b"{}", {"Origin": "https://unrelated.example"}, 403),
            ("/api/config/meta", b"{}", {"Content-Type": "application/json"}, 403),
            ("/api/spatial/spaces/demo", b"{}", {"Content-Type": "application/json"}, 403),
            ("/api/spatial/spaces/demo", b"{}", {"Content-Type": "text/plain", "Origin": origin}, 415),
            ("/api/human-skills/jobs", b"{}", {"Content-Type": "application/json"}, 403),
            ("/api/human-skills/jobs", b"{}", {"Content-Type": "text/plain", "Origin": origin}, 415),
        ]
        for route, body, headers, status in cases:
            with self.subTest(route=route, status=status):
                connection = DelayedBodyConnection("127.0.0.1", self.server.server_port, timeout=2)
                try:
                    connection.request("POST", route, body, headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, status)
                    self.assertIn("error", json.loads(response.read()))
                finally:
                    connection.close()

    def test_rejection_drain_is_bounded_and_flushes_response_before_reading(self):
        handler = Handler.__new__(Handler)
        handler.headers = Message(); handler.headers["Content-Length"] = str(MAX_REJECT_DRAIN_BYTES * 2)
        events = []
        handler.error = Mock(side_effect=lambda *_: events.append("response"))
        handler.wfile = Mock(); handler.wfile.flush.side_effect = lambda: events.append("flush")
        handler.connection = Mock(); handler.connection.gettimeout.return_value = 30
        handler.rfile = Mock()
        def read(size):
            self.assertEqual(events[:2], ["response", "flush"])
            self.assertLessEqual(size, 8192)
            return b"x" * size
        handler.rfile.read1.side_effect = read
        handler.reject_before_body(413, "body_limit", "fixed")
        self.assertEqual(sum(call.args[0] for call in handler.rfile.read1.call_args_list), MAX_REJECT_DRAIN_BYTES)
        self.assertTrue(handler.close_connection)
        self.assertEqual(handler.connection.settimeout.call_args.args, (30,))
        # A per-read timeout alone would permit a slow body indefinitely. The
        # cumulative monotonic deadline stops even if each tiny read succeeds.
        handler.headers.replace_header("Content-Length", "100")
        handler.rfile.reset_mock(); handler.rfile.read1.side_effect = lambda _: b"x"
        handler.connection.reset_mock(); handler.connection.gettimeout.return_value = 30
        clock = Mock(side_effect=[0, .01, .15, .201])
        with patch("services.h1.server.time", SimpleNamespace(monotonic=clock)):
            handler.reject_before_body(413, "body_limit", "fixed")
        self.assertEqual(handler.rfile.read1.call_count, 2)
        self.assertTrue(all(0 < call.args[0] <= REJECT_DRAIN_SECONDS for call in handler.connection.settimeout.call_args_list[:-1]))
        self.assertEqual(handler.connection.settimeout.call_args.args, (30,))

    def test_rejection_never_reads_chunked_invalid_or_ambiguous_lengths(self):
        for lengths, transfer in ((["invalid"], None), (["-1"], None), (["2", "2"], None), ([], None), (["2"], "chunked"), (["2"], "")):
            with self.subTest(lengths=lengths, transfer=transfer):
                handler = Handler.__new__(Handler); handler.headers = Message()
                for length in lengths: handler.headers["Content-Length"] = length
                if transfer is not None: handler.headers["Transfer-Encoding"] = transfer
                handler.error = Mock(); handler.wfile = Mock(); handler.connection = Mock(); handler.rfile = Mock()
                handler.reject_before_body(413, "body_limit", "fixed")
                handler.rfile.read1.assert_not_called(); handler.connection.settimeout.assert_not_called()

    def test_semantic_rejection_after_reading_json_does_not_drain_a_second_body(self):
        with patch.object(Handler, "reject_before_body") as reject:
            code, _ = self.call("POST", "/api/practice", {"transcript": "Prueba.", "use_meta": True})
            self.assertEqual(code, 422); reject.assert_not_called()

    def test_local_mode_never_calls_meta(self):
        with patch("services.h1.server.propose_guidance") as provider:
            status, result = self.call("POST", "/api/practice", {"transcript": "Mi idea."})
            self.assertEqual(status, 200)
            self.assertEqual(result["mode"], "local")
            provider.assert_not_called()

    def test_meta_requires_consent_at_server_not_just_ui(self):
        with patch("services.h1.server.propose_guidance") as provider:
            status, result = self.call("POST", "/api/practice", {"transcript": "Mi idea.", "use_meta": True})
            self.assertEqual(status, 422)
            self.assertNotIn("Mi idea.", json.dumps(result))
            provider.assert_not_called()

    def test_provider_suggestions_cannot_overwrite_observations(self):
        advisory = {"guidance": {"message": "Sugerencia del modelo", "strengths": [], "improvements": [],
                                "next_exercise": "Repite", "evidence_notes": ["Solo texto"]},
                    "provider": "meta", "model": "test", "latency_ms": 5, "usage": {},
                    "checks": [{"id": "delivery", "verdict": "PASS"}]}
        with patch("services.h1.server.propose_guidance", return_value=advisory) as provider:
            status, result = self.call("POST", "/api/practice", {"transcript": "Mi idea.", "use_meta": True,
                                                                 "consent_to_send_transcript": True})
            self.assertEqual(status, 200)
            self.assertEqual(result["mode"], "meta")
            self.assertEqual(result["checks"][2]["verdict"], "UNKNOWN")
            self.assertEqual(provider.call_args.args[0]["transcript"], "Mi idea.")

    def test_meta_failure_does_not_masquerade_as_local_success(self):
        with patch("services.h1.server.propose_guidance", side_effect=MetaProviderError("timeout", "Tiempo agotado.")):
            status, result = self.call("POST", "/api/practice", {"transcript": "Mi idea.", "use_meta": True,
                                                                 "consent_to_send_transcript": True})
            self.assertEqual(status, 502)
            self.assertEqual(result["error"]["code"], "timeout")
            self.assertNotIn("guidance", result)

    def test_simultaneous_meta_calls_rejected_without_retries(self):
        META_LOCK.acquire()
        try:
            with patch("services.h1.server.propose_guidance") as provider:
                status, _ = self.call("POST", "/api/practice", {"transcript": "Mi idea.", "use_meta": True,
                                                               "consent_to_send_transcript": True})
                self.assertEqual(status, 409)
                provider.assert_not_called()
        finally:
            META_LOCK.release()

    def test_config_loader_does_not_execute_or_override_environment(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"BRIVANY_META_MODEL": "existing"}, clear=True):
            path = Path(directory) / ".env"
            path.write_text('BRIVANY_META_MODEL=replacement\nBRIVANY_META_API_KEY="test-local"\nUNRELATED=value\n', encoding="utf-8")
            load_local_config(path)
            self.assertEqual(os.environ["BRIVANY_META_MODEL"], "existing")
            self.assertEqual(os.environ["BRIVANY_META_API_KEY"], "test-local")
            self.assertNotIn("UNRELATED", os.environ)

    def test_meta_key_form_never_echoes_key_and_requires_same_origin(self):
        key = "fake-test-credential-0123456789"
        with patch("services.h1.server.save_meta_key") as save:
            self.assertEqual(self.call("POST", "/api/config/meta", {"key": key})[0], 403)
            save.assert_not_called()
            status, result = self.call("POST", "/api/config/meta", {"key": key},
                                       {"Origin": f"http://127.0.0.1:{self.server.server_port}"})
            self.assertEqual(status, 200)
            self.assertEqual(result, {"saved": True})
            self.assertNotIn(key, json.dumps(result))
            save.assert_called_once_with(key)

    def test_meta_key_save_preserves_config_and_rejects_line_injection(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("# keep comment\nBRIVANY_META_API_KEY=old\nBRIVANY_META_MODEL=keep-model\n", encoding="utf-8")
            key = "fake-test-credential-0123456789"
            save_meta_key(key, path)
            self.assertEqual(os.environ["BRIVANY_META_API_KEY"], key)
            text = path.read_text(encoding="utf-8")
            self.assertIn("# keep comment", text)
            self.assertIn("BRIVANY_META_MODEL=keep-model", text)
            self.assertEqual(text.count("BRIVANY_META_API_KEY="), 1)
            with self.assertRaises(ValueError):
                save_meta_key(key + "\nUNRELATED=value", path)
            self.assertEqual(path.read_text(encoding="utf-8"), text)

    def test_speech_releases_synthesis_slot_before_publishing_eof(self):
        lock = threading.Lock()
        closed, observed = [], []

        class Upstream(BytesIO):
            def close(self):
                closed.append(True)
                super().close()

        class Output(BytesIO):
            def write(self, data):
                if data == b"0\r\n\r\n":
                    observed.append((lock.locked(), bool(closed)))
                return super().write(data)

        request = json.dumps({"text": "Una frase de prueba.", "consent": True}).encode()
        handler = Handler.__new__(Handler)
        handler.rfile, handler.wfile = BytesIO(request), Output()
        handler.send_headers = lambda *args, **kwargs: None
        with patch("services.h1.server.VOICE_LOCK", lock), patch(
                "services.h1.server.open_melodi", return_value=Upstream(b"\x00\x01")):
            handler.speech(len(request))
        self.assertEqual(observed, [(False, True)])
        self.assertFalse(lock.locked())

    def test_dubbing_key_is_separate_persistent_and_never_echoed(self):
        key = "fake-dubbing-key-0123456789012345"
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("BRIVANY_META_API_KEY=preserve-meta\n# local settings\n", encoding="utf-8")
            save_dubbing_key(key, path)
            self.assertEqual(os.environ["BRIVANY_PALABRA_API_KEY"], key)
            self.assertIn("BRIVANY_META_API_KEY=preserve-meta", path.read_text())
            with self.assertRaises(ValueError): save_dubbing_key(key + "\nBAD=value", path)
        with patch("services.h1.server.save_dubbing_key") as save:
            self.assertEqual(self.call("POST", "/api/config/dubbing", {"key": key})[0], 403)
            save.assert_not_called()
            code, result = self.call("POST", "/api/config/dubbing", {"key": key, "provider": "palabra"},
                                    {"Origin": f"http://127.0.0.1:{self.server.server_port}"})
            self.assertEqual((code, result), (200, {"saved": True}))
            self.assertNotIn(key, json.dumps(result)); save.assert_called_once_with(key)
            self.assertEqual(self.call("POST", "/api/config/dubbing", {"key": key, "provider": "unknown"},
                                      {"Origin": f"http://127.0.0.1:{self.server.server_port}"})[0], 422)

    def test_dubbing_status_does_not_claim_availability_or_measured_latency(self):
        with patch.dict(os.environ, {}, clear=True):
            code, result = self.call("GET", "/api/dubbing/status")
            self.assertEqual(code, 200)
            self.assertFalse(result["configured"]); self.assertFalse(result["available"])
            self.assertIsNone(result["websocket_url"])
            self.assertEqual(result["provider"], "Muse · Meta Spark · Cartesia")
            self.assertTrue(result["continuous"])
            self.assertFalse(result["audible_latency_verified"])

    def test_modular_status_routes_to_own_bridge_and_never_saves_meta_as_dubbing_key(self):
        status = {"provider": "Meta modular", "configured": True, "inference_verified": False,
                  "target_inference_ms": 500, "inference_ms": None}
        self.server.modular_bridge = SimpleNamespace(port=19876)
        try:
            with patch("services.h1.server.modular_status", return_value=status):
                code, result = self.call("GET", "/api/dubbing/status?provider=meta")
                self.assertEqual(code, 200)
                self.assertEqual(result["provider"], "Meta modular")
                self.assertEqual(result["websocket_url"], "ws://127.0.0.1:19876/dub")
                self.assertTrue(result["available"])
                self.assertFalse(result["inference_verified"])
                self.assertIsNone(result["inference_ms"])
            connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            connection.request("GET", "/dubbing")
            response = connection.getresponse()
            self.assertIn("ws://127.0.0.1:19876", response.getheader("Content-Security-Policy"))
            response.read(); connection.close()
            with patch("services.h1.server.save_meta_key") as meta, patch("services.h1.server.save_dubbing_key") as dubbing:
                self.assertEqual(self.call("POST", "/api/config/dubbing", {"key": "fake-local-key-01234567890", "provider": "meta"},
                    {"Origin": f"http://127.0.0.1:{self.server.server_port}"})[0], 422)
                meta.assert_not_called(); dubbing.assert_not_called()
        finally:
            del self.server.modular_bridge

    def test_gemini_key_persists_independently_and_status_does_not_claim_access(self):
        key = "fake-google-key-for-local-test-0123456789"
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("BRIVANY_META_API_KEY=keep-meta\nBRIVANY_PALABRA_API_KEY=keep-palabra\n", encoding="utf-8")
            save_gemini_key(key, path)
            self.assertEqual(os.environ["BRIVANY_GEMINI_API_KEY"], key)
            self.assertIn("BRIVANY_META_API_KEY=keep-meta", path.read_text())
            self.assertIn("BRIVANY_PALABRA_API_KEY=keep-palabra", path.read_text())
            with patch.dict(os.environ, {}, clear=True):
                load_local_config(path)
                self.assertEqual(os.environ["BRIVANY_GEMINI_API_KEY"], key)
        with patch("services.h1.server.save_gemini_key") as save:
            code, result = self.call("POST", "/api/config/dubbing", {"key": key, "provider": "gemini"},
                {"Origin": f"http://127.0.0.1:{self.server.server_port}"})
            self.assertEqual((code, result), (200, {"saved": True}))
            self.assertNotIn(key, json.dumps(result)); save.assert_called_once_with(key)
        with patch.dict(os.environ, {}, clear=True):
            code, result = self.call("GET", "/api/dubbing/status?provider=gemini")
            self.assertEqual(code, 200)
            self.assertEqual(result["provider"], "Google Gemini")
            self.assertFalse(result["configured"]); self.assertFalse(result["available"])
            self.assertFalse(result["inference_verified"])

    def test_eleven_credentials_are_separate_and_status_never_implies_entitlement(self):
        key = "fake-eleven-key-for-local-test-012345"
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("BRIVANY_PALABRA_API_KEY=keep-palabra\n", encoding="utf-8")
            save_eleven_key(key, path)
            self.assertEqual(os.environ["BRIVANY_ELEVENLABS_API_KEY"], key)
            self.assertIn("BRIVANY_PALABRA_API_KEY=keep-palabra", path.read_text())
        with patch("services.h1.server.save_eleven_key") as save:
            code, result = self.call("POST", "/api/config/dubbing", {"key": key, "provider": "elevenlabs"},
                                    {"Origin": f"http://127.0.0.1:{self.server.server_port}"})
            self.assertEqual((code, result), (200, {"saved": True})); save.assert_called_once_with(key)
        with patch.dict(os.environ, {"BRIVANY_ELEVENLABS_API_KEY": key}, clear=True):
            code, result = self.call("GET", "/api/dubbing/status?provider=elevenlabs")
            self.assertEqual(code, 200); self.assertEqual(result["provider"], "ElevenLabs")
            self.assertTrue(result["configured"]); self.assertFalse(result["voice_configured"])
            self.assertFalse(result["available"]); self.assertFalse(result["inference_verified"])
            self.assertNotIn(key, json.dumps(result))
        self.assertEqual(self.call("GET", "/api/dubbing/status?provider=unknown")[0], 422)

    def test_openai_key_is_isolated_persistent_and_never_echoed(self):
        key = "fake-openai-key-for-private-form-012345"
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("BRIVANY_GEMINI_API_KEY=keep-google\nBRIVANY_META_API_KEY=keep-meta\n", encoding="utf-8")
            save_openai_key(key, path)
            self.assertEqual(os.environ["BRIVANY_OPENAI_API_KEY"], key)
            self.assertIn("BRIVANY_GEMINI_API_KEY=keep-google", path.read_text())
            self.assertIn("BRIVANY_META_API_KEY=keep-meta", path.read_text())
            with patch.dict(os.environ, {}, clear=True):
                load_local_config(path)
                self.assertEqual(os.environ["BRIVANY_OPENAI_API_KEY"], key)
        with patch("services.h1.server.save_openai_key") as save:
            code, result = self.call("POST", "/api/config/dubbing", {"provider": "openai", "key": key},
                                    {"Origin": f"http://127.0.0.1:{self.server.server_port}"})
            self.assertEqual((code, result), (200, {"saved": True}));save.assert_called_once_with(key)
            self.assertNotIn(key, json.dumps(result))
            save.reset_mock()
            self.assertEqual(self.call("POST", "/api/config/dubbing", {"provider": "openai", "key": key})[0], 403)
            save.assert_not_called()

    def test_openai_status_only_describes_local_readiness_and_separate_access(self):
        key = "fake-openai-key-for-status-012345"
        with patch.dict(os.environ, {"BRIVANY_OPENAI_API_KEY": key}, clear=True):
            with patch.object(self.server, "openai_translation_bridge", SimpleNamespace(port=9456), create=True):
                code, result = self.call("GET", "/api/dubbing/status?provider=openai")
                self.assertEqual(code, 200);self.assertEqual(result["provider"], "OpenAI")
                self.assertTrue(result["configured"]);self.assertTrue(result["available"])
                self.assertEqual(result["websocket_url"], "ws://127.0.0.1:9456/dub")
                self.assertFalse(result["access_verified"]);self.assertFalse(result["audible_delay_verified"])
                self.assertFalse(result["physical_playback_measured"])
                self.assertNotIn(key, json.dumps(result))


if __name__ == "__main__":
    unittest.main()
