"""Opt-in local listening artifacts for two approved synthetic EN→ES fixtures.

No providers are called. The source's built-in path, digest and PCM frame count
are authority; caller metadata and flags cannot authorize a different recording.
Output media must not be attached to the construction activity ledger.
"""
from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import unicodedata
from uuid import uuid4
import wave


ROOT = Path(__file__).resolve().parents[1]
SOURCE_RELATIVE = Path("tmp/modular-dubbing/english-room.wav")
SOURCE_SHA256 = "5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30"
SOURCE_FRAMES = 56261
KNOWN_SOURCE_TEXT = "This room has two windows."
STREAM_SOURCE_PATTERN = re.compile(r"tmp/stream-dubbing/build-[a-f0-9]{32}/two-clauses\.wav\Z")
STREAM_SOURCE_SHA256 = "373acd421477dc7f1169151181f1d5dff3a6a3107ed70704c9ca894c74a46b38"
STREAM_SOURCE_FRAMES = 83040
STREAM_SOURCE_TEXT = "This room has two windows. The table is next to the door."
OUTPUT_RELATIVE = Path("tmp/synthetic-dubbing-review")
SAMPLE_RATE = 24000
MAX_SOURCE_BYTES = 2*1024*1024
MAX_OUTPUT_PCM_BYTES = SAMPLE_RATE*2*20
MAX_AUDIO_CHUNK_BYTES = SAMPLE_RATE*2*10
MAX_TEXT_CHARACTERS = 512
MAX_STDIN_BYTES = 2*1024*1024
MAX_REVIEW_EVENTS = 1000


def _source_spec(source_path):
    """Authorize path and expected content together, never a caller's manifest."""
    if not isinstance(source_path, (str, Path)):
        raise ValueError("La revisión requiere la fixture sintética autorizada.")
    requested = Path(source_path).absolute()
    source = requested.resolve()
    # Reject path aliases/junctions as well as files placed outside the approved
    # folders. A digest cannot authorize a new source path on its own.
    if source != requested:
        raise ValueError("La ruta de revisión no puede redirigirse.")
    try: relative = source.relative_to(ROOT.absolute())
    except ValueError:
        raise ValueError("La revisión solo admite las fixtures sintéticas autorizadas.") from None
    if relative == SOURCE_RELATIVE:
        return source, relative, SOURCE_SHA256, SOURCE_FRAMES, KNOWN_SOURCE_TEXT, "single_room_phrase"
    if STREAM_SOURCE_PATTERN.fullmatch(relative.as_posix()):
        return source, relative, STREAM_SOURCE_SHA256, STREAM_SOURCE_FRAMES, STREAM_SOURCE_TEXT, "two_clauses"
    raise ValueError("La revisión solo admite las fixtures sintéticas autorizadas.")


def _clean_text(value):
    if not isinstance(value, str) or len(value) > MAX_TEXT_CHARACTERS:
        raise ValueError("El texto de revisión excede el límite o no es válido.")
    value = "".join(character for character in value if not unicodedata.category(character).startswith("C"))
    value = re.sub(r"\s+", " ", value)
    # Observed translation is plain text. Credentials/URLs, if accidentally
    # injected into the text event, are never copied into a persisted artifact.
    if (re.search(r"(?:https?://|www\.|bearer\s+|api[_-]?key|access[_-]?token|(?:sk|AIza)[-_a-zA-Z0-9]{8,})", value, re.I)
        or re.search(r"[A-Za-z0-9_+/=-]{48,}", value)):
        raise ValueError("El texto de revisión contiene datos ajenos a una traducción.")
    return value


