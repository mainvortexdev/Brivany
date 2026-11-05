"""Prepare two fixed synthetic English clauses locally, without provider APIs.

Windows System.Speech (Zira Desktop) and FFmpeg are required. Existing approved
PCM is reused for clause one. All generated material remains in tmp/stream-dubbing.
Energy windows are timing landmarks, not independent speech/semantic alignment.
"""
from __future__ import annotations

import array
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4
import wave


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tmp/modular-dubbing/english-room.wav"
SOURCE_SHA256 = "5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30"
RATE = 24000
WINDOW_FRAMES = RATE // 50  # 20 ms
RMS_THRESHOLD = .005
MARGIN_FRAMES = RATE // 10  # 100 ms of low energy at each retained edge
GAP_FRAMES = RATE * 60 // 1000
PHRASES = ("This room has two windows.", "The table is next to the door.")


class FixtureError(RuntimeError):
    pass


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def read_pcm(path):
    with wave.open(str(path), "rb") as stream:
        if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, RATE, "NONE"):
            raise FixtureError("The synthetic fixture must be PCM16 mono at 24 kHz.")
        frames = stream.getnframes()
        if not 0 < frames <= RATE * 10:
            raise FixtureError("A synthetic clause must be between zero and ten seconds.")
        pcm = stream.readframes(frames)
    if len(pcm) != frames * 2:
        raise FixtureError("The synthetic WAV contains incomplete PCM.")
    return pcm


def write_pcm(path, pcm):
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes(pcm)


def energy_bounds(pcm):
    samples = array.array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    first, last = None, None
    for offset in range(0, len(samples), WINDOW_FRAMES):
        window = samples[offset:offset + WINDOW_FRAMES]
        rms = math.sqrt(sum((value / 32768) ** 2 for value in window) / len(window))
        if rms > RMS_THRESHOLD:
            if first is None:
                first = offset
            last = offset + len(window)
    if first is None:
        raise FixtureError("The synthetic clause contains no energy above the fixed threshold.")
    return first, last


def retained_clause(pcm):
    first, last = energy_bounds(pcm)
    start = max(0, first - MARGIN_FRAMES)
    end = min(len(pcm) // 2, last + MARGIN_FRAMES)
    retained = pcm[start * 2:end * 2]
    # Margins and bounds align to RMS windows, preserving their interpretation.
    kept_first, kept_last = energy_bounds(retained)
    if kept_first != first - start or kept_last != last - start:
        raise FixtureError("Trimming unexpectedly moved the energy landmarks.")
    return retained, {"source_start_frame": start, "source_end_frame": end,
                      "source_energy_start_frame": first, "source_energy_end_frame": last,
                      "retained_energy_start_frame": kept_first, "retained_energy_end_frame": kept_last}


def synthesize_second(build, executable):
    native = build / "second-zira-native.wav"
    script = build / "synthesize-second.ps1"
    script.write_text("""param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixtureSynth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $fixtureVoice = $fixtureSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq 'Microsoft Zira Desktop' -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
  if (-not $fixtureVoice) { throw 'The fixed offline Zira voice is unavailable.' }
  $fixtureSynth.SelectVoice($fixtureVoice.VoiceInfo.Name)
  $fixtureSynth.Rate = 0
  $fixtureSynth.Volume = 100
  $fixtureSynth.SetOutputToWaveFile($Destination)
  $fixtureSynth.Speak('The table is next to the door.')
  $fixtureSynth.SetOutputToNull()
  [pscustomobject]@{name=$fixtureVoice.VoiceInfo.Name;culture=$fixtureVoice.VoiceInfo.Culture.Name;engine='Windows System.Speech';rate=0;volume=100} | ConvertTo-Json -Compress
} finally { $fixtureSynth.Dispose() }
""", encoding="utf-8")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # Only this generated local script runs under a process-scoped policy; no
    # persisted Windows execution policy is changed.
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), str(native)],
                            cwd=ROOT, capture_output=True, timeout=30, creationflags=flags)
    if result.returncode:
        raise FixtureError("The fixed offline Windows Zira voice could not generate clause two.")
    try:
        voice = json.loads(result.stdout.decode("utf-8-sig").strip())
    except (UnicodeError, ValueError):
        raise FixtureError("The offline voice did not return the expected provenance record.") from None
    if voice.get("name") != "Microsoft Zira Desktop" or voice.get("culture") != "en-US":
        raise FixtureError("The offline voice did not match the required Zira identity.")
    normalized = build / "second-zira-24k.wav"
    result = subprocess.run([executable, "-hide_banner", "-loglevel", "error", "-i", str(native),
                             "-ac", "1", "-ar", str(RATE), "-c:a", "pcm_s16le", "-y", str(normalized)],
                            cwd=ROOT, capture_output=True, timeout=15, creationflags=flags)
    if result.returncode:
        raise FixtureError("FFmpeg could not normalize the synthetic voice to PCM16 mono 24 kHz.")
    return normalized, voice


