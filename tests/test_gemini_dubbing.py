"""Google Live Translate adapter checks. Every upstream is loopback or mocked."""
import base64
import json
import math
import os
import queue
import struct
import threading
import time
import unittest
from unittest.mock import patch

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect
from websockets.sync.server import serve

from packages.providers.gemini_dubbing import (
    GeminiBridge, GeminiEvents, PCM24To16, URL, dubbing_key, gemini_status,
    parse_event, setup_event, start_options,
)
from packages.providers.live_voice import VoiceError

OPTIONS = {"type": "start", "consent": True, "source_language": "en", "target_language": "es", "max_seconds": 5}
CONFIG = {"BRIVANY_GEMINI_API_KEY": "local-test-secret"}
PCM = b"\0\1" * 2400


def audio_event(data=PCM, **content):
    return {"serverContent": {"modelTurn": {"parts": [{"inlineData": {
        "mimeType": "audio/pcm;rate=24000", "data": base64.b64encode(data).decode("ascii")}}]}, **content}}


class ManualClock:
    """A monotonic clock shared by the relay and its test driver."""
    def __init__(self, initial=100.0):
        self.value, self.lock = float(initial), threading.Lock()

    def __call__(self):
        with self.lock: return self.value

    def advance(self, seconds):
        if seconds < 0: raise ValueError("The test clock cannot go backwards")
        with self.lock:
            self.value += seconds
            return self.value


