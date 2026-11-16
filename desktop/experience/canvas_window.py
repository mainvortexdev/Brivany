"""On-demand drawing window. PNGs leave memory only on Copy or Export."""
import base64
import binascii
import ctypes
from ctypes import wintypes
import io
import os
from pathlib import Path
import tempfile
import threading
from urllib.parse import urlsplit

from .scripts import post_script
from .workspace_controls import _clipboard_api

MAX_PNG = 16 * 1024 * 1024
PAGE = '/workspace-canvas'


def decode_png(value, include_dib=True):
    """Bound the decoded allocation and remove metadata before native output."""
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,') or len(value) > (MAX_PNG + 2) // 3 * 4 + 22:
        raise ValueError('El dibujo debe ser un PNG de hasta 16 MiB.')
    try:
        raw = base64.b64decode(value[22:], validate=True)
        if len(raw) > MAX_PNG or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError()
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as image:
            w, h = image.size
            if image.format != 'PNG' or not 1 <= w <= 4096 or not 1 <= h <= 4096 or w * h > 8388608 or getattr(image, 'n_frames', 1) != 1:
                raise ValueError()
            image.load()
            rgba = image.convert('RGBA')
            rgb = Image.new('RGB', image.size, 'white')
            rgb.paste(rgba, mask=rgba.getchannel('A'))
            rgba.close()
        png, bmp = io.BytesIO(), io.BytesIO()
        try:
            rgb.save(png, format='PNG')
            if include_dib:
                rgb.save(bmp, format='BMP')
            return png.getvalue(), bmp.getvalue()[14:]
        finally:
            rgb.close()
    except (OSError, ValueError, binascii.Error, SyntaxError) as error:
        raise ValueError('No se pudo leer el PNG del lienzo.') from error


def copy_png(png, dib):
    """PNG for fidelity and CF_DIB for Windows apps that expect a bitmap."""
    user, kernel = _clipboard_api()
    user.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    user.RegisterClipboardFormatW.restype = wintypes.UINT
    formats = [user.RegisterClipboardFormatW('PNG'), user.RegisterClipboardFormatW('image/png'), 8]
    if not all(formats):
        raise ValueError('Windows no pudo preparar el formato PNG.')
    owner = user.CreateWindowExW(0, 'STATIC', 'Brivany PNG', 0, 0, 0, 0, 0, wintypes.HWND(-3), None, None, None)
    if not owner:
        raise ValueError('No se pudo preparar el portapapeles.')
    handles = []
    try:
        # Prepare everything before clearing the clipboard. Ownership transfers
        # only for successful SetClipboardData calls.
        for data in (png, png, dib):
            handle = kernel.GlobalAlloc(0x0002, len(data))
            if not handle:
                raise ValueError('No hay memoria para copiar el dibujo.')
            handles.append(handle)
            pointer = kernel.GlobalLock(handle)
            if not pointer:
                raise ValueError('No se pudo preparar el dibujo.')
            try:
                ctypes.memmove(pointer, data, len(data))
            finally:
                kernel.GlobalUnlock(handle)
        if not user.OpenClipboard(owner):
            raise ValueError('El portapapeles está ocupado. Vuelve a intentarlo.')
        try:
            if not user.EmptyClipboard():
                raise ValueError('Windows no pudo copiar el dibujo.')
            succeeded = []
            for i, fmt in enumerate(formats):
                if user.SetClipboardData(fmt, handles[i]):
                    handles[i] = None; succeeded.append(fmt)
            if formats[0] not in succeeded or 8 not in succeeded:
                raise ValueError('Windows no pudo completar la copia. Vuelve a intentarlo.')
        finally:
            user.CloseClipboard()
    finally:
        for handle in handles:
            if handle:
                kernel.GlobalFree(handle)
        user.DestroyWindow(owner)


def save_png(path, png):
    path = Path(path)
    if not path.is_absolute() or path.suffix.lower() != '.png':
        raise ValueError('Elige un archivo con extensión .png.')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.brivany-', suffix='.tmp', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(png); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


