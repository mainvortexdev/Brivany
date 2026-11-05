"""Bounded single-object worker protocol, usable offline without Modal or torch.

This module never authenticates, downloads weights, creates cloud resources or
accepts commands/URLs from a job. Actual SAM3D compatibility remains unverified.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import sys
import tempfile
import time
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "config/spatial-models.lock.json"
MAX_INPUT = 8 * 1024 * 1024
MAX_OUTPUT = 32 * 1024 * 1024


class SpatialWorkerError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def read_lock(path=None):
    path = Path(path) if path is not None else LOCK_PATH
    if not path.is_file() or path.stat().st_size > 65536:
        raise SpatialWorkerError("worker_lock", "Falta un lock de ejecución espacial válido.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("schema_version") != "0.1.0": raise ValueError()
        if not re.fullmatch(r"[a-z0-9._-]{1,80}", value["pipeline_version"]): raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise SpatialWorkerError("worker_lock", "El lock de ejecución espacial no es válido.") from None
    return value


def readiness(lock=None):
    lock = read_lock() if lock is None else deepcopy(lock)
    runtime, model, budget = lock.get("runtime", {}), lock.get("models", {}).get("sam3d_objects", {}), lock.get("budget", {})
    pending = []
    if lock.get("remote_dispatch_enabled") is not True: pending.append("remote_dispatch_disabled")
    for key in ("dependency_lock_complete", "build_verified", "cuda_compatibility_verified"):
        if runtime.get(key) is not True: pending.append(key + "_pending")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", str(runtime.get("base_image_digest", ""))): pending.append("base_image_digest_pending")
    if not re.fullmatch(r"[a-f0-9]{40}", str(model.get("checkpoint_revision", ""))): pending.append("checkpoint_revision_pending")
    if model.get("checkpoint_hashes_verified") is not True or not runtime.get("checkpoint_manifest"): pending.append("checkpoint_hashes_pending")
    if model.get("license_reviewed_by_user") is not True: pending.append("checkpoint_license_pending")
    if any(type(budget.get(key)) not in (int, float) or not math.isfinite(budget[key]) or budget[key] <= 0
           for key in ("approved_per_job_usd", "approved_total_usd", "gpu_rate_usd_per_second", "non_gpu_reserve_per_job_usd")):
        pending.append("monetary_budget_pending")
    return {"status": "prepared_not_deployed" if pending else "configured_not_execution_verified",
            "remote_dispatch_enabled": not pending, "pending": pending,
            "pipeline_version": lock["pipeline_version"], "gpu_candidate": lock.get("modal", {}).get("gpu"),
            "gpu_execution_verified": False, "external_calls": 0, "gpu_seconds": 0,
            "limitations": ["Configuration and local tests do not verify a GPU model or actual billing.",
                "Modal may reschedule a container after a crash even with application retries set to zero."]}


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _png(data, limit, label):
    if not isinstance(data, bytes) or not 33 <= len(data) <= limit:
        raise SpatialWorkerError("worker_input", f"La {label} PNG supera el límite o está vacía.")
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise SpatialWorkerError("worker_input", f"La {label} debe ser PNG.")
    width, height = struct.unpack(">II", data[16:24])
    if not 1 <= width <= 1280 or not 1 <= height <= 1280:
        raise SpatialWorkerError("worker_input", "La imagen y máscara deben caber en 1280 px por lado.")
    return width, height


def validate_request(request):
    required = {"schema_version", "job_id", "capture_id", "frame_id", "image_png", "image_sha256",
                "mask_png", "mask_sha256", "mask_reviewed", "seed", "timeout_seconds", "reserved_usd"}
    if not isinstance(request, dict) or set(request) != required:
        raise SpatialWorkerError("worker_input", "El trabajo espacial no cumple el contrato esperado.")
    try:
        if request["schema_version"] != "0.1.0": raise ValueError()
        UUID(request["job_id"]); UUID(request["capture_id"])
        if not re.fullmatch(r"frame-[0-9]{4}", request["frame_id"]): raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise SpatialWorkerError("worker_input", "Los identificadores espaciales no son válidos.") from None
    if request["mask_reviewed"] is not True or type(request["seed"]) is not int or not 0 <= request["seed"] <= 2147483647:
        raise SpatialWorkerError("worker_mask", "Revisa una máscara y una semilla válida antes de reconstruir.")
    if type(request["timeout_seconds"]) is not int or not 1 <= request["timeout_seconds"] <= 180:
        raise SpatialWorkerError("worker_budget", "El trabajo admite entre 1 y 180 segundos de ejecución.")
    if not _finite(request["reserved_usd"]) or request["reserved_usd"] <= 0:
        raise SpatialWorkerError("worker_budget", "El trabajo necesita una reserva monetaria explícita.")
    image = _png(request["image_png"], MAX_INPUT, "imagen")
    mask = _png(request["mask_png"], 2 * 1024 * 1024, "máscara")
    if image != mask: raise SpatialWorkerError("worker_mask", "La máscara y el fotograma deben tener las mismas dimensiones.")
    for name in ("image", "mask"):
        digest = request[name + "_sha256"]
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or hashlib.sha256(request[name + "_png"]).hexdigest() != digest:
            raise SpatialWorkerError("worker_hash", "La imagen o máscara no coincide con su hash declarado.")
    return image


def budget_estimate(lock, timeout_seconds):
    values = lock.get("budget", {})
    fields = ("approved_per_job_usd", "approved_total_usd", "gpu_rate_usd_per_second", "non_gpu_reserve_per_job_usd")
    if any(not _finite(values.get(name)) or values[name] <= 0 for name in fields):
        raise SpatialWorkerError("worker_budget", "El presupuesto monetario no está configurado.")
    estimate = timeout_seconds * values["gpu_rate_usd_per_second"] + values["non_gpu_reserve_per_job_usd"]
    if estimate > values["approved_per_job_usd"] or estimate > values["approved_total_usd"]:
        raise SpatialWorkerError("worker_budget", "La estimación supera el presupuesto configurado.")
    return estimate


def cache_key(request, lock):
    validate_request(request)
    model = lock["models"]["sam3d_objects"]
    payload = {"pipeline": lock["pipeline_version"], "image": request["image_sha256"], "mask": request["mask_sha256"],
        "seed": request["seed"], "code": model["code_revision"], "checkpoint": model["checkpoint_revision"],
        "weights": lock["runtime"]["checkpoint_manifest"], "image_digest": lock["runtime"]["base_image_digest"]}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verify_weight_tree(root, manifest):
    root = Path(root).resolve()
    if not root.is_dir() or not isinstance(manifest, list) or not 1 <= len(manifest) <= 1000:
        raise SpatialWorkerError("worker_weights", "Falta un manifiesto completo de checkpoints.")
    expected = set()
    for entry in manifest:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "size_bytes"}:
            raise SpatialWorkerError("worker_weights", "El manifiesto de checkpoints no es válido.")
        relative = entry["path"]
        if not isinstance(relative, str) or "\\" in relative or ":" in relative or PurePosixPath(relative).is_absolute() or any(part in {"", ".", ".."} for part in relative.split("/")):
            raise SpatialWorkerError("worker_weights", "El checkpoint incluye una ruta no admitida.")
        if relative in expected: raise SpatialWorkerError("worker_weights", "Un checkpoint está repetido.")
        expected.add(relative); path = root / relative
        if not path.is_file() or path.resolve() != path.absolute() or not path.resolve().is_relative_to(root):
            raise SpatialWorkerError("worker_weights", "Un checkpoint falta o redirige fuera del volumen.")
        if type(entry["size_bytes"]) is not int or entry["size_bytes"] <= 0 or path.stat().st_size != entry["size_bytes"]:
            raise SpatialWorkerError("worker_weights", "El tamaño del checkpoint no coincide.")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""): digest.update(chunk)
        if not isinstance(entry["sha256"], str) or digest.hexdigest() != entry["sha256"]:
            raise SpatialWorkerError("worker_weights", "El checkpoint no coincide con su hash.")
    actual = set()
    for path in root.rglob("*"):
        if path.is_symlink(): raise SpatialWorkerError("worker_weights", "El volumen contiene enlaces no admitidos.")
        if path.is_file(): actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise SpatialWorkerError("worker_weights", "El volumen contiene archivos fuera del lock de checkpoints.")
    return len(expected)


def verify_model_code(root, lock):
    root = Path(root).resolve()
    revision = lock["models"]["sam3d_objects"]["code_revision"]
    if not re.fullmatch(r"[a-f0-9]{40}", str(revision)) or not root.is_dir():
        raise SpatialWorkerError("worker_code", "Falta el código SAM3D fijado.")
    try:
        process = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"], capture_output=True,
            timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        if process.stdout.decode("ascii").strip() != revision or dirty.stdout.strip(): raise ValueError()
    except (OSError, subprocess.SubprocessError, ValueError, UnicodeError):
        raise SpatialWorkerError("worker_code", "El checkout SAM3D difiere del commit limpio fijado.") from None
    for relative, entry in lock["sam3d_source_files"].items():
        path = root / relative
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise SpatialWorkerError("worker_code", "Los archivos SAM3D no coinciden con el lock.")


def validate_glb(content):
    if not isinstance(content, bytes) or not 32 <= len(content) <= MAX_OUTPUT:
        raise SpatialWorkerError("worker_output", "El artefacto GLB no tiene un tamaño válido.")
    magic, version, length = struct.unpack("<III", content[:12])
    if (magic, version, length) != (0x46546C67, 2, len(content)):
        raise SpatialWorkerError("worker_output", "La cabecera GLB no es válida.")
    offset, model, binary = 12, None, None
    try:
        while offset < len(content):
            if offset + 8 > len(content): raise ValueError()
            size, kind = struct.unpack("<II", content[offset:offset+8]); offset += 8
            if size % 4 or offset + size > len(content): raise ValueError()
            chunk = content[offset:offset+size]; offset += size
            if kind == 0x4E4F534A and model is None and binary is None: model = json.loads(chunk)
            elif kind == 0x004E4942 and model is not None and binary is None: binary = chunk
            else: raise ValueError()
        if not isinstance(model, dict) or model.get("asset", {}).get("version") != "2.0" or not model.get("meshes") or binary is None: raise ValueError()
        buffers = model.get("buffers")
        if not isinstance(buffers, list) or len(buffers) != 1 or type(buffers[0].get("byteLength")) is not int or not 0 < buffers[0]["byteLength"] <= len(binary): raise ValueError()
        def visit(value):
            if isinstance(value, dict):
                if "uri" in value: raise ValueError()
                for child in value.values(): visit(child)
            elif isinstance(value, list):
                for child in value: visit(child)
        visit(model)
        views = model.get("bufferViews", [])
        if not isinstance(views, list) or len(views) > 10000: raise ValueError()
        for view in views:
            if not isinstance(view, dict) or view.get("buffer") != 0: raise ValueError()
            start, size = view.get("byteOffset", 0), view.get("byteLength")
            if type(start) is not int or type(size) is not int or start < 0 or size <= 0 or start + size > buffers[0]["byteLength"]: raise ValueError()
        accessors = model.get("accessors", [])
        components = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
        widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
        if not isinstance(accessors, list) or not 1 <= len(accessors) <= 10000: raise ValueError()
        for accessor in accessors:
            if not isinstance(accessor, dict) or "sparse" in accessor: raise ValueError()
            view_index, count = accessor.get("bufferView"), accessor.get("count")
            if type(view_index) is not int or not 0 <= view_index < len(views) or type(count) is not int or not 1 <= count <= 2_000_000: raise ValueError()
            width = components.get(accessor.get("componentType"), 0) * widths.get(accessor.get("type"), 0)
            view = views[view_index]; stride = view.get("byteStride", width); start = accessor.get("byteOffset", 0)
            if not width or type(stride) is not int or stride < width or type(start) is not int or start < 0 or start + (count-1)*stride + width > view["byteLength"]: raise ValueError()
        for mesh in model["meshes"]:
            if not isinstance(mesh, dict) or not isinstance(mesh.get("primitives"), list) or not mesh["primitives"]: raise ValueError()
            for primitive in mesh["primitives"]:
                attrs = primitive.get("attributes")
                if not isinstance(attrs, dict) or "POSITION" not in attrs: raise ValueError()
                for index in list(attrs.values()) + ([primitive["indices"]] if "indices" in primitive else []):
                    if type(index) is not int or not 0 <= index < len(accessors): raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, RecursionError, struct.error):
        raise SpatialWorkerError("worker_output", "El GLB debe ser autocontenido, sin recursos externos.") from None
    return {"sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content), "format": "glb", "structure_checks_passed": True,
            "validation_scope": "glb_header_chunks_buffer_ranges_accessors_self_contained",
            "geometry_fidelity_verified": False, "physical_realism_verified": False}


def _run_model_process(job_dir, weights, model_root, timeout, cancelled):
    command = [sys.executable, "-B", "-m", "workers.sam3d_runner", "--job", str(job_dir), "--weights", str(weights), "--model", str(model_root)]
    # Provider/model stdout can include paths and input-derived values. Keep it
    # private in a temporary directory and never reflect it into app responses.
    with (job_dir / "private-runner.log").open("wb") as log:
        process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            if cancelled() or time.monotonic() >= deadline:
                process.kill(); process.wait(timeout=5)
                raise SpatialWorkerError("worker_cancelled" if cancelled() else "worker_timeout", "La reconstrucción se canceló o superó su tiempo asignado.")
            time.sleep(.05)
        if process.returncode != 0:
            raise SpatialWorkerError("worker_inference", "La reconstrucción no produjo un resultado válido.")


def execute(request, workspace, weights, *, lock=None, cancelled=lambda: False):
    """Prepared remote entrypoint. No work starts while the shipped lock is disabled.

    The caller must reserve money atomically before dispatch; the worker checks
    that reservation but cannot turn account billing into a hard dollar limit.
    """
    lock = read_lock() if lock is None else deepcopy(lock)
    state = readiness(lock)
    if state["pending"]:
        raise SpatialWorkerError("worker_not_configured", "La reconstrucción remota sigue pendiente de configuración verificada.")
    validate_request(request)
    estimate = budget_estimate(lock, request["timeout_seconds"])
    if request["reserved_usd"] < estimate:
        raise SpatialWorkerError("worker_budget", "La reserva del trabajo no cubre la estimación configurada.")
    if cancelled(): raise SpatialWorkerError("worker_cancelled", "El trabajo ya fue cancelado.")
    start = time.monotonic(); verify_model_code(lock["runtime"]["model_root"], lock)
    verify_weight_tree(weights, lock["runtime"]["checkpoint_manifest"])
    weight_seconds = time.monotonic() - start
    root = Path(workspace).resolve(); root.mkdir(parents=True, exist_ok=True)
    key = cache_key(request, lock); cache = root / key
    if cache.is_dir() and not cache.is_symlink():
        try:
            if any((cache / name).is_symlink() or not (cache / name).is_file() for name in ("result.json", "object.glb")): raise ValueError()
            if (cache / "result.json").stat().st_size > 65536 or (cache / "object.glb").stat().st_size > MAX_OUTPUT: raise ValueError()
            info = json.loads((cache / "result.json").read_text(encoding="utf-8"))
            content = (cache / "object.glb").read_bytes(); artifact = validate_glb(content)
            if info["cache_key"] != key or info["artifact"]["sha256"] != artifact["sha256"]: raise ValueError()
            return {**info, "cache_hit": True, "artifact_bytes": content, "model_executed_this_call": False,
                    "request_job_id": request["job_id"], "source_capture_id": request["capture_id"],
                    "source_frame_id": request["frame_id"], "actual_billed_usd": None}
        except (OSError, ValueError, KeyError):
            raise SpatialWorkerError("worker_cache", "La caché espacial no coincide con su manifiesto.") from None
    with tempfile.TemporaryDirectory(prefix=".single-object-", dir=root) as temporary:
        job = Path(temporary)
        (job / "image.png").write_bytes(request["image_png"]); (job / "mask.png").write_bytes(request["mask_png"])
        (job / "options.json").write_text(json.dumps({"seed": request["seed"], "config": lock["runtime"]["sam3d_config_relative_path"]}), encoding="utf-8")
        model_started = time.monotonic()
        remaining = request["timeout_seconds"] - (model_started - start)
        if remaining <= 0: raise SpatialWorkerError("worker_timeout", "La verificación agotó el plazo antes de iniciar el modelo.")
        _run_model_process(job, Path(weights).resolve(), Path(lock["runtime"]["model_root"]), remaining, cancelled)
        inference_seconds = time.monotonic() - model_started
        if cancelled(): raise SpatialWorkerError("worker_cancelled", "El trabajo se canceló antes de publicar el resultado.")
        output = job / "object.glb"
        if not output.is_file() or output.is_symlink() or output.stat().st_size > MAX_OUTPUT:
            raise SpatialWorkerError("worker_output", "La reconstrucción no devolvió un GLB acotado.")
        content = output.read_bytes(); artifact = validate_glb(content)
        result = {"status": "preview_unverified", "cache_key": key, "pipeline_version": lock["pipeline_version"],
            "artifact": artifact, "provenance": "inferred", "source_frame_id": request["frame_id"],
            "source_capture_id": request["capture_id"], "cache_hit": False, "actual_billed_usd": None,
            "estimate_usd": round(estimate, 6), "timing_seconds": {"weight_verification": weight_seconds, "model_process": inference_seconds,
                "weight_download": None, "container_cold_start": None},
            "limitations": ["Hidden geometry is inferred; this result does not certify metric scale or physics.",
                "Process time and a wall timeout are not a complete GPU or billing measurement."]}
        # Publish only complete validated output, never private logs or inputs.
        publish = job / "publish"; publish.mkdir()
        (publish / "object.glb").write_bytes(content)
        (publish / "result.json").write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        if cache.exists(): raise SpatialWorkerError("worker_cache", "Otro resultado con la misma clave ya está publicado.")
        publish.rename(cache)
    return {**result, "artifact_bytes": content, "model_executed_this_call": True}
