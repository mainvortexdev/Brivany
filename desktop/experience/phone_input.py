"""Bounded Windows input used by an explicitly approved phone session."""
import ctypes as C
from ctypes import wintypes as W
import io
import os
from pathlib import Path
import subprocess


KEYS = {'backspace': 0x08, 'tab': 0x09, 'enter': 0x0D, 'escape': 0x1B, 'pageup': 0x21,
        'pagedown': 0x22, 'end': 0x23, 'home': 0x24, 'left': 0x25, 'up': 0x26,
        'right': 0x27, 'down': 0x28, 'delete': 0x2E}
MUSIC = {'previous': 0xB1, 'toggle': 0xB3, 'next': 0xB0, 'volume-down': 0xAE, 'volume-up': 0xAF, 'mute': 0xAD}
SLIDES = {'previous': 0x21, 'next': 0x22, 'end': 0x1B}


class MouseInput(C.Structure):
    _fields_ = [('dx', W.LONG), ('dy', W.LONG), ('data', W.DWORD), ('flags', W.DWORD),
                ('time', W.DWORD), ('extra', C.c_size_t)]


class KeyInput(C.Structure):
    _fields_ = [('virtual', W.WORD), ('scan', W.WORD), ('flags', W.DWORD), ('time', W.DWORD), ('extra', C.c_size_t)]


class Payload(C.Union):
    _fields_ = [('mouse', MouseInput), ('key', KeyInput)]


class Input(C.Structure):
    _anonymous_ = ('payload',)
    _fields_ = [('kind', W.DWORD), ('payload', Payload)]


def mouse(flags, dx=0, dy=0, data=0):
    value = Input(kind=0)
    value.mouse = MouseInput(dx, dy, data & 0xffffffff, flags, 0, 0)
    return value


def key(virtual=0, scan=0, flags=0):
    value = Input(kind=1)
    value.key = KeyInput(virtual, scan, flags, 0, 0)
    return value


def key_pair(virtual):
    extended = int(0x21 <= virtual <= 0x2E or virtual in MUSIC.values())
    return [key(virtual, flags=extended), key(virtual, flags=extended | 2)]


class WindowsPhoneInput:
    def __init__(self):
        if os.name != 'nt':
            raise ValueError('El control móvil está disponible en Windows.')
        self.user = C.WinDLL('user32', use_last_error=True)
        self.user.SendInput.argtypes = [W.UINT, C.POINTER(Input), C.c_int]
        self.user.SendInput.restype = W.UINT

    def _send(self, events):
        batch = (Input * len(events))(*events)
        count = self.user.SendInput(len(batch), batch, C.sizeof(Input))
        if count != len(batch):
            if 0 < count < len(batch):
                next_event = batch[count]
                if (next_event.kind == 1 and next_event.key.flags & 2) or (next_event.kind == 0 and next_event.mouse.flags in (4, 16)):
                    self.user.SendInput(1, C.byref(next_event), C.sizeof(Input))
            raise ValueError('Windows no aceptó la entrada en la aplicación activa.')

    def run(self, kind, value):
        if kind == 'move':
            events = [mouse(1, value['x'], value['y'])]
        elif kind == 'scroll':
            events = [mouse(0x0800, data=value['ticks'] * 120)]
        elif kind == 'click':
            down, up = (2, 4) if value['button'] == 'left' else (8, 16)
            events = [mouse(down), mouse(up)]
        elif kind == 'tap-screen':
            events = [mouse(0x8001, value['x'], value['y']), mouse(2), mouse(4)]
        elif kind == 'text':
            raw = value['text'].encode('utf-16-le')
            events = []
            for offset in range(0, len(raw), 2):
                unit = int.from_bytes(raw[offset:offset + 2], 'little')
                events.extend((key(scan=unit, flags=4), key(scan=unit, flags=6)))
        else:
            codes = {'key': KEYS, 'music': MUSIC, 'slides': SLIDES}
            events = key_pair(codes[kind][value['key']])
        self._send(events)

    def power(self, action):
        if action == 'lock':
            self.user.LockWorkStation.argtypes = []
            self.user.LockWorkStation.restype = W.BOOL
            if not self.user.LockWorkStation():
                raise ValueError('Windows no inició el bloqueo.')
        elif action == 'shutdown':
            # A zero timeout avoids the implicit /f of positive timeouts.
            program = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'shutdown.exe'
            try:
                result = subprocess.run([str(program), '/s', '/t', '0'], capture_output=True, timeout=6,
                                        creationflags=subprocess.CREATE_NO_WINDOW, check=False)
            except subprocess.TimeoutExpired:
                raise ValueError('Windows no confirmó el apagado.') from None
            if result.returncode:
                raise ValueError('Windows no inició el apagado.')
        else:
            raise ValueError('Acción de energía no disponible.')


def capture_primary():
    from PIL import Image, ImageGrab
    with ImageGrab.grab() as screen:
        screen.thumbnail((960, 600), Image.Resampling.BILINEAR)
        output = io.BytesIO()
        screen.save(output, format='JPEG', quality=61)
    return output.getvalue()
