"""Explicit Windows screen/window recording. No idle capture, audio or upload."""
import atexit
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from uuid import uuid4

from desktop.experience.scripts import post_script

MAX_SECONDS = 1800
MAX_BYTES = 2 * 1024 ** 3
BUSY = {'starting', 'recording', 'stopping', 'saving'}


class CaptureSources:
    """Enumerate only on demand; opaque IDs never accept a command or file path."""
    def __init__(self):
        self.entries = {}

    def refresh(self):
        if os.name != 'nt':
            raise ValueError('La grabación de pantalla está disponible en Windows.')
        user = ctypes.WinDLL('user32', use_last_error=True)
        user.IsWindowVisible.argtypes = [wintypes.HWND]
        user.IsIconic.argtypes = [wintypes.HWND]
        user.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        old = {entry['key']: token for token, entry in self.entries.items()}
        found = {}

        def add(key, label, kind, **value):
            token = old.get(key) or uuid4().hex
            found[token] = {'id': token, 'key': key, 'label': label, 'kind': kind, **value}

        class MonitorInfo(ctypes.Structure):
            _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT),
                        ('rcWork', wintypes.RECT), ('dwFlags', wintypes.DWORD)]

        monitor_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HANDLE, wintypes.HDC,
                                              ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
        window_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.c_void_p, monitor_callback, wintypes.LPARAM]
        user.EnumWindows.argtypes = [window_callback, wintypes.LPARAM]
        screens = []

        def monitor(handle, dc, rect, data):
            info = MonitorInfo(); info.cbSize = ctypes.sizeof(info)
            if user.GetMonitorInfoW(handle, ctypes.byref(info)):
                r = info.rcMonitor
                screens.append((not bool(info.dwFlags & 1), (r.left, r.top, r.right - r.left, r.bottom - r.top)))
            return True

        def window(handle, data):
            if len(found) >= 100 or not user.IsWindowVisible(handle) or user.IsIconic(handle):
                return True
            length = user.GetWindowTextLengthW(handle)
            if not length:
                return True
            title = ctypes.create_unicode_buffer(min(length + 1, 256))
            user.GetWindowTextW(handle, title, len(title))
            rect = wintypes.RECT()
            if title.value.strip() and user.GetWindowRect(handle, ctypes.byref(rect)) and rect.right - rect.left >= 100 and rect.bottom - rect.top >= 80:
                pid = wintypes.DWORD()
                user.GetWindowThreadProcessId(handle, ctypes.byref(pid))
                add(('window', int(handle), pid.value), title.value[:160], 'window', hwnd=int(handle), pid=pid.value)
            return True

        # Pixel coordinates even if the application uses a different DPI context.
        previous = None
        dpi = getattr(user, 'SetThreadDpiAwarenessContext', None)
        if dpi:
            dpi.argtypes = [ctypes.c_void_p]; dpi.restype = ctypes.c_void_p
            previous = dpi(ctypes.c_void_p(-4))
        try:
            user.EnumDisplayMonitors(None, None, monitor_callback(monitor), 0)
            for index, (secondary, bounds) in enumerate(sorted(screens), 1):
                add(('monitor', *bounds), f'Pantalla {index} · {bounds[2]} × {bounds[3]}' + (' · principal' if not secondary else ''), 'monitor', bounds=bounds)
            user.EnumWindows(window_callback(window), 0)
        finally:
            if dpi and previous:
                dpi(previous)
        self.entries = found
        return [{k: entry[k] for k in ('id', 'label', 'kind')} for entry in found.values()]

    def arguments(self, token, fps, cursor):
        if not isinstance(token, str) or token not in self.entries:
            raise ValueError('Actualiza las fuentes y elige una pantalla o ventana.')
        entry = self.entries[token]
        args = ['-f', 'gdigrab', '-framerate', str(fps), '-draw_mouse', '1' if cursor else '0']
        if entry['kind'] == 'monitor':
            x, y, width, height = entry['bounds']
            if not 2 <= width <= 16384 or not 2 <= height <= 16384:
                raise ValueError('Esta pantalla supera el tamaño de captura admitido.')
            args += ['-offset_x', str(x), '-offset_y', str(y), '-video_size', f'{width}x{height}', '-i', 'desktop']
        else:
            user = ctypes.WinDLL('user32', use_last_error=True)
            for method in (user.IsWindow, user.IsIconic, user.IsWindowVisible):
                method.argtypes = [wintypes.HWND]
            hwnd = entry['hwnd']
            if not user.IsWindow(hwnd) or not user.IsWindowVisible(hwnd) or user.IsIconic(hwnd):
                raise ValueError('Esa ventana se cerró o está minimizada. Actualiza las fuentes.')
            user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value != entry['pid']:
                raise ValueError('La ventana cambió. Actualiza las fuentes antes de grabar.')
            args += ['-i', 'hwnd=' + str(hwnd)]
        return args, entry['label']


