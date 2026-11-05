"""Fixed SAM3D invocation for a future verified Linux worker, never a shell job.

Imports are deliberately lazy. This runner has not been exercised on a GPU.
The parent process bounds its lifetime, validates GLB and removes input/log files.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import sys


def run(job, weights, model):
    import numpy as np
    from PIL import Image
    import torch

    job, weights, model = Path(job).resolve(), Path(weights).resolve(), Path(model).resolve()
    options = json.loads((job / "options.json").read_text(encoding="utf-8"))
    relative = options["config"]
    if not isinstance(relative, str) or "\\" in relative or ":" in relative or PurePosixPath(relative).is_absolute() or any(p in {"", ".", ".."} for p in relative.split("/")):
        raise ValueError("Invalid locked configuration path.")
    configuration = weights / relative
    if not configuration.is_file() or not configuration.resolve().is_relative_to(weights):
        raise ValueError("Locked model configuration unavailable.")
    if not torch.cuda.is_available(): raise RuntimeError("The prepared worker requires a CUDA GPU.")
    if torch.cuda.get_device_properties(0).total_memory < 32 * 1024**3:
        raise RuntimeError("SAM3D requires at least 32 GiB of GPU memory.")
    Image.MAX_IMAGE_PIXELS = 1280 * 1280
    with Image.open(job / "image.png") as source:
        image = np.asarray(source.convert("RGB"), dtype=np.uint8)
    with Image.open(job / "mask.png") as source:
        mask = np.asarray(source.convert("L"), dtype=np.uint8)
    if image.shape[:2] != mask.shape or max(mask.shape) > 1280 or not np.isin(mask, [0, 255]).all() or not mask.any() or (mask > 0).all():
        raise ValueError("A reviewed binary mask must select a nonempty subset of the image.")
    sys.path.insert(0, str(model / "notebook"))
    # Public inference API at the pinned upstream revision; native dependencies,
    # checkpoint compatibility and output convention still require a GPU trial.
    from inference import Inference
    pipeline = Inference(str(configuration), compile=False)
    output = pipeline(image, mask > 0, seed=options["seed"])
    mesh = output.get("glb")
    if mesh is None or not hasattr(mesh, "export"):
        raise RuntimeError("SAM3D did not provide an exportable mesh.")
    mesh.export(str(job / "object.glb"), file_type="glb")


def main():
    parser = argparse.ArgumentParser(description="Fixed single-object SAM3D runner")
    parser.add_argument("--job", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    run(args.job, args.weights, args.model)


if __name__ == "__main__": main()
