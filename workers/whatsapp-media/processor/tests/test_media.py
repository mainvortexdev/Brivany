import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if (ROOT / ".test-deps").is_dir(): sys.path.insert(0, str(ROOT / ".test-deps"))
import numpy as np
from PIL import Image
from audio import classify_audio, label_scores, wav_chunks
from fetch_model import verify
from media import Limits, collage_pages, process_video


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-threads", "1", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe required")
class FrameTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()

    def video(self, *, audio=False):
        path = self.root / "local.mp4"
        args = ["-f", "lavfi", "-i", "color=c=blue:s=160x120:r=10:d=1"]
        if audio: args += ["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1", "-c:a", "aac", "-shortest"]
        ffmpeg(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path))
        return path

    def test_all_decoded_frames_have_exact_total_and_preserve_audio_presence(self):
        result = process_video(self.video(), self.root, prefix="m001", limits=Limits(), deadline=time.monotonic() + 30)
        self.assertEqual(result["coverage"], {"totalFrames": 10, "extractedFrames": 10, "complete": True, "reason": None})
        self.assertEqual([frame["timestampMs"] for frame in result["imageFiles"]], [float(n * 100) for n in range(10)])
        self.assertFalse(result["audio"]["present"])
        self.assertEqual(len(result["collageFiles"]), 1)
        self.assertEqual(result["collageFiles"][0]["frames"][-1], {"index": 9, "timestampMs": 900.0})

    def test_frame_limit_is_explicit_partial_coverage_with_real_total(self):
        result = process_video(self.video(), self.root, prefix="m002", limits=Limits(max_frames=3), deadline=time.monotonic() + 30)
        self.assertEqual(result["coverage"], {"totalFrames": 10, "extractedFrames": 3, "complete": False, "reason": "frame_limit"})
        self.assertEqual(result["imageFiles"][-1]["timestampMs"], 200)

    def test_vfr_timestamps_are_not_replaced_with_nominal_fps(self):
        for i, color in enumerate(["red", "green", "blue"]): Image.new("RGB", (160, 120), color).save(self.root / f"{i}.png")
        sequence = self.root / "fixture.txt"
        sequence.write_text("file '0.png'\nduration 0.10\nfile '1.png'\nduration 0.30\nfile '2.png'\nduration 0.15\nfile '2.png'\n")
        video = self.root / "vfr.mp4"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(sequence), "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video))
        result = process_video(video, self.root, prefix="vfr", limits=Limits(), deadline=time.monotonic() + 30)
        stamps = [frame["timestampMs"] for frame in result["imageFiles"]]
        gaps = {round(b - a, 3) for a, b in zip(stamps, stamps[1:])}
        self.assertGreater(len(gaps), 1)
        self.assertTrue(result["coverage"]["complete"])
        self.assertEqual(result["coverage"]["totalFrames"], len(stamps))

    def test_original_audio_and_analysis_chunks_are_separate_and_not_assumed_speech(self):
        result = process_video(self.video(audio=True), self.root, prefix="audio", limits=Limits(), deadline=time.monotonic() + 30)
        self.assertTrue(result["audio"]["present"])
        track = result["audio"]["tracks"][0]
        self.assertTrue((self.root / track["originalFile"]).is_file())
        with wave.open(str(self.root / track["wav16kFile"]), "rb") as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 16000))
        self.assertEqual(track["classification"]["status"], "unavailable")
        self.assertIsNone(track["classification"]["segments"][0]["speech"])
        self.assertIsNone(track["classification"]["segments"][0]["music"])
        self.assertLess((self.root / track["wav16kFiles"][0]["file"]).stat().st_size, 1_048_576)

    def test_collages_paginate_4_by_4_and_keep_all_ordered_indexes(self):
        Image.new("RGB", (8, 8), "red").save(self.root / "frame.jpg")
        frames = [{"file": "frame.jpg", "index": index, "timestampMs": index * 125} for index in range(17)]
        pages = collage_pages(frames, self.root, prefix="paginated")
        self.assertEqual(len(pages), 2)
        self.assertEqual([frame["index"] for page in pages for frame in page["frames"]], list(range(17)))
        with Image.open(self.root / pages[0]["file"]) as page: self.assertEqual(page.size, (960, 1056))

    def test_playlists_and_duration_over_limit_are_rejected_before_extraction(self):
        file = self.root / "remote.mp4"; file.write_text("#EXTM3U\nhttps://internal.invalid/secret\n")
        with self.assertRaisesRegex(ValueError, "video_container_not_allowed"):
            process_video(file, self.root, prefix="bad", limits=Limits(), deadline=time.monotonic() + 5)
        with self.assertRaisesRegex(ValueError, "video_duration_limit"):
            process_video(self.video(), self.root, prefix="long", limits=Limits(max_duration=0), deadline=time.monotonic() + 30)


