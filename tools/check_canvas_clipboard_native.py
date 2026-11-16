"""Production PNG clipboard round trip in a private window station only.

Never opens or reads the interactive WinSta0 clipboard. Run as a fresh process,
before any GUI runtime is loaded. The station is destroyed after the trial.
"""
import base64
import ctypes
from ctypes import wintypes as W
import io
import json
import os
from pathlib import Path
from uuid import uuid4


def main():
    assert os.name == 'nt'
    user, kernel = ctypes.WinDLL('user32', use_last_error=True), ctypes.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'GetProcessWindowStation': ([], W.HANDLE), 'GetThreadDesktop': ([W.DWORD], W.HANDLE),
        'CreateWindowStationW': ([W.LPCWSTR, W.DWORD, W.DWORD, ctypes.c_void_p], W.HANDLE),
        'SetProcessWindowStation': ([W.HANDLE], W.BOOL),
        'CreateDesktopW': ([W.LPCWSTR, W.LPCWSTR, ctypes.c_void_p, W.DWORD, W.DWORD, ctypes.c_void_p], W.HANDLE),
        'SetThreadDesktop': ([W.HANDLE], W.BOOL), 'CloseDesktop': ([W.HANDLE], W.BOOL),
        'CloseWindowStation': ([W.HANDLE], W.BOOL),
    }
    for name, (args, result) in signatures.items():
        getattr(user, name).argtypes = args; getattr(user, name).restype = result
    kernel.GetCurrentThreadId.restype = W.DWORD
    original_station = user.GetProcessWindowStation(); original_desktop = user.GetThreadDesktop(kernel.GetCurrentThreadId())
    station = desktop = None
    report = {'passed': False, 'mode': 'real_windows_clipboard_private_noninteractive_window_station', 'interactive_clipboard_opened': False, 'external_calls': 0, 'gpu_seconds': None}
    try:
        # Only clipboard, desktop creation, atoms and attribute reads; no screen
        # access or interactive window-station rights are requested.
        station = user.CreateWindowStationW('BrivanyCanvasTest' + uuid4().hex, 0, 0x2E, None)
        assert station, ('CreateWindowStation', ctypes.get_last_error())
        assert user.SetProcessWindowStation(station), ('SetProcessWindowStation', ctypes.get_last_error())
        desktop = user.CreateDesktopW('Default', None, None, 0, 0x1FF, None)
        assert desktop, ('CreateDesktop', ctypes.get_last_error())
        assert user.SetThreadDesktop(desktop), ('SetThreadDesktop', ctypes.get_last_error())
        assert user.GetProcessWindowStation() != original_station
        from PIL import Image
        from desktop.experience.canvas_window import decode_png, copy_png
        from desktop.experience.workspace_controls import _clipboard_api
        stream = io.BytesIO(); Image.new('RGB', (64, 48), (38, 108, 230)).save(stream, format='PNG')
        png, dib = decode_png('data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode())
        copy_png(png, dib)
        user, kernel = _clipboard_api()
        user.RegisterClipboardFormatW.argtypes = [W.LPCWSTR]; user.RegisterClipboardFormatW.restype = W.UINT
        assert user.OpenClipboard(None), ('OpenPrivateClipboard', ctypes.get_last_error())
        try:
            for fmt, expected in ((user.RegisterClipboardFormatW('PNG'), png), (user.RegisterClipboardFormatW('image/png'), png), (8, dib)):
                assert user.IsClipboardFormatAvailable(fmt)
                handle = user.GetClipboardData(fmt); assert handle
                pointer = kernel.GlobalLock(handle); assert pointer
                try: actual = ctypes.string_at(pointer, len(expected))
                finally: kernel.GlobalUnlock(handle)
                assert actual == expected
            assert user.EmptyClipboard()
        finally:
            user.CloseClipboard()
        with Image.open(io.BytesIO(png)) as image:
            assert image.size == (64, 48) and image.getpixel((10, 10)) == (38, 108, 230)
        report.update(passed=True, formats=['PNG', 'image/png', 'CF_DIB'], pixels_verified=True)
    finally:
        # All HWNDs and clipboard handles created by copy_png are already gone.
        assert user.SetProcessWindowStation(original_station)
        assert user.SetThreadDesktop(original_desktop)
        if desktop: assert user.CloseDesktop(desktop)
        if station: assert user.CloseWindowStation(station)
        directory = Path(__file__).resolve().parents[1] / 'tmp/workspace-canvas-native'
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'clipboard.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report)); return 0


if __name__ == '__main__': raise SystemExit(main())
