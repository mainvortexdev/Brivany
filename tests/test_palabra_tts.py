"""Dedicated TTS protocol tests: synthetic PCM and fake WebSockets, no API calls."""
import base64
import json
import os
import queue
import socket
import threading
import time
import unittest
from unittest.mock import patch
from websockets.sync.client import connect
from websockets.sync.server import serve

from packages.providers.live_voice import VoiceError
from packages.providers import palabra_tts as tts


PCM = b"\x00\x01\x02\x03" * 960


class FakeSocket:
    def __init__(self):
        self.closed = threading.Event()
        self.shutdown_how = None

    def shutdown(self, how):
        self.shutdown_how = how
        self.closed.set()

    def close(self):
        self.closed.set()


class FakeWS:
    def __init__(self, *, acknowledge=True, respond=True):
        self.socket = FakeSocket()
        self.sent = []
        self.incoming = queue.Queue()
        self.acknowledge = acknowledge
        self.respond = respond
        self.first_text = threading.Event()
        self.receiving = threading.Event()
        self.initialized = threading.Event()
        self.on_text = None

    def send(self, raw):
        if self.socket.closed.is_set():
            raise OSError("private upstream details must not escape")
        event = json.loads(raw)
        self.sent.append(event)
        if event["type"] == "init":
            self.initialized.set()
            if self.acknowledge:
                self.put({"message_type": "init_response", "data": {}})
        if event["type"] == "text":
            self.first_text.set()
            if self.on_text is not None:
                self.on_text(event)
            elif event["is_eos"] and self.respond:
                self.audio(event["generation_id"], PCM)
                # The documented final marker may carry no audio or timings.
                self.put({"message_type": "audio_chunk", "data": {
                    "generation_id": event["generation_id"], "last_chunk": True}})

    def put(self, event):
        self.incoming.put(json.dumps(event))

    def audio(self, generation, pcm, *, last=False):
        self.put({"message_type": "audio_chunk", "data": {"generation_id": generation,
            "audio": base64.b64encode(pcm).decode(), "size": len(pcm), "last_chunk": last}})

    def recv(self, timeout):
        self.receiving.set()
        if self.socket.closed.is_set():
            raise OSError("private upstream details must not escape")
        try:
            return self.incoming.get(timeout=min(timeout, .02))
        except queue.Empty:
            if self.socket.closed.is_set():
                raise OSError("private upstream details must not escape")
            raise TimeoutError from None

    def close(self):
        raise AssertionError("Cancellation must not enter a WebSocket close handshake")


class Factory:
    def __init__(self, websocket=None):
        self.websocket = websocket or FakeWS()
        self.calls = []

    def __call__(self, url, **options):
        self.calls.append((url, options))
        return self.websocket


def drain(stream, size=7680):
    chunks = []
    while True:
        chunk = stream.read(size)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


class PalabraTTSTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"BRIVANY_PALABRA_API_KEY": "test-private-key"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def session(self, language="es", websocket=None):
        factory = Factory(websocket)
        session = tts.PalabraTTSSession(language, _connect=factory)
        self.addCleanup(session.close)
        return session, factory

    def test_status_reports_actual_tts_capabilities_without_secrets_or_latency(self):
        value = tts.tts_status()
        self.assertEqual(value["languages"], ["en", "es", "fr"])
        self.assertTrue(value["text_streaming"])
        self.assertTrue(value["audio_streaming"])
        self.assertEqual((value["format"], value["channels"], value["sample_rate"]), ("pcm16", 1, 24000))
        self.assertIsNone(value["inference_ms"])
        self.assertFalse(value["access_verified"])
        self.assertFalse(value["voice_cloning"])
        self.assertFalse(value["prosody_from_source_audio"])
        self.assertNotIn("test-private-key", json.dumps(value))
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(tts.tts_status()["configured"])

    def test_invalid_language_text_and_unconfigured_key_make_no_connection(self):
        for language in ("auto", "de", None, []):
            with self.assertRaises(VoiceError):
                tts.PalabraTTSSession(language)
        session, factory = self.session()
        for text in ("", " ", "x" * (tts.MAX_TEXT_CHARS + 1), None, 1):
            with self.assertRaises(VoiceError):
                session(text)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(VoiceError) as caught:
                session("hola")
            self.assertEqual(caught.exception.code, "palabra_tts_not_configured")
        self.assertEqual(factory.calls, [])

    def test_language_init_pcm_and_persistent_context_reuse_protocol(self):
        for language in ("en", "es", "fr"):
            with self.subTest(language=language):
                session, factory = self.session(language)
                for text in ("Primera frase.", "Siguiente frase."):
                    stream = session(text)
                    self.assertEqual(drain(stream, 1000), PCM)
                    stream.close()
                self.assertEqual(len(factory.calls), 1)
                url, options = factory.calls[0]
                self.assertEqual(url, tts.URL)
                self.assertNotIn("test-private-key", url)
                self.assertEqual(options["additional_headers"], {"Authorization": "Bearer test-private-key"})
                self.assertEqual(options["max_queue"], 8)
                self.assertIsNone(options["proxy"])
                self.assertIsNone(options["compression"])
                sent = factory.websocket.sent
                self.assertEqual(sent[0], {"type": "init", "language": language, "model": "auto",
                    "voice_options": {"voice_id": "default_low", "speed": 1.0, "deaccent_strength": 0.0},
                    "output": {"format": "pcm", "sample_rate": 24000}})
                self.assertEqual([item["type"] for item in sent], ["init", "text", "text"])
                self.assertNotEqual(sent[1]["generation_id"], sent[2]["generation_id"])
                self.assertFalse(factory.websocket.socket.closed.is_set())

    def test_long_sentence_is_split_without_altering_text_or_eos_per_token(self):
        session, factory = self.session()
        text = "café français español. " * 250
        response = session(text)
        self.assertEqual(drain(response), PCM)
        messages = [item for item in factory.websocket.sent if item["type"] == "text"]
        self.assertEqual("".join(item["text"] for item in messages), text)
        self.assertTrue(all(1 <= len(item["text"]) <= 1024 for item in messages))
        self.assertEqual([item["is_eos"] for item in messages], [False] * (len(messages) - 1) + [True])
        self.assertEqual(len({item["generation_id"] for item in messages}), 1)

    def test_iterator_streams_before_iterator_finishes_and_preserves_all_characters(self):
        session, factory = self.session()
        release = threading.Event()

        def fragments():
            yield "Bonjour, "
            if not release.wait(2):
                raise AssertionError("Writer incorrectly waited for complete sentence")
            yield "le monde."

        response = session(fragments())
        self.assertTrue(factory.websocket.first_text.wait(1))
        self.assertEqual(factory.websocket.sent[1]["text"], "Bonjour,")
        self.assertFalse(factory.websocket.sent[1]["is_eos"])
        release.set()
        self.assertEqual(drain(response), PCM)
        messages = [item for item in factory.websocket.sent if item["type"] == "text"]
        self.assertEqual("".join(item["text"] for item in messages), "Bonjour, le monde.")
        self.assertTrue(messages[-1]["is_eos"])
        self.assertTrue(all(item["text"] for item in messages))

    def test_manual_incremental_stream_accepts_empty_local_eos_and_one_character_deltas(self):
        session, factory = self.session()
        response = session.start_sentence()
        response.send_text("H")
        self.assertEqual(len(factory.websocket.sent), 1)
        response.send_text("e")
        response.send_text("llo ")
        response.send_text("world.")
        response.send_text("", is_eos=True)
        self.assertEqual(drain(response), PCM)
        messages = factory.websocket.sent[1:]
        self.assertEqual("".join(item["text"] for item in messages), "Hello world.")
        self.assertTrue(all(item["text"] for item in messages))
        self.assertTrue(messages[-1]["is_eos"])
        self.assertFalse(any(item["is_eos"] for item in messages[:-1]))
        with self.assertRaises(VoiceError):
            response.send_text("extra")

    def test_close_interrupts_reader_without_waiting_for_network_and_discards_buffered_audio(self):
        websocket = FakeWS(respond=False)
        session, _ = self.session(websocket=websocket)
        response = session.start_sentence()
        response.send_text("wait", is_eos=True)
        result = []
        websocket.receiving.clear()
        reader = threading.Thread(target=lambda: result.append(response.read()), daemon=True)
        reader.start()
        self.assertTrue(websocket.receiving.wait(1))
        started = time.monotonic()
        response.close()
        self.assertLess(time.monotonic() - started, .2)
        self.assertEqual(websocket.socket.shutdown_how, socket.SHUT_RDWR)
        reader.join(1)
        self.assertFalse(reader.is_alive())
        self.assertEqual(result, [b""])
        self.assertEqual(response.read(), b"")
        self.assertEqual(response._pending, b"")

    def test_close_during_initialization_aborts_connection_without_text(self):
        websocket = FakeWS(acknowledge=False)
        session, _ = self.session(websocket=websocket)
        errors = []

        def open_sentence():
            try:
                session.start_sentence()
            except VoiceError as error:
                errors.append(error)

        worker = threading.Thread(target=open_sentence, daemon=True)
        worker.start()
        self.assertTrue(websocket.initialized.wait(1))
        started = time.monotonic()
        session.close()
        self.assertLess(time.monotonic() - started, .2)
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(errors)
        self.assertEqual([item["type"] for item in websocket.sent], ["init"])

    def test_close_during_connect_returns_immediately_and_late_connection_is_aborted(self):
        websocket = FakeWS()
        connecting, release = threading.Event(), threading.Event()

        def connector(*_, **__):
            connecting.set()
            release.wait(2)
            return websocket

        session = tts.PalabraTTSSession(_connect=connector)
        errors = []

        def open_sentence():
            try:
                session.start_sentence()
            except VoiceError as error:
                errors.append(error)

        worker = threading.Thread(target=open_sentence, daemon=True)
        worker.start()
        self.assertTrue(connecting.wait(1))
        started = time.monotonic()
        session.close()
        self.assertLess(time.monotonic() - started, .2)
        release.set()
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(websocket.socket.closed.is_set())
        self.assertEqual(websocket.sent, [])
        self.assertTrue(errors)
        with self.assertRaises(VoiceError):
            session.start_sentence()

    def test_text_rate_limiter_wait_is_cancellable_without_taking_the_send_lock(self):
        session, factory = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        session._text_times.extend([time.monotonic()] * 40)
        waiting, errors = threading.Event(), []
        original_wait = stream._cancelled.wait

        def wait(timeout):
            waiting.set()
            return original_wait(timeout)

        def send_text():
            try:
                stream.send_text("Hola", is_eos=True)
            except VoiceError as error:
                errors.append(error)

        with patch.object(stream._cancelled, "wait", side_effect=wait):
            sender = threading.Thread(target=send_text, daemon=True)
            sender.start()
            self.assertTrue(waiting.wait(1))
            self.assertEqual([item["type"] for item in factory.websocket.sent], ["init"])
            started = time.monotonic()
            session.close()
            self.assertLess(time.monotonic() - started, .2)
            sender.join(1)
        self.assertFalse(sender.is_alive())
        self.assertTrue(errors)
        self.assertEqual([item["type"] for item in factory.websocket.sent], ["init"])

    def test_foreign_generation_audio_is_discarded_and_final_marker_can_be_empty(self):
        session, factory = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        stream.send_text("Hola", is_eos=True)
        factory.websocket.audio("old-generation", b"\x99\x00")
        factory.websocket.audio(stream.generation_id, PCM, last=True)
        self.assertEqual(drain(stream), PCM)

    def test_provider_errors_are_sanitized_and_allowlist_only_the_code(self):
        session, factory = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        stream.send_text("Hola", is_eos=True)
        factory.websocket.put({"message_type": "error", "data": {
            "code": "QUOTA_EXCEEDED", "desc": "private transcript and test-private-key"}})
        with self.assertRaises(VoiceError) as caught:
            stream.read()
        self.assertEqual(caught.exception.provider_code, "QUOTA_EXCEEDED")
        self.assertNotIn("private", str(caught.exception))
        self.assertTrue(factory.websocket.socket.closed.is_set())

    def test_bad_pcm_base64_and_size_are_rejected_without_decode_fallback(self):
        cases = [("!!!", 0), (base64.b64encode(b"x").decode(), 1),
            (base64.b64encode(PCM).decode(), 1)]
        for encoded, size in cases:
            with self.subTest(encoded=encoded[:12]):
                session, factory = self.session(websocket=FakeWS(respond=False))
                stream = session.start_sentence()
                stream.send_text("Hola", is_eos=True)
                factory.websocket.put({"message_type": "audio_chunk", "data": {
                    "generation_id": stream.generation_id, "audio": encoded, "size": size, "last_chunk": True}})
                with self.assertRaises(VoiceError) as caught:
                    stream.read()
                self.assertEqual(caught.exception.code, "palabra_tts_format")

    def test_raw_pcm_is_not_misidentified_as_a_container_from_a_sample_pattern(self):
        session, factory = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        stream.send_text("Hola", is_eos=True)
        pcm = b"RIFF\x00\x00\x00\x00WAVE\x01\x00"
        factory.websocket.audio(stream.generation_id, pcm, last=True)
        # PCM cannot be type-detected by four sample bytes. The init format is
        # authoritative; arbitrary valid samples must remain byte-exact.
        self.assertEqual(drain(stream), pcm)

    def test_generation_output_and_wait_are_bounded(self):
        session, factory = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        stream.send_text("Hola", is_eos=True)
        factory.websocket.audio(stream.generation_id, PCM, last=True)
        with patch.object(tts, "MAX_OUTPUT_BYTES", 2):
            with self.assertRaises(VoiceError) as caught:
                stream.read()
        self.assertEqual(caught.exception.code, "palabra_tts_limit")
        session, _ = self.session(websocket=FakeWS(respond=False))
        stream = session.start_sentence()
        with patch.object(tts, "RECEIVE_TIMEOUT_SECONDS", .025):
            with self.assertRaises(VoiceError) as caught:
                stream.read()
        self.assertEqual(caught.exception.code, "palabra_tts_timeout")

    def test_iterator_error_never_exposes_source_exception_or_starts_a_retry(self):
        session, factory = self.session(websocket=FakeWS(respond=False))

        def fragments():
            yield "hello"
            raise RuntimeError("private text and test-private-key")

        stream = session(fragments())
        with self.assertRaises(VoiceError) as caught:
            stream.read()
        self.assertEqual(caught.exception.code, "palabra_tts_text")
        self.assertNotIn("private", str(caught.exception))
        self.assertEqual(len(factory.calls), 1)

    def test_init_contradicting_pcm_settings_and_unexpected_response_are_rejected(self):
        for reply in ({"message_type": "init_response", "data": {"output": {"format": "wav"}}},
                      {"message_type": "task_status", "data": {}}):
            websocket = FakeWS(acknowledge=False)
            websocket.put(reply)
            session, _ = self.session(websocket=websocket)
            with self.assertRaises(VoiceError):
                session.start_sentence()
            self.assertTrue(websocket.socket.closed.is_set())
            self.assertEqual([item["type"] for item in websocket.sent], ["init"])

    def test_real_loopback_websocket_protocol_and_abort_unblock_pending_receive(self):
        awaiting_text, server_done = threading.Event(), threading.Event()
        observed = []

        def handler(websocket):
            try:
                observed.append(websocket.request.headers["Authorization"])
                observed.append(json.loads(websocket.recv(timeout=2)))
                websocket.send(json.dumps({"message_type": "init_response", "data": {}}))
                awaiting_text.set()
                while True:
                    event = json.loads(websocket.recv(timeout=2))
                    observed.append(event)
                    if event.get("is_eos"):
                        break
                generation = event["generation_id"]
                websocket.send(json.dumps({"message_type": "audio_chunk", "data": {
                    "generation_id": generation, "audio": base64.b64encode(PCM).decode(),
                    "size": len(PCM), "last_chunk": False}}))
                # Keep the generation open. Client cancellation must terminate
                # a pending real websocket recv, without a protocol handshake.
                try:
                    websocket.recv(timeout=2)
                except Exception:
                    pass
            finally:
                server_done.set()

        with serve(handler, "127.0.0.1", 0) as server:
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            port = server.socket.getsockname()[1]

            def connector(_url, **options):
                return connect(f"ws://127.0.0.1:{port}", **options)

            session = tts.PalabraTTSSession("fr", _connect=connector)
            self.addCleanup(session.close)
            stream = session.start_sentence()
            self.assertTrue(awaiting_text.wait(1))
            stream.send_text("Bonjour", is_eos=True)
            self.assertEqual(stream.read(len(PCM)), PCM)
            results = []
            reader = threading.Thread(target=lambda: results.append(stream.read()), daemon=True)
            reader.start()
            started = time.monotonic()
            session.close()
            self.assertLess(time.monotonic() - started, .2)
            reader.join(1)
            self.assertFalse(reader.is_alive())
            self.assertEqual(results, [b""])
            self.assertTrue(server_done.wait(1))
            self.assertEqual(observed[0], "Bearer test-private-key")
            self.assertEqual(observed[1]["type"], "init")
            self.assertEqual(observed[2]["text"], "Bonjour")
            server.shutdown()
            server_thread.join(1)


if __name__ == "__main__":
    unittest.main()
