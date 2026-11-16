"""Mute the Windows communications input without opening an audio stream."""
from contextlib import contextmanager
import ctypes as C
from ctypes import wintypes as W
import os
import threading
from uuid import uuid4

from .audio_sessions import GUID, call, release
from .scripts import post_script

SCOPE = 'windows_default_communications_input'


@contextmanager
def communications_endpoint():
    if os.name != 'nt':
        raise OSError('El control del micrófono requiere Windows.')
    ole = C.WinDLL('ole32')
    ole.CoInitializeEx.argtypes = [C.c_void_p, W.DWORD]
    ole.CoInitializeEx.restype = C.c_long
    ole.CoUninitialize.argtypes = []
    ole.CoUninitialize.restype = None
    ole.CoCreateInstance.argtypes = [C.POINTER(GUID), C.c_void_p, W.DWORD, C.POINTER(GUID), C.POINTER(C.c_void_p)]
    ole.CoCreateInstance.restype = C.c_long
    ole.CoTaskMemFree.argtypes = [C.c_void_p]
    ole.CoTaskMemFree.restype = None
    apartment = ole.CoInitializeEx(None, 0)
    # An existing STA can use these interfaces on the calling thread as well.
    if apartment < 0 and apartment & 0xFFFFFFFF != 0x80010106:
        raise OSError('No se pudo consultar el micrófono de Windows.')

    enumerator, device, volume, raw_id = (C.c_void_p() for _ in range(4))
    try:
        clsid = GUID('BCDE0395-E52F-467C-8E3D-C4579291692E')
        iid = GUID('A95664D2-9614-4F35-A746-DE8DB63617E6')
        if ole.CoCreateInstance(C.byref(clsid), None, 1, C.byref(iid), C.byref(enumerator)) < 0:
            raise OSError('No se pudo consultar el micrófono de Windows.')
        # IMMDeviceEnumerator::GetDefaultAudioEndpoint(eCapture, eCommunications).
        call(enumerator, 4, (C.c_int, 1), (C.c_int, 2), (C.POINTER(C.c_void_p), C.byref(device)))
        call(device, 5, (C.POINTER(C.c_void_p), C.byref(raw_id)))
        if not raw_id:
            raise OSError('No hay un micrófono de llamadas disponible.')
        identifier = C.wstring_at(raw_id)
        volume_iid = GUID('5CDF2C82-841E-4546-9722-0CF74078229A')
        call(device, 3, (C.POINTER(GUID), C.byref(volume_iid)), (W.DWORD, 23),
             (C.c_void_p, None), (C.POINTER(C.c_void_p), C.byref(volume)))
        yield identifier, volume
    finally:
        for pointer in (volume, device, enumerator):
            release(pointer)
        if raw_id:
            ole.CoTaskMemFree(raw_id)
        if apartment >= 0:
            ole.CoUninitialize()


def get_mute(volume):
    muted = W.BOOL()
    call(volume, 15, (C.POINTER(W.BOOL), C.byref(muted)))
    return bool(muted.value)


def set_mute(volume, muted):
    call(volume, 14, (W.BOOL, muted), (C.c_void_p, None))


class CallMute:
    def __init__(self):
        self.lock = threading.Lock()
        self.observed = None
        self.token = None
        self.revision = 0

    def _state(self, identifier, muted, *, changed=False, message=''):
        key = (identifier, muted)
        if key != self.observed:
            self.observed = key
            self.token = uuid4().hex if identifier else None
            self.revision += 1
        return {'available': bool(identifier), 'muted': muted, 'token': self.token,
                'revision': self.revision, 'scope': SCOPE, 'changed': changed, 'message': message}

    def read(self):
        with self.lock:
            try:
                with communications_endpoint() as (identifier, volume):
                    return self._state(identifier, get_mute(volume))
            except OSError:
                return self._state(None, None, message='Micrófono de llamadas no disponible.')

    def change(self, muted, token):
        if type(muted) is not bool or not isinstance(token, str) or len(token) != 32:
            raise ValueError('Actualiza el estado del micrófono antes de cambiarlo.')
        with self.lock:
            try:
                with communications_endpoint() as (identifier, volume):
                    current = get_mute(volume)
                    self._state(identifier, current)
                    if token != self.token:
                        return self._state(identifier, current, message='El micrófono o su estado cambió. Vuelve a pulsar.')
                    if current == muted:
                        return self._state(identifier, current)
                    set_mute(volume, muted)
                    actual = get_mute(volume)
                    return self._state(identifier, actual, changed=actual != current,
                                       message='' if actual == muted else 'Windows no aplicó el cambio.')
            except OSError:
                return self._state(None, None, message='No se pudo cambiar el micrófono de llamadas.')


class WorkspaceCallBridge:
    _call_mute_init = threading.Lock()

    def _call_mute(self):
        with self._call_mute_init:
            if not hasattr(self, '_call_mute_state'):
                self._call_mute_state = CallMute()
            return self._call_mute_state

    def workspace_call_mute_state(self):
        self._trusted()
        return self._call_mute().read()

    def workspace_call_mute_set(self, muted, token):
        self._trusted()
        if getattr(self, '_exit_requested', False):
            raise ValueError('Brivany se está cerrando.')
        state = self._call_mute().change(muted, token)
        # Publish only actual device state, never the command-specific result.
        import json
        update = {**state, 'changed': False, 'message': ''}
        script = 'window.BrivanyCallMute?.receive(' + json.dumps(update, ensure_ascii=True) + ')'
        for name in ('_work_window', '_bar_window'):
            window = getattr(self, name, None)
            if window:
                post_script(window, script, 'call-mute')
        return state
