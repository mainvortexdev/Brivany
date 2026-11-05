"""Measure real providers using generated test speech, never the user's microphone.

Run from the repository: python -m tools.benchmark_live --runs 5
Requires credentials; each run generates a short, billable TTS sample.
"""
import argparse
from array import array
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
import threading
import time
import wave

from packages.providers.live_voice import open_melodi, muse_key, muse_handshake, MUSE_URL, VoiceError
from services.h1.server import load_local_config

PHRASES = ["Hola. Soy Melodi, y te escucho.", "Claro. Tómate un momento para ordenar tu idea.",
           "Bien. Explica una idea, dale un ejemplo y termina con un cierre.",
           "Puedes decir: déjame comprobar la información antes de responder.",
           "Vamos paso a paso. Estoy aquí para acompañarte."]


def speech(text):
    start = time.perf_counter()
    first_voice = None
    with open_melodi(text) as response:
        chunks = []
        first = None
        carry = b""
        while chunk := response.read1(4096):
            now = time.perf_counter()
            if first is None:
                first = now
            chunks.append(chunk)
            probe = carry + chunk
            carry = probe[-1:] if len(probe) % 2 else b""
            probe = probe[:len(probe) - len(carry)]
            if first_voice is None and any(abs(v) > 96 for v in array("h", probe)):
                first_voice = now
    audio = b"".join(chunks)
    if len(audio) % 2 or audio[:4] in {b"RIFF", b"OggS"} or audio[:3] == b"ID3":
        raise ValueError("Expected raw PCM16LE, received a container")
    samples = array("h", audio)
    active = next((i for i, value in enumerate(samples) if abs(value) > 250), None)
    if active is None:
        raise ValueError("TTS returned silence")
    return {"first_pcm_ms": round((first - start) * 1000),
            "first_voice_pcm_ms": round((first_voice - start) * 1000),
            "complete_ms": round((time.perf_counter() - start) * 1000),
            "audio_seconds": round(len(audio) / 48000, 3), "bytes": len(audio),
            "leading_audio_silence_ms": round(active / 24)}, audio


def muse(audio):
    from websockets.sync.client import connect
    samples = array("h", audio)
    last_active = max((i for i, sample in enumerate(samples) if abs(sample) > 96), default=0) / 24000
    result = {}
    ready = time.perf_counter()
    with connect(MUSE_URL, proxy=None, open_timeout=15, close_timeout=3) as socket:
        socket.send(json.dumps(muse_handshake({"type": "start", "consent": True, "mode": "practice", "language": "es-ES"})))
        if "sessionId" not in json.loads(socket.recv(timeout=15)):
            raise VoiceError("asr_rejected", "Muse no aceptó la sesión de prueba.")
        result["connect_ms"] = round((time.perf_counter() - ready) * 1000)
        start = time.perf_counter()
        final = threading.Event()
        failure = []
        def receive():
            try:
                for raw in socket:
                    event = json.loads(raw)
                    if event.get("type") == "error":
                        failure.append("Muse rechazó la prueba"); final.set(); break
                    if event.get("type") == "transcript" and event.get("transcript"):
                        result.setdefault("first_partial_ms_from_audio_start", round((time.perf_counter() - start) * 1000))
                    if event.get("type") == "speechComplete":
                        result["final_ms_after_audio_end"] = round((time.perf_counter() - start - len(audio) / 48000) * 1000)
                        result["final_ms_after_last_activity"] = round((time.perf_counter() - start - last_active) * 1000)
                        result["transcript"] = str(event.get("transcript", ""))[:500]
                        final.set(); break
            except Exception:
                failure.append("Muse interrumpió la prueba"); final.set()
        reader = threading.Thread(target=receive, daemon=True); reader.start()
        padded = audio + b"\0" * 48000 * 8
        for offset in range(0, len(padded), 3840):
            if final.is_set():
                break
            remaining = start + offset / 48000 - time.perf_counter()
            if remaining > 0:
                time.sleep(remaining)
            socket.send(padded[offset:offset + 3840].ljust(3840, b"\0"))
        socket.send('{"type":"endStream"}')
        final.wait(10)
        if failure or "transcript" not in result:
            raise VoiceError("asr_test_failed", "No se recibió el turno final de Muse.")
    result["synthetic_test_audio"] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, choices=range(1, 11), default=5)
    parser.add_argument("--output", default="tmp/live-latency.json")
    args = parser.parse_args()
    load_local_config()
    report = {"measured_at": datetime.now(timezone.utc).isoformat(), "voice": "Melodi / Celeste / Aura-2 ES",
              "tts": [], "muse": [], "conversation_model": "not_configured",
              "physical_playback_tested": False, "guarantee": False}
    fixture = None
    for index in range(args.runs):
        measurement, audio = speech(PHRASES[index % len(PHRASES)])
        report["tts"].append(measurement)
        if fixture is None:
            fixture = audio
    values = sorted(item["first_pcm_ms"] for item in report["tts"])
    report["tts_summary"] = {"samples": len(values), "median_first_pcm_ms": statistics.median(values),
                             "p95_first_pcm_ms": values[math.ceil(.95 * len(values)) - 1], "max_first_pcm_ms": max(values)}
    if muse_key():
        for _ in range(min(args.runs, 3)):
            try:
                report["muse"].append(muse(fixture))
            except VoiceError as error:
                report["muse_status"] = error.code
                break
    else:
        report["muse_status"] = "blocked_missing_api_key"
    report["end_to_end_status"] = "pending_muse_and_conversation_model"
    path = Path(args.output); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with wave.open(str(path.with_suffix(".wav")), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(fixture)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
