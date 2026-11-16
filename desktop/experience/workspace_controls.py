"""Explicit local controls. No clipboard monitoring, remote traffic or disk history."""
import ctypes
from ctypes import wintypes
import os
import threading
from uuid import uuid4

CONTROL_URIS = {'sound': 'ms-settings:sound', 'display': 'ms-settings:display',
    'wifi': 'ms-settings:network-wifi', 'bluetooth': 'ms-settings:bluetooth',
    'notifications': 'ms-settings:notifications', 'privacy': 'ms-settings:privacy-microphone',
    'screenshot': 'ms-screenclip:'}
MAX_CLIPBOARD_CHARS = 16384
MAX_CLIPBOARD_ITEMS = 10


def _clipboard_api():
    if os.name != 'nt':
        raise ValueError('El portapapeles nativo está disponible en Windows.')
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    user.OpenClipboard.argtypes = [wintypes.HWND]
    user.OpenClipboard.restype = wintypes.BOOL
    user.CloseClipboard.argtypes = []
    user.CloseClipboard.restype = wintypes.BOOL
    user.EmptyClipboard.argtypes = []
    user.EmptyClipboard.restype = wintypes.BOOL
    user.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    user.IsClipboardFormatAvailable.restype = wintypes.BOOL
    user.GetClipboardData.argtypes = [wintypes.UINT]
    user.GetClipboardData.restype = wintypes.HANDLE
    user.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user.SetClipboardData.restype = wintypes.HANDLE
    user.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
        wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p]
    user.CreateWindowExW.restype = wintypes.HWND
    user.DestroyWindow.argtypes = [wintypes.HWND]
    user.DestroyWindow.restype = wintypes.BOOL
    kernel.GlobalSize.argtypes = [wintypes.HGLOBAL]
    kernel.GlobalSize.restype = ctypes.c_size_t
    kernel.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel.GlobalLock.restype = ctypes.c_void_p
    kernel.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel.GlobalUnlock.restype = wintypes.BOOL
    kernel.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel.GlobalFree.restype = wintypes.HGLOBAL
    return user, kernel


def read_clipboard_text():
    user, kernel = _clipboard_api()
    if not user.OpenClipboard(None):
        raise ValueError('El portapapeles está ocupado. Vuelve a intentarlo.')
    try:
        if not user.IsClipboardFormatAvailable(13):
            raise ValueError('El portapapeles no contiene texto.')
        handle = user.GetClipboardData(13)
        size = kernel.GlobalSize(handle)
        if not handle or not size or size > (MAX_CLIPBOARD_CHARS + 1) * 2:
            raise ValueError('Cada captura admite hasta 16.384 caracteres de texto.')
        pointer = kernel.GlobalLock(handle)
        if not pointer:
            raise ValueError('No se pudo leer el portapapeles.')
        try:
            return ctypes.wstring_at(pointer, min(size // 2, MAX_CLIPBOARD_CHARS + 1)).split('\0', 1)[0]
        finally:
            kernel.GlobalUnlock(handle)
    finally:
        user.CloseClipboard()


def copy_clipboard_text(text):
    user, kernel = _clipboard_api()
    data = (text + '\0').encode('utf-16-le')
    # EmptyClipboard needs a real owner; no visible window or clipboard watcher.
    owner = user.CreateWindowExW(0, 'STATIC', 'Brivany clipboard', 0, 0, 0, 0, 0,
                                wintypes.HWND(-3), None, None, None)
    if not owner:
        raise ValueError('No se pudo preparar el portapapeles.')
    handle = kernel.GlobalAlloc(0x0002, len(data))
    if not handle:
        user.DestroyWindow(owner)
        raise ValueError('No se pudo preparar el texto.')
    transferred = False
    try:
        pointer = kernel.GlobalLock(handle)
        if not pointer:
            raise ValueError('No se pudo preparar el texto.')
        try:
            ctypes.memmove(pointer, data, len(data))
        finally:
            kernel.GlobalUnlock(handle)
        if not user.OpenClipboard(owner):
            raise ValueError('El portapapeles está ocupado. Vuelve a intentarlo.')
        try:
            if not user.EmptyClipboard() or not user.SetClipboardData(13, handle):
                raise ValueError('Windows no pudo copiar el texto.')
            transferred = True
        finally:
            user.CloseClipboard()
    finally:
        if not transferred:
            kernel.GlobalFree(handle)
        user.DestroyWindow(owner)


def process_resources():
    """Current Python host only; do not mislabel as system or entire WebView tree."""
    times = os.times()
    rss = None
    if os.name == 'nt':
        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD),
                *[(name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
                'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
                'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.WinDLL('psapi', use_last_error=True)
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            rss = counters.WorkingSetSize
    return {'pid': os.getpid(), 'cpu_seconds': round(times.user + times.system, 3),
        'rss_bytes': rss, 'scope': 'python_host_only', 'includes_webview2': False,
        'message': 'Proceso anfitrión Python de Brivany. No incluye WebView2 ni otros procesos.',
        'measurement': 'on_demand_no_background_sampling'}


class WorkspaceControlsBridge:
    _clipboard_init_lock = threading.RLock()

    def _clipboard_state(self):
        with self._clipboard_init_lock:
            if not hasattr(self, '_workspace_clipboard'):
                self._workspace_clipboard = []
            return self._workspace_clipboard

    def workspace_control_open(self, action):
        self._trusted()
        if not isinstance(action, str) or action not in CONTROL_URIS:
            raise ValueError('Control no disponible.')
        if os.name != 'nt':
            raise ValueError('Estos accesos están disponibles en Windows.')
        try:
            os.startfile(CONTROL_URIS[action])
        except OSError:
            raise ValueError('Windows no pudo abrir esta herramienta.') from None
        return {'opened': True, 'action': action, 'changed_setting': False,
                'message': 'Herramienta de Windows abierta. Elige allí el cambio o la captura.'}

    def workspace_clipboard_state(self):
        self._trusted()
        with self._clipboard_init_lock:
            return {'items': [dict(item) for item in self._clipboard_state()],
                    'limit': MAX_CLIPBOARD_ITEMS, 'monitoring': False, 'persisted': False}

    def workspace_clipboard_read(self):
        self._trusted()
        text = read_clipboard_text()
        if not isinstance(text, str) or not text.strip():
            raise ValueError('El portapapeles no contiene texto utilizable.')
        if len(text) > MAX_CLIPBOARD_CHARS:
            raise ValueError('Cada captura admite hasta 16.384 caracteres de texto.')
        with self._clipboard_init_lock:
            items = self._clipboard_state()
            if not items or items[0]['text'] != text:
                items.insert(0, {'id': uuid4().hex, 'text': text})
                del items[MAX_CLIPBOARD_ITEMS:]
            return self.workspace_clipboard_state()

    def workspace_clipboard_copy(self, identifier):
        self._trusted()
        with self._clipboard_init_lock:
            item = next((item for item in self._clipboard_state()
                         if isinstance(identifier, str) and item['id'] == identifier), None)
            if item is None:
                raise ValueError('Ese texto ya no está en el historial de esta sesión.')
            copy_clipboard_text(item['text'])
            return {'copied': True}

    def workspace_clipboard_clear(self):
        self._trusted()
        with self._clipboard_init_lock:
            self._clipboard_state().clear()
            return {'items': [], 'limit': MAX_CLIPBOARD_ITEMS, 'monitoring': False,
                    'persisted': False, 'system_clipboard_changed': False}

    def workspace_process_resources(self):
        self._trusted()
        return process_resources()
