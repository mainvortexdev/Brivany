"""Synthetic drawings only; these tests never touch the user's clipboard."""
import base64
import ctypes
import io
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

from PIL import Image, PngImagePlugin
from desktop.experience.canvas_window import CanvasAPI, CanvasWindow, WorkspaceCanvasBridge, decode_png, save_png, copy_png


def payload(size=(64, 48), color=(22, 55, 88, 128)):
    stream = io.BytesIO(); info = PngImagePlugin.PngInfo(); info.add_text('test', 'remove metadata')
    Image.new('RGBA', size, color).save(stream, format='PNG', pnginfo=info)
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


class CanvasOutputTests(unittest.TestCase):
    def test_png_pixels_white_composite_and_dib(self):
        png, dib = decode_png(payload())
        with Image.open(io.BytesIO(png)) as image:
            self.assertEqual(image.size, (64, 48)); self.assertEqual(image.mode, 'RGB')
            self.assertEqual(image.getpixel((10, 10)), (138, 155, 171)); self.assertNotIn('test', image.info)
        self.assertEqual(int.from_bytes(dib[:4], 'little'), 40)
        self.assertEqual(int.from_bytes(dib[4:8], 'little'), 64)

    def test_rejects_invalid_and_oversized_payloads(self):
        for value in (None, {}, 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,!', 'data:image/png;base64,AAAA', payload((4097, 1)), payload((4096, 2049))):
            with self.subTest(kind=type(value).__name__), self.assertRaises(ValueError):
                decode_png(value)

    def test_rejects_animated_png(self):
        stream = io.BytesIO()
        Image.new('RGB', (4, 4), 'red').save(stream, format='PNG', save_all=True, append_images=[Image.new('RGB', (4, 4), 'blue')], duration=100)
        with self.assertRaises(ValueError):
            decode_png('data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode())

    def test_export_atomic_and_extension(self):
        png, _ = decode_png(payload())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'dibujo.png'; path.write_bytes(b'previous fixture')
            save_png(path, png); self.assertEqual(path.read_bytes(), png)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            for target in ('relative.png', Path(directory) / 'wrong.jpg'):
                with self.assertRaises(ValueError): save_png(target, png)

    def test_failed_write_keeps_previous_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'dibujo.png'; path.write_bytes(b'previous fixture')
            with patch('desktop.experience.canvas_window.os.replace', side_effect=OSError('fixture')):
                with self.assertRaises(OSError): save_png(path, b'new')
            self.assertEqual(path.read_bytes(), b'previous fixture'); self.assertEqual(len(list(Path(directory).iterdir())), 1)


class CanvasAPITests(unittest.TestCase):
    def setUp(self):
        self.manager = CanvasWindow('http://127.0.0.1:6193')
        self.api = CanvasAPI(self.manager); self.window = Mock()
        self.window.get_current_url.return_value = self.manager.base + '/workspace-canvas'
        self.manager.window = self.api._window = self.window; self.manager.api = self.api

    def test_scoped_origin_and_closed_instance(self):
        for url in ('https://127.0.0.1:6193/workspace-canvas', 'http://127.0.0.1:6193/app', 'http://user@127.0.0.1:6193/workspace-canvas', 'http://127.0.0.1:6194/workspace-canvas'):
            self.window.get_current_url.return_value = url
            with self.assertRaises(ValueError): self.api.canvas_copy(payload(), 0)
        self.window.get_current_url.return_value = self.manager.base + '/workspace-canvas'
        self.manager.close()
        with self.assertRaises(ValueError): self.api.canvas_ready()

    def test_dirty_order_copy_and_stale_output(self):
        self.api.canvas_changed(2, True); self.api.canvas_changed(1, False)
        self.assertTrue(self.manager.dirty)
        with self.assertRaises(ValueError): self.api.canvas_copy(payload(), 1)
        with patch('desktop.experience.canvas_window.copy_png') as copy:
            self.assertTrue(self.api.canvas_copy(payload(), 2)['copied']); copy.assert_called_once()
        self.assertFalse(self.manager.dirty)
        self.assertNotIn('workspace_canvas_open', dir(self.api))

    def test_canceled_export_preserves_dirty(self):
        self.api.canvas_changed(1, True); self.window.create_file_dialog.return_value = None
        self.assertFalse(self.api.canvas_export(payload(), 1)['saved']); self.assertTrue(self.manager.dirty)
        with self.assertRaises(ValueError): self.api.canvas_close_decision('close')
        self.window.destroy.assert_not_called()

    def test_export_uses_only_chosen_path(self):
        self.api.canvas_changed(1, True)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'elegido.png'; self.window.create_file_dialog.return_value = (str(path),)
            self.assertTrue(self.api.canvas_export(payload(), 1)['saved'])
            with Image.open(path) as image: self.assertEqual(image.size, (64, 48))
        self.assertFalse(self.manager.dirty)

    def test_exit_cancel_then_discard_continuation(self):
        self.manager.is_ready = True; self.api.canvas_changed(1, True); done = threading.Event()
        with patch('desktop.experience.canvas_window.post_script') as post:
            self.assertTrue(self.manager.request_close(done.set)); post.assert_called_once()
        self.api.canvas_close_decision('cancel'); self.assertIsNone(self.manager.continuation)
        self.assertFalse(done.is_set()); self.manager.continuation = done.set
        self.api.canvas_close_decision('discard'); self.manager._closed(self.window)
        self.assertTrue(done.wait(1)); self.assertIsNone(self.manager.window)

    def test_lazy_creation_reuse_and_inflight_exit(self):
        root = WorkspaceCanvasBridge(); root._trusted = Mock(); root._base = self.manager.base
        self.assertFalse(root._request_canvas_exit(Mock())); root._close_canvas()
        with patch('desktop.experience.canvas_window.CanvasWindow') as cls:
            root.workspace_canvas_open(); root.workspace_canvas_open(); self.assertEqual(cls.call_count, 1)
        self.manager.creating = True; self.manager.window = None
        self.assertFalse(self.manager.request_close()); self.assertEqual(self.manager.epoch, 1)

    def test_all_entrypoints_reject_foreign_url_before_effects(self):
        self.window.get_current_url.return_value = 'https://example.invalid/'
        for method, args in (('canvas_ready', ()), ('canvas_changed', (1, True)), ('canvas_copy', (payload(), 0)), ('canvas_export', (payload(), 0)), ('canvas_close_decision', ('discard',)), ('canvas_window', ('minimize',))):
            with self.subTest(method=method), self.assertRaises(ValueError): getattr(self.api, method)(*args)
        self.window.destroy.assert_not_called(); self.window.create_file_dialog.assert_not_called()


@unittest.skipUnless(os.name == 'nt', 'Win32 memory ABI')
class ClipboardAllocationTests(unittest.TestCase):
    """Real HGLOBALs with substituted clipboard calls: no personal data access."""
    def setUp(self):
        from desktop.experience.workspace_controls import _clipboard_api
        _, real = _clipboard_api(); self.real = real; self.allocated = []; self.freed = []; self.transferred = []
        def allocate(flags, size):
            value = real.GlobalAlloc(flags, size); self.allocated.append(value); return value
        def free(handle): self.freed.append(handle); return real.GlobalFree(handle)
        self.kernel = SimpleNamespace(GlobalAlloc=allocate, GlobalFree=free, GlobalLock=real.GlobalLock, GlobalUnlock=real.GlobalUnlock)
        self.user = Mock(); self.user.RegisterClipboardFormatW.side_effect = [49300, 49301]
        self.user.CreateWindowExW.return_value = 123; self.user.OpenClipboard.return_value = True; self.user.EmptyClipboard.return_value = True
        def transfer(fmt, handle): self.transferred.append((fmt, handle)); return handle
        self.user.SetClipboardData.side_effect = transfer

    def tearDown(self):
        for _, handle in self.transferred:
            if handle not in self.freed: self.real.GlobalFree(handle)

    def test_three_formats_preserve_bytes_and_transfer_ownership(self):
        png, dib = decode_png(payload())
        with patch('desktop.experience.canvas_window._clipboard_api', return_value=(self.user, self.kernel)):
            copy_png(png, dib)
        self.assertEqual([fmt for fmt, _ in self.transferred], [49300, 49301, 8]); self.assertFalse(self.freed)
        for (_, handle), expected in zip(self.transferred, (png, png, dib)):
            ptr = self.real.GlobalLock(handle)
            try: self.assertEqual(ctypes.string_at(ptr, len(expected)), expected)
            finally: self.real.GlobalUnlock(handle)
        self.user.CloseClipboard.assert_called_once(); self.user.DestroyWindow.assert_called_once_with(123)

    def test_busy_clipboard_frees_every_allocation_without_clearing(self):
        self.user.OpenClipboard.return_value = False
        with patch('desktop.experience.canvas_window._clipboard_api', return_value=(self.user, self.kernel)):
            with self.assertRaises(ValueError): copy_png(*decode_png(payload()))
        self.assertCountEqual(self.allocated, self.freed); self.user.EmptyClipboard.assert_not_called()
        self.user.SetClipboardData.assert_not_called(); self.user.DestroyWindow.assert_called_once()

    def test_allocation_failure_keeps_clipboard_untouched(self):
        allocate = self.kernel.GlobalAlloc
        self.kernel.GlobalAlloc = lambda flags, size: allocate(flags, size) if not self.allocated else None
        with patch('desktop.experience.canvas_window._clipboard_api', return_value=(self.user, self.kernel)):
            with self.assertRaises(ValueError): copy_png(*decode_png(payload()))
        self.assertCountEqual(self.allocated, self.freed); self.user.OpenClipboard.assert_not_called()


if __name__ == '__main__': unittest.main()