class GeminiDubbingTests(unittest.TestCase):
    def with_relay(self, handler, body, clock=None):
        failures = []
        clock = clock or ManualClock()

        def checked(ws):
            try: handler(ws)
            except ConnectionClosed: pass
            except Exception as exc: failures.append(exc)

        with serve(checked, "127.0.0.1", 0, compression=None) as fake:
            threading.Thread(target=fake.serve_forever, daemon=True).start()
            bridge = GeminiBridge(9876, port=0, clock=clock).start()
            try:
                with patch.dict(os.environ, CONFIG, clear=True), patch("packages.providers.gemini_dubbing.URL", f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"):
                    body(bridge)
            finally: bridge.close()
        if failures: raise failures[0]

    @staticmethod
    def browser(bridge):
        return connect(f"ws://127.0.0.1:{bridge.port}/dub", origin="http://127.0.0.1:9876", proxy=None)

    @staticmethod
    def handshake(ws):
        value = json.loads(ws.recv(timeout=2))
        ws.send(json.dumps({"setupComplete": {}}))
        return value

    def receive_error(self, browser):
        summary = json.loads(browser.recv(timeout=2))
        self.assertEqual(summary["type"], "metrics")
        self.assertIn("provider_diagnostics", summary)
        event = json.loads(browser.recv(timeout=2))
        self.assertEqual(event["type"], "error")
        return event

    def assert_no_message(self, browser):
        with self.assertRaises(TimeoutError): browser.recv(timeout=.15)

    def receive_done(self, browser, reason="quiet_window", values=None):
        values = [] if values is None else values
        while not values or values[-1]["type"] != "done":
            values.append(json.loads(browser.recv(timeout=2)))
        final = next(value for value in reversed(values) if value["type"] == "metrics")
        for value in (final, values[-1]):
            self.assertIs(value["session_closed_locally"], True)
            self.assertEqual(value["completion_method"], "bounded_post_input_drain")
            self.assertEqual(value["completion_reason"], reason)
            self.assertIs(value["provider_input_consumed_acknowledged"], False)
            self.assertIs(value["finalization_verified"], False)
        with self.assertRaises(ConnectionClosed): browser.recv(timeout=2)
        return values

    def test_explicit_key_options_and_sdk_setup_shape(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "unrelated", "GOOGLE_API_KEY": "unrelated"}, clear=True):
            self.assertEqual(dubbing_key(), "")
            self.assertFalse(gemini_status()["configured"])
            with self.assertRaises(VoiceError): start_options(OPTIONS)
        with patch.dict(os.environ, CONFIG, clear=True):
            self.assertEqual(start_options(OPTIONS), ("en", "es", 5))
            self.assertEqual(start_options({**OPTIONS, "tail_silence_seconds": 0}), ("en", "es", 5))
            self.assertEqual(start_options({**OPTIONS, "tail_silence_seconds": 2}), ("en", "es", 5))
            self.assertEqual(start_options({**OPTIONS, "source_language": "es", "target_language": "en"}), ("es", "en", 5))
            for options in ({**OPTIONS, "consent": False}, {**OPTIONS, "source_language": "es"},
                            {**OPTIONS, "max_seconds": True}, {**OPTIONS, "max_seconds": 61},
                            {**OPTIONS, "target_language": "fr"}, {**OPTIONS, "model": "other"},
                            *({**OPTIONS, "tail_silence_seconds": value} for value in (4, True, False, -1, 1, 2.0, "2", None))):
                with self.assertRaises(VoiceError): start_options(options)
            self.assertFalse(gemini_status()["inference_verified"])
            self.assertFalse(gemini_status()["access_verified"])
            self.assertEqual(gemini_status()["drain_min_seconds"], 4)
            self.assertEqual(gemini_status()["drain_quiet_seconds"], .75)
            self.assertEqual(gemini_status()["drain_seconds"], 12)
            self.assertEqual(gemini_status()["tail_silence_seconds_default"], 0)
            self.assertEqual(gemini_status()["tail_silence_seconds_options"], [0, 2])
            self.assertEqual(gemini_status()["padding_max_seconds"], 2)
            self.assertEqual(gemini_status()["completion_method"], "bounded_post_input_drain")
            self.assertIs(gemini_status()["provider_input_consumed_acknowledged"], False)
            self.assertIs(gemini_status()["finalization_verified"], False)
            self.assertEqual(gemini_status()["source_language_mode"], "automatic")
            self.assertNotIn(CONFIG["BRIVANY_GEMINI_API_KEY"], json.dumps(gemini_status()))
        setup = setup_event("es")["setup"]
        self.assertEqual(setup["generationConfig"]["translationConfig"], {"targetLanguageCode": "es", "echoTargetLanguage": False})
        self.assertEqual(setup["inputAudioTranscription"], {})
        self.assertEqual(setup["outputAudioTranscription"], {})
        self.assertNotIn("inputAudioTranscription", setup["generationConfig"])
        self.assertNotIn("?", URL)

    def test_resampler_preserves_state_duration_and_rejects_aliasing(self):
        samples = [round(10000 * math.sin(2 * math.pi * 1000 * index / 24000)) for index in range(4800)]
        raw = struct.pack("<" + "h" * len(samples), *samples)
        whole = PCM24To16(); expected = whole.feed(raw, final=True)
        chunks = PCM24To16(); converted = bytearray()
        sizes, offset = [2, 22, 800, 1920, 4000, 180], 0
        while offset < len(raw):
            count = sizes[(offset // 2) % len(sizes)]
            converted.extend(chunks.feed(raw[offset:offset + count])); offset += count
        converted.extend(chunks.feed(b"", final=True))
        self.assertEqual(bytes(converted), expected)
        self.assertEqual(len(expected), len(samples) * 2 // 3 * 2)
        self.assertEqual(chunks.samples, [])
        with self.assertRaises(VoiceError): chunks.feed(b"\0\0")
        with self.assertRaises(VoiceError): PCM24To16().feed(b"odd")
        for count in (0, 1, 2, 3, 31, 32, 33, 4811):
            resampler = PCM24To16()
            output = resampler.feed(b"\0\0" * count) + resampler.feed(b"", final=True)
            self.assertEqual(len(output), count * 2 // 3 * 2)
        high = [round(10000 * math.sin(2 * math.pi * 10000 * index / 24000)) for index in range(4800)]
        high_bytes = PCM24To16().feed(struct.pack("<" + "h" * len(high), *high), final=True)
        rms = lambda data: math.sqrt(sum(value * value for value in struct.unpack("<" + "h" * (len(data) // 2), data)[33:-33]) / (len(data) // 2 - 66))
        self.assertGreater(rms(expected), 6900)
        self.assertLess(rms(high_bytes), rms(expected) * .03)

    def test_events_pcm_transcripts_repetition_and_completion_validation(self):
        events = GeminiEvents()
        normalized, complete = events.accept(audio_event(inputTranscription={"text": "Hello"}, outputTranscription={"text": "Hola"}))
        self.assertEqual([event["source"] for event in normalized if event["type"] == "transcript"], ["original", "translation"])
        self.assertEqual(base64.b64decode(normalized[-1]["audio"]), PCM)
        self.assertFalse(complete)
        # Identical PCM chunks are legitimate audio, not identifiers to deduplicate.
        events.accept(audio_event()); self.assertEqual(events.output_bytes, len(PCM) * 2)
        self.assertTrue(events.accept({"serverContent": {"turnComplete": True}})[1])
        self.assertFalse(events.accept({"serverContent": {"turnComplete": True, "interactionStatus": "GENERATING"}})[1])
        self.assertTrue(events.accept({"serverContent": {"interactionStatus": "IDLE"}})[1])
        self.assertEqual(parse_event(b'{"setupComplete":{}}'), {"setupComplete": {}})
        for mime, encoded in (("audio/pcm;rate=16000", ""), ("audio/pcm;rate=24000;channels=2", ""), ("audio/pcm;rate=24000", "bad")):
            value = {"serverContent": {"modelTurn": {"parts": [{"inlineData": {"mimeType": mime, "data": encoded}}]}}}
            with self.assertRaises(VoiceError): events.accept(value)
        events.output_bytes = 90 * 48000
        with self.assertRaises(VoiceError): events.accept(audio_event())
        for raw in ('[]', b'\xff', '{"error":{"code":403,"message":"local-test-secret private"}}', '{"goAway":{"timeLeft":"0s"}}'):
            with self.assertRaises(VoiceError) as error: parse_event(raw)
            self.assertNotIn("local-test-secret", str(error.exception))

    def test_guardrails_never_connect_before_valid_consent_and_key(self):
        bridge = GeminiBridge(9876).start()
        try:
            for config, options, code in (({}, OPTIONS, "dubbing_not_configured"), (CONFIG, {**OPTIONS, "consent": False}, "dubbing_consent"),
                                          (CONFIG, {**OPTIONS, "voice": "override"}, "dubbing_options"),
                                          *((CONFIG, {**OPTIONS, "tail_silence_seconds": value}, "dubbing_options") for value in (4, True, False))):
                with patch.dict(os.environ, config, clear=True), patch("packages.providers.gemini_dubbing.connect") as upstream:
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps(options)); event = self.receive_error(browser)
                        self.assertEqual(event["code"], code)
                    upstream.assert_not_called()
        finally: bridge.close()

    def test_wire_setup_headers_resampling_live_audio_and_final_drain(self):
        received, ended = [], threading.Event()
        def upstream(ws):
            self.assertEqual(ws.request.headers["x-goog-api-key"], "local-test-secret")
            self.assertNotIn("local-test-secret", ws.request.path)
            self.assertEqual(self.handshake(ws), setup_event("es"))
            first = json.loads(ws.recv(timeout=2)); received.append(first)
            ws.send(json.dumps(audio_event(PCM[:1920], outputTranscription={"text": "Prueba"})))
            while True:
                event = json.loads(ws.recv(timeout=2)); received.append(event)
                if event == {"realtimeInput": {"audioStreamEnd": True}}: break
            ws.send(json.dumps(audio_event(PCM[:960], outputTranscription={"text": " final"})))
            ended.set()
            for _ in ws: pass  # Live sessions remain open until the client closes.
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["type"], "ready"); self.assertEqual(ready["sample_rate"], 24000)
                self.assertEqual(ready["tail_silence_seconds"], 0)
                browser.send(PCM * 2); values = []
                while not any(event["type"] == "audio" for event in values): values.append(json.loads(browser.recv(timeout=2)))
                browser.send(json.dumps({"type": "finish"})); browser.send(json.dumps({"type": "finish"}))
                self.assertTrue(ended.wait(2))
                while "".join(event["text"] for event in values if event["type"] == "transcript") != "Prueba final":
                    values.append(json.loads(browser.recv(timeout=2)))
                while sum(event["type"] == "audio" for event in values) < 2:
                    values.append(json.loads(browser.recv(timeout=2)))
                self.assert_no_message(browser)
                bridge.clock.advance(3.99)
                self.assert_no_message(browser)
                bridge.clock.advance(.02)
                self.receive_done(browser, values=values)
                self.assertEqual("".join(event["text"] for event in values if event["type"] == "transcript"), "Prueba final")
                final = [event for event in values if event["type"] == "metrics"][-1]
                self.assertEqual(final["bytes_sent"], len(PCM) * 2)
                self.assertEqual(final["provider_input_bytes"], len(PCM) * 2 * 2 // 3)
                self.assertEqual(final["padding_input_bytes"], 0)
                self.assertEqual(final["padding_input_seconds"], 0)
                self.assertEqual(final["input_seconds"], .2)
                self.assertEqual(final["provider_input_seconds"], .2)
                self.assertIsNotNone(final["first_output_audio_ms"])
                self.assertIsNone(final["inference_ms"]); self.assertFalse(final["inference_verified"])
                self.assertEqual(final["provider_diagnostics"]["interaction_idle_signals"], 0)
                self.assertFalse(final["provider_input_consumed_acknowledged"])
                self.assertFalse(final["finalization_verified"])
        self.with_relay(upstream, body)
        frames = [value["realtimeInput"]["audio"] for value in received if "audio" in value["realtimeInput"]]
        self.assertTrue(all(frame["mimeType"] == "audio/pcm;rate=16000" for frame in frames))
        self.assertTrue(all(len(base64.b64decode(frame["data"])) <= 3200 for frame in frames))
        actual = b"".join(base64.b64decode(frame["data"]) for frame in frames)
        self.assertEqual(actual, PCM24To16().feed(PCM * 2, final=True))
        self.assertEqual(sum(value == {"realtimeInput": {"audioStreamEnd": True}} for value in received), 1)

    def test_opt_in_tail_sends_twenty_paced_zero_frames_then_starts_drain(self):
        source_frames, padding_frames, padding_stamps = [], [], []
        first_padding, ended = threading.Event(), threading.Event()
        first_audio_at = []
        source_bytes = len(PCM) * 2 * 2 // 3
        def upstream(ws):
            self.handshake(ws)
            total = 0
            while True:
                event = json.loads(ws.recv(timeout=3))
                realtime = event["realtimeInput"]
                if "audioStreamEnd" in realtime:
                    self.assertTrue(realtime["audioStreamEnd"])
                    ended.set()
                    break
                raw = base64.b64decode(realtime["audio"]["data"])
                self.assertEqual(realtime["audio"]["mimeType"], "audio/pcm;rate=16000")
                if total < source_bytes:
                    source_frames.append(raw); total += len(raw)
                    if len(source_frames) == 1:
                        first_audio_at.append(time.monotonic())
                        ws.send(json.dumps(audio_event(PCM[:960])))
                else:
                    padding_frames.append(raw); padding_stamps.append(time.monotonic())
                    first_padding.set()
            for _ in ws: pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "tail_silence_seconds": 2}))
                ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["tail_silence_seconds"], 2)
                self.assertEqual(ready["drain_seconds"], 14)
                browser.send(PCM * 2)
                values = []
                while not any(value["type"] == "audio" for value in values):
                    values.append(json.loads(browser.recv(timeout=2)))
                # Output and TFPA remain available before finish or padding.
                self.assertFalse(first_padding.is_set())
                self.assertIsNotNone(next(value for value in values if value["type"] == "metrics")["first_output_audio_ms"])
                finish_at = time.monotonic()
                browser.send(json.dumps({"type": "finish"}))
                browser.send(json.dumps({"type": "finish"}))
                self.assertTrue(first_padding.wait(2))
                bridge.clock.advance(20)
                self.assert_no_message(browser)
                self.assertFalse(ended.is_set())
                self.assertTrue(ended.wait(3))
                self.assert_no_message(browser)
                self.assertGreaterEqual(padding_stamps[0] - finish_at, .075)
                self.assertGreaterEqual(padding_stamps[-1] - padding_stamps[0], 1.7)
                self.assertTrue(all(later - earlier >= .075 for earlier, later in zip(padding_stamps, padding_stamps[1:])))
                bridge.clock.advance(3.99); self.assert_no_message(browser)
                bridge.clock.advance(.02)
                self.receive_done(browser, values=values)
                final = values[-2]
                self.assertEqual(final["bytes_sent"], len(PCM) * 2)
                self.assertEqual(final["provider_real_input_bytes"], source_bytes)
                self.assertEqual(final["provider_input_bytes"], source_bytes + 64000)
                self.assertEqual(final["padding_input_bytes"], 64000)
                self.assertEqual(final["padding_input_seconds"], 2)
                self.assertEqual(final["input_seconds"], .2)
                self.assertEqual(final["provider_input_seconds"], 2.2)
                self.assertEqual(final["provider_diagnostics"]["audio_stream_end_messages_sent"], 1)
        self.with_relay(upstream, body)
        self.assertEqual(b"".join(source_frames), PCM24To16().feed(PCM * 2, final=True))
        self.assertEqual(padding_frames, [bytes(3200)] * 20)

    def test_cancel_during_tail_stops_promptly_without_end_or_stale_frames(self):
        first_padding, disconnected = threading.Event(), threading.Event()
        padding_frames, end_messages = [], []
        def upstream(ws):
            self.handshake(ws)
            try:
                for raw in ws:
                    realtime = json.loads(raw)["realtimeInput"]
                    if "audioStreamEnd" in realtime: end_messages.append(realtime)
                    else:
                        padding_frames.append(base64.b64decode(realtime["audio"]["data"]))
                        first_padding.set()
            finally: disconnected.set()
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "tail_silence_seconds": 2}))
                browser.recv(timeout=2); browser.send(json.dumps({"type": "finish"}))
                self.assertTrue(first_padding.wait(2))
                cancel_at = time.monotonic()
                browser.send(json.dumps({"type": "cancel"}))
                self.assertTrue(disconnected.wait(.5))
                self.assertLess(time.monotonic() - cancel_at, .5)
                with self.assertRaises(ConnectionClosed): browser.recv(timeout=1)
                count = len(padding_frames)
                bridge.clock.advance(30)
                # Let the cancelled wait cycle elapse to detect a stale worker.
                self.assertFalse(threading.Event().wait(.2))
                self.assertEqual(len(padding_frames), count)
        self.with_relay(upstream, body)
        self.assertGreaterEqual(len(padding_frames), 1)
        self.assertLess(len(padding_frames), 20)
        self.assertTrue(all(frame == bytes(3200) for frame in padding_frames))
        self.assertEqual(end_messages, [])

    def test_sixty_second_source_and_two_second_padding_have_separate_accounting(self):
        source_bytes, received_bytes = 60 * 32000, [0]
        condition, ended = threading.Condition(), threading.Event()
        padding_frames = []
        def upstream(ws):
            self.handshake(ws)
            for raw in ws:
                realtime = json.loads(raw)["realtimeInput"]
                if "audioStreamEnd" in realtime:
                    ended.set()
                    continue
                data = base64.b64decode(realtime["audio"]["data"])
                with condition:
                    if received_bytes[0] >= source_bytes: padding_frames.append(data)
                    received_bytes[0] += len(data)
                    condition.notify_all()
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "max_seconds": 60, "tail_silence_seconds": 2}))
                ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["max_seconds"], 60)
                self.assert_no_message(browser)
                for index in range(300):
                    if index: bridge.clock.advance(.2)
                    browser.send(PCM * 2)
                    # FIR lookahead keeps part of one input frame pending.
                    sent_full_frames = (index + 1) * 2 - 1
                    with condition:
                        self.assertTrue(condition.wait_for(lambda: received_bytes[0] >= sent_full_frames * 3200, timeout=3))
                browser.send(json.dumps({"type": "finish"}))
                self.assertTrue(ended.wait(3))
                self.assert_no_message(browser)
                bridge.clock.advance(4)
                values = self.receive_done(browser)
                final = values[-2]
                self.assertEqual(final["bytes_sent"], 60 * 48000)
                self.assertEqual(final["input_seconds"], 60)
                self.assertEqual(final["provider_real_input_bytes"], source_bytes)
                self.assertEqual(final["padding_input_bytes"], 64000)
                self.assertEqual(final["padding_input_seconds"], 2)
                self.assertEqual(final["provider_input_bytes"], 62 * 32000)
                self.assertEqual(final["provider_input_seconds"], 62)
        self.with_relay(upstream, body)
        self.assertEqual(padding_frames, [bytes(3200)] * 20)

    def test_idle_received_during_finish_flush_cannot_truncate_final_audio(self):
        prior_idle_seen, stream_end_waiting = threading.Event(), threading.Event()
        release_end, end_received, release_late = threading.Event(), threading.Event(), threading.Event()

        class GatedConnection:
            def __init__(self, connection): self.connection = connection
            def __getattr__(self, name): return getattr(self.connection, name)
            def send(self, value):
                if json.loads(value) == {"realtimeInput": {"audioStreamEnd": True}}:
                    if not prior_idle_seen.wait(2): raise AssertionError("Prior phrase IDLE was not observed during flush")
                    stream_end_waiting.set()
                    if not release_end.wait(2): raise AssertionError("Test did not release final input")
                return self.connection.send(value)

        def observed_parse(raw, diagnostics=None):
            value = parse_event(raw, diagnostics)
            if value.get("serverContent", {}).get("probe") == "prior_phrase": prior_idle_seen.set()
            return value

        def upstream(ws):
            self.handshake(ws)
            ws.recv(timeout=2)  # First full input frame before finish.
            ws.recv(timeout=2)  # Final resampler frame, while finish is flushing.
            ws.send(json.dumps({"serverContent": {"interactionStatus": "IDLE", "probe": "prior_phrase"}}))
            self.assertEqual(json.loads(ws.recv(timeout=2)), {"realtimeInput": {"audioStreamEnd": True}})
            end_received.set()
            ws.send(json.dumps({"serverContent": {"turnComplete": True}}))
            # Even a signal just after finish is insufficient on its own: late
            # output resets the bounded quiet window and must still be delivered.
            self.assertTrue(release_late.wait(2))
            ws.send(json.dumps(audio_event(PCM[:1920], outputTranscription={"text": "Final conservado"})))
            try:
                for _ in ws: pass
            except ConnectionClosed: pass

        def body(bridge):
            with patch("packages.providers.gemini_dubbing.connect", side_effect=lambda *args, **kwargs: GatedConnection(connect(*args, **kwargs))), patch("packages.providers.gemini_dubbing.parse_event", side_effect=observed_parse):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                    browser.send(PCM * 2); browser.send(json.dumps({"type": "finish"})); values = []
                    self.assertTrue(stream_end_waiting.wait(2))
                    bridge.clock.advance(20)
                    self.assert_no_message(browser)
                    release_end.set()
                    self.assertTrue(end_received.wait(2))
                    self.assert_no_message(browser)
                    bridge.clock.advance(3.5)
                    release_late.set()
                    while not any(value["type"] == "audio" for value in values):
                        value = json.loads(browser.recv(timeout=2)); values.append(value)
                    self.assertTrue(prior_idle_seen.is_set())
                    self.assertEqual(next(value["text"] for value in values if value["type"] == "transcript"), "Final conservado")
                    self.assert_no_message(browser)
                    bridge.clock.advance(.5)
                    self.assert_no_message(browser)
                    bridge.clock.advance(.249)
                    self.assert_no_message(browser)
                    bridge.clock.advance(.002)
                    self.receive_done(browser, values=values)
        self.with_relay(upstream, body)

    def test_cancel_busy_format_and_input_pacing_bounds(self):
        disconnected = threading.Event()
        def upstream(ws):
            self.handshake(ws)
            try:
                for _ in ws: pass
            finally: disconnected.set()
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                with self.browser(bridge) as other: self.assertEqual(json.loads(other.recv(timeout=2))["code"], "dubbing_busy")
                browser.send(json.dumps({"type": "cancel"})); self.assertTrue(disconnected.wait(2))
            for data, count, code in ((b"odd", 1, "dubbing_audio_format"), (b"\0" * 9602, 1, "dubbing_audio_format"), (b"\0" * 9600, 3, "dubbing_backlog")):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                    for _ in range(count): browser.send(data)
                    self.assertEqual(self.receive_error(browser)["code"], code)
        self.with_relay(upstream, body)

    def test_provider_errors_and_disconnect_before_local_policy_remain_errors(self):
        def denied(ws):
            ws.recv(timeout=2); ws.send('{"error":{"code":403,"message":"local-test-secret account details"}}')
        def denied_body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); event = self.receive_error(browser)
                self.assertEqual(event["code"], "dubbing_access"); self.assertNotIn("local-test-secret", json.dumps(event))
        self.with_relay(denied, denied_body)
        def early_close(ws): self.handshake(ws)
        def disconnected_body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                self.assertEqual(self.receive_error(browser)["code"], "dubbing_incomplete")
        self.with_relay(early_close, disconnected_body)
        for failure in ("error", "disconnect"):
            with self.subTest(failure=failure):
                ended, fail = threading.Event(), threading.Event()
                def after_finish(ws):
                    self.handshake(ws)
                    self.assertEqual(json.loads(ws.recv(timeout=2)), {"realtimeInput": {"audioStreamEnd": True}})
                    ended.set()
                    self.assertTrue(fail.wait(2))
                    if failure == "error":
                        ws.send('{"error":{"code":429,"message":"local-test-secret account details"}}')
                        for _ in ws: pass
                def after_finish_body(bridge):
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                        browser.send(json.dumps({"type": "finish"}))
                        self.assertTrue(ended.wait(2))
                        bridge.clock.advance(3.99)
                        fail.set()
                        event = self.receive_error(browser)
                        self.assertEqual(event["code"], "dubbing_quota" if failure == "error" else "dubbing_incomplete")
                        self.assertNotIn("local-test-secret", json.dumps(event))
                self.with_relay(after_finish, after_finish_body)

    def test_diagnostics_allowlist_never_copies_raw_data_or_unknown_names(self):
        private = "private-text-or-token-do-not-copy"
        event = {private: {"url": "https://private.example"}, "serverContent": {
            private: private, "generationComplete": True, "turnComplete": False,
            "interrupted": private, "inputTranscription": {"text": private, "finished": True},
            "outputTranscription": {"text": private, "finished": False}}}
        events = GeminiEvents()
        parsed = parse_event(json.dumps(event), events)
        _, complete = events.accept(parsed, record=False)
        self.assertFalse(complete)  # Generic flags do not establish a Translate flush.
        summary = events.summary()
        self.assertEqual(summary["events_received"], 1)
        self.assertEqual(summary["boolean_signals"]["generationComplete"]["true"], 1)
        self.assertEqual(summary["boolean_signals"]["interrupted"]["invalid"], 1)
        self.assertEqual(summary["transcription_finished"]["inputTranscription"]["true"], 1)
        self.assertEqual(summary["unknown_top_fields"], 1)
        self.assertEqual(summary["unknown_server_content_fields"], 1)
        encoded = json.dumps(summary)
        self.assertNotIn(private, encoded); self.assertNotIn("https://", encoded)
        with self.assertRaises(VoiceError): parse_event('{"error":{"code":403,"message":"' + private + '"}}', events)
        self.assertEqual(events.summary()["top_fields"]["error"], 1)
        self.assertNotIn(private, json.dumps(events.summary()))

    def test_continuous_model_without_turn_signal_closes_locally_with_diagnostics(self):
        ended = threading.Event()
        def upstream(ws):
            self.handshake(ws)
            while json.loads(ws.recv(timeout=2)) != {"realtimeInput": {"audioStreamEnd": True}}: pass
            ws.send(json.dumps({"serverContent": {"generationComplete": True,
                "inputTranscription": {"text": "private-source", "finished": True},
                "outputTranscription": {"text": "private-translation", "finished": True}}}))
            ended.set()
            for _ in ws: pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                browser.send(json.dumps({"type": "finish"})); values = []
                self.assertTrue(ended.wait(2))
                while sum(value["type"] == "transcript" for value in values) < 2:
                    values.append(json.loads(browser.recv(timeout=2)))
                self.assert_no_message(browser)
                bridge.clock.advance(3.99)
                self.assert_no_message(browser)
                bridge.clock.advance(.02)
                self.receive_done(browser, values=values)
                self.assertEqual(values[-2]["type"], "metrics")
                summary = values[-2]
                self.assertEqual(summary["bytes_sent"], 0)
                self.assertIsNone(summary["inference_ms"])
                diagnostics = summary["provider_diagnostics"]
                self.assertEqual(diagnostics["boolean_signals"]["generationComplete"]["true"], 1)
                self.assertEqual(diagnostics["transcription_finished"]["outputTranscription"]["true"], 1)
                self.assertEqual(diagnostics["audio_stream_end_messages_sent"], 1)
                self.assertTrue(diagnostics["audio_stream_end_sent"])
                self.assertEqual(diagnostics["interaction_idle_signals"], 0)
                self.assertEqual(diagnostics["boolean_signals"]["turnComplete"]["true"], 0)
                self.assertNotIn("private-source", json.dumps(summary))
                self.assertNotIn("private-translation", json.dumps(summary))
        self.with_relay(upstream, body)

    def test_usage_and_empty_control_events_do_not_restart_content_quiet_window(self):
        ended, send_controls = threading.Event(), threading.Event()
        late_content, usage_seen, controls_seen = threading.Event(), threading.Event(), threading.Event()
        def observed_parse(raw, diagnostics=None):
            value = parse_event(raw, diagnostics)
            if "usageMetadata" in value: usage_seen.set()
            if value.get("serverContent", {}).get("waitingForInput"): controls_seen.set()
            return value
        def upstream(ws):
            self.handshake(ws)
            self.assertEqual(json.loads(ws.recv(timeout=2)), {"realtimeInput": {"audioStreamEnd": True}})
            ended.set()
            self.assertTrue(late_content.wait(2))
            ws.send(json.dumps({"serverContent": {"outputTranscription": {"text": "último contenido"}}}))
            self.assertTrue(send_controls.wait(2))
            ws.send(json.dumps({"usageMetadata": {"totalTokenCount": 17}}))
            ws.send(json.dumps({"serverContent": {"interactionStatus": "IDLE", "turnComplete": True,
                "generationComplete": True, "waitingForInput": True,
                "inputTranscription": {"finished": True}, "outputTranscription": {"text": "", "finished": True}}}))
            for _ in ws: pass
        def body(bridge):
            with patch("packages.providers.gemini_dubbing.parse_event", side_effect=observed_parse), self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                browser.send(json.dumps({"type": "finish"})); self.assertTrue(ended.wait(2))
                bridge.clock.advance(3.5); late_content.set()
                self.assertEqual(json.loads(browser.recv(timeout=2))["text"], "último contenido")
                self.assert_no_message(browser)
                bridge.clock.advance(.5); send_controls.set()
                self.assertTrue(usage_seen.wait(2)); self.assertTrue(controls_seen.wait(2))
                self.assert_no_message(browser)
                bridge.clock.advance(.251)
                values = self.receive_done(browser)
                self.assertEqual(values[-2]["provider_diagnostics"]["top_fields"]["usageMetadata"], 1)
        self.with_relay(upstream, body)

    def test_continuous_pcm_is_bounded_by_twelve_second_post_input_budget(self):
        ended, packets = threading.Event(), queue.Queue()
        def upstream(ws):
            self.handshake(ws)
            while json.loads(ws.recv(timeout=2)) != {"realtimeInput": {"audioStreamEnd": True}}: pass
            ended.set()
            for _ in range(18):
                packets.get(timeout=2)
                ws.send(json.dumps(audio_event(PCM[:960])))
            for _ in ws: pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2); browser.send(PCM)
                browser.send(json.dumps({"type": "finish"})); self.assertTrue(ended.wait(2))
                values = []
                self.assert_no_message(browser)
                for advance in [3.5] + [.5] * 16 + [.4]:
                    bridge.clock.advance(advance); packets.put(True)
                    while True:
                        value = json.loads(browser.recv(timeout=2)); values.append(value)
                        self.assertNotIn(value["type"], {"done", "error"})
                        if value["type"] == "audio": break
                self.assertEqual(sum(value["type"] == "audio" for value in values), 18)
                self.assert_no_message(browser)
                bridge.clock.advance(.11)
                self.receive_done(browser, reason="drain_budget", values=values)
                self.assertEqual(values[-2]["provider_diagnostics"]["interaction_idle_signals"], 0)
        self.with_relay(upstream, body)

    def test_output_backpressure_remains_bounded_after_idle(self):
        ended = threading.Event()
        def upstream(ws):
            self.handshake(ws); ws.recv(timeout=2)
            ws.send(json.dumps(audio_event(PCM[:1920])))
            time.sleep(.4)
            ws.send(json.dumps(audio_event(PCM * 8)))
            while json.loads(ws.recv(timeout=2)) != {"realtimeInput": {"audioStreamEnd": True}}: pass
            ws.send(json.dumps({"serverContent": {"turnComplete": True}}))
            ended.set()
            for _ in ws: pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2); browser.send(PCM * 2)
                stamps = []
                while len(stamps) < 9:
                    event = json.loads(browser.recv(timeout=2))
                    if event["type"] == "audio": stamps.append(time.monotonic())
                self.assertGreater(stamps[-1] - stamps[1], .43)
                browser.send(json.dumps({"type": "finish"}))
                self.assertTrue(ended.wait(2)); bridge.clock.advance(4)
                self.receive_done(browser)
        self.with_relay(upstream, body)

    def test_pending_normalized_audio_is_delivered_before_quiet_close(self):
        ended, first_delivery, release_delivery = threading.Event(), threading.Event(), threading.Event()
        original_send = GeminiBridge.send
        def gated_send(browser, event):
            original_send(browser, event)
            if event["type"] == "audio" and not first_delivery.is_set():
                first_delivery.set()
                self.assertTrue(release_delivery.wait(2))
        def upstream(ws):
            self.handshake(ws)
            while json.loads(ws.recv(timeout=2)) != {"realtimeInput": {"audioStreamEnd": True}}: pass
            ended.set()
            ws.send(json.dumps(audio_event(PCM * 4)))  # Four normalized 100 ms frames.
            for _ in ws: pass
        def body(bridge):
            with patch.object(GeminiBridge, "send", staticmethod(gated_send)), self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2); browser.send(PCM)
                browser.send(json.dumps({"type": "finish"})); self.assertTrue(ended.wait(2))
                values = []
                while not any(value["type"] == "audio" for value in values):
                    values.append(json.loads(browser.recv(timeout=2)))
                self.assertTrue(first_delivery.wait(2))
                self.assert_no_message(browser)
                bridge.clock.advance(4)
                self.assert_no_message(browser)
                release_delivery.set()
                while sum(value["type"] == "audio" for value in values) < 4:
                    value = json.loads(browser.recv(timeout=2)); values.append(value)
                    self.assertNotIn(value["type"], {"done", "error"})
                self.assert_no_message(browser)
                bridge.clock.advance(.749)
                self.assert_no_message(browser)
                bridge.clock.advance(.002)
                self.receive_done(browser, values=values)
        self.with_relay(upstream, body)

    def test_wall_deadline_sends_stream_end_without_more_client_messages(self):
        ended, allow_stream_read = threading.Event(), threading.Event()
        def upstream(ws):
            self.handshake(ws)
            # Deliberately postpone the upstream observation until after the
            # browser sees its local input-ended notice. They are separate
            # sockets/threads; that notice is not an upstream acknowledgement.
            self.assertTrue(allow_stream_read.wait(2))
            self.assertEqual(json.loads(ws.recv(timeout=2)), {"realtimeInput": {"audioStreamEnd": True}})
            ended.set(); ws.send(json.dumps({"serverContent": {"turnComplete": True}}))
            for _ in ws: pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2); values = []
                self.assert_no_message(browser)
                bridge.clock.advance(5.01)
                while not any(value["type"] == "input-ended" for value in values):
                    values.append(json.loads(browser.recv(timeout=2)))
                self.assertFalse(ended.is_set())
                allow_stream_read.set()
                self.assertTrue(ended.wait(2))
                self.assertTrue(any(value["type"] == "input-ended" for value in values))
                bridge.clock.advance(4)
                self.receive_done(browser, values=values)
                metrics=next(value for value in values if value["type"] == "metrics")
                self.assertIsNone(metrics["first_output_audio_ms"])
                self.assertEqual(metrics["provider_diagnostics"]["audio_stream_end_messages_sent"],1)
                self.assertEqual(metrics["bytes_sent"],0)
        self.with_relay(upstream, body)


if __name__ == "__main__": unittest.main()