class AudioTests(unittest.TestCase):
    def test_speech_music_singing_and_overlap_are_independent(self):
        names = ["Speech", "Music", "Singing"]
        mixed = label_scores([0.8, 0.9, 0.01], names)
        self.assertTrue(mixed["speech"]); self.assertTrue(mixed["music"]); self.assertTrue(mixed["overlap"]); self.assertFalse(mixed["singing"])
        sung = label_scores([0.02, 0.8, 0.8], names)
        self.assertFalse(sung["speech"]); self.assertTrue(sung["singing"]); self.assertTrue(sung["overlap"])
        self.assertEqual(label_scores([0.01, 0.01, 0.01], names)["labels"], ["unknown"])

    def test_silence_energy_does_not_fabricate_speech_or_music_absence_without_classifier(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "silence.wav"
            with wave.open(str(path), "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", "none")); output.writeframes(bytes(32000))
            result = classify_audio(path)
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["segments"][0]["labels"], ["silence_candidate"])
            self.assertIsNone(result["segments"][0]["speech"]); self.assertIsNone(result["segments"][0]["music"])

    def test_chunks_stay_under_one_mebibyte_and_classification_uses_absolute_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = root / "long.wav"
            with wave.open(str(path), "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", "none")); output.writeframes(bytes(16000 * 2 * 61))
            classification = {"status": "classified", "segments": [{"startSeconds": 29.7, "endSeconds": 30.4, "music": True}]}
            chunks = wav_chunks(path, root, prefix="test", classification=classification)
            self.assertEqual(len(chunks), 3)
            self.assertEqual(chunks[1]["startSeconds"], 30)
            self.assertEqual(chunks[1]["classification"]["segments"][0]["startSeconds"], 30)
            self.assertEqual(chunks[1]["classification"]["segments"][0]["endSeconds"], 30.4)
            self.assertTrue(all((root / chunk["file"]).stat().st_size < 1_048_576 for chunk in chunks))

    def test_model_hash_rejects_modified_or_other_weights(self):
        with self.assertRaisesRegex(ValueError, "hash_mismatch"): verify(b"not the official model")

    @unittest.skipUnless((ROOT / "models/yamnet-classification.tflite").is_file(), "Official hash-pinned model not installed")
    def test_real_cpu_yamnet_model_is_small_and_produces_bounded_independent_scores(self):
        try:
            from ai_edge_litert.interpreter import Interpreter
        except ImportError: self.skipTest("LiteRT not installed")
        model = ROOT / "models/yamnet-classification.tflite"
        self.assertEqual(len(verify(model.read_bytes())), 4_126_810)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "silence.wav"
            with wave.open(str(path), "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", "none")); output.writeframes(bytes(32000 * 2))
            started = time.monotonic()
            result = classify_audio(path, model_path=model)
            self.assertEqual(result["status"], "classified")
            self.assertLess(time.monotonic() - started, 10)
            self.assertTrue(all(0 <= score <= 1 for segment in result["segments"] for score in segment["scores"].values()))
            self.assertFalse(any(segment["speech"] or segment["music"] for segment in result["segments"]))


if __name__ == "__main__": unittest.main()
