"""Translation transport tests use loopback providers; no paid or external requests."""
import base64
import json
import os
import threading
import time
import unittest
from unittest.mock import patch

from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed, InvalidStatus

from packages.providers.dubbing import TranslationBridge, TranslationEvents, dubbing_status, start_options
from packages.providers.live_voice import VoiceError

OPTIONS = {"type": "start", "consent": True, "target_language": "es", "max_seconds": 5}
PCM = b"\0\1" * 2400


def provider_handshake(ws):
    ws.send(json.dumps({"type": "session.created"}))
    update = json.loads(ws.recv())
    ws.send(json.dumps({"type": "session.updated"}))
    return update


class DubbingTests(unittest.TestCase):
    def test_consent_limits_and_missing_credentials_fail_before_connecting(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(dubbing_status()["configured"])
            for value in ({}, {**OPTIONS, "consent": False}, OPTIONS):
                with self.assertRaises(VoiceError): start_options(value)
        with patch.dict(os.environ, {"BRIVANY_OPENAI_API_KEY": "test-secret"}, clear=True):
            self.assertEqual(start_options(OPTIONS), ("es", 5))
            self.assertEqual(start_options({**OPTIONS, "source_language": "en"}), ("es", 5))
            for value in ({**OPTIONS, "max_seconds": True}, {**OPTIONS, "max_seconds": 61},
                          {**OPTIONS, "target_language": "xx"}, {**OPTIONS, "url": "https://foreign"},
                          {**OPTIONS, "source_language": "es"}, {**OPTIONS, "source_language": "xx"},
                          {**OPTIONS, "source_language": []}, {**OPTIONS, "target_language": []}):
                with self.assertRaises(VoiceError): start_options(value)
            self.assertNotIn("test-secret", json.dumps(dubbing_status()))

    def test_only_explicit_brivany_credential_is_used_and_access_is_not_inferred(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "another-application-secret"}, clear=True):
            self.assertFalse(dubbing_status()["configured"])
            with self.assertRaises(VoiceError): start_options(OPTIONS)
        with patch.dict(os.environ, {"BRIVANY_OPENAI_API_KEY": "dedicated-test-secret"}, clear=True):
            status = dubbing_status()
            self.assertTrue(status["configured"])
            self.assertFalse(status["access_verified"])
            self.assertFalse(status["audible_delay_verified"])
            self.assertEqual(status["source_language_mode"], "automatic")
            self.assertEqual(status["drain_seconds"], 10)
        for key in ("invalid\nheader", "x" * 4097):
            with patch.dict(os.environ, {"BRIVANY_OPENAI_API_KEY": key}, clear=True):
                with self.assertRaises(VoiceError): start_options(OPTIONS)

    def test_deltas_deduplicate_ids_but_keep_shared_alignment_and_format(self):
        events = TranslationEvents()
        first = {"type": "session.output_transcript.delta", "event_id": "a", "delta": "Hola", "elapsed_ms": 200}
        self.assertEqual(events.accept(first)["text"], "Hola")
        self.assertIsNone(events.accept(first))
        self.assertEqual(events.accept({**first, "event_id": "b", "delta": " mundo"})["text"], " mundo")
        audio = events.accept({"type": "session.output_audio.delta", "event_id": "c", "delta": base64.b64encode(PCM).decode(), "sample_rate": 24000, "channels": 1, "format": "pcm16", "elapsed_ms": 200})
        self.assertEqual(base64.b64decode(audio["audio"]), PCM)
        for invalid in ({"delta": "bad"}, {"delta": base64.b64encode(b"odd").decode()}, {"delta": base64.b64encode(PCM).decode(), "sample_rate": 48000}):
            with self.assertRaises(VoiceError): events.accept({"type": "session.output_audio.delta", **invalid})

    def with_relay(self, handler, body):
        with serve(handler, "127.0.0.1", 0, compression=None) as fake:
            threading.Thread(target=fake.serve_forever, daemon=True).start()
            endpoint = f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"
            bridge = TranslationBridge(9876).start()
            try:
                with patch.dict(os.environ, {"BRIVANY_OPENAI_API_KEY": "test-secret"}, clear=True), patch("packages.providers.dubbing.URL", endpoint):
                    body(bridge)
            finally: bridge.close()

    @staticmethod
    def browser(bridge):
        return connect(f"ws://127.0.0.1:{bridge.port}/dub", origin="http://127.0.0.1:9876", proxy=None)

    def test_relay_pcm_translation_finish_drains_and_metrics_are_not_inference(self):
        received = []
        def upstream(ws):
            self.assertEqual(ws.request.headers["Authorization"], "Bearer test-secret")
            received.append(provider_handshake(ws))
            received.append(json.loads(ws.recv()))
            received.append(json.loads(ws.recv()))
            ws.send(json.dumps({"type": "session.output_transcript.delta", "event_id": "text", "delta": "Hola."}))
            ws.send(json.dumps({"type": "session.output_audio.delta", "event_id": "audio", "delta": base64.b64encode(PCM).decode()}))
            ws.send(json.dumps({"type": "session.closed", "event_id": "closed"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(PCM); browser.send(json.dumps({"type": "finish"}))
                events = []
                while True:
                    event = json.loads(browser.recv(timeout=2)); events.append(event)
                    if event["type"] == "done": break
                self.assertEqual([event["text"] for event in events if event["type"] == "transcript"], ["Hola."])
                self.assertEqual(b"".join(base64.b64decode(event["audio"]) for event in events if event["type"] == "audio"), PCM)
                metrics = [event for event in events if event["type"] == "metrics"]
                self.assertTrue(all(event["inference_ms"] is None and not event["inference_verified"] for event in metrics))
                self.assertEqual(metrics[-1]["bytes_sent"], len(PCM))
                self.assertEqual(metrics[-1]["provider_input_bytes"], len(PCM))
                self.assertTrue(metrics[-1]["provider_finalization_verified"])
                self.assertTrue(events[-1]["finalization_verified"])
        self.with_relay(upstream, body)
        self.assertEqual(received[0]["session"]["audio"]["input"], {"noise_reduction": None, "transcription": None})
        self.assertEqual(received[1]["type"], "session.input_audio_buffer.append")
        self.assertEqual(base64.b64decode(received[1]["audio"]), PCM)
        self.assertEqual(received[2], {"type": "session.close"})

    def test_cancel_closes_upstream_and_concurrent_session_is_rejected(self):
        closed = threading.Event()
        def upstream(ws):
            provider_handshake(ws)
            try:
                for _ in ws: pass
            finally: closed.set()
        def body(bridge):
            with self.browser(bridge) as first:
                first.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(first.recv(timeout=2))["type"], "ready")
                with self.browser(bridge) as second:
                    error = json.loads(second.recv(timeout=2)); self.assertEqual(error["code"], "dubbing_busy")
                first.send(json.dumps({"type": "cancel"}))
                self.assertTrue(closed.wait(2))
        self.with_relay(upstream, body)

    def test_private_origin_path_and_no_key_never_contact_upstream(self):
        bridge = TranslationBridge(9876).start()
        try:
            for path, origin in (("/dub", "https://foreign.example"), ("/other", "http://127.0.0.1:9876")):
                with self.assertRaises(InvalidStatus): connect(f"ws://127.0.0.1:{bridge.port}{path}", origin=origin, proxy=None)
            with patch.dict(os.environ, {}, clear=True), patch("packages.providers.dubbing.connect") as upstream:
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["code"], "dubbing_not_configured")
                upstream.assert_not_called()
        finally: bridge.close()

    def test_oversized_odd_and_too_fast_audio_are_rejected_without_retry(self):
        def upstream(ws):
            provider_handshake(ws)
            try:
                for _ in ws: pass
            except ConnectionClosed: pass
        def body(bridge):
            for data, count, code in ((b"\0", 1, "dubbing_audio_format"), (b"\0" * 9602, 1, "dubbing_audio_format"), (b"\0" * 9600, 3, "dubbing_backlog")):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                    for _ in range(count): browser.send(data)
                    self.assertEqual(json.loads(browser.recv(timeout=2))["code"], code)
        self.with_relay(upstream, body)

    def test_upstream_error_is_sanitized_and_no_done_claimed(self):
        def upstream(ws):
            provider_handshake(ws); ws.recv()
            ws.send(json.dumps({"type": "error", "error": {"message": "test-secret internal detail"}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(PCM * 2)
                error = json.loads(browser.recv(timeout=2))
                self.assertEqual(error["type"], "error"); self.assertNotIn("test-secret", json.dumps(error))
        self.with_relay(upstream, body)

    def test_finalization_has_deadline_and_does_not_claim_done(self):
        def upstream(ws):
            provider_handshake(ws)
            try:
                for _ in ws: pass  # Simulated provider never emits session.closed.
            except ConnectionClosed: pass
        def body(bridge):
            with self.browser(bridge) as browser, patch("packages.providers.dubbing.DRAIN_SECONDS", .05):
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(json.dumps({"type": "finish"}))
                error = json.loads(browser.recv(timeout=2))
                self.assertEqual(error["code"], "dubbing_drain_timeout")
        self.with_relay(upstream, body)

    def test_wall_duration_closes_idle_session_instead_of_leaving_billable_connection(self):
        received = []
        def upstream(ws):
            provider_handshake(ws); received.append(json.loads(ws.recv(timeout=7)))
            ws.send(json.dumps({"type": "session.closed"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                values = []
                while True:
                    value = json.loads(browser.recv(timeout=7)); values.append(value)
                    if value["type"] == "done": break
                self.assertTrue(any(value["type"] == "input-ended" for value in values))
                metrics = next(value for value in values if value["type"] == "metrics")
                self.assertIsNone(metrics["first_output_audio_ms"]); self.assertEqual(metrics["bytes_sent"], 0)
        self.with_relay(upstream, body)
        self.assertEqual(received, [{"type": "session.close"}])

    def test_40ms_input_frames_form_200ms_upstream_frames_and_exact_final_partial(self):
        original = bytes(range(256)) * 48 + b"\x10\x20" * 29  # 12346 bytes; an even final partial.
        received = []
        def upstream(ws):
            received.append(provider_handshake(ws))
            for raw in ws:
                event = json.loads(raw); received.append(event)
                if event["type"] == "session.close":
                    ws.send(json.dumps({"type": "session.closed"})); return
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "source_language": "en"}))
                ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["source_language_requested"], "en")
                self.assertEqual(ready["source_language_mode"], "automatic")
                self.assertFalse(ready["source_language_enforced"])
                self.assertEqual(ready["drain_seconds"], 10)
                for offset in range(0, len(original), 1920): browser.send(original[offset:offset + 1920])
                browser.send(json.dumps({"type": "finish"}))
                while json.loads(browser.recv(timeout=2))["type"] != "done": pass
        self.with_relay(upstream, body)
        audio = [base64.b64decode(event["audio"]) for event in received if event["type"] == "session.input_audio_buffer.append"]
        self.assertEqual([len(chunk) for chunk in audio], [9600, len(original) - 9600])
        self.assertEqual(b"".join(audio), original)
        self.assertEqual(received[-1], {"type": "session.close"})

    def test_coalesced_output_is_preserved_in_40ms_slices_without_idle_credit_or_browser_backlog(self):
        original = bytes(range(256)) * 495 + b"\0\1\2\3\4\5\6\7\10\11"  # 126730 bytes.
        received, times = [], []
        def upstream(ws):
            provider_handshake(ws); ws.recv(); ws.recv()  # 200 ms input, then finish.
            time.sleep(.45)  # Must not accumulate more than the 300 ms output lead.
            ws.send(json.dumps({"type": "session.output_audio.delta", "event_id": "burst", "delta": base64.b64encode(original).decode(), "elapsed_ms": 200}))
            ws.send(json.dumps({"type": "session.output_transcript.delta", "event_id": "text", "delta": "Final."}))
            ws.send(json.dumps({"type": "session.closed"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(PCM * 2); browser.send(json.dumps({"type": "finish"}))
                while True:
                    event = json.loads(browser.recv(timeout=4)); received.append(event)
                    if event["type"] == "audio": times.append(time.monotonic())
                    if event["type"] == "done": break
        self.with_relay(upstream, body)
        chunks = [base64.b64decode(event["audio"]) for event in received if event["type"] == "audio"]
        self.assertEqual(len(chunks), 67); self.assertEqual(len(chunks[-1]), 10)
        self.assertEqual(b"".join(chunks), original)
        self.assertTrue(all(len(chunk) <= 1920 for chunk in chunks))
        self.assertTrue(all(event["elapsed_ms"] == 200 for event in received if event["type"] == "audio"))
        until, max_lead = 0, 0
        for stamp, chunk in zip(times, chunks):
            now = stamp - times[0]; until = max(until, now + .035) + len(chunk) / 48000
            max_lead = max(max_lead, until - now)
        self.assertLess(max_lead, .39)
        self.assertGreater(times[-1] - times[0], 1.8)
        self.assertEqual([event["text"] for event in received if event["type"] == "transcript"], ["Final."])
        self.assertEqual(received[-1]["type"], "done")

    def test_cancel_interrupts_a_paced_delta_and_discards_late_transcript_metrics_and_done(self):
        closed = threading.Event()
        def upstream(ws):
            provider_handshake(ws); ws.recv()
            ws.send(json.dumps({"type": "session.output_audio.delta", "delta": base64.b64encode(b"\0\1" * 240000).decode()}))
            ws.send(json.dumps({"type": "session.output_transcript.delta", "delta": "Late text must not escape."}))
            ws.send(json.dumps({"type": "session.closed"}))
            try:
                for _ in ws: pass
            finally: closed.set()
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(PCM * 2)
                while json.loads(browser.recv(timeout=2))["type"] != "audio": pass
                started = time.monotonic(); browser.send(json.dumps({"type": "cancel"}))
                after = []
                try:
                    while True: after.append(json.loads(browser.recv(timeout=2)))
                except ConnectionClosed: pass
                self.assertLess(time.monotonic() - started, .75)
                self.assertFalse(any(event["type"] in {"transcript", "metrics", "done", "error"} for event in after))
                self.assertTrue(closed.wait(2))
        self.with_relay(upstream, body)

    def test_premature_provider_closed_never_claims_a_verified_finalization(self):
        def upstream(ws):
            provider_handshake(ws); ws.recv()
            ws.send(json.dumps({"type": "session.closed"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                browser.send(PCM * 2)
                error = json.loads(browser.recv(timeout=2))
                self.assertEqual(error["code"], "dubbing_incomplete")
        self.with_relay(upstream, body)

    def test_provider_closed_during_final_partial_flush_is_not_a_close_acknowledgement(self):
        provider_closed = threading.Event()
        def upstream(ws):
            provider_handshake(ws)
            self.assertEqual(json.loads(ws.recv())["type"], "session.input_audio_buffer.append")
            ws.send(json.dumps({"type": "session.closed"})); provider_closed.set()
            try:
                for _ in ws: pass
            except ConnectionClosed: pass
        def body(bridge):
            actual_connect = connect
            class DelayedInputSend:
                def __init__(self, socket): self.socket = socket
                def __getattr__(self, name): return getattr(self.socket, name)
                def send(self, message):
                    self.socket.send(message)
                    if json.loads(message).get("type") == "session.input_audio_buffer.append":
                        provider_closed.wait(2); time.sleep(.08)
            def connect_with_delay(*args, **kwargs): return DelayedInputSend(actual_connect(*args, **kwargs))
            with patch("packages.providers.dubbing.connect", side_effect=connect_with_delay):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                    # 100 ms stays buffered until finish, exercising the interval
                    # after closing_at is set but before session.close is sent.
                    browser.send(PCM); browser.send(json.dumps({"type": "finish"}))
                    error = json.loads(browser.recv(timeout=2))
                    self.assertEqual(error["code"], "dubbing_incomplete")
                    with self.assertRaises(ConnectionClosed): browser.recv(timeout=2)
        self.with_relay(upstream, body)


if __name__ == "__main__": unittest.main()
