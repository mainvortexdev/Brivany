"""Bounded local-only FFmpeg extraction with real decoded presentation timestamps."""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from audio import classify_audio, wav_chunks
from contracts import Limits, configured_integer

Image.MAX_IMAGE_PIXELS = 20_000_000


def folder_bytes(directory: Path) -> int:
    return sum(file.stat().st_size for file in directory.iterdir() if file.is_file())


def command(args, *, deadline, max_output=8_000_000, directory=None, max_bytes=None):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("processing_deadline")
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buffers = [bytearray(), bytearray()]
    output_lock, output_limit, read_failure = threading.Lock(), threading.Event(), threading.Event()
    def collect(stream, buffer):
        try:
            while chunk := stream.read(65536):
                with output_lock:
                    if sum(map(len, buffers)) + len(chunk) > max_output:
                        output_limit.set()
                        return
                    buffer.extend(chunk)
        except OSError:
            read_failure.set()
        finally:
            stream.close()
    readers = [threading.Thread(target=collect, args=(stream, buffer), daemon=True)
               for stream, buffer in zip((process.stdout, process.stderr), buffers)]
    for reader in readers:
        reader.start()
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("processing_deadline")
            if directory is not None and max_bytes is not None and folder_bytes(directory) > max_bytes:
                raise ValueError("aggregate_byte_limit")
            if output_limit.is_set():
                raise ValueError("command_output_limit")
            try:
                process.wait(timeout=min(0.1, remaining))
                break
            except subprocess.TimeoutExpired:
                continue
    except BaseException:
        process.kill()
        process.wait()
        for reader in readers:
            reader.join(timeout=1)
        raise
    for reader in readers:
        reader.join(timeout=max(0.1, min(1, deadline - time.monotonic())))
    if output_limit.is_set():
        raise ValueError("command_output_limit")
    if read_failure.is_set() or any(reader.is_alive() for reader in readers):
        raise ValueError("media_decode_failed")
    stdout, stderr = map(bytes, buffers)
    if process.returncode:
        raise ValueError("media_decode_failed")
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def probe(path: Path, *, deadline, count_frames=True) -> dict:
    args = ["ffprobe", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json"]
    if count_frames:
        args += ["-count_frames"]
    return json.loads(command([*args, str(path)], deadline=deadline).stdout)


def number(value, default=None):
    try:
        value = float(value)
        return value if value == value and abs(value) != float("inf") else default
    except (ValueError, TypeError):
        return default


def collage_pages(frames: list[dict], directory: Path, *, prefix: str) -> list[dict]:
    pages = []
    for offset in range(0, len(frames), 16):
        batch = frames[offset:offset + 16]
        canvas = Image.new("RGB", (4 * 240, 4 * 264), "#161b22")
        draw = ImageDraw.Draw(canvas)
        for i, frame in enumerate(batch):
            with Image.open(directory / frame["file"]) as source:
                thumbnail = ImageOps.contain(ImageOps.exif_transpose(source).convert("RGB"), (240, 240))
            x, y = i % 4 * 240, i // 4 * 264
            canvas.paste(thumbnail, (x + (240 - thumbnail.width) // 2, y + (240 - thumbnail.height) // 2))
            timestamp = frame.get("timestampMs")
            label = f"#{frame['index']}" + (f"  {timestamp / 1000:.3f}s" if timestamp is not None else "  timestamp unknown")
            draw.text((x + 6, y + 244), label, fill="white")
        file = f"{prefix}-collage-{offset // 16 + 1:03d}.jpg"
        canvas.save(directory / file, "JPEG", quality=86)
        pages.append({"file": file, "frames": [{"index": frame["index"], "timestampMs": frame.get("timestampMs")} for frame in batch]})
    return pages


def process_image(path: Path, directory: Path, *, prefix: str) -> dict:
    with Image.open(path) as original:
        if original.width * original.height > configured_integer("MEDIA_MAX_IMAGE_PIXELS", 20_000_000, 262_144, 20_000_000):
            raise ValueError("image_pixel_limit")
        width, height = original.size
        if original.getexif().get(274) in (5, 6, 7, 8):
            width, height = height, width
        dimensions = {"width": width, "height": height}
        # JPEG draft decoding and thumbnailing precede copies/RGB conversion.
        # Preserve source dimensions while avoiding multiple full-size copies.
        original.draft("RGB", (1600, 1600))
        original.thumbnail((1600, 1600))
        image = ImageOps.exif_transpose(original).convert("RGB")
        file = f"{prefix}-image.jpg"
        image.save(directory / file, "JPEG", quality=90)
    return {"kind": "image", "originalFile": path.name, **dimensions,
            "imageFiles": [{"file": file, "index": 0, "timestampMs": None}],
            "collageFiles": [], "audio": {"present": False, "tracks": []},
            "coverage": {"totalFrames": 1, "extractedFrames": 1, "complete": True, "reason": None}}


def process_video(path: Path, directory: Path, *, prefix: str, limits: Limits, deadline: float, model_path=None) -> dict:
    # Refuse playlists/concat scripts before FFmpeg can interpret local paths.
    with path.open("rb") as source:
        magic = source.read(16)
    if not (magic[4:8] == b"ftyp" or magic[:4] == b"\x1aE\xdf\xa3"):
        raise ValueError("video_container_not_allowed")
    metadata = probe(path, deadline=deadline, count_frames=False)
    videos = [stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "video"
              and not stream.get("disposition", {}).get("attached_pic")]
    audios = [stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "audio"]
    if not videos:
        raise ValueError("video_stream_missing")
    video = videos[0]
    if int(video.get("width", 0)) * int(video.get("height", 0)) > configured_integer("MEDIA_MAX_VIDEO_PIXELS", 16_777_216, 262_144, 16_777_216):
        raise ValueError("video_pixel_limit")
    duration = number(video.get("duration"), number(metadata.get("format", {}).get("duration")))
    if duration is None or duration <= 0:
        raise ValueError("video_duration_unknown")
    if duration > limits.max_duration:
        raise ValueError("video_duration_limit")
    counted = probe(path, deadline=deadline)
    video = next(stream for stream in counted.get("streams", []) if stream.get("index") == video["index"])
    count_value = number(video.get("nb_read_frames"))
    total = int(count_value) if count_value is not None else None
    # No fps resampling. showinfo emits the decoded input PTS after scaling;
    # -copyts retains its stream timeline. VFR frame timestamps remain exact.
    filter_ = (f"scale=w='if(gte(iw,ih),min({limits.frame_edge},iw),-2)':"
               f"h='if(gte(iw,ih),-2,min({limits.frame_edge},ih))',showinfo")
    decoded = command(["ffmpeg", "-hide_banner", "-nostdin", "-v", "info", "-threads", str(limits.ffmpeg_threads), "-filter_threads", "1",
                       "-protocol_whitelist", "file,pipe", "-copyts", "-i", str(path), "-map", f"0:{video['index']}",
                       "-an", "-vf", filter_, "-fps_mode", "passthrough", "-frames:v", str(limits.max_frames),
                       "-threads", str(limits.ffmpeg_threads), "-q:v", "6", str(directory / f"{prefix}-frame-%06d.jpg")], deadline=deadline,
                      directory=directory, max_bytes=limits.max_bytes)
    stamps = [(int(n), int(pts), float(seconds)) for n, pts, seconds in re.findall(
        r"\bn:\s*(\d+).*?\bpts:\s*(-?\d+).*?\bpts_time:\s*([-\d.e+]+)", decoded.stderr.decode("utf-8", "replace"))]
    files = sorted(directory.glob(f"{prefix}-frame-*.jpg"))
    if not files or len(stamps) < len(files):
        raise ValueError("frame_timestamps_missing")
    base = stamps[0][2]
    frames = [{"file": file.name, "index": stamps[i][0], "timestampMs": round((stamps[i][2] - base) * 1000, 3),
               "pts": stamps[i][1], "ptsTimeSeconds": stamps[i][2]} for i, file in enumerate(files)]
    pages = collage_pages(frames, directory, prefix=prefix)
    if folder_bytes(directory) > limits.max_bytes:
        raise ValueError("aggregate_byte_limit")
    tracks = []
    for stream in audios[:4]:
        original_file = f"{prefix}-audio-{stream['index']}.mka"
        wav_file = f"{prefix}-audio-{stream['index']}-16k.wav"
        command(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-threads", str(limits.ffmpeg_threads), "-protocol_whitelist", "file,pipe",
                 "-i", str(path), "-map", f"0:{stream['index']}", "-vn", "-c:a", "copy", str(directory / original_file)], deadline=deadline,
                directory=directory, max_bytes=limits.max_bytes)
        command(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-threads", str(limits.ffmpeg_threads), "-protocol_whitelist", "file,pipe",
                 "-i", str(path), "-map", f"0:{stream['index']}", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                 str(directory / wav_file)], deadline=deadline, directory=directory, max_bytes=limits.max_bytes)
        def interpreter_factory(**arguments):
            from ai_edge_litert.interpreter import Interpreter
            return Interpreter(**{**arguments, "num_threads": limits.ffmpeg_threads})
        classification = classify_audio(directory / wav_file, model_path=model_path, deadline=deadline,
                                        interpreter_factory=interpreter_factory)
        chunks = wav_chunks(directory / wav_file, directory, prefix=f"{prefix}-audio-{stream['index']}", classification=classification)
        if folder_bytes(directory) > limits.max_bytes:
            raise ValueError("aggregate_byte_limit")
        tracks.append({"index": stream["index"], "codec": stream.get("codec_name"), "channels": stream.get("channels"),
                       "sampleRate": stream.get("sample_rate"), "originalFile": original_file, "wav16kFile": wav_file,
                       "wav16kFiles": chunks, "classification": classification})
    complete = total is not None and len(frames) == total
    reason = None if complete else "frame_limit" if total is not None and total > len(frames) else "total_frame_count_unknown"
    if len(audios) > 4:
        reason, complete = "audio_track_limit", False
    if len(videos) > 1:
        reason, complete = "video_track_limit", False
    return {"kind": "video", "originalFile": path.name, "videoFile": path.name, "durationSeconds": duration,
            "videoTrackCount": len(videos), "extractedVideoTrack": video["index"],
            "width": video.get("width"), "height": video.get("height"), "rFrameRate": video.get("r_frame_rate"),
            "avgFrameRate": video.get("avg_frame_rate"), "timeBase": video.get("time_base"), "firstPtsTimeSeconds": base,
            "imageFiles": frames, "collageFiles": pages, "audio": {"present": bool(audios), "trackCount": len(audios), "tracks": tracks},
            "coverage": {"totalFrames": total, "extractedFrames": len(frames), "complete": complete, "reason": reason},
            "limitations": ["Extracted frames are not yet analyzed by a vision model; downstream selected-frame analysis must declare its sampling."]}
