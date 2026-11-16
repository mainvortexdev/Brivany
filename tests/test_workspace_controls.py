"""Local policy and substitutions: no real clipboard read or settings launch."""
import unittest
import ctypes
import os
from unittest.mock import patch
from desktop.experience.workspace_controls import WorkspaceControlsBridge, CONTROL_URIS, MAX_CLIPBOARD_CHARS, _clipboard_api


class ControlsTests(unittest.TestCase):
    def setUp(self):
        self.bridge = WorkspaceControlsBridge()
        self.bridge._trusted = lambda: None

    def test_only_allowlisted_uri_can_open_and_never_claims_toggle(self):
        with patch('desktop.experience.workspace_controls.os.name', 'nt'), patch('desktop.experience.workspace_controls.os.startfile', create=True) as start:
            for action, uri in CONTROL_URIS.items():
                result = self.bridge.workspace_control_open(action)
                start.assert_called_with(uri)
                self.assertTrue(result['opened'])
                self.assertFalse(result['changed_setting'])
            for action in ('shutdown', 'https://evil.test', '../file', 'ms-settings:unknown', None, []):
                with self.subTest(action=action), self.assertRaises(ValueError):
                    self.bridge.workspace_control_open(action)

    def test_clipboard_is_only_read_by_explicit_action_and_not_persisted(self):
        with patch('desktop.experience.workspace_controls.read_clipboard_text', return_value='texto propio') as read:
            self.assertEqual(self.bridge.workspace_clipboard_state()['items'], [])
            read.assert_not_called()
            result = self.bridge.workspace_clipboard_read()
            self.assertEqual(result['items'][0]['text'], 'texto propio')
            self.assertFalse(result['monitoring'])
            self.assertFalse(result['persisted'])
            self.assertEqual(read.call_count, 1)

    def test_clipboard_is_bounded_deduplicated_and_copy_uses_stored_id(self):
        with patch('desktop.experience.workspace_controls.read_clipboard_text', side_effect=[str(i) for i in range(12)]):
            for _ in range(12):
                result = self.bridge.workspace_clipboard_read()
        self.assertEqual(len(result['items']), 10)
        self.assertEqual(result['items'][0]['text'], '11')
        with patch('desktop.experience.workspace_controls.read_clipboard_text', return_value='11'):
            result = self.bridge.workspace_clipboard_read()
        self.assertEqual(len(result['items']), 10)
        with patch('desktop.experience.workspace_controls.copy_clipboard_text') as copy:
            self.bridge.workspace_clipboard_copy(result['items'][0]['id'])
            copy.assert_called_once_with('11')
            with self.assertRaises(ValueError):
                self.bridge.workspace_clipboard_copy('arbitrary text')

    def test_clear_only_clears_brivany_history_not_system_clipboard(self):
        with patch('desktop.experience.workspace_controls.read_clipboard_text', return_value='texto propio'):
            self.bridge.workspace_clipboard_read()
        with patch('desktop.experience.workspace_controls.copy_clipboard_text') as copy:
            result = self.bridge.workspace_clipboard_clear()
            copy.assert_not_called()
        self.assertEqual(result['items'], [])
        self.assertFalse(result['system_clipboard_changed'])

    def test_empty_and_large_clipboard_are_rejected(self):
        for value in ('', ' ', 'x' * (MAX_CLIPBOARD_CHARS + 1)):
            with patch('desktop.experience.workspace_controls.read_clipboard_text', return_value=value):
                with self.assertRaises(ValueError):
                    self.bridge.workspace_clipboard_read()

    def test_all_actions_check_trust_before_read_or_os_access(self):
        def reject():
            raise PermissionError('untrusted')
        self.bridge._trusted = reject
        for method, args in [('workspace_control_open', ('sound',)), ('workspace_clipboard_state', ()),
                ('workspace_clipboard_read', ()), ('workspace_clipboard_copy', ('id',)),
                ('workspace_clipboard_clear', ()), ('workspace_process_resources', ())]:
            with self.subTest(method=method), self.assertRaises(PermissionError):
                getattr(self.bridge, method)(*args)

    def test_resources_scope_explicitly_excludes_webview_and_is_on_demand(self):
        result = self.bridge.workspace_process_resources()
        self.assertEqual(result['scope'], 'python_host_only')
        self.assertFalse(result['includes_webview2'])
        self.assertGreater(result['pid'], 0)
        self.assertGreaterEqual(result['cpu_seconds'], 0)
        self.assertTrue(result['rss_bytes'] is None or result['rss_bytes'] > 0)

    @unittest.skipUnless(os.name == 'nt', 'Windows ABI only')
    def test_clipboard_ffi_handles_preserve_pointer_width_without_reading_clipboard(self):
        user, kernel = _clipboard_api()
        for function in (user.GetClipboardData, user.SetClipboardData, user.CreateWindowExW,
                         kernel.GlobalAlloc, kernel.GlobalFree, kernel.GlobalLock):
            self.assertEqual(ctypes.sizeof(function.restype), ctypes.sizeof(ctypes.c_void_p))
        self.assertEqual(kernel.GlobalSize.restype, ctypes.c_size_t)


if __name__ == '__main__':
    unittest.main()
