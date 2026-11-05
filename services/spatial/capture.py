"""Prepare a small, auditable capture bundle using CPU only. Never calls a cloud API."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile
from uuid import uuid4

from contracts.spatial import CaptureManifest, CaptureSource, ReconstructionPlan, ScaleReference

MAX_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 60
MAX_EDGE = 1280


class CaptureError(ValueError):
    pass


def _run(args, timeout=15):
    try:
        return subprocess.run(args, capture_output=True, check=True, timeout=timeout,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except (subprocess.SubprocessError, OSError):
        raise CaptureError("No se pudo leer el video. Usa un MP4 compatible y comprueba ffmpeg/ffprobe.") from None


def probe_video(path: Path):
    executable = shutil.which("ffprobe")
    if not executable:
        raise CaptureError("Instala ffprobe para comprobar la captura antes de procesarla.")
    try:
        data = json.loads(_run([executable, "-v", "error", "-protocol_whitelist", "file,pipe",
                               "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", str(path)]))
        stream = next(item for item in data["streams"] if item["codec_type"] == "video")
        duration = float(data["format"]["duration"])
        width, height = int(stream["width"]), int(stream["height"])
        has_audio = any(item["codec_type"] == "audio" for item in data["streams"])
    except (KeyError, ValueError, TypeError, StopIteration):
        raise CaptureError("La captura necesita imagen y una duración legible.") from None
    if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
        raise CaptureError("La primera prueba espacial admite clips de hasta 60 segundos.")
    if not 16 <= width <= 7680 or not 16 <= height <= 7680:
        raise CaptureError("La resolución del video no está dentro del límite del prototipo.")
    return {"duration_seconds": duration, "width": width, "height": height, "has_audio": has_audio}


def jpeg_size(data: bytes):
    """Read JPEG SOF dimensions without requiring an image/ML runtime."""
    if data[:2] != b"\xff\xd8": raise CaptureError("No se generó un fotograma JPEG válido.")
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255: raise CaptureError("Cabecera JPEG no válida.")
        while offset < len(data) and data[offset] == 255: offset += 1
        if offset >= len(data): break
        marker = data[offset]; offset += 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7: continue
        if offset + 2 > len(data): break
        length = int.from_bytes(data[offset:offset+2], "big")
        if length < 2 or offset + length > len(data): break
        if marker in (0xC0, 0xC1, 0xC2):
            if length < 8: break
            height, width = struct.unpack(">HH", data[offset+3:offset+7])
            if 0 < width <= MAX_EDGE and 0 < height <= MAX_EDGE: return width, height
            break
        offset += length
    raise CaptureError("No se pudieron comprobar las dimensiones del fotograma.")


def extract_frame(source: Path, at: float, output: Path):
    executable = shutil.which("ffmpeg")
    if not executable: raise CaptureError("Instala ffmpeg para preparar fotogramas.")
    # No CUDA, Torch, model downloads or audio extraction. Bounded CPU decode.
    def decode(seek):
        _run([executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2",
          "-protocol_whitelist", "file,pipe", "-ss", f"{seek:.6f}", "-i", str(source),
          "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn",
          "-vf", f"scale=w='min({MAX_EDGE},iw)':h='min({MAX_EDGE},ih)':force_original_aspect_ratio=decrease",
          "-pix_fmt", "yuvj420p", "-q:v", "3", "-threads", "2", str(output)])
    decode(at)
    fallback=False
    if not output.exists() and at>0:
        # Some short/low-FPS MP4s have no frame starting after this seek. A
        # single explicit local fallback preserves an inspectable sample. Its
        # provenance is recorded, never presented as a verified timestamp.
        decode(0);fallback=True
    if not output.exists() or output.stat().st_size > 2 * 1024 * 1024:
        raise CaptureError("El fotograma está vacío o supera el límite previsto.")
    return {'requested_seek_seconds':at,'fallback_seek_seconds':0.0 if fallback else None,
            'decoded_timestamp_verified':False}


def grayscale_metrics(pixels, width, height, previous=None):
    """Cheap image signals, not a semantic quality or overlap classifier."""
    if len(pixels)!=width*height or width<3 or height<3:raise ValueError('Invalid gray image')
    count=len(pixels);mean=sum(pixels)/count
    contrast=math.sqrt(sum((value-mean)**2 for value in pixels)/count)
    edges=[]
    for y in range(1,height-1):
        for x in range(1,width-1):
            i=y*width+x;edges.append(4*pixels[i]-pixels[i-1]-pixels[i+1]-pixels[i-width]-pixels[i+width])
    lap_mean=sum(edges)/len(edges)
    sharpness=sum((value-lap_mean)**2 for value in edges)/len(edges)
    change=sum(abs(a-b) for a,b in zip(pixels,previous))/count if previous is not None and len(previous)==count else None
    return {'luma_mean':round(mean,3),'luma_stddev':round(contrast,3),'laplacian_variance':round(sharpness,3),
            'dark_fraction':round(sum(value<16 for value in pixels)/count,4),
            'bright_fraction':round(sum(value>239 for value in pixels)/count,4),
            'mean_absolute_change_from_previous':round(change,3) if change is not None else None}


def frame_gray(path):
    executable=shutil.which('ffmpeg')
    if not executable:raise CaptureError('Falta FFmpeg para las señales visuales.')
    return _run([executable,'-hide_banner','-loglevel','error','-nostdin','-threads','2',
        '-protocol_whitelist','file,pipe','-i',str(path),'-frames:v','1','-an','-sn','-dn',
        '-vf','scale=96:64','-pix_fmt','gray','-threads','2','-f','rawvideo','pipe:1'])


def prepare_capture(source, output, *, frames=6, reference_length_m=None, reference_description=None,
                    probe=probe_video, extract=extract_frame):
    """Write capture.json, planned reconstruction, frames and ZIP; never overwrite a folder."""
    source, output = Path(source).resolve(), Path(output).absolute()
    if type(frames) is not int or not 2 <= frames <= 8:
        raise CaptureError("Elige entre dos y ocho fotogramas para esta prueba.")
    if not source.is_file() or source.suffix.lower() != ".mp4":
        raise CaptureError("Selecciona un archivo MP4 existente.")
    if not 16 <= source.stat().st_size <= MAX_BYTES:
        raise CaptureError("La captura debe ocupar como máximo 25 MiB.")
    if output.exists() or not output.parent.is_dir():
        raise CaptureError("La carpeta de salida debe ser nueva y su carpeta superior debe existir.")
    calibration = None
    if reference_length_m is not None or reference_description is not None:
        if reference_length_m is None or not reference_description:
            raise CaptureError("La referencia necesita una longitud y una descripción del tramo medido.")
        calibration = ScaleReference(description=reference_description, length_m=reference_length_m)
    # Snapshot prevents a changed source file mixing metadata and sampled frames.
    with tempfile.TemporaryDirectory(prefix="brivany-spatial-") as workdir:
        work = Path(workdir); snapshot = work / "source.mp4"
        with source.open("rb") as stream: content = stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES or content[4:8] != b"ftyp":
            raise CaptureError("El archivo no es un MP4 válido o cambió durante la lectura.")
        snapshot.write_bytes(content)
        metadata = probe(snapshot)
        validated_source = CaptureSource(filename=source.name, sha256=hashlib.sha256(content).hexdigest(),
                                         size_bytes=len(content), **metadata)
        manifest = {"capture_id": uuid4(), "source": validated_source,
                    "calibration": calibration, "frames": []}
        # Validate source and declared reference before doing repeated decoding.
        duration = metadata["duration_seconds"]
        if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
            raise CaptureError("Usa un clip de hasta 60 segundos.")
        bundle = work / "bundle"; (bundle / "frames").mkdir(parents=True)
        observations=[];signals=[];previous=None
        for index in range(frames):
            frame_id = f"frame-{index:04d}"; relative = f"frames/{frame_id}.jpg"
            at = duration * (index + .5) / frames
            path = bundle / relative; observation=extract(snapshot, at, path)
            data = path.read_bytes(); width, height = jpeg_size(data)
            manifest["frames"].append({"id": frame_id, "relative_path": relative,
                "at_seconds": at, "width": width, "height": height, "sha256": hashlib.sha256(data).hexdigest()})
            if isinstance(observation,dict):observations.append({'frame_id':frame_id,**observation})
            try:
                pixels=frame_gray(path);metrics=grayscale_metrics(pixels,96,64,previous);previous=pixels
                warnings=[]
                if metrics['dark_fraction']>.65:warnings.append('predominantly_dark')
                if metrics['bright_fraction']>.65:warnings.append('predominantly_bright')
                if metrics['luma_stddev']<8:warnings.append('low_visual_variation')
                signals.append({'frame_id':frame_id,'status':'measured_image_signals','metrics':metrics,'review_flags':warnings})
            except (CaptureError,ValueError):
                signals.append({'frame_id':frame_id,'status':'unavailable','metrics':None,'review_flags':['signals_unavailable']})
        validated = CaptureManifest.model_validate(manifest)
        plan = ReconstructionPlan(capture_id=validated.capture_id, max_frames=frames,
                                  max_objects=3, gpu_seconds_limit=180)
        (bundle / "capture.json").write_text(validated.model_dump_json(indent=2), encoding="utf-8")
        (bundle / "reconstruction-plan.json").write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        unique_frames = len({frame.sha256 for frame in validated.frames})
        notes = {"status": "prepared_not_reconstructed", "cloud_requests": 0, "gpu_inference": False,
                 "sampling": "uniform_midpoints", "quality_assessed": False,
                 "unique_frame_hashes": unique_frames, "exact_duplicate_frames": frames - unique_frames,
                 "requires_capture_review": True,
                 "sampling_observations":observations,
                 "heuristics":{"status":"image_signals_only","version":"gray96x64-v1","frames":signals,
                    "coverage_assessed":False,"overlap_assessed":False,"camera_motion_estimated":False,
                    "decoded_timestamps_verified":False,
                    "recommendation":"Review exposure, sharpness signals and duplicates before choosing objects.",
                    "limitations":["Pixel change is not geometric overlap or camera motion.",
                        "Sharpness depends on texture; these thresholds do not certify usable reconstruction.",
                        "A fallback sample may repeat the initial frame and still require recapture."]},
                 "warnings": ["Muestreo uniforme; no demuestra cobertura, nitidez ni solapamiento suficientes.",
                     "La referencia de longitud es declarada y todavía no calibra la geometría.",
                     "No se han inferido objetos, materiales, masas ni colisiones.",
                     "Este paquete contiene imágenes del espacio. El envío a Modal es un paso independiente."],
                 "next_stage": "Modal worker and bounded single-object reconstruction"}
        (bundle / "preflight.json").write_text(json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")
        with zipfile.ZipFile(bundle / "capture-bundle.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(bundle.rglob("*")):
                if path.is_file() and path.suffix != ".zip": archive.write(path, path.relative_to(bundle).as_posix())
        # Publish a complete bundle on the destination filesystem. A failed copy
        # leaves no apparent capture folder and never replaces an existing one.
        with tempfile.TemporaryDirectory(prefix=".brivany-capture-", dir=output.parent) as staging_dir:
            staged = Path(staging_dir) / "bundle"
            shutil.copytree(bundle, staged)
            if output.exists():
                raise CaptureError("La carpeta de salida ya existe; elige una nueva.")
            staged.rename(output)
    return {"capture_id": str(validated.capture_id), "status": "prepared_not_reconstructed",
            "output": str(output), "frames": len(validated.frames), "duration_seconds": duration,
            "cloud_requests": 0, "gpu_inference": False}