def prepare():
    directory = ROOT / "tmp/stream-dubbing"
    directory.mkdir(parents=True, exist_ok=True)
    build = directory / ("build-" + uuid4().hex)
    build.mkdir()
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "status": "blocked",
                "synthetic": True, "external_calls": 0, "gpu_seconds": 0,
                "purpose": "Test whether useful translation of clause one begins before clause two ends, without a long inter-clause silence.",
                "limitations": ["No translation provider, model latency, intelligibility, or physical audio device is evaluated by fixture preparation.",
                                "RMS landmarks identify energy windows, not forced word alignment or proof of semantic correspondence.",
                                "Reproduction uses the fixed prior synthetic PCM plus offline Windows Zira synthesis; byte reproducibility depends on the installed voice version."]}
    try:
        if not SOURCE.is_file() or sha256(SOURCE) != SOURCE_SHA256:
            raise FixtureError("The approved fixed synthetic source is absent or has changed.")
        executable = shutil.which("ffmpeg")
        if not executable or not shutil.which("powershell.exe"):
            raise FixtureError("This preparation requires FFmpeg and Windows PowerShell with System.Speech.")
        original = read_pcm(SOURCE)
        second_path, voice = synthesize_second(build, executable)
        second = read_pcm(second_path)
        combined = bytearray()
        clauses = []
        for index, (source_pcm, source_path, phrase) in enumerate(((original, SOURCE, PHRASES[0]), (second, second_path, PHRASES[1]))):
            if index:
                combined.extend(b"\0\0" * GAP_FRAMES)
            retained, bounds = retained_clause(source_pcm)
            start = len(combined) // 2
            combined.extend(retained)
            segment_path = build / f"clause-{index + 1}.wav"
            write_pcm(segment_path, retained)
            if read_pcm(segment_path) != retained:
                raise FixtureError("A generated synthetic segment did not round-trip exactly.")
            clauses.append({"index": index + 1, "text": phrase, "language": "en", "source": relative(source_path),
                            "source_sha256": sha256(source_path), "segment": relative(segment_path),
                            "segment_sha256": sha256(segment_path), "retained_pcm_sha256": hashlib.sha256(retained).hexdigest(),
                            **bounds, "combined_start_frame": start, "combined_end_frame": len(combined) // 2,
                            "combined_energy_start_frame": start + bounds["retained_energy_start_frame"],
                            "combined_energy_end_frame": start + bounds["retained_energy_end_frame"],
                            "voice": voice if index else {"engine": "prior fixed synthetic fixture", "name": None,
                                                           "note": "Original voice identity is not independently rechecked by this tool; fixed WAV hash is verified."}})
        combined_path = build / "two-clauses.wav"
        write_pcm(combined_path, bytes(combined))
        if read_pcm(combined_path) != bytes(combined):
            raise FixtureError("The combined synthetic fixture did not round-trip exactly.")
        gap = clauses[1]["combined_energy_start_frame"] - clauses[0]["combined_energy_end_frame"]
        if not 0 <= gap < int(.3 * RATE):
            raise FixtureError("The synthetic energy gap must remain below the Palabra 300 ms silence minimum.")
        frames = len(combined) // 2
        manifest.update({"status": "prepared", "format": "pcm_s16le", "sample_rate_hz": RATE, "channels": 1,
                         "window_frames": WINDOW_FRAMES, "window_ms": 20, "rms_threshold": RMS_THRESHOLD,
                         "retained_margin_frames": MARGIN_FRAMES, "explicit_gap_frames": GAP_FRAMES,
                         "inter_clause_energy_gap_frames": gap, "inter_clause_energy_gap_ms": gap / RATE * 1000,
                         "audio": relative(combined_path), "audio_sha256": sha256(combined_path),
                         "pcm_sha256": hashlib.sha256(combined).hexdigest(), "frames": frames,
                         "duration_seconds": frames / RATE, "clauses": clauses,
                         "streaming_decision_reference": {"first_clause_energy_end_frame": clauses[0]["combined_energy_end_frame"],
                                                          "second_clause_energy_end_frame": clauses[1]["combined_energy_end_frame"],
                                                          "requires_useful_translated_audio_not_only_caption": True,
                                                          "target_audible_delay_ms": 500, "target_verified": False}})
    except (FixtureError, OSError, subprocess.TimeoutExpired) as error:
        manifest["reason"] = str(error) if isinstance(error, FixtureError) else "The offline synthetic fixture preparation did not complete."
    path = build / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": manifest["status"], "manifest": relative(path),
                      "audio": manifest.get("audio"), "external_calls": 0,
                      "duration_seconds": manifest.get("duration_seconds"),
                      "inter_clause_energy_gap_ms": manifest.get("inter_clause_energy_gap_ms"),
                      "reason": manifest.get("reason")}, ensure_ascii=False))
    return 0 if manifest["status"] == "prepared" else 2


if __name__ == "__main__":
    raise SystemExit(prepare())
