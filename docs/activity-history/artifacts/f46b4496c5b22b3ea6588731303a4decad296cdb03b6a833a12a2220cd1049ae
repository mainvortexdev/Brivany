"""Local development ledger with evidence snapshots; never records voice sessions."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import tempfile
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

ROOT = Path(__file__).resolve().parents[1]
MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
ZERO_HASH = "0" * 64


class ActivityError(ValueError):
    pass


class ActivityInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    kind: Literal["idea", "implementation", "test", "decision"]
    status: Literal["pending", "implemented", "passed", "failed"]
    title: str = Field(min_length=1, max_length=180)
    summary: str = Field(min_length=1, max_length=5000)
    external_calls: int | None = Field(default=None, ge=0)
    gpu_seconds: float | None = Field(default=None, ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def coherent_status(self):
        if self.kind == "test" and self.status not in {"passed", "failed", "pending"}:
            raise ValueError("A test needs an actual result or pending state")
        if self.kind != "test" and self.status in {"passed", "failed"}:
            raise ValueError("Only tests have pass/fail results")
        return self


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class ActivityStore:
    def __init__(self, directory=None, *, root=ROOT):
        self.root = Path(root).resolve()
        self.directory = Path(directory or self.root / ".local" / "activity").resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.artifacts = self.directory / "artifacts"
        self.artifacts.mkdir(exist_ok=True)
        self.database = self.directory / "activity.sqlite3"
        with self.connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL)")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db: yield db
        finally:
            db.close()

    def snapshot(self, path):
        source = Path(path)
        if not source.is_absolute(): source = self.root / source
        source = source.resolve()
        try: relative = source.relative_to(self.root)
        except ValueError: raise ActivityError("La evidencia debe estar dentro del proyecto.") from None
        allowed = {".md", ".json", ".log", ".txt", ".py", ".js", ".cjs", ".css", ".html", ".png"}
        if any(part.startswith(".") for part in relative.parts) or source.suffix.lower() not in allowed:
            raise ActivityError("La evidencia debe ser un informe, documento, código o captura; no datos privados.")
        if not source.is_file(): raise ActivityError("No se encontró la evidencia indicada.")
        with source.open("rb") as stream: data = stream.read(MAX_EVIDENCE_BYTES + 1)
        if len(data) > MAX_EVIDENCE_BYTES: raise ActivityError("Cada evidencia admite hasta 2 MiB.")
        digest = hashlib.sha256(data).hexdigest()
        destination = self.artifacts / digest
        # Publish complete bytes atomically, including when CLI and web tools
        # register the same evidence concurrently in different processes.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.artifacts, prefix="snapshot-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            try: os.link(temporary, destination)
            except FileExistsError:
                if destination.stat().st_size != len(data) or destination.read_bytes() != data:
                    raise ActivityError("La copia de evidencia existente está dañada.") from None
        finally:
            if temporary is not None: temporary.unlink(missing_ok=True)
        return {"label": relative.as_posix(), "sha256": digest, "size_bytes": len(data)}

    def add(self, value, evidence=()):
        entry = value if isinstance(value, ActivityInput) else ActivityInput.model_validate(value)
        if len(evidence) > 8: raise ActivityError("Un registro admite hasta ocho evidencias.")
        snapshots = [self.snapshot(path) for path in evidence]
        if entry.kind == "test" and entry.status != "pending" and not snapshots:
            raise ActivityError("El resultado de una prueba necesita evidencia guardada.")
        payload = {"id": str(uuid4()), "recorded_at": datetime.now(timezone.utc).isoformat(),
                   "kind": entry.kind, "status": entry.status, "title": entry.title, "summary": entry.summary,
                   "verification": "evidenced" if snapshots else "recorded",
                   "cost": {"external_calls": entry.external_calls, "gpu_seconds": entry.gpu_seconds},
                   "evidence": snapshots}
        body = canonical(payload)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            last = db.execute("SELECT entry_hash FROM entries ORDER BY seq DESC LIMIT 1").fetchone()
            previous = last[0] if last else ZERO_HASH
            digest = hashlib.sha256((previous + "\n" + body).encode()).hexdigest()
            db.execute("INSERT INTO entries (id,payload,previous_hash,entry_hash) VALUES (?,?,?,?)", (payload["id"], body, previous, digest))
        return payload

    def read_evidence(self, identifier, index):
        with self.connection() as db:
            row = db.execute("SELECT payload FROM entries WHERE id=?", (identifier,)).fetchone()
        if row is None: raise ActivityError("Registro no disponible.")
        items = json.loads(row[0])["evidence"]
        if not 0 <= index < len(items): raise ActivityError("Evidencia no disponible.")
        item = items[index]
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ActivityError("Hash de evidencia inválido.")
        path = self.artifacts / item["sha256"]
        if not path.is_file(): raise ActivityError("Falta la copia de evidencia.")
        if not 0 <= item["size_bytes"] <= MAX_EVIDENCE_BYTES or path.stat().st_size != item["size_bytes"]:
            raise ActivityError("La evidencia cambió de tamaño.")
        data = path.read_bytes()
        if len(data) != item["size_bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ActivityError("La evidencia cambió y no coincide con su hash.")
        return data, item

    def listing(self, *, before=None):
        with self.connection() as db: rows = db.execute("SELECT * FROM entries ORDER BY seq").fetchall()
        valid, previous = True, ZERO_HASH
        for row in rows:
            digest = hashlib.sha256((previous + "\n" + row["payload"]).encode()).hexdigest()
            if row["previous_hash"] != previous or row["entry_hash"] != digest: valid = False
            previous = row["entry_hash"]
        filtered = [row for row in reversed(rows) if before is None or row["seq"] < before]
        selected = filtered[:200]
        entries = []
        for row in selected:
            payload = json.loads(row["payload"])
            for index, item in enumerate(payload["evidence"]):
                item["url"] = f'/api/activity/{payload["id"]}/evidence/{index}'
                try: self.read_evidence(payload["id"], index); item["integrity"] = "ok"
                except ActivityError:
                    item["integrity"] = "missing" if re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) and not (self.artifacts / item["sha256"]).exists() else "mismatch"
            entries.append(payload)
        return {"scope": "local", "entries": entries, "integrity": {"valid": valid, "entries": len(rows), "signed": False},
                "has_more": len(filtered) > 200, "next_before": selected[-1]["seq"] if len(filtered) > 200 else None}
