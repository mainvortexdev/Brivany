"""One authorized fixture, local collection and files only; no external calls."""
import base64
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import wave

from tools.synthetic_dubbing_review import (SyntheticReview, ROOT, SOURCE_RELATIVE, SOURCE_SHA256,
    SOURCE_FRAMES, KNOWN_SOURCE_TEXT, OUTPUT_RELATIVE, MAX_OUTPUT_PCM_BYTES, MAX_AUDIO_CHUNK_BYTES,
    STREAM_SOURCE_SHA256, STREAM_SOURCE_FRAMES, STREAM_SOURCE_TEXT, MAX_STDIN_BYTES, MAX_REVIEW_EVENTS,
    collect_stdin, main)


def audio_event(content=b"\0\0"*240):
    return {"type": "audio", "audio": base64.b64encode(content).decode(), "sample_rate": 24000}


class SyntheticDubbingReviewTests(unittest.TestCase):
    def setUp(self):
        self.source = ROOT/SOURCE_RELATIVE
        self.assertTrue(self.source.is_file(), "La fixture autorizada debe existir para estas pruebas locales.")

    def collector(self): return SyntheticReview(self.source)

    def retain_for_cleanup(self, result):
        def cleanup():
            for key in ("wav_path", "json_path"): Path(result[key]).unlink(missing_ok=True)
            Path(result["directory"]).rmdir()
        self.addCleanup(cleanup)
        return result

    def finish(self, review): return self.retain_for_cleanup(review.finish())

    def stream_source(self):
        matches = [path for path in (ROOT/"tmp/stream-dubbing").glob("build-*/two-clauses.wav")
                   if hashlib.sha256(path.read_bytes()).hexdigest() == STREAM_SOURCE_SHA256]
        self.assertTrue(matches, "La fixture aprobada de dos frases debe estar preparada.")
        return sorted(matches)[0]

    def cli(self, args, content=b""):
        output = io.StringIO()
        with patch("tools.synthetic_dubbing_review.sys.stdin", SimpleNamespace(buffer=io.BytesIO(content))), redirect_stdout(output):
            code = main(args)
        return code, output.getvalue(), json.loads(output.getvalue())

    def test_fixture_hash_and_metadata_authority_are_builtin(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), SOURCE_SHA256)
        metadata = self.collector().source_metadata()
        self.assertEqual(metadata["sha256"], SOURCE_SHA256)
        self.assertEqual(metadata["duration_seconds"], SOURCE_FRAMES/24000)
        self.assertTrue(metadata["synthetic"])
        for source in ({"sha256": SOURCE_SHA256}, "https://private.invalid/recording.wav", ROOT/"tmp/private.wav"):
            with self.assertRaises(ValueError): SyntheticReview(source)
        with self.assertRaises(ValueError): SyntheticReview(self.source, ROOT/"tmp/private-review")

    def test_wrong_file_digest_rejected_even_at_authorized_path(self):
        with patch.object(Path, "open", return_value=io.BytesIO(b"private-source-audio")):
            with self.assertRaises(ValueError) as failure: self.collector()
        self.assertNotIn("private-source-audio", str(failure.exception))

    def test_wav_format_duration_and_complete_pcm_validated_after_digest(self):
        def wav(rate=24000, frames=SOURCE_FRAMES, channels=1):
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as stream:
                stream.setnchannels(channels); stream.setsampwidth(2); stream.setframerate(rate)
                stream.writeframes(b"\0\0"*(frames*channels))
            return buffer.getvalue()
        digest = Mock(); digest.hexdigest.return_value = SOURCE_SHA256
        for content in (wav(rate=16000), wav(frames=SOURCE_FRAMES-1), wav(channels=2), wav()[:-2], b"not-wav"):
            with patch.object(Path, "open", return_value=io.BytesIO(content)), \
                 patch("tools.synthetic_dubbing_review.hashlib.sha256", return_value=digest):
                with self.assertRaises(ValueError): self.collector()

    def test_only_valid_base64_pcm_format_and_twenty_second_output_are_accepted(self):
        review = self.collector()
        invalid = [b"binary-event", [], {"type": "audio", "audio": b"binary-pcm"},
            {"type": "audio", "audio": "%%%"}, audio_event(b"\0"), audio_event(b""),
            {**audio_event(), "sample_rate": 16000}, {**audio_event(), "channels": True},
            {**audio_event(), "format": "mp3"}, {**audio_event(), "format": []}, audio_event(b"\0"*(MAX_AUDIO_CHUNK_BYTES+2))]
        for event in invalid:
            with self.assertRaises(ValueError): review.collect(event)
        review.collect(audio_event(b"\0"*MAX_AUDIO_CHUNK_BYTES))
        review.collect(audio_event(b"\0"*MAX_AUDIO_CHUNK_BYTES))
        with self.assertRaises(ValueError): review.collect(audio_event(b"\0\0"))
        result = self.finish(review)
        with wave.open(result["wav_path"], "rb") as audio:
            self.assertEqual(audio.getnframes()*2, MAX_OUTPUT_PCM_BYTES)

    def test_source_private_text_and_untrusted_metadata_never_persist(self):
        review = self.collector()
        with self.assertRaises(ValueError):
            review.collect({"type": "transcript", "source": "original", "text": "Bearer private-token-value"})
        review.collect({"type": "metrics", "token": "private-token-value", "provider": "private-provider-metadata"})
        review.collect({**audio_event(), "token": "private-token-value", "provider": "private-provider-metadata"})
        review.collect({"type": "transcript", "source": "original", "text": "This room "})
        review.collect({"type": "transcript", "source": "original", "text": "has two windows."})
        review.collect({"type": "transcript", "source": "translation", "text": "Esta habitación tiene dos ventanas.",
                        "provider_metadata": "private-provider-metadata"})
        result = self.finish(review)
        report_text = Path(result["json_path"]).read_text(encoding="utf-8")
        report = json.loads(report_text)
        for private in ("Private meeting notes", "private-token-value", "private-provider-metadata"):
            self.assertNotIn(private, report_text)
        self.assertEqual(report["known_source_text_en"], KNOWN_SOURCE_TEXT)
        self.assertEqual(report["source_text_observed"], KNOWN_SOURCE_TEXT)
        self.assertEqual(report["target_text_observed"], "Esta habitación tiene dos ventanas.")
        self.assertTrue(report["synthetic"]); self.assertTrue(report["pcm_review_available"])
        self.assertFalse(report["semantic_accuracy_verified"]); self.assertFalse(report["automatic_semantic_assessment"])
        self.assertFalse(report["naturalness_verified"])

    def test_recognition_error_on_authorized_fixture_is_retained_without_claiming_accuracy(self):
        review=self.collector();review.collect(audio_event())
        review.collect({"type":"transcript","source":"original","text":"This room has to windows."})
        result=self.finish(review)
        report=json.loads(Path(result["json_path"]).read_text(encoding="utf-8"))
        self.assertEqual(report["source_text_observed"],"This room has to windows.")
        self.assertEqual(report["known_source_text_en"],KNOWN_SOURCE_TEXT)
        self.assertFalse(report["semantic_accuracy_verified"])

    def test_target_text_bounds_controls_credentials_and_segment_revisions(self):
        review = self.collector()
        for text in (None, "x"*513, "Bearer private-secret-token", "https://private.invalid/token", "api_key=private-secret"):
            with self.assertRaises(ValueError): review.collect({"type": "transcript", "source": "translation", "text": text})
        review.collect({"type": "transcript", "source": "translation", "segment_id": "one", "text": "incorrecto"})
        review.collect({"type": "transcript", "source": "translation", "segment_id": "one", "operation": "replace",
                        "text": "Esta\x00 habitación\u202e tiene dos ventanas."})
        review.collect(audio_event())
        result = self.finish(review)
        report = json.loads(Path(result["json_path"]).read_text(encoding="utf-8"))
        self.assertEqual(report["target_text_observed"], "Esta habitación tiene dos ventanas.")
        self.assertNotIn("incorrecto", report["target_text_observed"])
        self.assertEqual(result, review.finish())
        with self.assertRaises(ValueError): review.collect(audio_event())

    def test_output_wav_and_json_hashes_match_and_only_uuid_local_files_created(self):
        review = self.collector(); pcm = b"\xE8\x03"*480
        review.collect(audio_event(pcm)); result = self.finish(review)
        directory = Path(result["directory"])
        self.assertEqual(directory.parent, (ROOT/OUTPUT_RELATIVE).resolve())
        self.assertEqual({path.name for path in directory.iterdir()}, {"translated.wav", "review.json"})
        report = json.loads(Path(result["json_path"]).read_text(encoding="utf-8"))
        self.assertEqual(hashlib.sha256(Path(result["wav_path"]).read_bytes()).hexdigest(), report["output"]["sha256"])
        self.assertEqual(hashlib.sha256(pcm).hexdigest(), report["output"]["pcm_sha256"])
        with wave.open(result["wav_path"], "rb") as audio:
            self.assertEqual(audio.getparams()[:4], (1, 2, 24000, 480))
            self.assertEqual(audio.readframes(480), pcm)
        self.assertEqual(report["source"]["sha256"], SOURCE_SHA256)
        self.assertEqual(report["output"]["duration_seconds"], .02)

    def test_empty_review_does_not_create_output_artifacts(self):
        review = self.collector()
        with self.assertRaises(ValueError): review.finish()

    def test_tuple_encoded_provider_segment_id_replaces_partial_without_being_persisted(self):
        review=self.collector();review.collect(audio_event())
        identifier='["upstream-private:id","0"]'
        review.collect({"type":"transcript","source":"translation","segment_id":identifier,
            "operation":"replace","text":"Esta habitación tiene"})
        review.collect({"type":"transcript","source":"translation","segment_id":identifier,
            "operation":"replace","text":"Esta habitación tiene dos ventanas."})
        result=self.finish(review);text=Path(result["json_path"]).read_text(encoding="utf-8")
        self.assertEqual(json.loads(text)["target_text_observed"],"Esta habitación tiene dos ventanas.")
        self.assertNotIn("upstream-private:id",text)

    def test_two_clause_fixture_requires_approved_path_hash_frames_and_text_provenance(self):
        source = self.stream_source(); review = SyntheticReview(source)
        metadata = review.source_metadata()
        self.assertEqual(metadata["fixture"], "two_clauses")
        self.assertEqual(metadata["sha256"], STREAM_SOURCE_SHA256)
        self.assertEqual(metadata["duration_seconds"], STREAM_SOURCE_FRAMES/24000)
        review.collect(audio_event()); result = self.finish(review)
        report = json.loads(Path(result["json_path"]).read_text(encoding="utf-8"))
        self.assertEqual(report["known_source_text_en"], STREAM_SOURCE_TEXT)
        self.assertEqual(result["source_sha256"], STREAM_SOURCE_SHA256)
        self.assertFalse(result["semantic_accuracy_verified"])
        for path in (source.parent/"another.wav", source.parent.parent/"two-clauses.wav",
                     source.parent.parent/("build-"+"a"*31)/"two-clauses.wav",
                     ROOT/"tmp/unrelated"/source.parent.name/"two-clauses.wav"):
            with patch.object(Path, "open") as open_file:
                with self.assertRaises(ValueError): SyntheticReview(path)
                open_file.assert_not_called()
        with patch.object(Path, "open", return_value=io.BytesIO(b"private-recording-not-authorized")):
            with self.assertRaises(ValueError): SyntheticReview(source)

    def test_preflight_both_sources_returns_only_safe_metadata_without_creating_artifacts(self):
        for source, expected in ((self.source, SOURCE_SHA256), (self.stream_source(), STREAM_SOURCE_SHA256)):
            with patch("tools.synthetic_dubbing_review.SyntheticReview.finish") as finish:
                code, text, result = self.cli(["--source", str(source), "--preflight"])
            self.assertEqual(code, 0); self.assertEqual(result["status"], "ready")
            self.assertEqual(result["source"]["sha256"], expected)
            self.assertFalse(result["audio_persisted"]); self.assertFalse(result["transcripts_persisted"])
            self.assertNotIn("text", text); self.assertNotIn("wav_path", text); finish.assert_not_called()

    def test_cli_collect_retains_exact_pcm_and_returns_hashes_without_transcripts_or_base64(self):
        pcm = b"\xE8\x03"*480
        observed = "Esta habitación tiene dos ventanas. La mesa está junto a la puerta."
        events = [audio_event(pcm[:640]), audio_event(pcm[640:]),
                  {"type":"transcript","source":"original","text":STREAM_SOURCE_TEXT},
                  {"type":"transcript","source":"translation","text":observed}]
        code, text, result = self.cli(["--source", str(self.stream_source()), "--collect-stdin"], json.dumps({"events":events}).encode())
        self.assertEqual(code, 0); self.assertEqual(result["status"], "saved")
        review = self.retain_for_cleanup(result["review"])
        self.assertNotIn(observed, text); self.assertNotIn(STREAM_SOURCE_TEXT, text)
        self.assertNotIn(events[0]["audio"], text)
        self.assertEqual(review["output_pcm_sha256"], hashlib.sha256(pcm).hexdigest())
        self.assertEqual(review["output_pcm_bytes"], len(pcm)); self.assertEqual(review["output_duration_seconds"], .02)
        self.assertEqual(review["review_sha256"], hashlib.sha256(Path(review["json_path"]).read_bytes()).hexdigest())
        self.assertEqual(review["output_sha256"], hashlib.sha256(Path(review["wav_path"]).read_bytes()).hexdigest())
        with wave.open(review["wav_path"], "rb") as audio: self.assertEqual(audio.readframes(1000), pcm)
        self.assertTrue(result["audio_persisted"]); self.assertFalse(result["semantic_accuracy_verified"])

    def test_cli_validates_every_event_before_finish_and_does_not_echo_rejected_private_data(self):
        rejected = [
            {"events":[audio_event(), {"type":"transcript","source":"translation","text":"Bearer private-token-value"}]},
            {"events":[audio_event(), {"type":"metrics","token":"private-token-value"}]},
            {"events":[audio_event(), {"type":[]}]},
            {"events":[audio_event(), {"type":"transcript","source":[],"text":"private-token-value"}]},
            {"events":[audio_event()],"private":"private-token-value"},
            {"events":[]}, {"events":[audio_event(b"\0\0")]*1001},
        ]
        for payload in rejected:
            with patch("tools.synthetic_dubbing_review.SyntheticReview.finish") as finish:
                code, text, result = self.cli(["--source",str(self.stream_source()),"--collect-stdin"],json.dumps(payload).encode())
            self.assertEqual(code, 2); self.assertEqual(result["status"], "rejected")
            self.assertNotIn("private-token-value", text); self.assertNotIn("audio", result)
            finish.assert_not_called()

    def test_stdin_byte_bound_is_applied_before_parsing_and_event_boundary_is_exact(self):
        stream = Mock(); stream.read.return_value = b"x"*(MAX_STDIN_BYTES+1)
        with patch("tools.synthetic_dubbing_review.SyntheticReview.finish") as finish:
            with self.assertRaises(ValueError): collect_stdin(self.source,stream)
        stream.read.assert_called_once_with(MAX_STDIN_BYTES+1); finish.assert_not_called()
        events = [audio_event(b"\0\0")]*MAX_REVIEW_EVENTS
        result = collect_stdin(self.stream_source(),io.BytesIO(json.dumps({"events":events}).encode()))
        review = self.retain_for_cleanup(result["review"])
        self.assertEqual(review["output_pcm_bytes"], MAX_REVIEW_EVENTS*2)

    def test_cli_argument_and_json_errors_are_static_and_never_create_a_review(self):
        cases = [(["--source",str(self.source),"--collect-stdin"],b"private-token-value"),
                 (["--source",str(self.source),"--preflight","--private-token-value"],b""),
                 (["--source","private-token-value","--preflight"],b"")]
        for args, content in cases:
            with patch("tools.synthetic_dubbing_review.SyntheticReview.finish") as finish:
                code, text, result = self.cli(args,content)
            self.assertEqual(code, 2); self.assertEqual(result["status"], "rejected")
            self.assertNotIn("private-token-value",text); finish.assert_not_called()


if __name__ == "__main__": unittest.main()