class CanvasAPI:
    """The editor gets only its own window/output methods, never the root API."""
    def __init__(self, manager):
        self._manager = manager
        self._window = None

    def _trusted(self):
        manager = self._manager
        with manager.lock:
            if manager.closed or manager.api is not self or not self._window or manager.window is not self._window:
                raise ValueError('El lienzo ya está cerrado.')
        parsed, base = urlsplit(self._window.get_current_url() or ''), urlsplit(manager.base)
        if (parsed.scheme, parsed.hostname, parsed.port) != (base.scheme, base.hostname, base.port) or parsed.path != PAGE or parsed.username or parsed.password:
            raise ValueError('Acción disponible solo desde el lienzo de Brivany.')
        return manager

    def canvas_ready(self):
        manager = self._trusted(); manager.ready(self)
        return {'ready': True}

    def canvas_changed(self, revision, dirty):
        manager = self._trusted()
        if type(revision) is not int or not 0 <= revision <= 2 ** 53 or type(dirty) is not bool:
            raise ValueError('Estado del lienzo no válido.')
        with manager.lock:
            if revision >= manager.revision:
                manager.revision = revision; manager.dirty = dirty
        return {'ok': True}

    def _output(self, value, revision, include_dib=True):
        manager = self._trusted()
        if type(revision) is not int or revision != manager.revision:
            raise ValueError('El dibujo cambió. Vuelve a intentarlo.')
        png, dib = decode_png(value, include_dib=include_dib)
        self._trusted()
        return manager, png, dib

    def canvas_copy(self, value, revision):
        manager, png, dib = self._output(value, revision)
        with manager.output_lock:
            self._trusted(); copy_png(png, dib)
        with manager.lock:
            if revision == manager.revision:
                manager.dirty = False
        return {'copied': True}

    def canvas_export(self, value, revision):
        manager, png, _ = self._output(value, revision, include_dib=False)
        import webview
        with manager.output_lock:
            self._trusted()
            choice = self._window.create_file_dialog(webview.FileDialog.SAVE, save_filename='Brivany-dibujo.png', file_types=('Imagen PNG (*.png)',))
            if not choice:
                return {'saved': False}
            self._trusted()
            save_png(choice[0] if isinstance(choice, (tuple, list)) else choice, png)
        with manager.lock:
            if revision == manager.revision:
                manager.dirty = False
        return {'saved': True}

    def canvas_close_decision(self, decision):
        manager = self._trusted()
        if decision not in ('cancel', 'discard', 'close'):
            raise ValueError('Acción no válida.')
        if decision == 'cancel':
            with manager.lock:
                manager.continuation = None
            return {'closed': False}
        if decision == 'close' and manager.dirty:
            raise ValueError('Guarda o descarta el dibujo antes de cerrar.')
        manager.destroy()
        return {'closed': True}

    def canvas_window(self, action):
        self._trusted()
        if action not in ('minimize', 'maximize', 'restore'):
            raise ValueError('Acción de ventana no válida.')
        getattr(self._window, action)()
        return {'ok': True}


class CanvasWindow:
    def __init__(self, base, session=None):
        self.base, self.session = base, session
        self.lock, self.output_lock = threading.RLock(), threading.Lock()
        self.window = self.api = self.guard = self.continuation = None
        self.creating = self.is_ready = self.allow_close = self.closed = self.dirty = False
        self.revision = self.epoch = 0

    def open(self):
        import webview
        with self.lock:
            if self.closed:
                raise ValueError('Brivany se está cerrando.')
            if self.window:
                window = self.window
            elif self.creating:
                return {'opened': True}
            else:
                window = None; self.creating = True; epoch = self.epoch
        if window:
            window.restore(); window.show()
            return {'opened': True}
        api = CanvasAPI(self)
        try:
            url = self.session.entry(self.base, PAGE) if self.session else self.base + PAGE
            window = webview.create_window('Brivany · Lienzo', url, js_api=api, width=1100, height=760,
                min_size=(520, 420), frameless=True, easy_drag=False, hidden=True, background_color='#f5f5f7')
            with self.lock:
                if self.closed or epoch != self.epoch:
                    self.creating = False; window.destroy(); return {'opened': False}
                self.window, self.api = window, api; api._window = window
                self.creating = False; self.allow_close = self.is_ready = self.dirty = False; self.revision = 0
            if self.session:
                self.session.bind_window(window, self.base)
            window.events.closing += self._closing
            window.events.closed += lambda: self._closed(window)
            def loaded():
                post_script(window, 'window.BrivanyCanvas?.nativeReady()', 'canvas-ready')
            window.events.loaded += loaded
            with self.lock:
                if not self.is_ready:
                    self.guard = threading.Timer(12, self.destroy); self.guard.daemon = True; self.guard.start()
            if window.events.loaded.is_set():
                loaded()
            return {'opened': True}
        except Exception:
            with self.lock:
                self.creating = False
            if window:
                self.destroy()
            raise

    def ready(self, api):
        with self.lock:
            if self.api is not api or self.closed:
                return
            self.is_ready = True
            if self.guard:
                self.guard.cancel(); self.guard = None
            window = self.window
        window.show()

    def _closing(self):
        with self.lock:
            if self.allow_close:
                return None
        self.request_close()
        return False

    def request_close(self, continuation=None):
        with self.lock:
            if self.window is None:
                if self.creating:
                    self.epoch += 1
                return False
            self.continuation = continuation
            window, ready = self.window, self.is_ready
        if not ready:
            self.destroy()
        else:
            window.restore(); window.show()
            post_script(window, 'window.BrivanyCanvas?.requestClose()', 'canvas-close')
        return True

    def destroy(self):
        with self.lock:
            self.allow_close = True
            if self.guard:
                self.guard.cancel(); self.guard = None
            window = self.window
        if window:
            window.destroy()

    def _closed(self, window):
        with self.lock:
            if self.window is not window:
                return
            self.window = self.api = None; self.is_ready = False
            if self.guard:
                self.guard.cancel(); self.guard = None
            continuation, self.continuation = self.continuation, None
        if continuation:
            threading.Thread(target=continuation, daemon=True, name='canvas-exit').start()

    def close(self):
        with self.lock:
            self.closed = True; self.epoch += 1; self.continuation = None
        self.destroy()


class WorkspaceCanvasBridge:
    _canvas_lock = threading.RLock()

    def workspace_canvas_open(self):
        self._trusted()
        with self._canvas_lock:
            if getattr(self, '_exit_requested', False):
                raise ValueError('Brivany se está cerrando.')
            if not getattr(self, '_canvas_window', None):
                self._canvas_window = CanvasWindow(self._base, getattr(self, '_desktop_ui_session', None))
            manager = self._canvas_window
        return manager.open()

    def _request_canvas_exit(self, continuation):
        manager = getattr(self, '_canvas_window', None)
        return bool(manager and manager.request_close(continuation))

    def _close_canvas(self):
        manager = getattr(self, '_canvas_window', None)
        if manager:
            manager.close()
