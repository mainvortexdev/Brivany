"""Palabra relay tests: local synthetic PCM and fake upstream only; no paid API."""
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
from packages.providers.palabra import PalabraBridge, PalabraEvents, dubbing_status, effective_settings, parse_event, start_options, task_settings
from packages.providers.live_voice import VoiceError

OPTIONS = {"type": "start", "consent": True, "source_language": "en", "target_language": "es", "max_seconds": 5}
PCM = b"\0\1" * 1920


def acknowledge(ws, response_data=None):
    task = json.loads(ws.recv(timeout=3))
    ws.send(json.dumps({"message_type": "task_status", "data": {"command": "set_task", "event": "started", "task_status": "running"}}))
    request = json.loads(ws.recv(timeout=3))
    if request != {"message_type": "get_task", "data": {"exclude_hidden": False}}:
        raise AssertionError("Expected get_task before audio")
    ws.send(json.dumps({"message_type": "current_task", "data": {**task["data"], "private_extra": "test-secret"} if response_data is None else response_data}))
    return task


def caption(text, *, kind="partial_translated_transcription", identifier="segment", part=0):
    return {"message_type": kind, "data": {"transcription": {
        "transcription_id": identifier, "translation_part_id": part, "text": text}}}


class PalabraTests(unittest.TestCase):
    def test_permissions_languages_and_local_key_never_echo_secret(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(dubbing_status()["configured"])
            for value in ({}, OPTIONS, {**OPTIONS, "consent": False}):
                with self.assertRaises(VoiceError): start_options(value)
        with patch.dict(os.environ, {"BRIVANY_PALABRA_API_KEY": "test-secret"}, clear=True):
            self.assertEqual(start_options(OPTIONS), ("en", "es", 5))
            for enabled in (False, True):
                self.assertEqual(start_options({**OPTIONS, "translate_partials": enabled}), ("en", "es", 5))
            for value in ({**OPTIONS, "max_seconds": True}, {**OPTIONS, "source_language": "es"},
                          {**OPTIONS, "target_language": "zz"}, {**OPTIONS, "url": "https://foreign"},
                          *({**OPTIONS, "translate_partials": value} for value in (0, 1, "true", None, [], {}))):
                with self.assertRaises(VoiceError): start_options(value)
            self.assertNotIn("test-secret", json.dumps(dubbing_status()))
            self.assertIs(dubbing_status()["partial_translation_supported"], True)
            self.assertIs(dubbing_status()["translate_partials_default"], False)

    def test_settings_match_pcm_and_valid_queue_bounds_without_cloning(self):
        data = task_settings("en", "es")["data"]
        self.assertEqual(data["input_stream"]["source"], {"type": "ws", "format": "pcm_s16le", "sample_rate": 24000, "channels": 1})
        self.assertIs(data["pipeline"]["transcription"]["only_confirm_by_silence"], False)
        self.assertFalse(data["pipeline"]["translations"][0]["speech_generation"]["voice_cloning"])
        self.assertFalse(data["pipeline"]["translations"][0]["translate_partial_transcriptions"])
        self.assertNotIn("translation_queue_configs", data)
        queue = data["pipeline"]["translation_queue_configs"]["global"]
        self.assertEqual((queue["desired_queue_level_ms"], queue["max_queue_level_ms"]), (2000, 12000))
        self.assertTrue(queue["auto_tempo"]);self.assertEqual((queue['min_tempo'],queue['max_tempo']),(1.0,1.12))
        self.assertNotIn("partial_translated_transcription", data["pipeline"]["allowed_message_types"])
        self.assertEqual(task_settings("en", "es", translate_partials=False), task_settings("en", "es"))
        opt_in = task_settings("en", "es", translate_partials=True)["data"]["pipeline"]
        self.assertIs(opt_in["translations"][0]["translate_partial_transcriptions"], True)
        self.assertEqual(set(opt_in["allowed_message_types"]), {"translated_transcription", "validated_transcription", "partial_translated_transcription"})
        self.assertEqual(opt_in["translations"][0]["speech_generation"], data["pipeline"]["translations"][0]["speech_generation"])
        self.assertEqual(opt_in["translation_queue_configs"], data["pipeline"]["translation_queue_configs"])

    def test_final_segments_deduplicate_but_independent_parts_and_audio_are_kept(self):
        events = PalabraEvents()
        event = {"message_type": "translated_transcription", "data": {"transcription": {"transcription_id": "segment", "translation_part_id": 0, "text": "Hola"}}}
        self.assertEqual(events.accept(event)["text"], "Hola ")
        self.assertIsNone(events.accept(event))
        next_event = json.loads(json.dumps(event)); next_event["data"]["transcription"]["translation_part_id"] = 1
        self.assertIsNotNone(events.accept(next_event))
        self.assertIsNone(events.accept({"message_type": "partial_translated_transcription", "data": {}}))
        audio = {"message_type": "output_audio_data", "data": {"data": base64.b64encode(PCM).decode(), "chunk_generation_delta": 120}}
        self.assertEqual(events.accept(audio)["tts_chunk_generation_ms"], 120)
        self.assertIsNotNone(events.accept(audio))  # Chunks have no unique event ID; don't drop identical silence.
        self.assertEqual(events.output_bytes, len(PCM)*2)
        with self.assertRaises(VoiceError): events.accept({"message_type": "output_audio_data", "data": {"data": "bad"}})
        limited = PalabraEvents(); limited.output_bytes = 90 * 48000
        with self.assertRaises(VoiceError) as error: limited.accept(audio)
        self.assertEqual(error.exception.code, "dubbing_output_limit")
        parsed = parse_event(json.dumps({"message_type": "task_status", "data": json.dumps({"task_status": "running"})}))
        self.assertEqual(parsed["data"]["task_status"], "running")

    def test_opt_in_partials_replace_with_corrected_final_and_never_regress(self):
        events = PalabraEvents(translate_partials=True)
        first = events.accept(caption(" Hola "))
        self.assertEqual(first["text"], " Hola ")
        self.assertEqual(first["operation"], "replace")
        self.assertEqual(first["source"], "translation")
        self.assertIs(first["provisional"], True)
        self.assertIs(first["final"], False)
        self.assertEqual(first["revision"], 1)
        self.assertIsInstance(first["segment_id"], str)
        self.assertTrue(first["segment_id"])
        self.assertIsNone(events.accept(caption(" Hola ")))
        revised = events.accept(caption(" Hola dos ", part="0"))
        self.assertEqual(revised["segment_id"], first["segment_id"])
        self.assertEqual(revised["revision"], 2)
        self.assertEqual(revised["text"], " Hola dos ")
        self.assertIsNone(events.accept(caption("", kind="translated_transcription")))
        final = events.accept(caption(" La habitación tiene dos ventanas. ", kind="translated_transcription"))
        self.assertEqual(final["segment_id"], first["segment_id"])
        self.assertEqual(final["revision"], 3)
        self.assertEqual(final["text"], " La habitación tiene dos ventanas. ")
        self.assertEqual(final["operation"], "replace")
        self.assertIs(final["provisional"], False)
        self.assertIs(final["final"], True)
        self.assertIsNone(events.accept(caption(" La habitación tiene dos ventanas. ", kind="translated_transcription")))
        self.assertIsNone(events.accept(caption("Otra corrección tardía", kind="translated_transcription")))
        self.assertIsNone(events.accept(caption("parcial viejo")))
        independent = events.accept(caption("otra parte", part=1))
        self.assertNotEqual(independent["segment_id"], final["segment_id"])
        self.assertEqual(independent["revision"], 1)
        # Final confirmation still replaces a partial whose text did not change.
        confirmed = events.accept(caption("otra parte", kind="translated_transcription", part="1"))
        self.assertEqual(confirmed["segment_id"], independent["segment_id"])
        self.assertEqual(confirmed["revision"], 2)
        self.assertIs(confirmed["final"], True)

    def test_empty_captions_do_not_consume_final_ids_and_audio_ignores_partial_mode(self):
        audio = {"message_type": "output_audio_data", "data": {
            "data": base64.b64encode(PCM).decode(), "chunk_generation_delta": 125}}
        audio_results = []
        for enabled in (False, True):
            with self.subTest(translate_partials=enabled):
                events = PalabraEvents(translate_partials=enabled)
                self.assertIsNone(events.accept(caption("", kind="translated_transcription")))
                self.assertIsNone(events.accept(caption("", kind="validated_transcription")))
                for kind in ("translated_transcription", "validated_transcription", "partial_translated_transcription"):
                    self.assertIsNone(events.accept({"message_type": kind, "data": {"transcription": {"text": ""}}}))
                translated = events.accept(caption("Final real", kind="translated_transcription"))
                source = events.accept(caption("Real source", kind="validated_transcription"))
                self.assertEqual(translated["text"], "Final real" if enabled else "Final real ")
                self.assertEqual(source["text"], "Real source ")
                audio_results.append(events.accept(audio))
                self.assertIsNotNone(events.accept(audio))
                self.assertEqual(events.output_bytes, len(PCM) * 2)
        self.assertEqual(audio_results[0], audio_results[1])
        self.assertEqual(base64.b64decode(audio_results[1]["audio"]), PCM)

    def test_partial_caption_identifiers_and_text_are_bounded(self):
        for identifier in (None, "", "x" * 513, [], {}):
            with self.subTest(identifier_type=type(identifier).__name__):
                with self.assertRaises(VoiceError): PalabraEvents(translate_partials=True).accept(caption("text", identifier=identifier))
        for part in (True, None, [], {}, "x" * 513):
            with self.subTest(part_type=type(part).__name__):
                with self.assertRaises(VoiceError): PalabraEvents(translate_partials=True).accept(caption("text", part=part))
        for text in (None, 1, [], "x" * 10001):
            with self.subTest(text_type=type(text).__name__):
                with self.assertRaises(VoiceError): PalabraEvents(translate_partials=True).accept(caption(text))

    def test_audio_and_caption_ids_correlate_without_changing_existing_partial_ids(self):
        identifier = 'room:["two"],ventanas'
        expected_segment = 'palabra:' + json.dumps((identifier, "0"), ensure_ascii=True, separators=(",", ":"))
        expected_turn = 'palabra:' + json.dumps((identifier,), ensure_ascii=True, separators=(",", ":"))
        audio = {"message_type": "output_audio_data", "data": {
            "data": base64.b64encode(PCM).decode(), "transcription_id": identifier,
            "translation_part_id": "0", "last_chunk": True, "private_extra": "test-secret"}}
        for enabled in (False, True):
            events = PalabraEvents(translate_partials=enabled)
            translated = caption("Dos ventanas", kind="translated_transcription", identifier=identifier, part=0)
            translated["data"]["transcription"]["segments"] = [
                {"start": 1.4, "end": 1.8, "text": "private segment", "words": [{"word": "private word"}], "start_timestamp": 1784642133.39},
                {"start": .4, "end": 1.2, "end_timestamp": 1784642134.35}]
            normalized_audio, normalized_text = events.accept(audio), events.accept(translated)
            for value in (normalized_audio, normalized_text):
                self.assertEqual(value["segment_id"], expected_segment)
                self.assertEqual(value["turn_id"], expected_turn)
                self.assertNotIn("test-secret", json.dumps(value))
                self.assertNotIn("178464213", json.dumps(value))
                self.assertNotIn("private segment", json.dumps(value))
                self.assertNotIn("private word", json.dumps(value))
            self.assertIs(normalized_audio["audio_segment_final"], True)
            self.assertIs(normalized_text["final"], True)
            self.assertIs(normalized_text["provisional"], False)
            self.assertEqual((normalized_text["source_start_seconds"], normalized_text["source_end_seconds"]), (.4, 1.8))
            self.assertNotIn("source_start_seconds", normalized_audio)
            original = {"message_type": "validated_transcription", "data": {"transcription": {
                "transcription_id": identifier, "text": "Two windows", "segments": [{"start": .4, "end": 1.8}]}}}
            normalized_original = events.accept(original)
            self.assertEqual(normalized_original["turn_id"], expected_turn)
            self.assertNotIn("segment_id", normalized_original)  # ASR has no translation part.
        partial = PalabraEvents(translate_partials=True).accept(caption("Dos", identifier=identifier, part="0"))
        self.assertEqual(partial["segment_id"], expected_segment)
        # Tuple boundaries avoid an ID/part collision when both contain punctuation.
        other = PalabraEvents().accept(caption("Otra", kind="translated_transcription", identifier='room:["two"]', part=',ventanas:0'))
        self.assertNotEqual(other["segment_id"], expected_segment)

    def test_optional_audio_metadata_is_unknown_when_absent_or_invalid_but_pcm_survives(self):
        base = {"data": base64.b64encode(PCM).decode()}
        for extra in ({}, {"transcription_id": None, "translation_part_id": 0, "last_chunk": "true"},
                      {"transcription_id": "", "translation_part_id": 0},
                      {"transcription_id": [], "translation_part_id": 0},
                      {"transcription_id": "x" * 513, "translation_part_id": 0}):
            value = PalabraEvents().accept({"message_type": "output_audio_data", "data": {**base, **extra}})
            self.assertEqual(base64.b64decode(value["audio"]), PCM)
            self.assertNotIn("segment_id", value); self.assertNotIn("turn_id", value)
            self.assertNotIn("audio_segment_final", value)
        for part in (None, True, [], {}, "x" * 513, 10**5000):
            value = PalabraEvents().accept({"message_type": "output_audio_data", "data": {
                **base, "transcription_id": "known", "translation_part_id": part, "last_chunk": False}})
            self.assertNotIn("segment_id", value)
            self.assertIn("turn_id", value)
            self.assertIs(value["audio_segment_final"], False)
            self.assertEqual(base64.b64decode(value["audio"]), PCM)

    def test_source_interval_requires_every_segment_to_be_valid_and_session_relative(self):
        valid = {"start": 1, "end": 2}
        invalid_segments = [None, [], {}, [valid, {}], [valid, {"start": 2}],
            [valid, {"start": True, "end": 3}], [valid, {"start": "2", "end": 3}],
            [valid, {"start": float("nan"), "end": 3}], [valid, {"start": 2, "end": float("inf")}],
            [valid, {"start": -1, "end": 3}], [valid, {"start": 3, "end": 2}], [valid, {"start": 1, "end": 1}],
            [valid, {"start": 0, "end": 90.01}], [valid, {"start": 1784642133, "end": 1784642134}],
            [valid] * 101, [valid, "invalid segment"]]
        for segments in invalid_segments:
            with self.subTest(segments_type=type(segments).__name__):
                event = caption("Texto válido", kind="translated_transcription")
                event["data"]["transcription"]["segments"] = segments
                value = PalabraEvents().accept(event)
                self.assertEqual(value["text"], "Texto válido ")
                self.assertNotIn("source_start_seconds", value); self.assertNotIn("source_end_seconds", value)
        event = caption("Límite válido", kind="translated_transcription")
        event["data"]["transcription"]["segments"] = [{"start": 0, "end": 90}] * 100
        value = PalabraEvents().accept(event)
        self.assertEqual((value["source_start_seconds"], value["source_end_seconds"]), (0, 90))

    def with_relay(self, handler, body):
        failures = []
        def checked(ws):
            try: handler(ws)
            except ConnectionClosed: pass
            except Exception as exc: failures.append(exc)
        with serve(checked, "127.0.0.1", 0, compression=None) as fake:
            threading.Thread(target=fake.serve_forever, daemon=True).start()
            endpoint = f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"
            bridge = PalabraBridge(9876).start()
            try:
                with patch.dict(os.environ, {"BRIVANY_PALABRA_API_KEY": "test-secret"}, clear=True), patch("packages.providers.palabra.URL", endpoint): body(bridge)
            finally: bridge.close()
        if failures: raise failures[0]

    @staticmethod
    def browser(bridge):
        return connect(f"ws://127.0.0.1:{bridge.port}/dub", origin="http://127.0.0.1:9876", proxy=None)

    def test_real_loopback_envelopes_aggregation_tail_padding_and_draining(self):
        received = []
        def upstream(ws):
            self.assertEqual(ws.request.headers.get("Authorization"), "Bearer test-secret")
            self.assertNotIn("test-secret", ws.request.path)
            received.append(acknowledge(ws))
            for raw in ws:
                event = json.loads(raw); received.append(event)
                if event["message_type"] == "input_audio_data" and len(received) == 2:
                    ws.send(json.dumps({"message_type": "output_audio_data", "data": {"data": base64.b64encode(PCM).decode(), "chunk_generation_delta": 95}}))
                    ws.send(json.dumps({"message_type": "translated_transcription", "data": {"transcription": {"transcription_id": "first", "translation_part_id": 0, "text": "Hola"}}}))
                elif event["message_type"] == "end_task":
                    ws.send(json.dumps({"message_type": "translated_transcription", "data": {"transcription": {"transcription_id": "tail", "translation_part_id": 0, "text": "final"}}}))
                    ws.send(json.dumps({"message_type": "end_of_stream", "data": {}})); return
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["type"], "ready")
                self.assertIs(ready["translate_partials_requested"], False)
                self.assertIs(ready["translate_partials_observed"], False)
                self.assertIs(ready["provider_settings"]["translate_partial_transcriptions"], False)
                self.assertEqual(ready["provider_settings"]["queue"]["desired_queue_level_ms"], 2000)
                self.assertNotIn("test-secret", json.dumps(ready))
                for _ in range(4):browser.send(PCM)
                browser.send(b"\0\1"*60)
                browser.send(json.dumps({"type": "finish"}))
                values = []
                while True:
                    value = json.loads(browser.recv(timeout=2)); values.append(value)
                    if value["type"] == "done": break
                self.assertEqual([item["text"] for item in values if item["type"] == "transcript"], ["Hola ", "final "])
                metrics = [item for item in values if item["type"] == "metrics"][-1]
                self.assertIsNone(metrics["inference_ms"]); self.assertFalse(metrics["inference_verified"])
                self.assertEqual(metrics["tts_first_chunk_generation_ms"], 95)
                self.assertEqual((metrics["bytes_sent"], metrics["padding_bytes"], metrics["provider_input_bytes"]), (15480, 648, 16128))
        self.with_relay(upstream, body)
        self.assertEqual([event["message_type"] for event in received], ["set_task", "input_audio_data", "input_audio_data", "end_task"])
        payloads = [base64.b64decode(item["data"]["data"]) for item in received if item["message_type"] == "input_audio_data"]
        self.assertEqual(payloads[0], PCM*4); self.assertEqual(payloads[1][:120], b"\0\1"*60)
        self.assertEqual(len(payloads[1]), 768); self.assertEqual(received[-1]["data"], {"force": False})

    def test_opt_in_transport_delivers_partial_revisions_final_and_unchanged_audio(self):
        tasks, input_frames = [], []
        def upstream(ws):
            tasks.append(acknowledge(ws))
            self.assertIs(tasks[-1]["data"]["pipeline"]["translations"][0]["translate_partial_transcriptions"], True)
            for raw in ws:
                incoming = json.loads(raw)
                if incoming["message_type"] == "input_audio_data":
                    input_frames.append(base64.b64decode(incoming["data"]["data"]))
                    ws.send(json.dumps(caption(" La casa ")))
                    ws.send(json.dumps(caption(" La casa ")))
                    ws.send(json.dumps(caption(" La habitación tiene dos ventanas. ", kind="translated_transcription")))
                    ws.send(json.dumps(caption("parcial anterior")))
                    ws.send(json.dumps(caption(" La habitación tiene dos ventanas. ", kind="translated_transcription")))
                    for _ in range(2):
                        ws.send(json.dumps({"message_type": "output_audio_data", "data": {
                            "data": base64.b64encode(PCM).decode(), "chunk_generation_delta": 95}}))
                if incoming["message_type"] == "end_task":
                    ws.send(json.dumps({"message_type": "end_of_stream", "data": {}})); return
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "translate_partials": True}))
                ready = json.loads(browser.recv(timeout=2))
                self.assertIs(ready["translate_partials_requested"], True)
                self.assertIs(ready["translate_partials_observed"], True)
                self.assertIs(ready["provider_settings"]["translate_partial_transcriptions"], True)
                self.assertIs(ready["provider_settings"]["observed_fields"]["translate_partial_transcriptions"], True)
                self.assertNotIn("test-secret", json.dumps(ready))
                browser.send(PCM); browser.send(json.dumps({"type": "finish"}))
                values = []
                while not values or values[-1]["type"] != "done":
                    values.append(json.loads(browser.recv(timeout=2)))
                captions = [value for value in values if value["type"] == "transcript"]
                self.assertEqual([value["text"] for value in captions], [" La casa ", " La habitación tiene dos ventanas. "])
                self.assertEqual([value["revision"] for value in captions], [1, 2])
                self.assertEqual(captions[0]["segment_id"], captions[1]["segment_id"])
                self.assertEqual([value["provisional"] for value in captions], [True, False])
                self.assertEqual([value["final"] for value in captions], [False, True])
                self.assertTrue(all(value["operation"] == "replace" for value in captions))
                audio = [base64.b64decode(value["audio"]) for value in values if value["type"] == "audio"]
                self.assertEqual(b"".join(audio), PCM * 2)
                self.assertTrue(all(0 < len(chunk) <= 1920 for chunk in audio))
                summary = next(value for value in reversed(values) if value["type"] == "metrics")
                self.assertEqual(summary["bytes_sent"], len(PCM))
                self.assertEqual(summary["output_bytes"], len(PCM) * 2)
        self.with_relay(upstream, body)
        self.assertEqual(input_frames, [PCM])

    def test_large_output_burst_is_paced_byte_exact_and_drains_captions_before_done(self):
        burst = bytes(index % 251 for index in range(126730))
        sent_at = []
        def upstream(ws):
            acknowledge(ws)
            self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "input_audio_data")
            self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "end_task")
            sent_at.append(time.monotonic())
            ws.send(json.dumps({"message_type": "output_audio_data", "data": {
                "data": base64.b64encode(burst).decode(), "chunk_generation_delta": 123,
                "transcription_id": "burst:room", "translation_part_id": "0", "last_chunk": True}}))
            ws.send(json.dumps(caption("Final detrás de la voz", kind="translated_transcription", identifier="burst:room", part=0)))
            ws.send(json.dumps({"message_type": "end_of_stream", "data": {}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                browser.send(PCM); browser.send(json.dumps({"type": "finish"}))
                values, chunks, stamps = [], [], []
                playback_until, max_queue = 0.0, 0.0
                while not values or values[-1]["type"] != "done":
                    value = json.loads(browser.recv(timeout=3)); now = time.monotonic(); values.append(value)
                    if value["type"] == "audio":
                        chunk = base64.b64decode(value["audio"]); chunks.append(chunk); stamps.append(now)
                        self.assertLessEqual(len(chunk), 1920)
                        self.assertEqual(len(chunk) % 2, 0)
                        playback_until = max(playback_until, now) + len(chunk) / 48000
                        max_queue = max(max_queue, playback_until - now)
                self.assertEqual(b"".join(chunks), burst)
                self.assertEqual(len(chunks), 67)
                self.assertEqual(len(chunks[-1]), 10)
                audio_events = [value for value in values if value["type"] == "audio"]
                self.assertEqual([value["audio_segment_final"] for value in audio_events], [False] * 66 + [True])
                text_event = next(value for value in values if value["type"] == "transcript")
                self.assertTrue(all(value["segment_id"] == text_event["segment_id"] for value in audio_events))
                self.assertTrue(all(value["turn_id"] == text_event["turn_id"] for value in audio_events))
                self.assertLessEqual(max_queue, .335)
                self.assertLess(stamps[0] - sent_at[0], .5)
                self.assertGreaterEqual(stamps[-1] - stamps[0], len(burst) / 48000 - .335)
                self.assertEqual([value["text"] for value in values if value["type"] == "transcript"], ["Final detrás de la voz "])
                last_audio = max(index for index, value in enumerate(values) if value["type"] == "audio")
                final_text = next(index for index, value in enumerate(values) if value["type"] == "transcript")
                self.assertLess(last_audio, final_text)
                self.assertLess(final_text, len(values) - 1)
                metrics = [value for value in values if value["type"] == "metrics"]
                self.assertEqual(metrics[-1]["output_bytes"], len(burst))
                self.assertEqual(metrics[0]["first_output_audio_ms"], metrics[-1]["first_output_audio_ms"])
                self.assertTrue(all(value["tts_first_chunk_generation_ms"] == 123 for value in metrics))
                with self.assertRaises(ConnectionClosed): browser.recv(timeout=1)
        self.with_relay(upstream, body)

    def test_output_bucket_does_not_accumulate_credit_during_idle(self):
        idle_started, release_burst = threading.Event(), threading.Event()
        large = bytes(index % 251 for index in range(28800))  # 600 ms.
        def upstream(ws):
            acknowledge(ws)
            self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "input_audio_data")
            ws.send(json.dumps({"message_type": "output_audio_data", "data": {"data": base64.b64encode(PCM[:1920]).decode()}}))
            idle_started.set()
            self.assertTrue(release_burst.wait(2))
            ws.send(json.dumps({"message_type": "output_audio_data", "data": {"data": base64.b64encode(large).decode()}}))
            self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "end_task")
            ws.send(json.dumps({"message_type": "end_of_stream", "data": {}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                for _ in range(4):browser.send(PCM)
                first = None
                while first is None:
                    event = json.loads(browser.recv(timeout=2))
                    if event["type"] == "audio": first = base64.b64decode(event["audio"])
                self.assertEqual(first, PCM[:1920]); self.assertTrue(idle_started.wait(2))
                # The idle source should refill only the 300 ms playback lead.
                self.assertFalse(threading.Event().wait(.4)); release_burst.set()
                chunks, stamps, playback_until, max_queue = [], [], 0.0, 0.0
                while sum(map(len, chunks)) < len(large):
                    event = json.loads(browser.recv(timeout=2)); now = time.monotonic()
                    if event["type"] != "audio": continue
                    chunk = base64.b64decode(event["audio"]); chunks.append(chunk); stamps.append(now)
                    playback_until = max(playback_until, now) + len(chunk) / 48000
                    max_queue = max(max_queue, playback_until - now)
                self.assertEqual(b"".join(chunks), large)
                self.assertTrue(all(len(chunk) <= 1920 for chunk in chunks))
                self.assertLessEqual(max_queue, .335)
                self.assertGreaterEqual(stamps[-1] - stamps[0], .265)
                browser.send(json.dumps({"type": "finish"}))
                while json.loads(browser.recv(timeout=2))["type"] != "done": pass
        self.with_relay(upstream, body)

    def test_cancel_interrupts_output_pacing_without_stale_audio_or_done(self):
        disconnected, burst_sent = threading.Event(), threading.Event()
        provider_messages, emitted_after_cancel = [], []
        burst = bytes(index % 251 for index in range(126730))
        original_send = PalabraBridge.send
        cancelled = threading.Event()
        def observed_send(browser, event):
            if cancelled.is_set(): emitted_after_cancel.append(event["type"])
            original_send(browser, event)
        def upstream(ws):
            acknowledge(ws)
            self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "input_audio_data")
            ws.send(json.dumps({"message_type": "output_audio_data", "data": {"data": base64.b64encode(burst).decode()}}))
            burst_sent.set()
            try:
                for raw in ws: provider_messages.append(json.loads(raw))
            finally: disconnected.set()
        def body(bridge):
            with patch.object(PalabraBridge, "send", staticmethod(observed_send)), self.browser(bridge) as browser:
                browser.send(json.dumps({**OPTIONS, "translate_partials": True})); browser.recv(timeout=2)
                for _ in range(4):browser.send(PCM)
                audio_bytes = 0
                while audio_bytes < 19200:  # Reader is pacing after its initial credit.
                    event = json.loads(browser.recv(timeout=2))
                    if event["type"] == "audio": audio_bytes += len(base64.b64decode(event["audio"]))
                self.assertTrue(burst_sent.is_set())
                started_cancel = time.monotonic(); browser.send(json.dumps({"type": "cancel"}))
                self.assertTrue(disconnected.wait(.5))
                self.assertLess(time.monotonic() - started_cancel, .5)
                cancelled.set()
                while True:
                    try: event = json.loads(browser.recv(timeout=1))
                    except ConnectionClosed: break
                    self.assertNotIn(event["type"], {"done", "error"})
                self.assertFalse(threading.Event().wait(.1))
                self.assertEqual(emitted_after_cancel, [])
        self.with_relay(upstream, body)
        self.assertEqual(provider_messages, [])

    def test_cancel_closes_connection_without_retries_or_end_task(self):
        for enabled in (False, True):
            with self.subTest(translate_partials=enabled):
                disconnected = threading.Event(); messages = []
                def upstream(ws):
                    acknowledge(ws)
                    try:
                        for raw in ws: messages.append(raw)
                    finally: disconnected.set()
                def body(bridge):
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps({**OPTIONS, "translate_partials": enabled}))
                        ready = json.loads(browser.recv(timeout=2))
                        self.assertEqual(ready["type"], "ready")
                        self.assertIs(ready["translate_partials_requested"], enabled)
                        with self.browser(bridge) as second: self.assertEqual(json.loads(second.recv(timeout=2))["code"], "dubbing_busy")
                        browser.send(json.dumps({"type": "cancel"})); self.assertTrue(disconnected.wait(2))
                self.with_relay(upstream, body); self.assertEqual(messages, [])

    def test_origin_path_missing_credentials_and_audio_limits(self):
        bridge = PalabraBridge(9876).start()
        try:
            with self.assertRaises(InvalidStatus): connect(f"ws://127.0.0.1:{bridge.port}/dub", origin="https://foreign.example", proxy=None)
            with patch.dict(os.environ, {}, clear=True), patch("packages.providers.palabra.connect") as upstream:
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS)); self.assertEqual(json.loads(browser.recv(timeout=2))["code"], "dubbing_not_configured")
                upstream.assert_not_called()
            for invalid in (0, 1, "true", None, [], {}):
                with patch.dict(os.environ, {"BRIVANY_PALABRA_API_KEY": "test-secret"}, clear=True), patch("packages.providers.palabra.connect") as upstream:
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps({**OPTIONS, "translate_partials": invalid}))
                        self.assertEqual(json.loads(browser.recv(timeout=2))["code"], "dubbing_options")
                    upstream.assert_not_called()
        finally: bridge.close()
        def upstream(ws):
            acknowledge(ws)
            try:
                for _ in ws: pass
            except ConnectionClosed: pass
        def body(bridge):
            for enabled in (False, True):
                for data, count, code in ((b"\0", 1, "dubbing_audio_format"), (b"\0"*9602, 1, "dubbing_audio_format"), (b"\0"*9600, 3, "dubbing_backlog")):
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps({**OPTIONS, "translate_partials": enabled}))
                        self.assertEqual(json.loads(browser.recv(timeout=2))["type"], "ready")
                        for _ in range(count): browser.send(data)
                        self.assertEqual(json.loads(browser.recv(timeout=2))["code"], code)
        self.with_relay(upstream, body)

    def test_rejection_is_sanitized_and_missing_end_of_stream_is_failure(self):
        def rejected(ws):
            ws.recv(); ws.send(json.dumps({"message_type": "error", "data": {"desc": "test-secret private detail"}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); error = json.loads(browser.recv(timeout=2))
                self.assertEqual(error["code"], "dubbing_rejected"); self.assertNotIn("test-secret", json.dumps(error))
        self.with_relay(rejected, body)
        def no_tail(ws):
            acknowledge(ws)
            try:
                for _ in ws: pass
            except ConnectionClosed: pass
        def tail_body(bridge):
            with self.browser(bridge) as browser, patch("packages.providers.palabra.DRAIN_SECONDS", .05):
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2); browser.send(json.dumps({"type": "finish"}))
                self.assertEqual(json.loads(browser.recv(timeout=2))["code"], "dubbing_drain_timeout")
        self.with_relay(no_tail, tail_body)

    def test_idle_session_ends_at_wall_limit_with_no_inference_claim(self):
        messages = []
        def upstream(ws):
            acknowledge(ws); messages.append(json.loads(ws.recv(timeout=7))); ws.send(json.dumps({"message_type": "end_of_stream", "data": {}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); browser.recv(timeout=2)
                while True:
                    event = json.loads(browser.recv(timeout=7))
                    if event["type"] == "metrics": self.assertIsNone(event["first_output_audio_ms"])
                    if event["type"] == "done": break
        self.with_relay(upstream, body); self.assertEqual(messages, [{"message_type": "end_task", "data": {"force": False}}])

    def test_effective_settings_are_observed_not_copied_from_requested_options(self):
        data = task_settings("en", "es")["data"]
        data["pipeline"]["translation_queue_configs"]["global"]["desired_queue_level_ms"] = 3000
        result = effective_settings(data, "en", "es")
        self.assertEqual(result["queue"]["desired_queue_level_ms"], 3000)
        data["pipeline"].pop("translation_queue_configs")
        unknown = effective_settings(data, "en", "es")
        self.assertIsNone(unknown["queue"])
        self.assertFalse(any(unknown["observed_fields"]["queue"].values()))

    def test_partial_metadata_accepts_only_observed_booleans_without_secrets(self):
        for observed in (False, True, 0, 1, "true", None, [], {}):
            with self.subTest(observed_type=type(observed).__name__, observed=observed):
                data = task_settings("en", "es")["data"]
                data["pipeline"]["translations"][0]["translate_partial_transcriptions"] = observed
                data["pipeline"]["translations"][0]["private_extra"] = "test-secret"
                result = effective_settings(data, "en", "es")
                self.assertIs(result["translate_partial_transcriptions"], observed if type(observed) is bool else None)
                self.assertIs(result["observed_fields"]["translate_partial_transcriptions"], type(observed) is bool)
                self.assertNotIn("test-secret", json.dumps(result))
        missing = task_settings("en", "es")["data"]
        missing["pipeline"]["translations"][0].pop("translate_partial_transcriptions")
        result = effective_settings(missing, "en", "es")
        self.assertIsNone(result["translate_partial_transcriptions"])
        self.assertIs(result["observed_fields"]["translate_partial_transcriptions"], False)

    def test_only_confirm_by_silence_is_requested_explicitly_but_only_observed_as_bool(self):
        self.assertIs(task_settings("en", "es")["data"]["pipeline"]["transcription"]["only_confirm_by_silence"], False)
        for observed in (False, True, None, "false", 0, 1, [], {}):
            with self.subTest(observed=observed):
                data = task_settings("en", "es")["data"]
                data["pipeline"]["transcription"]["only_confirm_by_silence"] = observed
                result = effective_settings(data, "en", "es")
                self.assertIs(result["only_confirm_by_silence"], observed if type(observed) is bool else None)
                self.assertIs(result["observed_fields"]["only_confirm_by_silence"], type(observed) is bool)
        data["pipeline"]["transcription"].pop("only_confirm_by_silence")
        result = effective_settings(data, "en", "es")
        self.assertIsNone(result["only_confirm_by_silence"])
        self.assertIs(result["observed_fields"]["only_confirm_by_silence"], False)

    def test_requested_partial_mode_does_not_invent_observed_settings(self):
        for requested, observed in ((False, True), (True, False), (True, None), (True, 1)):
            with self.subTest(requested=requested, observed=observed):
                metadata = task_settings("en", "es")["data"]
                metadata["pipeline"]["translations"][0]["translate_partial_transcriptions"] = observed
                def upstream(ws):
                    acknowledge(ws, metadata)
                    self.assertEqual(json.loads(ws.recv(timeout=2))["message_type"], "end_task")
                    ws.send(json.dumps({"message_type": "end_of_stream", "data": {}}))
                def body(bridge):
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps({**OPTIONS, "translate_partials": requested}))
                        ready = json.loads(browser.recv(timeout=2))
                        self.assertIs(ready["translate_partials_requested"], requested)
                        self.assertIs(ready["translate_partials_observed"], observed if type(observed) is bool else None)
                        self.assertIs(ready["provider_settings"]["observed_fields"]["translate_partial_transcriptions"], type(observed) is bool)
                        browser.send(json.dumps({"type": "finish"}))
                        while json.loads(browser.recv(timeout=2))["type"] != "done": pass
                self.with_relay(upstream, body)

    def test_incomplete_metadata_does_not_disable_core_translation(self):
        def upstream(ws):
            acknowledge(ws, {"task_status": "running", "private_extra": "test-secret"})
            message = json.loads(ws.recv(timeout=2))
            self.assertEqual(message["message_type"], "end_task")
            ws.send(json.dumps({"message_type": "end_of_stream", "data": {}}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS)); ready = json.loads(browser.recv(timeout=2))
                self.assertEqual(ready["type"], "ready")
                self.assertIsNone(ready["provider_settings"]["source_language"])
                self.assertIsNone(ready["provider_settings"]["target_language"])
                self.assertIsNone(ready["provider_settings"]["queue"])
                self.assertIs(ready["translate_partials_requested"], False)
                self.assertIsNone(ready["translate_partials_observed"])
                self.assertNotIn("test-secret", json.dumps(ready))
                browser.send(json.dumps({"type": "finish"}))
                while json.loads(browser.recv(timeout=2))["type"] != "done": pass
        self.with_relay(upstream, body)

    def test_nested_metadata_is_observed_and_explicit_wrong_language_is_error(self):
        nested = {"task": task_settings("en", "es")["data"]}
        result = effective_settings(nested, "en", "es")
        self.assertEqual(result["observed_path"], "task.pipeline")
        self.assertEqual(result["source_language"], "en")
        nested["task"]["pipeline"]["transcription"]["source_language"] = "fr"
        with self.assertRaises(VoiceError) as error: effective_settings(nested, "en", "es")
        self.assertEqual(error.exception.code, "dubbing_language_mismatch")


if __name__ == "__main__": unittest.main()
