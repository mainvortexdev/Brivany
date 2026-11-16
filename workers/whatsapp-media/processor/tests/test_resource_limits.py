import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if (ROOT / ".test-deps").is_dir(): sys.path.insert(0, str(ROOT / ".test-deps"))
from PIL import Image
from media import Limits, command, process_image, process_video
from processor import process_request
import server


class ResourceTests(unittest.TestCase):
    def test_server_ceilings_cannot_be_raised_by_request_and_defaults_keep_3000_frames(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(Limits.from_request().max_frames, 3000)
        with patch.dict(os.environ, {"MEDIA_MAX_BYTES": "100000000", "MEDIA_MAX_FRAMES": "3000",
                                     "MEDIA_MAX_DURATION_SECONDS": "90", "MEDIA_FRAME_EDGE": "512"}, clear=True):
            limits = Limits.from_request({"maxBytes": 400000000, "maxFrames": 3000, "maxDurationSeconds": 300})
            self.assertEqual((limits.max_bytes, limits.max_frames, limits.max_duration, limits.frame_edge),
                             (100000000, 3000, 90, 512))
            self.assertEqual(Limits.from_request({"maxFrames": 12}).max_frames, 12)
            with self.assertRaisesRegex(ValueError, "invalid_limits"):
                Limits.from_request({"ffmpegThreads": 8})

    def test_invalid_or_unbounded_deployment_configuration_fails_closed(self):
        for name, value in [("MEDIA_FFMPEG_THREADS", "999"), ("MEDIA_FRAME_EDGE", "8192"),
                            ("MEDIA_MAX_BYTES", "400000001"), ("MEDIA_CPU_SECONDS", "0"),
                            ("MEDIA_MAX_FRAMES", "-1"), ("MEDIA_MAX_MEDIA", "NaN")]:
            with self.subTest(name=name), patch.dict(os.environ, {name: value}, clear=True):
                with self.assertRaisesRegex(ValueError, "invalid_resource_configuration"):
                    Limits.from_request()

    def test_decoder_diagnostics_are_capped_while_process_is_still_running(self):
        started = time.monotonic()
        with self.assertRaisesRegex(ValueError, "command_output_limit"):
            command([sys.executable, "-c", "import sys,time;sys.stderr.write('x'*10000000);sys.stderr.flush();time.sleep(20)"],
                    deadline=started + 10, max_output=65536)
        self.assertLess(time.monotonic() - started, 3)

    def test_image_memory_ceiling_applies_before_large_rgb_copy_and_preserves_dimensions(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); original = directory / "image.jpg"
            Image.new("RGB", (900, 400), "red").save(original)
            with patch.dict(os.environ, {"MEDIA_MAX_IMAGE_PIXELS": "262144"}):
                with self.assertRaisesRegex(ValueError, "image_pixel_limit"):
                    process_image(original, directory, prefix="rejected")
            self.assertFalse((directory / "rejected-image.jpg").exists())
            result = process_image(original, directory, prefix="accepted")
            self.assertEqual((result["width"], result["height"]), (900, 400))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_portrait_frame_size_is_bounded_without_resampling_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); original = directory / "portrait.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=blue:s=320x640:r=4:d=1", "-threads", "1", "-c:v", "libx264", str(original)],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            result = process_video(original, directory, prefix="portrait", limits=Limits(frame_edge=128),
                                   deadline=time.monotonic() + 20)
            self.assertEqual([f["timestampMs"] for f in result["imageFiles"]], [0, 250, 500, 750])
            self.assertTrue(result["coverage"]["complete"])
            for frame in result["imageFiles"]:
                with Image.open(directory / frame["file"]) as image:
                    self.assertLessEqual(max(image.size), 128)

    def test_child_process_receives_bounded_native_threads_and_cpu_deadline(self):
        process = unittest.mock.Mock(returncode=0)
        process.communicate.return_value = (json.dumps({"ok": True, "result": {"status": "complete"}}).encode(), b"")
        with patch.dict(os.environ, {"MEDIA_FFMPEG_THREADS": "1", "OPENBLAS_NUM_THREADS": "64", "MEDIA_CPU_SECONDS": "60"}), \
             patch.object(server.subprocess, "Popen", return_value=process) as spawn:
            self.assertEqual(server.run_processing({"requestId": "job", "sourceUrl": "https://instagram.com/p/TEST/"})["status"], "complete")
            self.assertEqual(spawn.call_args.kwargs["env"]["OPENBLAS_NUM_THREADS"], "1")
            self.assertEqual(spawn.call_args.kwargs["env"]["OMP_NUM_THREADS"], "1")
            self.assertEqual(process.communicate.call_args.kwargs["timeout"], 60)

    def test_untrusted_decoder_does_not_inherit_parent_service_credentials(self):
        process = unittest.mock.Mock(returncode=0)
        process.communicate.return_value = (json.dumps({"ok": True, "result": {"status": "complete"}}).encode(), b"")
        with patch.dict(os.environ, {"MEDIA_PROCESSOR_TOKEN": "fixture-token", "UNRELATED_PROVIDER_KEY": "fixture-secret", "PATH": "fixture-runtime"}), \
             patch.object(server.subprocess, "Popen", return_value=process) as spawn:
            server.run_processing({"requestId": "job", "sourceUrl": "https://instagram.com/p/TEST/"})
            child = spawn.call_args.kwargs["env"]
            self.assertNotIn("MEDIA_PROCESSOR_TOKEN", child)
            self.assertNotIn("UNRELATED_PROVIDER_KEY", child)
            self.assertEqual(child["PATH"], "fixture-runtime")

    def test_memory_guard_failure_becomes_unavailable_source_evidence_not_complete(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"MEDIA_MAX_IMAGE_PIXELS": "262144"}):
            directory = Path(folder)
            class Transport:
                def download(self, url, destination, max_bytes):
                    Image.new("RGB", (900, 400), "red").save(destination, "PNG")
                    return {"bytes": destination.stat().st_size, "mimeType": "image/png"}
            result = process_request({"requestId": "large", "sourceUrl": "https://instagram.com/p/TEST/"}, directory,
                                     metadata_reader=lambda *_a, **_k: {"sourceUrl": "https://www.instagram.com/p/TEST/",
                                       "status": "available", "expectedMedia": 1, "media": [{"kind": "image", "url": "https://cdn.cdninstagram.com/a.png"}]},
                                     http=Transport())
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["coverage"]["extractedFrames"], 0)
            self.assertIn("image_pixel_limit", result["coverage"]["reasons"])