class SyntheticReview:
    """Collect normalized relay events for the authorized synthetic fixture.

    ``collect`` accepts PCM audio only as validated base64 in ``event['audio']``;
    Source and target transcripts are bounded observations: recognition errors
    are retained as evidence, never an automatic semantic verification.
    """
    def __init__(self, source_path, output_directory=None):
        source, relative, expected_hash, expected_frames, known_text, fixture = _source_spec(source_path)
        if not source.is_file() or source.suffix.lower() != ".wav":
            raise ValueError("La revisión solo admite la fixture sintética autorizada.")
        if not 44 <= source.stat().st_size <= MAX_SOURCE_BYTES:
            raise ValueError("La fixture sintética no tiene un tamaño válido.")
        # One file descriptor/read: digest and WAV validation refer to the same
        # bytes even if the file on disk is replaced after construction.
        with source.open("rb") as handle: content = handle.read(MAX_SOURCE_BYTES+1)
        if len(content) > MAX_SOURCE_BYTES or hashlib.sha256(content).hexdigest() != expected_hash:
            raise ValueError("La fixture sintética no coincide con su hash autorizado.")
        try:
            with wave.open(io.BytesIO(content), "rb") as audio:
                if (audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != SAMPLE_RATE or
                    audio.getcomptype() != "NONE" or audio.getnframes() != expected_frames):
                    raise ValueError("format")
                pcm = audio.readframes(expected_frames+1)
                if len(pcm) != expected_frames*2: raise ValueError("incomplete")
        except (wave.Error, EOFError, OSError, ValueError):
            raise ValueError("La fixture debe ser PCM16 mono de 24 kHz con duración autorizada.") from None
        default = (ROOT/OUTPUT_RELATIVE).resolve()
        if default != (ROOT/OUTPUT_RELATIVE).absolute():
            raise ValueError("La carpeta de revisión no puede redirigirse fuera del proyecto.")
        output = Path(output_directory).resolve() if output_directory is not None else default
        if output != default:
            raise ValueError("La revisión debe guardarse en tmp/synthetic-dubbing-review.")
        self._output = output
        self._source_relative, self._source_hash, self._source_frames = relative, expected_hash, expected_frames
        self._known_text, self._fixture = known_text, fixture
        self._source_size = len(content)
        self._audio = bytearray()
        self._observed_target = ""
        self._observed_source = ""
        self._segment_targets = {}
        self._audio_chunks = 0
        self._closed = False
        self._result = None

    def source_metadata(self):
        return {"synthetic": True, "filename": self._source_relative.name, "sha256": self._source_hash,
                "size_bytes": self._source_size, "duration_seconds": self._source_frames/SAMPLE_RATE,
                "sample_rate": SAMPLE_RATE, "channels": 1, "format": "pcm16", "fixture": self._fixture}

    def collect(self, event):
        if self._closed: raise ValueError("La revisión sintética está cerrada.")
        if not isinstance(event, dict): raise ValueError("La revisión requiere eventos normalizados.")
        kind = event.get("type")
        if kind == "audio":
            rate, channels = event.get("sample_rate", SAMPLE_RATE), event.get("channels", 1)
            audio_format = event.get("format", "pcm16")
            if (type(rate) is not int or rate != SAMPLE_RATE or type(channels) is not int or channels != 1 or
                not isinstance(audio_format, str) or audio_format not in {"pcm16", "pcm_s16le"}):
                raise ValueError("La revisión requiere audio PCM16 mono de 24 kHz.")
            encoded = event.get("audio")
            if not isinstance(encoded, str) or not encoded or len(encoded) > (MAX_AUDIO_CHUNK_BYTES+2)//3*4:
                raise ValueError("El bloque de revisión no tiene un tamaño válido.")
            try: chunk = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                raise ValueError("El bloque de revisión no es base64 válido.") from None
            if not chunk or len(chunk)%2 or len(chunk) > MAX_AUDIO_CHUNK_BYTES:
                raise ValueError("El bloque de revisión debe contener muestras PCM completas.")
            if len(self._audio)+len(chunk) > MAX_OUTPUT_PCM_BYTES:
                raise ValueError("La salida de revisión excede veinte segundos.")
            self._audio.extend(chunk); self._audio_chunks += 1
        elif kind == "transcript":
            source = event.get("source")
            if not isinstance(source, str): return
            if source not in {"original", "translation"}: return
            text = _clean_text(event.get("text"))
            operation = event.get("operation", "append")
            if not isinstance(operation, str) or operation not in {"append", "replace"}:
                raise ValueError("La operación de texto no está admitida.")
            if source == "original":
                value = text if operation == "replace" else self._observed_source+text
                if len(value) > MAX_TEXT_CHARACTERS:
                    raise ValueError("La transcripción de la fixture excede el límite.")
                self._observed_source = value
            else:
                identifier = event.get("segment_id")
                if identifier is not None:
                    if not isinstance(identifier, (str, int)) or isinstance(identifier, bool):
                        raise ValueError("El identificador de segmento no es válido.")
                    identifier = str(identifier)
                    if not 1<=len(identifier)<=1024 or any(unicodedata.category(character).startswith("C") for character in identifier):
                        raise ValueError("El identificador de segmento no es válido.")
                    # Provider IDs may be JSON tuples; preserve identity without
                    # retaining arbitrary ID strings in review metadata.
                    identifier=hashlib.sha256(identifier.encode("utf-8")).hexdigest()
                    proposed = dict(self._segment_targets)
                    proposed[identifier] = text if operation == "replace" else proposed.get(identifier, "")+text
                    value = " ".join(proposed.values())
                    if len(value) > MAX_TEXT_CHARACTERS or len(proposed) > 32:
                        raise ValueError("La transcripción de revisión excede el límite.")
                    self._segment_targets = proposed
                else:
                    value = text if operation == "replace" else self._observed_target+text
                    if len(value) > MAX_TEXT_CHARACTERS:
                        raise ValueError("La transcripción de revisión excede el límite.")
                self._observed_target = value

    def finish(self):
        """Write synthetic output only. JSON declares review, not correctness."""
        if self._result is not None: return dict(self._result)
        if self._closed: raise ValueError("La revisión sintética está cerrada.")
        if not self._audio: raise ValueError("La revisión aún no tiene audio PCM de salida.")
        # Resolve again to reject a parent redirected after initialization.
        if self._output.resolve() != (ROOT/OUTPUT_RELATIVE).absolute():
            raise ValueError("La carpeta de revisión cambió de ubicación.")
        self._output.mkdir(parents=True, exist_ok=True)
        directory = self._output/str(uuid4()); directory.mkdir()
        wav_path, json_path = directory/"translated.wav", directory/"review.json"
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(SAMPLE_RATE)
            audio.writeframes(self._audio)
        content = buffer.getvalue()
        report = {"created_at": datetime.now(timezone.utc).isoformat(), "synthetic": True,
            "source": self.source_metadata(), "known_source_text_en": self._known_text,
            "source_text_observed": self._observed_source.strip(), "target_language": "es",
            "target_text_observed": self._observed_target.strip(),
            "output": {"filename": "translated.wav", "sha256": hashlib.sha256(content).hexdigest(),
                "pcm_sha256": hashlib.sha256(self._audio).hexdigest(), "size_bytes": len(content),
                "pcm_bytes": len(self._audio), "duration_seconds": len(self._audio)/(SAMPLE_RATE*2),
                "sample_rate": SAMPLE_RATE, "channels": 1, "format": "pcm16", "audio_chunks": self._audio_chunks},
            "pcm_review_available": True, "semantic_accuracy_verified": False,
            "naturalness_verified": False, "review_status": "pending_human_listening",
            "automatic_semantic_assessment": False,
            "limitations": ["Audio sintético de prueba; los bytes PCM no prueban traducción correcta ni naturalidad.",
                "Texto observado del proveedor, sin verificación semántica automática.",
                "No adjuntar audio de revisión a la bitácora de construcción."]}
        review_content = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
        try:
            with wav_path.open("xb") as handle: handle.write(content)
            with json_path.open("xb") as handle: handle.write(review_content)
        except OSError:
            # This UUID and these two filenames are created exclusively here.
            # Do not leave half a review or recursively delete any directory.
            wav_path.unlink(missing_ok=True); json_path.unlink(missing_ok=True)
            directory.rmdir()
            raise
        self._closed = True
        self._audio.clear()
        self._result = {"directory": str(directory), "wav_path": str(wav_path), "json_path": str(json_path),
                        "pcm_review_available": True, "semantic_accuracy_verified": False,
                        "naturalness_verified": False, "source_sha256": self._source_hash,
                        "output_sha256": report["output"]["sha256"],
                        "output_pcm_sha256": report["output"]["pcm_sha256"],
                        "output_pcm_bytes": report["output"]["pcm_bytes"],
                        "output_duration_seconds": report["output"]["duration_seconds"],
                        "review_sha256": hashlib.sha256(review_content).hexdigest()}
        return dict(self._result)


