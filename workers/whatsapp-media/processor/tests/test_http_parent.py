"""The HTTP parent stays lightweight and cleans unpublished failed jobs safely."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from contracts import cleanup_failed_job, has_complete_manifest

REQUEST = {"requestId": "fixture-failure", "sourceUrl": "https://www.instagram.com/p/TEST/"}


def write_receipt(directory, request_id=REQUEST["requestId"]):
    artifact = directory / "frame.jpg"
    artifact.write_bytes(b"stored-immutable-artifact")
    receipt = {"fingerprint": "a" * 64, "files": [artifact.name],
               "result": {"requestId": request_id, "sourceUrl": REQUEST["sourceUrl"], "status": "complete",
                          "media": [], "expiresAt": int(time.time()) + 900}}
    (directory / "manifest.json").write_text(json.dumps(receipt), "utf-8")
    return receipt


class ParentMemoryTests(unittest.TestCase):
    def test_fresh_server_import_never_loads_image_numeric_model_or_pipeline_modules(self):
        code = """
import importlib.abc, sys
sys.path.insert(0, sys.argv[1])
class RejectHeavy(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'numpy', 'PIL', 'ai_edge_litert', 'tensorflow', 'torch', 'processor', 'media', 'audio'}:
            raise RuntimeError('heavy HTTP parent import: ' + fullname)
sys.meta_path.insert(0, RejectHeavy())
import server
assert server.Limits.from_request().ffmpeg_threads == 1
assert not set(sys.modules) & {'numpy', 'PIL', 'ai_edge_litert', 'processor', 'media', 'audio'}
print('lightweight-parent')
"""
        run = subprocess.run([sys.executable, "-B", "-c", code, str(ROOT)], check=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(run.stdout.decode().strip(), "lightweight-parent")


class FailedJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.target = self.root / REQUEST["requestId"]
        self.root_patch = patch.object(server, "ROOT", self.root)
        self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def spawn(self, stdout=b"", returncode=0, publish=False):
        process = Mock(returncode=returncode)
        def communication(*_args, **_kwargs):
            self.target.mkdir(exist_ok=True)
            (self.target / "partial.mp4").write_bytes(b"partially-downloaded-file")
            if publish:
                write_receipt(self.target)
            return stdout, b"private diagnostic"
        process.communicate.side_effect = communication
        return process

    def test_oom_nonzero_exit_cleans_new_partial_files(self):
        process = self.spawn(returncode=-9)
        with patch.object(server.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(ValueError, "processing_unavailable"):
                server.run_processing(REQUEST)
        self.assertFalse(self.target.exists())

    def test_bad_json_shape_size_or_reported_error_cleans_new_partial_directory(self):
        for stdout in (b"not json", b"[]", b'{"ok":true}', b'{"ok":true,"result":[]}',
                       b'{"ok":false,"error":"public_metadata_unavailable"}', b"x" * 8_000_001):
            with self.subTest(size=len(stdout)), patch.object(server.subprocess, "Popen", return_value=self.spawn(stdout)):
                with self.assertRaises(ValueError):
                    server.run_processing(REQUEST)
                self.assertFalse(self.target.exists())

    def test_failure_after_publish_preserves_receipt_and_artifacts(self):
        for stdout, returncode in ((b"not json", 0), (b"", -9)):
            with self.subTest(code=returncode), patch.object(server.subprocess, "Popen", return_value=self.spawn(stdout, returncode, publish=True)):
                with self.assertRaises(ValueError):
                    server.run_processing(REQUEST)
                self.assertTrue(has_complete_manifest(self.target, REQUEST["requestId"]))
                self.assertEqual((self.target / "frame.jpg").read_bytes(), b"stored-immutable-artifact")
            # The second case deliberately also covers an existing immutable result.

    def test_request_conflict_preserves_preexisting_valid_job(self):
        self.target.mkdir()
        before = write_receipt(self.target)
        process = Mock(returncode=0)
        process.communicate.return_value = (b'{"ok":false,"error":"request_id_conflict"}', b"")
        with patch.object(server.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(ValueError, "request_id_conflict"):
                server.run_processing({**REQUEST, "sourceUrl": "https://www.instagram.com/p/OTHER/"})
        self.assertEqual(json.loads((self.target / "manifest.json").read_text("utf-8")), before)

    def test_timeout_kills_job_group_and_removes_unpublished_directory(self):
        process = Mock(returncode=-9, pid=777777)
        calls = 0
        def communication(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                self.target.mkdir()
                (self.target / "partial.mp4").write_bytes(b"partial")
                raise subprocess.TimeoutExpired("pipeline", 180)
            return b"", b""
        process.communicate.side_effect = communication
        # Patch the kill primitive: the test must never signal an actual process.
        with patch.object(server.subprocess, "Popen", return_value=process), patch.object(server.os, "killpg", create=True) as kill_group:
            with self.assertRaises(subprocess.TimeoutExpired):
                server.run_processing(REQUEST)
        if os.name == "posix":
            kill_group.assert_called_once_with(process.pid, server.signal.SIGKILL)
        else:
            process.kill.assert_called_once()
        self.assertFalse(self.target.exists())

    def test_cleanup_paths_are_fixed_single_components_and_other_jobs_survive(self):
        other = self.root / "another-job"
        other.mkdir(); (other / "keep.wav").write_bytes(b"other data")
        self.target.mkdir(); (self.target / "bad.mp4").write_bytes(b"partial")
        self.assertTrue(cleanup_failed_job(self.root, REQUEST["requestId"]))
        self.assertTrue((other / "keep.wav").is_file())
        for request_id in ("../another-job", str(other.resolve()), "..", "name/child", "name\\child"):
            with self.subTest(request_id=request_id), self.assertRaisesRegex(ValueError, "invalid_request_id"):
                cleanup_failed_job(self.root, request_id)
        self.assertTrue((other / "keep.wav").is_file())

    def test_new_invalid_or_oversized_manifest_is_not_a_published_receipt(self):
        self.target.mkdir()
        manifest = self.target / "manifest.json"
        for value in (b"invalid-json", json.dumps({"fingerprint": "a" * 64, "files": ["../outside.jpg"],
                     "result": {"requestId": REQUEST["requestId"], "sourceUrl": REQUEST["sourceUrl"],
                                "status": "complete", "media": [], "expiresAt": 1234}}).encode(), b"x" * 8_000_001):
            manifest.write_bytes(value)
            self.assertFalse(has_complete_manifest(self.target, REQUEST["requestId"]))
        self.assertTrue(cleanup_failed_job(self.root, REQUEST["requestId"]))

    def test_symlink_job_is_never_deleted_or_followed(self):
        outside = self.root / "outside"
        outside.mkdir(); (outside / "keep.jpg").write_bytes(b"untouched")
        try:
            self.target.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("symlink privileges unavailable")
        self.assertFalse(cleanup_failed_job(self.root, REQUEST["requestId"]))
        self.assertTrue(self.target.is_symlink())
        self.assertEqual((outside / "keep.jpg").read_bytes(), b"untouched")


if __name__ == "__main__":
    unittest.main()
