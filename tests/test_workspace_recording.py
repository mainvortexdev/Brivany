"""Recorder lifecycle and boundaries, with substituted capture and encoder."""
from pathlib import Path
from queue import Queue
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from desktop.experience.workspace_recording import CaptureSources, ScreenRecorder, WorkspaceRecordingBridge, MAX_SECONDS, MAX_BYTES


class Sources:
    def __init__(self):
        self.calls = 0

    def refresh(self):
        self.calls += 1
        return [{'id': 'owned', 'label': 'Ventana propia', 'kind': 'window'}]

    def arguments(self, token, fps, cursor):
        if token != 'owned':
            raise ValueError('unknown source')
        return ['-f', 'gdigrab', '-i', 'hwnd=123'], 'Ventana propia'


class Process:
    def __init__(self, command, frames=15, ignore_stop=False):
        self.command, self.returncode = command, None
        self.done = threading.Event()
        self.lines = Queue()
        self.ignore_stop, self.terminated, self.killed = ignore_stop, False, False
        self.writes = []
        self.stdin = SimpleNamespace(write=self.write, flush=lambda: None, close=lambda: None)
        self.stdout = self
        self.lines.put('frame=' + str(frames) + '\n')
        Path(command[-1]).write_bytes(b'owned-mkv-fixture')

    def write(self, value):
        self.writes.append(value)
        if not self.ignore_stop:
            self.finish(0)

    def finish(self, code):
        self.returncode = code; self.done.set(); self.lines.put(None)

    def __iter__(self):
        while True:
            value = self.lines.get(timeout=5)
            if value is None:
                return
            yield value

    def close(self):
        pass

    def wait(self, timeout=None):
        if not self.done.wait(timeout):
            raise subprocess.TimeoutExpired('owned-ffmpeg', timeout)
        return self.returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True; self.finish(1)

    def kill(self):
        self.killed = True; self.finish(1)


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sources = Sources(); self.processes = []; self.events = []; self.remuxes = []
        self.frames = 15; self.ignore_stop = False; self.remux_code = 0
        def popen(command, **kwargs):
            self.assertFalse(kwargs.get('shell', False))
            child = Process(command, self.frames, self.ignore_stop); self.processes.append(child); return child
        def remux(command, **kwargs):
            self.remuxes.append(command)
            if self.remux_code == 0:
                Path(command[-1]).write_bytes(b'owned-mp4-fixture')
            return SimpleNamespace(returncode=self.remux_code)
        self.recorder = ScreenRecorder(Path(self.temp.name) / 'recordings', sources=self.sources,
            encoder=lambda: 'ffmpeg.exe', publish=self.events.append, popen=popen, run=remux,
            disk_usage=lambda folder: SimpleNamespace(free=1024 ** 3))
        self.addCleanup(self.recorder.close)

    def wait_state(self, state):
        until = time.monotonic() + 2
        while time.monotonic() < until:
            if self.recorder.snapshot()['state'] == state:
                return
            time.sleep(.005)
        self.fail(self.recorder.snapshot())

    def test_idle_does_not_capture_spawn_enumerate_or_create_folder(self):
        for _ in range(10):
            result = self.recorder.snapshot()
        self.assertEqual(result['state'], 'idle')
        self.assertIsNone(self.recorder.worker)
        self.assertFalse(self.recorder.folder.exists())
        self.assertEqual(self.processes, []); self.assertEqual(self.sources.calls, 0)

    def test_success_stops_our_child_remuxes_without_reencoding_and_returns_file(self):
        self.recorder.choices(); self.recorder.start('owned', 15, False); self.wait_state('recording')
        command = self.processes[0].command
        self.assertIn('-an', command); self.assertIn('-n', command)
        self.assertIn(str(MAX_SECONDS), command); self.assertIn(str(MAX_BYTES), command)
        self.assertEqual(command[command.index('-threads') + 1], '2')
        self.assertEqual(command[command.index('-r') + 1], '15')
        self.assertEqual(command[command.index('-fps_mode') + 1], 'cfr')
        result = self.recorder.stop()
        self.assertEqual(result['state'], 'saved'); self.assertTrue(result['has_file']); self.assertFalse(result['audio'])
        self.assertEqual(self.processes[0].writes, ['q\n']); self.assertFalse(self.processes[0].terminated)
        self.assertIn('copy', self.remuxes[0]); self.assertNotIn('libx264', self.remuxes[0])
        self.assertEqual(len(list(self.recorder.folder.glob('*.mp4'))), 1)
        self.assertEqual(list(self.recorder.folder.glob('*.mkv')), [])
        self.assertTrue(any(event['state'] == 'saving' for event in self.events))

    def test_bad_options_and_arbitrary_input_never_spawn(self):
        for fps, cursor in [(True, True), (60, True), ('15', True), (15, 'yes')]:
            with self.assertRaises(ValueError):
                self.recorder.start('owned', fps, cursor)
        for token in [None, '../desktop', 'https://example.test', 'C:/file.mp4', 'unknown']:
            with self.assertRaises(ValueError):
                self.recorder.start(token)
        self.assertEqual(self.processes, [])

    def test_duplicate_start_and_refresh_blocked_while_recording(self):
        self.recorder.start('owned'); self.wait_state('recording')
        with self.assertRaises(ValueError):
            self.recorder.start('owned')
        with self.assertRaises(ValueError):
            self.recorder.choices()
        self.assertEqual(len(self.processes), 1)

    def test_remux_failure_keeps_original_mkv_for_recovery(self):
        self.remux_code = 1
        self.recorder.start('owned'); self.wait_state('recording')
        result = self.recorder.stop()
        self.assertEqual(result['state'], 'error'); self.assertTrue(result['has_file'])
        self.assertTrue(result['file_name'].endswith('.partial.mkv'))
        self.assertTrue(self.recorder.output.is_file()); self.assertIn('MKV', result['error'])

    def test_failed_capture_never_claims_saved_video(self):
        self.frames = 0
        self.recorder.start('owned'); self.processes[0].finish(1)
        self.assertTrue(self.recorder.finished.wait(2))
        result = self.recorder.snapshot()
        self.assertEqual(result['state'], 'error'); self.assertFalse(result['has_file'])
        self.assertIn('imágenes', result['error']); self.assertEqual(self.remuxes, [])

    def test_stop_timeout_only_terminates_the_owned_child_and_preserves_partial(self):
        self.ignore_stop = True
        self.recorder.start('owned'); self.wait_state('recording')
        result = self.recorder.stop(timeout=.01)
        self.assertTrue(self.processes[0].terminated); self.assertTrue(self.recorder.finished.is_set())
        self.assertTrue(result['has_file']); self.assertEqual(result['state'], 'error')

    def test_missing_encoder_disk_full_or_spawn_error_do_not_start_capture(self):
        self.recorder.encoder = lambda: None
        with self.assertRaisesRegex(ValueError, 'FFmpeg'):
            self.recorder.start('owned')
        self.recorder.encoder = lambda: 'ffmpeg.exe'
        self.recorder.disk_usage = lambda folder: SimpleNamespace(free=0)
        with self.assertRaisesRegex(ValueError, '256 MB'):
            self.recorder.start('owned')
        self.recorder.disk_usage = lambda folder: SimpleNamespace(free=1024 ** 3)
        self.recorder.popen = Mock(side_effect=OSError())
        with self.assertRaisesRegex(ValueError, 'iniciar'):
            self.recorder.start('owned')
        self.assertEqual(self.recorder.snapshot()['state'], 'idle'); self.assertEqual(self.processes, [])

    def test_close_finishes_capture_and_rejects_future_start(self):
        self.recorder.start('owned'); self.wait_state('recording'); self.recorder.close()
        self.assertFalse(self.recorder.worker.is_alive()); self.assertIsNone(self.recorder.process)
        self.assertEqual(self.recorder.snapshot()['state'], 'saved')
        with self.assertRaises(ValueError):
            self.recorder.start('owned')

    def test_screen_arguments_keep_negative_coordinates_as_individual_args(self):
        sources = CaptureSources()
        sources.entries['owned'] = {'label': 'Pantalla propia', 'kind': 'monitor', 'bounds': (-1920, -100, 1920, 1080)}
        args, label = sources.arguments('owned', 30, False)
        self.assertEqual(args[args.index('-offset_x') + 1], '-1920')
        self.assertEqual(args[args.index('-draw_mouse') + 1], '0')
        self.assertEqual(args[-2:], ['-i', 'desktop'])
        for token in (None, [], 'desktop', 'owned; command'):
            with self.assertRaises(ValueError):
                sources.arguments(token, 15, True)

    def test_public_bridge_checks_trust_before_native_or_disk_access(self):
        bridge = WorkspaceRecordingBridge(); bridge._trusted = Mock(side_effect=PermissionError('untrusted'))
        for method, args in [('workspace_recording_status', ()), ('workspace_recording_sources', ()),
                             ('workspace_recording_start', ('owned',)), ('workspace_recording_stop', ()),
                             ('workspace_recording_open', (False,))]:
            with self.subTest(method=method), self.assertRaises(PermissionError):
                getattr(bridge, method)(*args)
        self.assertFalse(hasattr(bridge, '_workspace_recorder'))

    def test_shutdown_cannot_create_a_late_recorder(self):
        bridge = WorkspaceRecordingBridge(); bridge._trusted = lambda: None; bridge._exit_requested = True
        with self.assertRaisesRegex(ValueError, 'cerrando'):
            bridge.workspace_recording_start('owned')
        self.assertFalse(hasattr(bridge, '_workspace_recorder'))

    def test_broken_progress_pipe_still_terminates_owned_capture(self):
        class BrokenStream:
            def __iter__(self):
                raise OSError('fixture broken pipe')
            def close(self):
                pass
        original = self.recorder.popen
        def popen(command, **kwargs):
            child = original(command, **kwargs); child.stdout = BrokenStream(); return child
        self.recorder.popen = popen
        self.recorder.start('owned'); self.assertTrue(self.recorder.finished.wait(2))
        self.assertTrue(self.processes[0].terminated)
        self.assertIsNone(self.recorder.process)
        self.assertEqual(self.recorder.snapshot()['state'], 'error')

    def test_bridge_can_only_open_the_owned_result_or_folder(self):
        bridge = WorkspaceRecordingBridge(); bridge._trusted = lambda: None; bridge._workspace_recorder = self.recorder
        with self.assertRaises(ValueError):
            bridge.workspace_recording_open('C:/arbitrary-file')
        with self.assertRaises(ValueError):
            bridge.workspace_recording_open()
        self.recorder.start('owned'); self.wait_state('recording'); self.recorder.stop()
        with patch('desktop.experience.workspace_recording.os.name', 'nt'), patch('desktop.experience.workspace_recording.os.startfile', create=True) as launch:
            bridge.workspace_recording_open(); launch.assert_called_with(str(self.recorder.output))
            bridge.workspace_recording_open(True); launch.assert_called_with(str(self.recorder.folder))


if __name__ == '__main__':
    unittest.main()
