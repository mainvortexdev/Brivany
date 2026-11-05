"""Modal definitions created only through an explicit, guarded factory.

Normal app imports and offline checks do not import Modal or create cloud
resources. The shipped reconstruction lock is incomplete and dispatch is off.
"""
from __future__ import annotations
import importlib.metadata
import hashlib
import json
import re
from workers.spatial_runtime import SpatialWorkerError, ROOT, execute, read_lock, readiness


def function_options(lock):
    options = lock["modal"]
    required = {"min_containers": 0, "max_containers": 1, "buffer_containers": 0, "retries": 0,
                "timeout_seconds": 180, "startup_timeout_seconds": 600}
    if any(type(options.get(key)) is not int or options[key] != value for key, value in required.items()):
        raise SpatialWorkerError("worker_limits", "El worker exige un contenedor como máximo, sin reintentos de aplicación y plazo de 180 s.")
    if options.get("gpu") != "L40S":
        raise SpatialWorkerError("worker_gpu", "La primera GPU candidata está fijada a L40S.")
    return {"gpu": "L40S", "min_containers": 0, "max_containers": 1,
            "buffer_containers": 0, "retries": 0, "timeout": 180, "startup_timeout": 600,
            "scaledown_window": 2, "cpu": 4, "memory": 32768}


def create_app(*, lock=None):
    """Declare a future deployment only after manual prerequisites are satisfied.

    Calling this function does not call .remote/.spawn or deploy. Declaration
    still requires the optional exact SDK locally; actual builds are postponed.
    """
    lock = read_lock() if lock is None else lock
    state = readiness(lock)
    if state["pending"]:
        raise SpatialWorkerError("worker_not_configured", "Configura imagen, pesos, licencias y presupuesto antes de declarar Modal.")
    options = function_options(lock)
    expected_sdk = lock["modal"]["sdk_version"]
    if importlib.metadata.version("modal") != expected_sdk:
        raise SpatialWorkerError("worker_sdk", "El SDK Modal no coincide con la versión fijada.")
    import modal

    runtime = lock["runtime"]
    digest = runtime["base_image_digest"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise SpatialWorkerError("worker_image", "La imagen remota necesita un digest inmutable verificado.")
    # This future image must already contain the validated native SAM3D stack,
    # /opt/sam3d at the pinned revision and Python 3.11. No install script pulls
    # weights or silently resolves unpinned dependencies during execution.
    image = (modal.Image.from_registry(runtime["candidate_base_image"].split("@")[0] + "@" + digest)
        .add_local_dir(ROOT / "workers", remote_path="/root/workers")
        .add_local_file(ROOT / "config/spatial-models.lock.json", remote_path="/root/config/spatial-models.lock.json"))
    weights = modal.Volume.from_name(lock["modal"]["weight_volume_name"], create_if_missing=False)
    results = modal.Volume.from_name(lock["modal"]["result_volume_name"], create_if_missing=False)
    app = modal.App("brivany-spatial")

    @app.function(image=image, min_containers=0, max_containers=1, retries=0, timeout=30)
    def health():
        return {"status": "prepared_runtime", "model_executed": False,
                "pipeline_version": lock["pipeline_version"], "gpu_inference": False}

    @app.function(image=image, volumes={"/weights": weights, "/results": results}, **options)
    def reconstruct_single_object(request,*,expected_lock_sha256):
        configured=read_lock()
        actual=hashlib.sha256(json.dumps(configured,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
        if not isinstance(expected_lock_sha256,str) or expected_lock_sha256!=actual:
            raise SpatialWorkerError('worker_lock_mismatch','El despliegue no tiene el mismo lock que el trabajo autorizado.')
        value = execute(request, "/results/single-object-cache", "/weights/sam3d")
        results.commit()
        return value

    return app, health, reconstruct_single_object


if __name__ == "__main__":
    import json
    print(json.dumps(readiness(), ensure_ascii=False, indent=2))
