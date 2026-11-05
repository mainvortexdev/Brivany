"""Offline inspection/compilation of the prepared worker; never creates Modal."""
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from workers.spatial_runtime import read_lock, readiness, ROOT
from workers.spatial_modal import function_options


def check():
    lock = read_lock()
    files = [ROOT / "workers/spatial_runtime.py", ROOT / "workers/spatial_modal.py", ROOT / "workers/sam3d_runner.py"]
    parsed = []
    for path in files:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path)); compile(tree, str(path), "exec")
        parsed.append({"file": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    options = function_options(lock)
    state = readiness(lock)
    assert lock["remote_dispatch_enabled"] is False
    assert state["remote_dispatch_enabled"] is False
    assert "remote_dispatch_disabled" in state["pending"]
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "status": "passed", "scope": "offline_contract_and_worker_definition_only",
        "compiled_files": parsed, "function_options": options, "readiness": state,
        "modal_deployed": False, "model_executed": False, "external_calls": 0, "gpu_seconds": 0,
        "limitations": ["Python compilation does not verify the native CUDA dependency image or checkpoint compatibility.",
            "L40S, 180 seconds and monetary estimates require later deployment and account measurements."]}


if __name__ == "__main__":
    value = check()
    directory = ROOT / "tmp/spatial-worker"; directory.mkdir(parents=True, exist_ok=True)
    path = directory / ("offline-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".json")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**value, "report": path.relative_to(ROOT).as_posix()}, ensure_ascii=False, indent=2))