def collect_stdin(source_path, stream):
    """Validate the complete bounded message before creating any artifact."""
    review = SyntheticReview(source_path)
    content = stream.read(MAX_STDIN_BYTES+1)
    if not isinstance(content, bytes) or len(content) > MAX_STDIN_BYTES:
        raise ValueError("La revisión por entrada estándar excede su límite.")
    try: payload = json.loads(content)
    except (ValueError, UnicodeError, RecursionError):
        raise ValueError("La revisión requiere un JSON de eventos válido.") from None
    if not isinstance(payload, dict) or set(payload) != {"events"}:
        raise ValueError("La revisión solo recibe una lista de eventos.")
    events = payload["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= MAX_REVIEW_EVENTS:
        raise ValueError("La revisión excede el límite de eventos.")
    # Nothing is persisted until every event has passed the collector's PCM,
    # text, identifier and cumulative bounds. Arbitrary provider events are not
    # accepted by this CLI, even though collect ignores them for older callers.
    for event in events:
        kind = event.get("type") if isinstance(event, dict) else None
        if not isinstance(kind, str) or kind not in {"audio", "transcript"}:
            raise ValueError("La revisión solo recibe audio y transcripciones.")
        if kind == "transcript" and (not isinstance(event.get("source"), str) or event["source"] not in {"original", "translation"}):
            raise ValueError("La transcripción de revisión no tiene un origen válido.")
        review.collect(event)
    result = review.finish()
    return {"status": "saved", "source": review.source_metadata(), "review": result,
            "audio_persisted": True, "transcripts_persisted": True,
            "semantic_accuracy_verified": False, "naturalness_verified": False, "external_calls": 0}


def main(argv=None):
    import argparse
    class ReviewParser(argparse.ArgumentParser):
        def error(self, _message):
            raise ValueError("Argumentos de revisión no válidos.")
    parser = ReviewParser(description="Revisión local optativa de fixtures sintéticas aprobadas")
    parser.add_argument("--source", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--collect-stdin", action="store_true")
    try:
        args = parser.parse_args(argv)
        if args.preflight:
            review = SyntheticReview(args.source)
            result = {"status": "ready", "source": review.source_metadata(), "audio_persisted": False,
                      "transcripts_persisted": False, "external_calls": 0}
        else:
            result = collect_stdin(args.source, sys.stdin.buffer)
    except (ValueError, OSError, RecursionError):
        # Never echo input, paths from exceptions, transcripts, base64 or keys.
        print(json.dumps({"status": "rejected", "error": "invalid_synthetic_review", "external_calls": 0}))
        return 2
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__": sys.exit(main())
