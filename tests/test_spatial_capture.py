"""Capture packaging only: no GPU, cloud request, or ML runtime."""
import hashlib
import json
from pathlib import Path
import struct
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from pydantic import ValidationError
from services.spatial.capture import CaptureError, jpeg_size, prepare_capture


def jpeg(width=32, height=24):
    # Minimal synthetic SOF header for metadata parser tests, not a decodable photo.
    return b"\xff\xd8\xff\xc0" + struct.pack(">HBHHB", 8, 8, height, width, 0) + b"\xff\xd9"


class SpatialCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root / "room.mp4"
        self.source.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"fixture-video")
        self.probe = Mock(return_value={"duration_seconds": 9.0, "width": 1920, "height": 1080, "has_audio": True})
        self.extract = Mock(side_effect=lambda source, at, output: output.write_bytes(jpeg()))

    def make(self, output="capture", **kwargs):
        return prepare_capture(self.source, self.root / output, probe=self.probe, extract=self.extract, **kwargs)

    def test_bundle_manifest_hashes_and_planned_cloud_execution(self):
        result = self.make(reference_length_m=0.8, reference_description="Ancho medido de puerta")
        self.assertEqual(result["status"], "prepared_not_reconstructed"); self.assertEqual(result["cloud_requests"], 0)
        capture = json.loads((self.root / "capture/capture.json").read_text())
        self.assertEqual(capture["source"]["sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(capture["calibration"]["provenance"], "user_declared")
        self.assertEqual(len(capture["frames"]), 6)
        for frame in capture["frames"]:
            self.assertEqual(frame["timestamp_basis"], "requested_seek")
            self.assertEqual(frame["sha256"], hashlib.sha256((self.root/"capture"/frame["relative_path"]).read_bytes()).hexdigest())
        plan = json.loads((self.root / "capture/reconstruction-plan.json").read_text())
        self.assertFalse(plan["dispatch_enabled"]); self.assertEqual(plan["gpu_seconds_limit"], 180)
        report = json.loads((self.root / "capture/preflight.json").read_text())
        self.assertEqual(report["exact_duplicate_frames"], 5); self.assertFalse(report["quality_assessed"])
        with zipfile.ZipFile(self.root / "capture/capture-bundle.zip") as bundle:
            self.assertEqual(len(bundle.namelist()), 9)
            self.assertNotIn("source.mp4", bundle.namelist())
            self.assertTrue(all(not Path(name).is_absolute() and ".." not in name for name in bundle.namelist()))

    def test_existing_folder_is_never_overwritten(self):
        output = self.root / "capture"; output.mkdir(); (output/"keep.txt").write_text("keep")
        with self.assertRaises(CaptureError): self.make()
        self.extract.assert_not_called(); self.assertEqual((output/"keep.txt").read_text(), "keep")

    def test_invalid_length_and_capture_bounds_stop_before_decode(self):
        for value in (float("nan"), -1., 0.):
            with self.assertRaises(ValidationError): self.make(reference_length_m=value, reference_description="Puerta")
        self.probe.return_value["duration_seconds"] = 61.0
        with self.assertRaises(ValidationError): self.make()
        self.extract.assert_not_called()

    def test_extraction_failure_leaves_no_output_and_removes_snapshot(self):
        paths=[]
        def fail(source, at, target): paths.append(source); raise CaptureError("Decode failed")
        self.extract.side_effect=fail
        with self.assertRaises(CaptureError): self.make()
        self.assertFalse((self.root/"capture").exists()); self.assertFalse(paths[0].exists())
        self.assertTrue(self.source.exists())

    def test_jpeg_dimensions_and_rejection_of_bad_data(self):
        self.assertEqual(jpeg_size(jpeg(1280,720)), (1280,720))
        for invalid in (b"", b"\xff\xd8", b"notjpeg", jpeg(1281,720)):
            with self.assertRaises(CaptureError): jpeg_size(invalid)

    def test_failed_publish_never_exposes_partial_bundle(self):
        with patch("services.spatial.capture.shutil.copytree", side_effect=OSError("Disk full")):
            with self.assertRaises(OSError): self.make()
        self.assertFalse((self.root / "capture").exists())
        self.assertEqual(list(self.root.glob(".brivany-capture-*")), [])
        self.assertTrue(self.source.exists())

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'Local FFmpeg required')
    def test_single_frame_short_mp4_records_explicit_fallback_and_duplicate_warning(self):
        source=self.root/'one-frame.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=gray:size=64x48:rate=5',
            '-frames:v','1','-c:v','libx264','-pix_fmt','yuv420p','-an',str(source)],check=True,capture_output=True,timeout=15)
        prepare_capture(source,self.root/'short',frames=2)
        notes=json.loads((self.root/'short/preflight.json').read_text(encoding='utf-8'))
        self.assertTrue(any(item['fallback_seek_seconds']==0 for item in notes['sampling_observations']))
        self.assertGreater(notes['exact_duplicate_frames'],0)
        self.assertFalse(notes['heuristics']['coverage_assessed']);self.assertFalse(notes['quality_assessed'])
        self.assertEqual(notes['heuristics']['frames'][0]['status'],'measured_image_signals')

if __name__ == "__main__": unittest.main()
