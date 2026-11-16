"""Lightweight limits and artifact paths shared by the HTTP parent and job subprocess.

Only the subprocess imports image, numeric or model libraries.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,120}\Z")
ARTIFACT_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|img|mp4|webm|mka|wav)\Z")


def configured_integer(name: str, default: int, low: int, high: int) -> int:
    """Deployment-only ceilings; request content cannot raise them."""
    value = os.environ.get(name)
    if value is None:
        return default
    if not re.fullmatch(r"[0-9]{1,10}", value) or not low <= int(value) <= high:
        raise ValueError("invalid_resource_configuration")
    return int(value)


@dataclass(frozen=True)
class Limits:
    max_media: int = 20
    max_frames: int = 3000
    max_duration: int = 300
    max_bytes: int = 400_000_000
    cpu_seconds: int = 180
    frame_edge: int = 720
    ffmpeg_threads: int = 1

    @classmethod
    def from_request(cls, values=None):
        values = values or {}
        allowed = {"maxMedia": ("max_media", 1, 20), "maxFrames": ("max_frames", 1, 3000),
                   "maxDurationSeconds": ("max_duration", 1, 300), "maxBytes": ("max_bytes", 100_000, 400_000_000)}
        if not isinstance(values, dict) or set(values) - set(allowed):
            raise ValueError("invalid_limits")
        fields = {}
        for key, value in values.items():
            field, low, high = allowed[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError("invalid_limits")
            fields[field] = value
        ceilings = {
            "max_media": configured_integer("MEDIA_MAX_MEDIA", 20, 1, 20),
            "max_frames": configured_integer("MEDIA_MAX_FRAMES", 3000, 1, 3000),
            "max_duration": configured_integer("MEDIA_MAX_DURATION_SECONDS", 300, 1, 300),
            "max_bytes": configured_integer("MEDIA_MAX_BYTES", 400_000_000, 100_000, 400_000_000),
        }
        return cls(**{name: min(fields.get(name, value), value) for name, value in ceilings.items()},
                   frame_edge=configured_integer("MEDIA_FRAME_EDGE", 720, 128, 720),
                   cpu_seconds=configured_integer("MEDIA_CPU_SECONDS", 180, 10, 180),
                   ffmpeg_threads=configured_integer("MEDIA_FFMPEG_THREADS", 1, 1, 2))


def valid_request_id(value) -> str:
    if not isinstance(value, str) or not REQUEST_ID.fullmatch(value):
        raise ValueError("invalid_request_id")
    return value


def artifact_path(root: Path, request_id: str, name: str) -> Path:
    valid_request_id(request_id)
    if not isinstance(name, str) or not ARTIFACT_NAME.fullmatch(name):
        raise ValueError("invalid_artifact_name")
    directory = root / request_id
    path = directory / name
    if directory.is_symlink() or path.is_symlink() or path.resolve().parent != directory.resolve():
        raise ValueError("unsafe_artifact_path")
    manifest = directory / "manifest.json"
    if not manifest.is_file() or manifest.is_symlink():
        raise FileNotFoundError("artifact_unavailable")
    metadata = json.loads(manifest.read_text("utf-8"))
    if name not in metadata.get("files", []) or metadata["result"]["expiresAt"] <= time.time() or not path.is_file():
        raise FileNotFoundError("artifact_unavailable")
    return path


def has_complete_manifest(directory: Path, request_id: str) -> bool:
    """A published receipt survives a later transport or subprocess failure."""
    manifest = directory / "manifest.json"
    try:
        if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 8_000_000:
            return False
        metadata = json.loads(manifest.read_text("utf-8"))
        result = metadata.get("result")
        files = metadata.get("files")
        if not isinstance(metadata.get("fingerprint"), str) or not re.fullmatch(r"[a-f0-9]{64}", metadata["fingerprint"]):
            return False
        if not isinstance(result, dict) or result.get("requestId") != request_id or result.get("status") not in ("complete", "partial", "unavailable"):
            return False
        if not isinstance(result.get("sourceUrl"), str) or not isinstance(result.get("media"), list):
            return False
        if type(result.get("expiresAt")) is not int or not isinstance(files, list):
            return False
        return all(isinstance(name, str) and ARTIFACT_NAME.fullmatch(name)
                   and not (directory / name).is_symlink() and (directory / name).is_file()
                   and (directory / name).resolve().parent == directory.resolve() for name in files)
    except (ValueError, OSError, TypeError, AttributeError):
        return False


def cleanup_failed_job(root: Path, request_id: str, *, existed_before: bool = False) -> bool:
    """Remove only the newly created, unpublished directory owned by this job."""
    valid_request_id(request_id)
    target = root / request_id
    if existed_before or root.is_symlink() or target.is_symlink() or not target.is_dir():
        return False
    if target.resolve().parent != root.resolve() or has_complete_manifest(target, request_id):
        return False
    shutil.rmtree(target)
    return True
