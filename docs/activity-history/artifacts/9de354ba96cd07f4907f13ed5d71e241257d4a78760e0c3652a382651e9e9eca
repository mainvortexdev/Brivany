"""Bounded MT adapter checks; injected transport, no Cloudflare calls."""
import io
import json
import os
import threading
import time
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request
from pathlib import Path
from contextlib import redirect_stdout
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from packages.providers.translation import translate_text, text_translation_status, TranslationError, CloudflareTranslationSession, _CloudflareKeepAliveOpener, MODEL, MAX_RESPONSE_BYTES, MAX_ERROR_RESPONSE_BYTES
from packages.providers.live_voice import VoiceError, NoRedirect


class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"BRIVANY_CLOUDFLARE_ACCOUNT_ID": "a"*32, "BRIVANY_CLOUDFLARE_API_TOKEN": "private-test-token"}, clear=True)
        self.environment.start(); self.addCleanup(self.environment.stop)

    @staticmethod
    def reply(value, content_type="application/json"):
        response = io.BytesIO(json.dumps(value).encode("utf-8") if not isinstance(value, bytes) else value)
        response.headers = {"Content-Type": content_type}
        return response

    def test_specific_model_language_params_and_transport_budget(self):
        opener = Mock(); opener.open.return_value = self.reply({"success": True, "result": {"translated_text": "Este es el salón."}})
        result = translate_text(" This is the living room. ", opener=opener)
        request = opener.open.call_args.args[0]
        self.assertEqual(json.loads(request.data), {"text": "This is the living room.", "source_lang": "en", "target_lang": "es"})
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 5)
        self.assertTrue(request.full_url.endswith("/ai/run/"+MODEL))
        self.assertEqual(request.get_header("Authorization"), "Bearer private-test-token")
        self.assertEqual(result["text"], "Este es el salón."); self.assertEqual(result["model_origin"], "Meta")
        self.assertIsNone(result["inference_ms"]); self.assertGreaterEqual(result["request_ms"], 0)
        self.assertNotIn("private-test-token", json.dumps(result)); opener.open.assert_called_once()

    def test_bad_input_and_missing_configuration_never_call_transport(self):
        opener = Mock()
        for text in (None, "", " \n ", "x"*401, {}):
            with self.assertRaises(VoiceError): translate_text(text, opener=opener)
        for source, target in (("en", "en"), ("english", "es"), ("en", "fr"), ({}, "es")):
            with self.assertRaises(VoiceError): translate_text("Hello", source, target, opener=opener)
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(text_translation_status()["configured"])
            with self.assertRaises(VoiceError): translate_text("Hello", opener=opener)
        opener.open.assert_not_called()
        self.assertFalse(text_translation_status()["inference_verified"])

    def test_http_network_errors_are_sanitized_without_retry_or_redirect(self):
        opener = Mock()
        for failure in (HTTPError("https://upstream", 429, "private-test-token", {}, None), URLError("private-test-token"), TimeoutError("private-test-token")):
            opener.reset_mock(); opener.open.side_effect = failure
            with self.assertRaises(VoiceError) as error: translate_text("Hello", opener=opener)
            self.assertNotIn("private-test-token", str(error.exception)); opener.open.assert_called_once()
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://foreign"))

    def test_refused_empty_oversized_and_wrong_shapes_are_rejected(self):
        opener = Mock()
        invalid = [self.reply({"success": False, "errors": [{"message": "private-test-token"}]}),
            self.reply({"success": True, "result": {"translated_text": " "}}),
            self.reply({"success": True, "result": {"translated_text": "x"*2401}}),
            self.reply({"success": True, "result": []}), self.reply(b"not-json"),
            self.reply(b"x"*(MAX_RESPONSE_BYTES+1)), self.reply({}, "text/html")]
        for response in invalid:
            opener.reset_mock(); opener.open.return_value = response
            with self.assertRaises(VoiceError) as error: translate_text("Hello", opener=opener)
            self.assertNotIn("private-test-token", str(error.exception)); opener.open.assert_called_once()

    def test_http_diagnostics_only_copy_documented_numeric_codes_and_bounded_timing(self):
        opener = Mock()
        body = {"success": False, "errors": [{"code": 3036, "message": "private-test-token"},
            {"code": "private-test-token"}, {"code": 999999}, {"code": 3036}, {"code": True}],
            "messages": ["private-test-token"], "request": "private-test-token"}
        failure = HTTPError("https://private-test-token", 429, "private-test-token", {"Authorization": "private-test-token"},
                            io.BytesIO(json.dumps(body).encode()))
        opener.open.side_effect = failure
        with self.assertRaises(TranslationError) as raised: translate_text("Hello", opener=opener)
        diagnostic = raised.exception.diagnostics()
        self.assertEqual(diagnostic["http_status"], 429)
        self.assertEqual(diagnostic["provider_error_codes"], [3036])
        self.assertGreaterEqual(diagnostic["request_ms"], 0)
        self.assertIsNone(diagnostic["inference_ms"])
        self.assertNotIn("private-test-token", json.dumps(diagnostic) + str(raised.exception))
        self.assertTrue(failure.closed); opener.open.assert_called_once()

    def test_non_json_or_oversized_http_failure_preserves_status_without_raw_body(self):
        opener = Mock()
        for body in (b"private-test-token", b"x"*(MAX_ERROR_RESPONSE_BYTES+1)):
            opener.reset_mock(); opener.open.side_effect = HTTPError("https://upstream", 403,
                "private-test-token", {}, io.BytesIO(body))
            with self.assertRaises(TranslationError) as raised: translate_text("Hello", opener=opener)
            self.assertEqual(raised.exception.http_status, 403)
            self.assertEqual(raised.exception.provider_error_codes, [])
            self.assertNotIn("private-test-token", json.dumps(raised.exception.diagnostics()))
            opener.open.assert_called_once()

    def test_benchmark_failure_report_keeps_safe_diagnostics_and_no_inference_claim(self):
        from tools import benchmark_translation
        with TemporaryDirectory() as directory:
            failure = TranslationError("mt_rejected", "Static sanitized failure", http_status=429,
                                       provider_error_codes=[3036], request_ms=123.4)
            with patch.object(benchmark_translation, "ROOT", Path(directory)), \
                 patch.object(benchmark_translation, "load_local_config"), \
                 patch.object(benchmark_translation, "text_translation_status", return_value={"configured": True}), \
                 patch.object(benchmark_translation, "translate_text", side_effect=failure) as transport, \
                 patch.object(benchmark_translation, "ActivityStore") as store, \
                 patch("sys.argv", ["benchmark_translation", "--allow-paid"]), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(benchmark_translation.main(), 1)
            report = json.loads(next((Path(directory)/"tmp"/"translation-measurements").glob("*.json")).read_text(encoding="utf-8"))
            self.assertEqual(report["http_status"], 429); self.assertEqual(report["provider_error_codes"], [3036])
            self.assertEqual(report["request_ms"], 123.4)
            self.assertGreaterEqual(report["attempt_elapsed_ms"], 0)
            self.assertIsNone(report["inference_ms"]); self.assertIsNone(report["actual_billed_usd"])
            self.assertEqual(report["automatic_retries"], 0); self.assertEqual(report["target_status"], "unverified")
            self.assertNotIn("private-test-token", output.getvalue() + json.dumps(report))
            transport.assert_called_once(); store.return_value.add.assert_called_once()


class TranslationKeepAliveTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"BRIVANY_CLOUDFLARE_ACCOUNT_ID": "a"*32,
            "BRIVANY_CLOUDFLARE_API_TOKEN": "private-test-token"}, clear=True)
        environment.start(); self.addCleanup(environment.stop)

    def server(self, mode="success"):
        calls, release, arrived = [], threading.Event(), threading.Event()
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *args): pass
            def handle(self):
                try: super().handle()
                except (OSError, ValueError): pass
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                calls.append({"port": self.client_address[1], "path": self.path,
                              "auth": self.headers.get("Authorization"), "body": json.loads(body)})
                if mode != "wait_body": arrived.set()
                if mode == "wait": release.wait(2)
                status = 302 if mode == "redirect" else 429 if mode == "error" else 200
                value = {"success": status == 200, "result": {"translated_text": "Hola."},
                         "errors": [{"code": 3036, "message": "private-test-token"}] if mode == "error" else []}
                encoded = json.dumps(value).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(encoded)))
                    if mode == "redirect": self.send_header("Location", "https://foreign.invalid/private-test-token")
                    if mode == "close": self.send_header("Connection", "close")
                    self.end_headers()
                    if mode == "wait_body": arrived.set(); release.wait(2)
                    if mode == "slow_body": threading.Event().wait(0.15)
                    self.wfile.write(encoded); self.wfile.flush()
                except (OSError, ValueError): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        def cleanup():
            release.set(); server.shutdown(); server.server_close(); worker.join(1)
        self.addCleanup(cleanup)
        def factory(host, port, *, timeout):
            self.assertEqual((host, port), ("api.cloudflare.com", 443))
            return HTTPConnection("127.0.0.1", server.server_port, timeout=timeout)
        return factory, calls, release, arrived

    def test_two_segments_reuse_one_http11_socket_and_close_prevents_reopening(self):
        factory, calls, _, _ = self.server()
        with CloudflareTranslationSession(_connection_factory=factory) as session:
            self.assertEqual(session("Hello.")["text"], "Hola.")
            self.assertEqual(session("Welcome.")["text"], "Hola.")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["port"], calls[1]["port"])
        self.assertTrue(all(row["auth"] == "Bearer private-test-token" for row in calls))
        self.assertTrue(all(row["path"] == "/client/v4/accounts/"+"a"*32+"/ai/run/"+MODEL for row in calls))
        with self.assertRaises(VoiceError) as failure: session("Again.")
        self.assertEqual(failure.exception.code, "mt_session_closed")
        self.assertNotIn("private-test-token", str(failure.exception)); self.assertEqual(len(calls), 2)

    def test_redirect_and_http_error_are_not_followed_or_retried(self):
        for mode, status in (("redirect", 302), ("error", 429)):
            factory, calls, _, _ = self.server(mode)
            session = CloudflareTranslationSession(_connection_factory=factory)
            self.addCleanup(session.close)
            with self.assertRaises(TranslationError) as failure: session("Hello.")
            self.assertEqual(failure.exception.http_status, status)
            self.assertNotIn("private-test-token", str(failure.exception) + json.dumps(failure.exception.diagnostics()))
            if mode == "error": self.assertEqual(failure.exception.provider_error_codes, [3036])
            with self.assertRaises(VoiceError) as closed: session("Again.")
            self.assertEqual(closed.exception.code, "mt_session_closed"); self.assertEqual(len(calls), 1)

    def test_timeout_ends_session_without_retry(self):
        factory, calls, release, _ = self.server("wait")
        session = CloudflareTranslationSession(_connection_factory=factory); self.addCleanup(session.close)
        with patch("packages.providers.translation.TIMEOUT_SECONDS", 0.05):
            with self.assertRaises(TranslationError) as failure: session("Hello.")
        release.set()
        self.assertEqual(failure.exception.code, "mt_unavailable")
        self.assertEqual(len(calls), 1)
        with self.assertRaises(VoiceError) as closed: session("Again.")
        self.assertEqual(closed.exception.code, "mt_session_closed"); self.assertEqual(len(calls), 1)

    def test_close_interrupts_blocked_request_and_discards_its_output(self):
        for mode in ("wait", "wait_body"):
            factory, calls, release, arrived = self.server(mode)
            session = CloudflareTranslationSession(_connection_factory=factory); self.addCleanup(session.close)
            outputs, failures = [], []
            def request():
                try: outputs.append(session("Hello."))
                except VoiceError as failure: failures.append(failure)
            worker = threading.Thread(target=request, daemon=True); worker.start()
            self.assertTrue(arrived.wait(1))
            before_close = time.monotonic(); session.close()
            self.assertLess(time.monotonic()-before_close, 0.5)
            # Windows may finish the blocking read only when the server responds
            # or its socket timeout expires. Always discard the closed result.
            worker.join(3); release.set()
            self.assertFalse(worker.is_alive()); self.assertEqual(outputs, [])
            self.assertEqual(len(failures), 1); self.assertEqual(len(calls), 1)
            self.assertNotIn("private-test-token", str(failures[0]))

    def test_slow_response_body_keeps_http_file_valid_and_socket_reusable(self):
        factory, calls, _, _ = self.server("slow_body")
        with CloudflareTranslationSession(_connection_factory=factory) as session:
            self.assertEqual(session("Hello.")["text"], "Hola.")
            self.assertEqual(session("Welcome.")["text"], "Hola.")
        self.assertEqual(len(calls), 2); self.assertEqual(calls[0]["port"], calls[1]["port"])

    def test_server_connection_close_completes_current_response_without_reconnecting(self):
        factory, calls, _, _ = self.server("close")
        session = CloudflareTranslationSession(_connection_factory=factory); self.addCleanup(session.close)
        self.assertEqual(session("Hello.")["text"], "Hola.")
        with self.assertRaises(VoiceError) as failure: session("Again.")
        self.assertEqual(failure.exception.code, "mt_session_closed"); self.assertEqual(len(calls), 1)

    def test_fixed_origin_path_method_and_headers_checked_before_transport(self):
        factory = Mock()
        opener = _CloudflareKeepAliveOpener("a"*32, _connection_factory=factory)
        self.addCleanup(opener.close)
        path = "/client/v4/accounts/"+"a"*32+"/ai/run/"+MODEL
        base = "https://api.cloudflare.com"+path
        headers = {"Authorization": "Bearer private-test-token", "Content-Type": "application/json", "Accept": "application/json"}
        invalid = ["http://api.cloudflare.com"+path, "https://foreign.invalid"+path,
            "https://api.cloudflare.com:444"+path, "https://private-test-token@api.cloudflare.com"+path,
            base+"?token=private-test-token", base+"#fragment", base+"/other"]
        for url in invalid:
            with self.assertRaises(VoiceError): opener.open(Request(url, data=b"{}", headers=headers))
        for extra in ({"Host": "foreign.invalid"}, {"Authorization": "Bearer private-test-token\nunsafe"}):
            with self.assertRaises(VoiceError): opener.open(Request(base, data=b"{}", headers={**headers, **extra}))
        with self.assertRaises(VoiceError): opener.open(Request(base, headers=headers, method="GET"))
        factory.assert_not_called()


if __name__ == "__main__": unittest.main()
