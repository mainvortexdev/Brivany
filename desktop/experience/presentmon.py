"""Pinned PresentMon console, bounded displayed-frame samples, named ETW capture."""
from collections import deque
import csv
import hashlib
import math
import os
from pathlib import Path
import platform
import subprocess
import threading
import time
from urllib.request import urlopen
from uuid import uuid4


NAME = 'PresentMon-2.6.0-x64.exe'
RELEASE = 'https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/' + NAME
SIZE = 980320
SHA256 = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af'
COLUMNS = {'processid', 'swapchainaddress', 'dropped', 'msbetweendisplaychange'}
PERMISSION_ERROR = 'Windows requiere permisos de registro de rendimiento para medir FPS.'


def supports_presentmon():
    return os.name == 'nt' and platform.machine().upper() in {'AMD64', 'X86_64', 'ARM64'}


class PresentMonPackage:
    def __init__(self, folder):
        self.path = Path(folder) / NAME
        self.lock = threading.Lock()

    def ready(self):
        try:
            with self.path.open('rb') as source:
                data = source.read(SIZE + 1)
            return len(data) == SIZE and hashlib.sha256(data).hexdigest() == SHA256
        except OSError:
            return False

    def prepare(self):
        if not supports_presentmon():
            raise ValueError('La captura de FPS requiere Windows de 64 bits.')
        if not self.lock.acquire(blocking=False):
            raise ValueError('La descarga de PresentMon ya está en curso.')
        temporary = None
        try:
            if self.ready():
                return
            with urlopen(RELEASE, timeout=12) as response:
                data = response.read(SIZE + 1)
            if len(data) != SIZE or hashlib.sha256(data).hexdigest() != SHA256:
                raise ValueError('La descarga de PresentMon no coincide con la versión verificada.')
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_name(self.path.name + '.' + uuid4().hex + '.tmp')
            with temporary.open('xb') as output:
                output.write(data)
            temporary.replace(self.path)
        except OSError:
            raise ValueError('No se pudo descargar PresentMon desde GitHub.') from None
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
            self.lock.release()


class DisplayFrames:
    def __init__(self, pid):
        self.pid = str(pid)
        self.columns = None
        self.chains = {}
        self.lock = threading.Lock()

    def add(self, line, now):
        if not line or len(line) > 4096:
            return
        row = next(csv.reader((line,)), [])
        if row and row[0].lstrip('\ufeff').lower() == 'application':
            names = [name.lower() for name in row]
            if COLUMNS.issubset(names):
                self.columns = {column: names.index(column) for column in COLUMNS}
                return
        if not self.columns or len(row) <= max(self.columns.values()):
            return
        if row[self.columns['processid']] != self.pid or row[self.columns['dropped']] != '0':
            return
        chain = row[self.columns['swapchainaddress']]
        try:
            interval = float(row[self.columns['msbetweendisplaychange']])
        except ValueError:
            return
        if not chain or not math.isfinite(interval) or not 0.2 <= interval <= 3000:
            return
        with self.lock:
            if chain not in self.chains and len(self.chains) >= 16:
                oldest = min(self.chains, key=lambda key: self.chains[key][-1][0])
                del self.chains[oldest]
            self.chains.setdefault(chain, deque(maxlen=3072)).append((now, interval))

    def fps(self, now):
        with self.lock:
            for chain, frames in list(self.chains.items()):
                while frames and now - frames[0][0] > 2:
                    frames.popleft()
                if not frames:
                    del self.chains[chain]
            frames = max(self.chains.values(), key=len, default=())
            if len(frames) < 2:
                return None
            return round(1000 * len(frames) / sum(interval for _, interval in frames))


class PresentMonCapture:
    def __init__(self, executable, pid):
        self.executable = str(executable)
        self.session = 'BrivanyGame_' + uuid4().hex
        self.frames = DisplayFrames(pid)
        self.message = ''
        self.flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        self.process = subprocess.Popen([
            self.executable, '--process_id', str(pid), '--session_name', self.session,
            '--v1_metrics', '--output_stdout', '--no_console_stats', '--no_track_input',
            '--no_track_gpu', '--exclude_dropped',
        ], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='replace', creationflags=self.flags)
        self.readers = [threading.Thread(target=read, daemon=True, name=name) for read, name in (
            (self._read_frames, 'brivany-present-frames'), (self._read_status, 'brivany-present-status'))]
        for worker in self.readers:
            worker.start()

    def _read_frames(self):
        for line in iter(lambda: self.process.stdout.readline(4097), ''):
            if line.endswith('\n'):
                self.frames.add(line, time.monotonic())

    def _read_status(self):
        for line in iter(lambda: self.process.stderr.readline(1024), ''):
            if 'failed to start trace session: access denied' in line.lower():
                self.message = PERMISSION_ERROR

    def sample(self):
        result = self.process.poll()
        if result is not None:
            self.readers[1].join(.1)
            return None, self.message or 'La captura de FPS se cerró.'
        fps = self.frames.fps(time.monotonic())
        return fps, '' if fps is not None else 'Esperando fotogramas de la ventana.'

    def close(self):
        # A named ETW session has its own lifetime. Stop only the session we created.
        command = [self.executable, '--session_name', self.session, '--terminate_existing_session']
        def stop_trace():
            try:
                subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=2, creationflags=self.flags, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
        if self.process.poll() is None:
            stop_trace()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
                stop_trace()
        for reader in self.readers:
            reader.join(1)
        self.process.stdout.close()
        self.process.stderr.close()
