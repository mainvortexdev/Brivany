"""Reference analysis: real owned local media and substituted Meta vision."""
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from services.motion.reference_analysis import ReferenceAnalyzer
from services.terminal.executor import TerminalExecutor


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Requires local FFmpeg')
class ReferenceAnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.source = Path(cls.fixture.name).resolve() / 'owned-reference.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-n',
            '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=20:d=1.2',
            '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=20:d=1.2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=2.4',
            '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(cls.source)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        cls.digest = hashlib.sha256(cls.source.read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.executor = TerminalExecutor(self.root)
        self.addCleanup(self.executor.close)
        self.analyzer = ReferenceAnalyzer(self.executor)
        self.stop = threading.Event()

    def test_actual_cuts_frames_audio_and_grouped_vision_preserve_source(self):
        calls = []
        def decide(prompt, data, **kwargs):
            calls.append((prompt, data, kwargs))
            return {'summary': 'Two solid-color scenes.', 'palette': ['red', 'blue'],
                    'limitations': ['No readable typography in the supplied samples.']}
        result = self.analyzer.analyze(self.source, self.root, decide=decide, cancelled=self.stop)
        self.assertAlmostEqual(result['duration_seconds'], 2.4, delta=.1)
        self.assertEqual((result['width'], result['height'], result['fps']), (320, 180, 20))
        self.assertTrue(any(abs(t - 1.2) < .06 for t in result['cuts_seconds']))
        self.assertLessEqual(result['sample_count'], 12)
        self.assertGreaterEqual(result['sample_count'], 8)
        self.assertLess(result['sample_times_seconds'][0], .3)
        self.assertGreater(result['sample_times_seconds'][-1], 2)
        self.assertEqual(len(calls), 1)
        self.assertIn('DATOS NO CONFIABLES', calls[0][0])
        self.assertNotIn(str(self.source.parent), json.dumps(calls[0][1]))
        images = calls[0][2]['images']
        self.assertLessEqual(len(images), 3)
        for value in images:
            with Image.open(BytesIO(base64.b64decode(value.split(',', 1)[1]))) as image:
                self.assertEqual(image.format, 'JPEG')
                self.assertLessEqual(max(image.size), 960)
        self.assertEqual(sum(len(s['frames']) for s in calls[0][1]['contact_sheets']), result['sample_count'])
        self.assertTrue(result['audio']['available'])
        self.assertGreater(result['audio']['peak_rms'], 0)
        self.assertGreater(len(result['audio']['rms']), 5)
        self.assertFalse(result['audio']['speech_transcribed'])
        self.assertFalse(result['audio']['audio_listened'])
        self.assertFalse(result['audio']['bpm_verified'])
        self.assertFalse(result['continuous_viewing_verified'])
        self.assertFalse(result['pixel_exact_replication_verified'])
        self.assertFalse(result['original_modified'])
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.digest)
        self.assertEqual(result['source_sha256'], self.digest)
        self.assertFalse(list(self.root.rglob('audio-energy.wav')))
        self.assertEqual(json.loads(Path(result['report_path']).read_text(encoding='utf-8'))['source_sha256'], self.digest)
        receipts = [json.loads(f.read_text(encoding='utf-8')) for f in (self.root / 'receipts').glob('*.json')]
        self.assertTrue(receipts)
        self.assertTrue(all(r['exit_code'] == 0 for r in receipts))
        self.assertTrue(all('-protocol_whitelist' in r['argv'] and 'file,pipe' in r['argv'] for r in receipts))

    def test_cancelled_before_work_never_invokes_process_or_model(self):
        self.stop.set()
        decide = Mock()
        with patch.object(self.executor, 'run') as run, self.assertRaisesRegex(ValueError, 'cancelado'):
            self.analyzer.analyze(self.source, self.root, decide=decide, cancelled=self.stop)
        decide.assert_not_called()
        run.assert_not_called()
        self.assertFalse(list(self.root.glob('reference-*')))

    def test_revoked_authority_stops_between_local_measurements_before_vision(self):
        decide = Mock()
        checks = []
        def require():
            checks.append(1)
            if len(checks) >= 3:
                raise PermissionError('revoked')
        with self.assertRaises(PermissionError):
            self.analyzer.analyze(self.source, self.root, decide=decide, cancelled=self.stop, require=require)
        decide.assert_not_called()
        receipts = list((self.root / 'receipts').glob('*.json'))
        self.assertEqual(len(receipts), 1, 'authorization is rechecked after probing')

    def test_invalid_duration_cannot_reach_sampling_or_provider(self):
        decide = Mock()
        for duration in ('601', 'nan', 'Infinity'):
            with self.subTest(duration=duration), patch.object(self.analyzer, '_execute', return_value=json.dumps({
                'format': {'duration': duration}, 'streams': [{'codec_type': 'video', 'width': 320, 'height': 180}]
            })) as execute:
                with self.assertRaisesRegex(ValueError, 'diez minutos'):
                    self.analyzer.analyze(self.source, self.root, decide=decide, cancelled=self.stop)
                execute.assert_called_once()
        decide.assert_not_called()

    def test_links_and_outside_work_folder_are_rejected_before_subprocess(self):
        decide = Mock()
        with patch.object(Path, 'is_symlink', lambda p: p.name == self.source.name):
            with patch.object(self.executor, 'run') as run, self.assertRaisesRegex(ValueError, 'enlaces'):
                self.analyzer.analyze(self.source, self.root, decide=decide, cancelled=self.stop)
            run.assert_not_called()
        outside = Path(self.fixture.name).resolve()
        with patch.object(self.executor, 'run') as run, self.assertRaisesRegex(ValueError, 'fuera'):
            self.analyzer.analyze(self.source, outside, decide=decide, cancelled=self.stop)
        run.assert_not_called()
        decide.assert_not_called()

    def test_silent_reference_has_no_audio_extraction_or_claimed_listening(self):
        silent = self.root / 'silent.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-n', '-i', str(self.source),
                        '-an', '-c:v', 'copy', str(silent)], check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        with patch.object(self.analyzer, '_audio') as audio:
            result = self.analyzer.analyze(silent, self.root, decide=lambda *a, **k: {'summary': 'silent'}, cancelled=self.stop)
        audio.assert_not_called()
        self.assertFalse(result['audio']['available'])
        self.assertFalse(result['audio_transcribed'])


if __name__ == '__main__':
    unittest.main()