class ScreenRecorder:
    def __init__(self, folder=None, *, sources=None, encoder=None, publish=None,
                 popen=subprocess.Popen, run=subprocess.run, clock=time.monotonic,
                 disk_usage=shutil.disk_usage):
        self.folder = Path(folder) if folder else Path.home() / 'Videos' / 'Brivany'
        self.sources = sources or CaptureSources()
        self.encoder = encoder or (lambda: shutil.which('ffmpeg'))
        self.publish = publish or (lambda state: None)
        self.popen, self.run, self.clock, self.disk_usage = popen, run, clock, disk_usage
        self.lock = threading.RLock()
        self.process = self.worker = None
        self.finished = threading.Event(); self.finished.set()
        self.closed = False
        self.state, self.revision = 'idle', 0
        self.error = self.label = ''
        self.output = None
        self.started = self.elapsed = 0
        self.frames = 0

    def snapshot(self):
        with self.lock:
            elapsed = max(0, self.clock() - self.started) if self.state in {'starting', 'recording'} else self.elapsed
            return {'state': self.state, 'revision': self.revision, 'elapsed_ms': round(elapsed * 1000),
                    'source': self.label, 'error': self.error, 'file_name': self.output.name if self.output else None,
                    'folder': str(self.folder), 'has_file': bool(self.output and self.output.is_file()),
                    'audio': False, 'max_seconds': MAX_SECONDS, 'max_bytes': MAX_BYTES}

    def _notify(self):
        try:
            self.publish(self.snapshot())
        except Exception:
            pass  # A closed WebView must never strand the capture process.

    def choices(self):
        with self.lock:
            if self.closed:
                raise ValueError('El grabador está cerrado.')
            if self.state in BUSY:
                raise ValueError('Detén la grabación antes de cambiar la fuente.')
            return {'sources': self.sources.refresh(), 'available': bool(self.encoder()), 'folder': str(self.folder)}

    def start(self, token, fps=15, cursor=True):
        if type(fps) is not int or fps not in (15, 30) or type(cursor) is not bool:
            raise ValueError('Elige 15 o 30 fps y si quieres incluir el cursor.')
        with self.lock:
            if self.closed:
                raise ValueError('El grabador está cerrado.')
            if self.state in BUSY:
                raise ValueError('Ya hay una grabación en curso.')
            binary = self.encoder()
            if not binary:
                raise ValueError('Instala FFmpeg y reinicia Brivany para grabar.')
            arguments, label = self.sources.arguments(token, fps, cursor)
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                if self.disk_usage(self.folder).free < 256 * 1024 ** 2:
                    raise ValueError('Libera al menos 256 MB en la carpeta de grabaciones.')
                stem = 'Brivany-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid4().hex[:8]
                stage = self.folder / (stem + '.partial.mkv')
                target = self.folder / (stem + '.mp4')
                # Two encoding threads, 1080p maximum and a bounded capture lifetime.
                command = [str(binary), '-hide_banner', '-loglevel', 'error', '-nostats', '-n',
                           '-progress', 'pipe:1', '-stats_period', '0.5', *arguments,
                           '-an', '-vf', 'scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
                           '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
                           '-r', str(fps), '-fps_mode', 'cfr', '-threads', '2',
                           '-t', str(MAX_SECONDS), '-fs', str(MAX_BYTES), str(stage)]
                process = self.popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', bufsize=1,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            except OSError:
                raise ValueError('No se pudo iniciar el grabador. Revisa FFmpeg y la carpeta de destino.') from None
            self.process, self.output = process, None
            self.state, self.label, self.error = 'starting', label, ''
            self.started, self.elapsed, self.frames = self.clock(), 0, 0
            self.revision += 1; self.finished.clear()
            self.worker = threading.Thread(target=self._watch, args=(process, str(binary), stage, target),
                                           name='brivany-screen-recording', daemon=True)
            self.worker.start()
        self._notify()
        return self.snapshot()

    def _watch(self, process, binary, stage, target):
        failure = ''
        try:
            for line in process.stdout:
                if line.startswith('frame='):
                    try:
                        frames = int(line.partition('=')[2].strip())
                    except ValueError:
                        continue
                    notify = False
                    with self.lock:
                        self.frames = frames
                        if frames > 0 and self.state == 'starting':
                            self.state = 'recording'; self.revision += 1; notify = True
                    if notify:
                        self._notify()
            code = process.wait(timeout=3)
            with self.lock:
                self.elapsed = max(0, self.clock() - self.started)
                self.state = 'saving'; self.revision += 1
            self._notify()
            if self.frames and stage.is_file() and stage.stat().st_size:
                # Remux, never a second encode. Keep the MKV if saving fails.
                result = self.run([binary, '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
                    '-i', str(stage), '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', str(target)],
                    capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if result.returncode == 0 and target.is_file() and target.stat().st_size:
                    self.output = target
                    stage.unlink(missing_ok=True)
                    if code not in (0, 255):
                        failure = 'La captura se interrumpió; se recuperó el video disponible.'
                else:
                    self.output = stage
                    failure = 'El video se conserva en MKV. No se pudo preparar el MP4.'
            else:
                failure = 'No se recibieron imágenes. Comprueba la fuente y vuelve a intentarlo.'
        except (OSError, ValueError, subprocess.SubprocessError):
            if stage.is_file() and stage.stat().st_size:
                self.output = stage
            failure = 'No se pudo finalizar el MP4. El archivo parcial se conserva si hay imágenes.'
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=2)
            for stream in (process.stdin, process.stdout):
                try:
                    stream.close()
                except (OSError, AttributeError):
                    pass
            with self.lock:
                self.state = 'error' if failure else 'saved'
                self.error = failure; self.process = None; self.revision += 1
                self.finished.set()
            self._notify()

    def stop(self, timeout=8):
        with self.lock:
            process = self.process
            if self.state in {'starting', 'recording'} and process:
                self.elapsed = max(0, self.clock() - self.started)
                self.state = 'stopping'; self.revision += 1
                try:
                    process.stdin.write('q\n'); process.stdin.flush()
                except (OSError, ValueError, AttributeError):
                    pass
        self._notify()
        if process and not self.finished.wait(timeout):
            # Only terminate our own capture child, never other FFmpeg processes.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=2)
            self.finished.wait(2)
        return self.snapshot()

    def close(self):
        with self.lock:
            self.closed = True
        self.stop()
        worker = self.worker
        if worker and worker is not threading.current_thread():
            worker.join(timeout=35)


