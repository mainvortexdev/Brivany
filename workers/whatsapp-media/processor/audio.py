"""Independent audio evidence: stream presence, energy, and optional YAMNet events."""
from __future__ import annotations

import math
import time
import wave
import zipfile
from pathlib import Path

import numpy as np


def read_pcm16(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 16000:
            raise ValueError("expected_mono_pcm16_16khz")
        # Upstream duration limits cap this allocation at <10 MiB.
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        return samples, source.getframerate()


def energy_segments(samples: np.ndarray, rate: int = 16000, seconds: float = 0.975) -> list[dict]:
    width = max(1, round(rate * seconds))
    result = []
    for start in range(0, len(samples), width):
        chunk = samples[start:start + width]
        rms = float(np.sqrt(np.mean(np.square(chunk), dtype=np.float64))) if len(chunk) else 0.0
        db = 20 * math.log10(max(rms, 1e-12))
        result.append({"startSeconds": round(start / rate, 6), "endSeconds": round(min(start + width, len(samples)) / rate, 6),
                       "rmsDb": round(db, 2), "quiet": db < -50})
    return result


def wav_chunks(path: Path, directory: Path, *, prefix: str, classification: dict, seconds: int = 30) -> list[dict]:
    chunks = []
    with wave.open(str(path), "rb") as source:
        rate, total = source.getframerate(), source.getnframes()
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or rate != 16000:
            raise ValueError("expected_mono_pcm16_16khz")
        for number, start in enumerate(range(0, total, rate * seconds), 1):
            count = min(rate * seconds, total - start)
            file = f"{prefix}-chunk-{number:03d}.wav"
            with wave.open(str(directory / file), "wb") as output:
                output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                output.writeframes(source.readframes(count))
            start_seconds, end_seconds = start / rate, (start + count) / rate
            segments = [{**segment, "startSeconds": max(start_seconds, segment["startSeconds"]),
                         "endSeconds": min(end_seconds, segment["endSeconds"])}
                        for segment in classification.get("segments", [])
                        if segment["startSeconds"] < end_seconds and segment["endSeconds"] > start_seconds]
            chunks.append({"file": file, "startSeconds": start_seconds, "endSeconds": end_seconds,
                           "classification": {**classification, "segments": segments}})
    return chunks


def label_scores(scores, names: list[str], *, threshold: float = 0.2) -> dict:
    # Scores are uncalibrated independent class evidence, not probabilities.
    classes = {name.lower(): max(0.0, min(1.0, float(value))) for name, value in zip(names, scores)}
    speech_names = {"speech", "conversation", "narration, monologue", "child speech, kid speaking", "male speech, man speaking", "female speech, woman speaking"}
    singing_names = {"singing", "choir", "yodeling", "chant", "mantra", "male singing", "female singing", "child singing", "synthetic singing"}
    speech = max((value for name, value in classes.items() if name in speech_names), default=0.0)
    music = max((value for name, value in classes.items() if name == "music" or name in {"background music", "theme music", "song", "instrumental music"}), default=0.0)
    singing = max((value for name, value in classes.items() if name in singing_names), default=0.0)
    labels = [name for name, value in [("speech", speech), ("music", music), ("singing", singing)] if value >= threshold]
    overlap = music >= threshold and (speech >= threshold or singing >= threshold)
    if overlap:
        labels.append("overlap")
    return {"labels": labels or ["unknown"], "scores": {"speech": round(speech, 4), "music": round(music, 4), "singing": round(singing, 4)},
            "speech": speech >= threshold, "music": music >= threshold, "singing": singing >= threshold,
            "overlap": overlap, "confidence": "uncalibrated_model_scores"}


def classify_audio(wav: Path, *, model_path: Path | None = None, interpreter_factory=None, deadline=None) -> dict:
    samples, rate = read_pcm16(wav)
    energy = energy_segments(samples, rate)
    if not model_path or not model_path.is_file():
        return {"status": "unavailable", "model": None, "reason": "audio_classifier_not_configured",
                "segments": [{**segment, "labels": ["silence_candidate"] if segment["quiet"] else ["unknown"],
                              "confidence": "energy_only", "speech": None, "music": None, "singing": None, "overlap": None}
                             for segment in energy], "limitations": ["Energy is not speech/music recognition; ASR absence does not prove absence of voice or music."]}
    try:
        from fetch_model import verify
        verify(model_path.read_bytes())
        if interpreter_factory is None:
            from ai_edge_litert.interpreter import Interpreter
            interpreter_factory = Interpreter
        # Official classification-tflite/1 has a fixed 15600-sample input and associated labels.
        with zipfile.ZipFile(model_path) as archive:
            names = archive.read("yamnet_label_list.txt").decode("utf-8").splitlines()
        if len(names) != 521:
            raise ValueError("classifier_labels_invalid")
        interpreter = interpreter_factory(model_path=str(model_path), num_threads=2)
        inputs, outputs = interpreter.get_input_details(), interpreter.get_output_details()
        if list(inputs[0]["shape"]) not in ([15600], [1, 15600]) or inputs[0]["dtype"] != np.float32:
            raise ValueError("classifier_input_invalid")
        interpreter.allocate_tensors()
        segments = []
        for i, segment in enumerate(energy):
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError("processing_deadline")
            chunk = samples[i * 15600:(i + 1) * 15600]
            padded = np.pad(chunk, (0, 15600 - len(chunk))).astype(np.float32)
            interpreter.set_tensor(inputs[0]["index"], padded.reshape(inputs[0]["shape"]))
            interpreter.invoke()
            scores = np.asarray(interpreter.get_tensor(outputs[0]["index"])).reshape(-1)
            if len(scores) != 521 or not np.isfinite(scores).all():
                raise ValueError("classifier_output_invalid")
            segments.append({**segment, **label_scores(scores, names)})
        return {"status": "classified", "processor": "yamnet", "model": "google/yamnet/classification-tflite/1", "segments": segments,
                "threshold": 0.2, "limitations": ["Independent class scores are uncalibrated; false positives/negatives remain possible.",
                                                  "Speech and singing are separate; transcription must keep spoken/sung/unknown content distinct."]}
    except Exception:
        return {"status": "unavailable", "model": "google/yamnet/classification-tflite/1", "reason": "audio_classifier_failed",
                "segments": [{**segment, "labels": ["unknown"], "confidence": "unknown", "speech": None,
                              "music": None, "singing": None, "overlap": None} for segment in energy]}
