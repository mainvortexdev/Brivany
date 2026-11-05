"""Bounded local jobs, persistence and credit protection; no provider calls."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

from packages.providers.meta import MetaProviderError
from services.h1.human_skills import HumanSkillService, SkillServiceError, inspect_video
from services.h1.server import Handler
from test_human_skills_provider import example_draft

VIDEO = b"\x00\x00\x00\x18ftypisom" + b"synthetic-fixture"


def source(video, filename):
    import hashlib
    return {"filename": filename, "sha256": hashlib.sha256(video).hexdigest(), "size_bytes": len(video),
            "duration_seconds": 8.0, "has_audio": True}


def generated(*_):
    return {"draft": example_draft(), "model": "test-model", "latency_ms": 1, "usage": {}}


def done(service, job):
    limit = time.monotonic() + 3
    while time.monotonic() < limit:
        current = service.job(job["id"])
        if current["status"] != "processing": return current
        time.sleep(.005)
    raise AssertionError("Local job did not complete")


class HumanSkillServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.provider = Mock(side_effect=generated)
        self.service = self.make()

    def make(self):
        return HumanSkillService(Path(self.temp.name), provider=self.provider, probe=source,
            status=lambda: {"configured": True, "model": "test-model", "prompt_version": "test-v1"})

    def test_persistence_dedup_progress_and_delete_never_generate_again(self):
        job = done(self.service, self.service.start(VIDEO, "demo.mp4", "Una idea"))
        self.assertEqual(job["status"], "complete")
        restored = self.make(); record = restored.get(job["skill_id"])
        self.assertEqual(record["lifecycle"], "draft")
        duplicate = restored.start(VIDEO, "renamed.mp4", "Una idea")
        self.assertTrue(duplicate["reused"]); self.assertEqual(duplicate["skill_id"], record["id"])
        updated = restored.progress(record["id"], {"completed_steps": [0], "transfer_completed": True})
        self.assertEqual(updated["progress"]["completed_steps"], [0])
        self.assertEqual(updated["lifecycle"], "draft")
        self.assertEqual(self.make().library()["skills"][0]["completed_steps"], 1)
        restored.delete(record["id"])
        self.assertEqual(restored.library()["skills"], [])
        self.assertEqual(self.provider.call_count, 1)
        self.assertEqual(list(Path(self.temp.name).glob("*.mp4")), [])

    def test_concurrent_identical_submission_joins_single_job(self):
        entered, release = threading.Event(), threading.Event()
        def slow(*args):
            entered.set(); release.wait(2); return generated()
        self.provider.side_effect = slow
        first = self.service.start(VIDEO, "demo.mp4", "Idea"); entered.wait(1)
        try:
            self.assertEqual(self.service.start(VIDEO, "demo.mp4", "Idea")["id"], first["id"])
            with self.assertRaises(SkillServiceError): self.service.start(VIDEO, "demo.mp4", "Otro objetivo")
        finally: release.set()
        self.assertEqual(done(self.service, first)["status"], "complete")
        self.assertEqual(self.provider.call_count, 1)

    def test_failed_generation_is_not_retried_or_saved(self):
        self.provider.side_effect = MetaProviderError("rate_limited", "Cuota agotada.")
        job = done(self.service, self.service.start(VIDEO, "demo.mp4", ""))
        self.assertEqual(job["error"]["code"], "rate_limited")
        self.assertEqual(self.provider.call_count, 1); self.assertEqual(self.service.library()["skills"], [])

    def test_bad_evidence_and_manual_verdict_cannot_be_saved(self):
        self.service.probe = lambda data, name: {**source(data, name), "has_audio": False}
        job = done(self.service, self.service.start(VIDEO, "demo.mp4", ""))
        self.assertEqual(job["error"]["code"], "unsupported_evidence")
        self.assertEqual(self.service.library()["skills"], [])
        self.service.probe = source
        record_id = done(self.service, self.service.start(VIDEO, "demo.mp4", ""))["skill_id"]
        for progress in ({"completed_steps": [99], "transfer_completed": False},
                         {"completed_steps": [True], "transfer_completed": False},
                         {"completed_steps": [0], "transfer_completed": False, "mastered": True}):
            with self.assertRaises(SkillServiceError): self.service.progress(record_id, progress)

    def test_validation_prevents_calls_and_probe_bounds_duration(self):
        with self.assertRaises(SkillServiceError): self.service.start(b"bad", "demo.mp4", "")
        self.provider.assert_not_called()
        with patch("services.h1.human_skills.shutil.which", return_value="ffprobe"), patch("services.h1.human_skills.subprocess.run") as run:
            run.return_value.stdout = json.dumps({"format": {"duration": "301"}, "streams": [{"codec_type": "video"}]}).encode()
            with self.assertRaises(SkillServiceError): inspect_video(VIDEO, "demo.mp4")
            self.assertIn("file,pipe", run.call_args.args[0])


class HumanSkillHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.provider = Mock(side_effect=generated)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.human_skills = HumanSkillService(Path(self.temp.name), provider=self.provider, probe=source,
            status=lambda: {"configured": True, "model": "test-model"})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3); self.temp.cleanup()

    def call(self, method, path, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, body=body, headers={"Origin": self.origin, **(headers or {})})
        response = connection.getresponse(); value = json.loads(response.read()); connection.close()
        return response.status, value

    def test_upload_consent_origin_and_lifecycle(self):
        headers = {"Content-Type": "video/mp4", "X-Brivany-Metadata": quote(json.dumps({"filename": "clip.mp4", "goal": "Una idea"}))}
        self.assertEqual(self.call("POST", "/api/human-skills/jobs", VIDEO, headers)[0], 422)
        headers["X-Brivany-Consent"] = "true"
        self.assertEqual(self.call("POST", "/api/human-skills/jobs", VIDEO, {**headers, "Origin": "https://other.example"})[0], 403)
        self.provider.assert_not_called()
        code, result = self.call("POST", "/api/human-skills/jobs", VIDEO, headers)
        self.assertEqual(code, 202)
        job = done(self.server.human_skills, result["job"])
        code, result = self.call("GET", "/api/human-skills/" + job["skill_id"])
        self.assertEqual(code, 200); self.assertEqual(result["skill"]["draft"]["status"], "ready")
        self.assertEqual(self.call("GET", "/.local/human-skills/" + job["skill_id"] + ".json")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/human-skills/" + job["skill_id"])[0], 200)
        self.assertEqual(self.provider.call_count, 1)

if __name__ == "__main__": unittest.main()