class ThreadTests(unittest.TestCase):
    def test_http_thread_budget_rejects_concurrent_overload_and_recovers(self):
        released, started = threading.Event(), threading.Event()
        class Slow(server.Handler):
            def do_GET(self):
                started.set(); released.wait(3); self.reply_json(200, {"status": "ready"})
        with patch.dict(os.environ, {"MEDIA_HTTP_THREADS": "2"}):
            http = server.BoundedHTTPServer(("127.0.0.1", 0), Slow)
        runner = threading.Thread(target=http.serve_forever, daemon=True); runner.start()
        # Establish two real requests and reserve both worker slots.
        clients = [http_client(http.server_port) for _ in range(2)]
        try:
            for client in clients: client.request("GET", "/health")
            self.assertTrue(started.wait(1))
            deadline = time.monotonic() + 1
            while http.slots.acquire(blocking=False):
                http.slots.release()
                if time.monotonic() > deadline: self.fail("second request not accepted")
                time.sleep(.01)
            overflow = http_client(http.server_port); overflow.request("GET", "/health")
            response = overflow.getresponse()
            self.assertEqual(response.status, 503); self.assertEqual(response.getheader("Retry-After"), "5")
            response.read(); overflow.close()
            released.set()
            for client in clients:
                response = client.getresponse(); self.assertEqual(response.status, 200); response.read()
            recovered = http_client(http.server_port); recovered.request("GET", "/health")
            response = recovered.getresponse(); self.assertEqual(response.status, 200); response.read(); recovered.close()
        finally:
            released.set()
            for client in clients: client.close()
            http.shutdown(); http.server_close(); runner.join()


def http_client(port):
    return http.client.HTTPConnection("127.0.0.1", port, timeout=4)


if __name__ == "__main__": unittest.main()