class WorkspaceRecordingBridge:
    _recording_lock = threading.RLock()

    def _recorder(self):
        with self._recording_lock:
            if getattr(self, '_exit_requested', False):
                raise ValueError('Brivany se está cerrando.')
            if not getattr(self, '_workspace_recorder', None):
                self._workspace_recorder = ScreenRecorder(publish=self._publish_recording)
                atexit.register(self._workspace_recorder.close)
            return self._workspace_recorder

    def _publish_recording(self, value):
        script = 'window.BrivanyWorkspaceRecorder?.receive(' + json.dumps(value, ensure_ascii=True) + ')'
        for window in (getattr(self, '_bar_window', None), getattr(self, '_work_window', None)):
            if window:
                post_script(window, script, 'workspace-recording')

    def _close_workspace_recording(self):
        recorder = getattr(self, '_workspace_recorder', None)
        if recorder:
            recorder.close()

    def workspace_recording_status(self):
        self._trusted()
        return self._recorder().snapshot()

    def workspace_recording_sources(self):
        self._trusted()
        return self._recorder().choices()

    def workspace_recording_start(self, source, fps=15, cursor=True):
        self._trusted()
        return self._recorder().start(source, fps, cursor)

    def workspace_recording_stop(self):
        self._trusted()
        return self._recorder().stop()

    def workspace_recording_open(self, folder=False):
        self._trusted()
        if type(folder) is not bool:
            raise ValueError('Elige el archivo o su carpeta.')
        recorder = self._recorder()
        with recorder.lock:
            path = recorder.folder if folder else recorder.output
            if path is None or not path.exists():
                raise ValueError('Todavía no hay una grabación guardada.')
            if os.name != 'nt':
                raise ValueError('Esta acción está disponible en Windows.')
            try:
                os.startfile(str(path))
            except OSError:
                raise ValueError('Windows no pudo abrir la grabación.') from None
        return {'opened': True}
