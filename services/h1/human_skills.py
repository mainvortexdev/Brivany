"""Local video-to-skill jobs. One provider call, private drafts, no retained video."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from uuid import uuid4

from contracts.human_skills import validate_draft
from packages.providers.human_skills import create_human_skill, human_skill_provider_status
from packages.providers.meta import MetaProviderError

MAX_VIDEO_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 300
ID_PATTERN = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")


class SkillServiceError(Exception):
    def __init__(self, code, message, status=422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def inspect_video(video: bytes, filename: str) -> dict:
    if not 16 <= len(video) <= MAX_VIDEO_BYTES or video[4:8] != b"ftyp":
        raise SkillServiceError("invalid_video", "Selecciona un archivo MP4 de hasta 25 MiB.")
    executable = shutil.which("ffprobe")
    if not executable:
        raise SkillServiceError("video_probe_unavailable", "Este equipo necesita ffprobe para comprobar el video.", 503)
    # A fixed local name and protocol whitelist avoid interpreting filenames or media URLs as commands.
    with tempfile.TemporaryDirectory(prefix="brivany-video-") as folder:
        path = Path(folder) / "source.mp4"
        path.write_bytes(video)
        try:
            result = subprocess.run([executable, "-v", "error", "-protocol_whitelist", "file,pipe",
                "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
                capture_output=True, timeout=12, check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            probe = json.loads(result.stdout)
            duration = float(probe["format"]["duration"])
            streams = {stream["codec_type"] for stream in probe["streams"]}
        except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError):
            raise SkillServiceError("unreadable_video", "No se pudo leer el MP4. Exporta el clip de nuevo e inténtalo.") from None
    if not math.isfinite(duration) or not 0 < duration <= MAX_DURATION_SECONDS or "video" not in streams:
        raise SkillServiceError("video_duration", "Usa un video de hasta cinco minutos con imagen válida.")
    name = str(filename).replace("\\", "/").split("/")[-1]
    name = "".join(c for c in name if ord(c) >= 32)[:180] or "video.mp4"
    return {"filename": name, "sha256": hashlib.sha256(video).hexdigest(), "size_bytes": len(video),
            "duration_seconds": duration, "has_audio": "audio" in streams}


class HumanSkillService:
    def __init__(self, folder: Path, provider=create_human_skill, probe=inspect_video,
                 status=human_skill_provider_status):
        self.folder, self.provider, self.probe, self.provider_status = Path(folder), provider, probe, status
        self.lock = threading.RLock()
        self.jobs = {}
        self.active_id = None

    def capabilities(self):
        return {**self.provider_status(), "max_bytes": MAX_VIDEO_BYTES,
                "max_duration_seconds": MAX_DURATION_SECONDS,
                "video_validation_available": shutil.which("ffprobe") is not None,
                "provider_calls_per_creation": 1, "automatic_retries": False}

    def _path(self, skill_id):
        if not isinstance(skill_id, str) or not ID_PATTERN.fullmatch(skill_id):
            raise SkillServiceError("not_found", "No se encontró la habilidad.", 404)
        return self.folder / f"{skill_id}.json"

    def _load(self, skill_id):
        path = self._path(skill_id)
        try:
            if path.stat().st_size > 256_000:
                raise ValueError()
            data = json.loads(path.read_text(encoding="utf-8"))
            if data["id"] != skill_id or data["lifecycle"] != "draft":
                raise ValueError()
            validate_draft(data["draft"], data["source"]["duration_seconds"])
            self._validate_progress(data["progress"], len(data["draft"]["steps"]))
            return data
        except (OSError, ValueError, KeyError, TypeError):
            raise SkillServiceError("not_found", "No se encontró una habilidad válida.", 404) from None

    def _save(self, data):
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self._path(data["id"])
        temporary = self.folder / (str(uuid4()) + ".tmp")
        try:
            temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def _records(self):
        records = []
        for path in self.folder.glob("*.json"):
            try: records.append(self._load(path.stem))
            except SkillServiceError: continue
        return sorted(records, key=lambda item: item["created_at"], reverse=True)

    def library(self):
        with self.lock:
            skills = [{"id": item["id"], "title": item["draft"]["title"], "objective": item["draft"]["objective"],
                       "domain": item["draft"]["domain"], "created_at": item["created_at"],
                       "step_count": len(item["draft"]["steps"]),
                       "completed_steps": len(item["progress"]["completed_steps"])} for item in self._records()]
            return {"skills": skills, "active_job": self.jobs.get(self.active_id), "capabilities": self.capabilities()}

    def get(self, skill_id):
        with self.lock: return self._load(skill_id)

    def job(self, job_id):
        with self.lock:
            if job_id not in self.jobs: raise SkillServiceError("job_not_found", "El análisis ya no está disponible. Revisa tu biblioteca.", 404)
            return dict(self.jobs[job_id])

    def start(self, video: bytes, filename: str, goal: str):
        if not isinstance(goal, str) or len(goal) > 500 or not isinstance(filename, str) or len(filename) > 240:
            raise SkillServiceError("invalid_metadata", "Indica un objetivo breve de hasta 500 caracteres.")
        if not 16 <= len(video) <= MAX_VIDEO_BYTES or video[4:8] != b"ftyp":
            raise SkillServiceError("invalid_video", "Selecciona un archivo MP4 de hasta 25 MiB.")
        goal = goal.strip()
        status = self.provider_status()
        digest = hashlib.sha256(video).hexdigest()
        request_key = hashlib.sha256(json.dumps([digest, goal, status["model"], status.get("prompt_version"), "human-skill-0.1.0"], ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            # Double clicks and successful repeats do not create additional billable calls.
            if self.active_id:
                active = self.jobs[self.active_id]
                if active["request_key"] == request_key: return dict(active)
                raise SkillServiceError("analysis_busy", "Hay un video en análisis. Espera a que termine.", 409)
            records = self._records()
            for record in records:
                if record["request_key"] == request_key:
                    job_id = str(uuid4())
                    job = {"id": job_id, "status": "complete", "phase": "Habilidad recuperada sin otra consulta a Meta.",
                           "skill_id": record["id"], "error": None, "reused": True, "request_key": request_key}
                    self._remember(job)
                    return dict(job)
            if not status["configured"]:
                raise SkillServiceError("meta_not_configured", "Conecta la clave de Meta en los ajustes de Melodi.", 503)
            if len(records) >= 100:
                raise SkillServiceError("library_full", "La biblioteca local admite 100 habilidades. Exporta y elimina alguna para continuar.", 409)
            job_id = str(uuid4())
            job = {"id": job_id, "status": "processing", "phase": "Comprobando el video…",
                   "skill_id": None, "error": None, "reused": False, "request_key": request_key}
            self._remember(job); self.active_id = job_id
            threading.Thread(target=self._analyze, args=(job_id, video, filename, goal), daemon=True).start()
            return dict(job)

    def _remember(self, job):
        while len(self.jobs) >= 32: self.jobs.pop(next(iter(self.jobs)))
        self.jobs[job["id"]] = job

    def _analyze(self, job_id, video, filename, goal):
        try:
            source = self.probe(video, filename)
            with self.lock: self.jobs[job_id]["phase"] = "Melodi está observando el video y preparando tu habilidad…"
            generated = self.provider(video, source, goal)
            draft = validate_draft(generated["draft"], source["duration_seconds"])
            if not source["has_audio"] and any(step.evidence.modality in ("audio", "both") for step in draft.steps):
                raise SkillServiceError("unsupported_evidence", "La propuesta atribuyó audio a un video sin pista de audio; no se guardó.")
            if draft.status != "ready":
                raise SkillServiceError("insufficient_evidence", draft.reason or "Este video no ofrece suficiente evidencia para crear una habilidad.")
            record = {"id": str(uuid4()), "version": "0.1.0", "lifecycle": "draft",
                      "created_at": datetime.now(timezone.utc).isoformat(), "source": source,
                      "goal": goal, "draft": draft.model_dump(mode="json"),
                      "analysis": {"model": generated["model"], "latency_ms": generated["latency_ms"], "usage": generated["usage"]},
                      "progress": {"completed_steps": [], "transfer_completed": False}}
            with self.lock:
                record["request_key"] = self.jobs[job_id]["request_key"]
                self._save(record)
                self.jobs[job_id].update(status="complete", phase="Tu human-skill está lista para revisar y practicar.", skill_id=record["id"])
        except (SkillServiceError, MetaProviderError) as exc:
            with self.lock: self.jobs[job_id].update(status="failed", phase="No se creó la habilidad.", error={"code": exc.code, "message": str(exc)})
        except Exception:
            # Do not echo provider payloads, source media or local paths on unexpected failures.
            with self.lock: self.jobs[job_id].update(status="failed", phase="No se creó la habilidad.", error={"code": "analysis_failed", "message": "No se pudo completar el análisis. No se repitió la consulta a Meta."})
        finally:
            with self.lock: self.active_id = None

    @staticmethod
    def _validate_progress(progress, total):
        if not isinstance(progress, dict) or set(progress) != {"completed_steps", "transfer_completed"}:
            raise SkillServiceError("invalid_progress", "Revisa los pasos de práctica.")
        completed = progress["completed_steps"]
        if (not isinstance(completed, list) or len(completed) > total or any(type(i) is not int or not 0 <= i < total for i in completed)
                or len(set(completed)) != len(completed) or type(progress["transfer_completed"]) is not bool):
            raise SkillServiceError("invalid_progress", "Revisa los pasos de práctica.")

    def progress(self, skill_id, value):
        with self.lock:
            record = self._load(skill_id)
            self._validate_progress(value, len(record["draft"]["steps"]))
            record["progress"] = {"completed_steps": sorted(value["completed_steps"]), "transfer_completed": value["transfer_completed"]}
            self._save(record)
            return record

    def delete(self, skill_id):
        with self.lock:
            self._load(skill_id)
            self._path(skill_id).unlink()

