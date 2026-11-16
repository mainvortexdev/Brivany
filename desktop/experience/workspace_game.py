"""WorkSpace metrics session, created only from the Juego tool."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import ctypes
from ctypes import wintypes as W
import os
from pathlib import Path
import threading

from .presentmon import PresentMonCapture, PresentMonPackage, supports_presentmon
from .workspace_recording import CaptureSources


ROOT = Path(__file__).resolve().parents[2]
METRICS = {'fps': None, 'cpu': None, 'gpu': None, 'ram': None}
_BRIDGE_LOCK = threading.Lock()


def live_window(target):
    user = ctypes.WinDLL('user32')
    user.GetWindowThreadProcessId.argtypes = (W.HWND, ctypes.POINTER(W.DWORD))
    user.GetWindowThreadProcessId.restype = W.DWORD
    pid = W.DWORD()
    user.GetWindowThreadProcessId(target['hwnd'], ctypes.byref(pid))
    return pid.value == target['pid']


def system_counters():
    from .game_counters import SystemCounters
    return SystemCounters()


class GameMonitor:
    def __init__(self, package, *, sources=None, counters=system_counters,
                 capture=PresentMonCapture, window_alive=live_window, publish=None, interval=1):
        self.package = package
        self.sources = sources or CaptureSources()
        self.counters, self.capture, self.window_alive = counters, capture, window_alive
        self.publish = publish or (lambda *_: None)
        self.interval = interval
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.worker = None
        self.closed = False
        self.value = {'revision': 0, 'state': 'idle', 'message': '', **METRICS}

    def snapshot(self):
        with self.lock:
            return dict(self.value)

    def _update(self, target=None, **values):
        with self.lock:
            if self.cancel.is_set() and values.get('state') == 'running':
                return
            self.value.update(values)
            self.value['revision'] += 1
            snapshot = dict(self.value)
        self.publish(snapshot, target)

    def options(self):
        with self.lock:
            if self.worker:
                raise ValueError('Detén la franja para cambiar de ventana.')
            entries = self.sources.refresh()
            windows = [entry for entry in entries if entry['kind'] == 'window'
                       and self.sources.entries[entry['id']]['pid'] not in (0, os.getpid())]
        return {'windows': windows, 'ready': self.package.ready(), 'supported': supports_presentmon()}

    def start(self, token):
        if not isinstance(token, str):
            raise ValueError('Elige una ventana de juego.')
        with self.lock:
            if self.closed or self.worker:
                raise ValueError('La franja anterior aún se está cerrando.')
            target = self.sources.entries.get(token) if token else None
            if token and (not target or target['kind'] != 'window' or target['pid'] in (0, os.getpid())
                          or not self.window_alive(target)):
                raise ValueError('Actualiza la lista y elige una ventana abierta.')
            self.cancel.clear()
            self._update(target, state='starting', message='', **METRICS)
            self.worker = threading.Thread(target=self._run, args=(target,), daemon=True, name='brivany-game-counters')
            try:
                self.worker.start()
            except RuntimeError:
                self.worker = None
                self._update(state='idle', message='No se pudo abrir la franja.', **METRICS)
        return self.snapshot()

    def _run(self, target):
        source = fps_capture = None
        message = ''
        try:
            source = self.counters()
            if target and not self.cancel.is_set():
                if not self.package.ready():
                    message = 'Prepara PresentMon para medir FPS.'
                else:
                    try:
                        fps_capture = self.capture(self.package.path, target['pid'])
                    except OSError:
                        message = 'No se pudo iniciar PresentMon.'
            while not self.cancel.is_set():
                if target and not self.window_alive(target):
                    message = 'La ventana de juego se cerró.'
                    break
                if fps_capture:
                    fps, message = fps_capture.sample()
                else:
                    fps = None
                self._update(target, state='running', message=message, fps=fps, **source.sample())
                if self.cancel.wait(self.interval):
                    message = ''
                    break
        except (OSError, RuntimeError, ValueError):
            message = 'Los contadores de juego no están disponibles.'
        finally:
            try:
                if fps_capture:
                    fps_capture.close()
            finally:
                if source:
                    source.close()
                with self.lock:
                    self.worker = None
                    self._update(state='idle', message=message, **METRICS)

    def stop(self, *, wait=False):
        with self.lock:
            worker = self.worker
            if worker:
                self.cancel.set()
                self._update(state='stopping', message='', **METRICS)
        if wait and worker and worker is not threading.current_thread():
            worker.join(7)
        return self.snapshot()

    def close(self):
        with self.lock:
            self.closed = True
        self.stop(wait=True)


class WorkspaceGameBridge:
    def _game_session(self):
        with _BRIDGE_LOCK:
            if getattr(self, '_exit_requested', False):
                raise ValueError('Brivany se está cerrando.')
            service = getattr(self, '_game_monitor', None)
            if service is None:
                service = self._game_monitor = GameMonitor(
                    PresentMonPackage(DATA_ROOT / '.local' / 'tools'), publish=self._publish_game)
            return service

    def _publish_game(self, snapshot, target):
        strip = getattr(self, '_game_strip', None)
        if strip:
            strip.update(snapshot, target)

    def workspace_game_state(self):
        self._trusted()
        value = self._game_session().snapshot()
        strip = getattr(self, '_game_strip', None)
        if value['state'] == 'running' and strip and strip.error:
            value['message'] = 'No se pudo mostrar la franja de juego.'
        return value

    def workspace_game_options(self):
        self._trusted()
        return self._game_session().options()

    def workspace_game_prepare(self):
        self._trusted()
        return self._game_session().package.prepare()

    def workspace_game_start(self, token):
        self._trusted()
        service = self._game_session()
        if not self._work().active:
            raise ValueError('Abre WorkSpace para mostrar la franja.')
        dispatcher = getattr(getattr(self, '_window', None), 'native', None)
        if not dispatcher:
            raise ValueError('La franja de juego requiere Brivany Desktop en Windows.')
        with service.lock:
            if not self._work().active:
                raise ValueError('WorkSpace se está cerrando.')
            if not getattr(self, '_game_strip', None):
                from .native_game_strip import NativeGameStrip
                self._game_strip = NativeGameStrip(dispatcher)
            return service.start(token)

    def workspace_game_stop(self):
        self._trusted()
        return self._game_session().stop()

    def _stop_game_monitor(self):
        service = getattr(self, '_game_monitor', None)
        if service:
            service.stop(wait=True)
        strip = getattr(self, '_game_strip', None)
        if strip:
            self._game_strip = None
            strip.close()
