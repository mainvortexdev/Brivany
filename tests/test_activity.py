"""Ledger persistence, evidence integrity, concurrent append, and local HTTP access."""
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from services.activity import ActivityStore, ActivityError
from services.h1.server import Handler


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = ActivityStore(self.root / ".local/activity", root=self.root)
        self.report = self.root / "result.json"; self.report.write_text('{"exit_code":0}')

    def add(self, **kwargs):
        return self.store.add({"kind": "test", "status": "passed", "title": "Prueba local",
            "summary": "Salida real guardada.", "external_calls": 0, "gpu_seconds": 0.0, **kwargs}, [self.report])

    def test_snapshot_survives_original_changes_and_reload(self):
        entry = self.add(); self.report.write_text("changed")
        restored = ActivityStore(self.store.directory, root=self.root)
        data, metadata = restored.read_evidence(entry["id"], 0)
        self.assertEqual(data, b'{"exit_code":0}')
        self.assertEqual(len(metadata["sha256"]), 64)
        listing = restored.listing()
        self.assertTrue(listing["integrity"]["valid"])
        self.assertEqual(listing["entries"][0]["evidence"][0]["integrity"], "ok")

    def test_corrupted_evidence_is_visible_and_cannot_be_served(self):
        entry = self.add(); item = entry["evidence"][0]
        (self.store.artifacts / item["sha256"]).write_bytes(b"changed")
        self.assertEqual(self.store.listing()["entries"][0]["evidence"][0]["integrity"], "mismatch")
        with self.assertRaises(ActivityError): self.store.read_evidence(entry["id"], 0)
        (self.store.artifacts / item["sha256"]).unlink()
        self.assertEqual(self.store.listing()["entries"][0]["evidence"][0]["integrity"], "missing")

    def test_concurrent_records_form_a_valid_chain_and_tamper_is_detected(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda i: self.add(title=f"Prueba {i}"), range(12)))
        self.assertEqual(self.store.listing()["integrity"], {"valid": True, "entries": 12, "signed": False})
        with self.store.connection() as db:
            row = db.execute("SELECT seq,payload FROM entries ORDER BY seq LIMIT 1").fetchone()
            payload = json.loads(row["payload"]); payload["title"] = "Changed"
            db.execute("UPDATE entries SET payload=? WHERE seq=?", (json.dumps(payload), row["seq"]))
        self.assertFalse(self.store.listing()["integrity"]["valid"])

    def test_rejects_private_external_and_missing_evidence(self):
        hidden = self.root / ".env"; hidden.write_text("never read")
        for source in (hidden, self.root.parent / "outside.json", self.root / "absent.json"):
            with self.assertRaises(ActivityError): self.store.snapshot(source)
        with self.assertRaises(ActivityError):
            self.store.add({"kind": "test", "status": "passed", "title": "Missing", "summary": "No evidence"})
        self.assertEqual(self.store.listing()["entries"], [])

    def test_idea_can_be_pending_with_unknown_cost(self):
        self.store.add({"kind": "idea", "status": "pending", "title": "Traducción de video", "summary": "Pendiente de implementar."})
        entry = self.store.listing()["entries"][0]
        self.assertEqual(entry["verification"], "recorded")
        self.assertIsNone(entry["cost"]["external_calls"])

    def test_http_reads_snapshots_but_cannot_write_or_read_private_paths(self):
        entry = self.add()
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler); server.activity_store = self.store
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            def call(method, path, origin=None):
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request(method, path, headers={"Origin": origin} if origin else {})
                response = connection.getresponse(); result = response.status, response.read(), response.getheader("Content-Type")
                connection.close(); return result
            code, body, _ = call("GET", "/api/activity")
            self.assertEqual(code, 200); self.assertEqual(len(json.loads(body)["entries"]), 1)
            code, body, content_type = call("GET", f'/api/activity/{entry["id"]}/evidence/0')
            self.assertEqual(code, 200); self.assertEqual(body, b'{"exit_code":0}'); self.assertIn("text/plain", content_type)
            self.assertEqual(call("POST", "/api/activity")[0], 404)
            self.assertEqual(call("GET", "/api/activity?before=oops")[0], 404)
            self.assertEqual(call("GET", "/api/activity", "https://other.example")[0], 403)
            self.assertEqual(call("GET", "/.local/activity/activity.sqlite3")[0], 404)
        finally:
            server.shutdown(); server.server_close(); thread.join(3)


if __name__ == "__main__": unittest.main()
