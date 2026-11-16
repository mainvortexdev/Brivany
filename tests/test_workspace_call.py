"""Test endpoint changes with a fake device, and query Windows without muting it."""
from contextlib import contextmanager
import ctypes
import os
import threading
import unittest
from unittest.mock import Mock, patch

from desktop.experience import workspace_call as call


class CallMuteTests(unittest.TestCase):
    def setUp(self):
        self.identifier = 'private-fixture-endpoint'
        self.muted = False
        self.available = True
        self.opens = self.closes = self.writes = 0
        self.service = call.CallMute()

        @contextmanager
        def endpoint():
            self.opens += 1
            try:
                if not self.available:
                    raise OSError('fixture endpoint disconnected')
                yield self.identifier, self
            finally:
                self.closes += 1

        def set_mute(_, muted):
            self.writes += 1
            self.muted = muted

        for name, value in [('communications_endpoint', endpoint), ('get_mute', lambda _: self.muted), ('set_mute', set_mute)]:
            replacement = patch.object(call, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_mute_and_restore_are_explicit_and_verified(self):
        initial = self.service.read()
        self.assertNotIn(self.identifier, str(initial))
        self.assertFalse(initial['muted'])
        muted = self.service.change(True, initial['token'])
        self.assertTrue(muted['muted'])
        self.assertTrue(muted['changed'])
        self.assertNotEqual(muted['token'], initial['token'])
        self.assertFalse(self.service.change(True, muted['token'])['changed'])
        restored = self.service.change(False, muted['token'])
        self.assertFalse(restored['muted'])
        self.assertEqual(self.writes, 2)
        self.assertEqual(self.opens, self.closes)

    def test_stale_endpoint_or_mute_state_never_changes_another_device(self):
        initial = self.service.read()
        self.identifier = 'different-endpoint'
        switched = self.service.change(True, initial['token'])
        self.assertTrue(switched['message'])
        self.assertEqual(self.writes, 0)
        self.muted = True
        external = self.service.change(False, switched['token'])
        self.assertTrue(external['muted'])
        self.assertFalse(external['changed'])
        self.assertEqual(self.writes, 0)

    def test_disconnect_clears_grant_and_can_recover(self):
        initial = self.service.read()
        self.available = False
        disconnected = self.service.change(True, initial['token'])
        self.assertFalse(disconnected['available'])
        self.assertIsNone(disconnected['muted'])
        self.assertIsNone(disconnected['token'])
        self.available = True
        self.assertNotEqual(self.service.read()['token'], initial['token'])
        self.assertEqual(self.writes, 0)

    def test_verifies_windows_readback(self):
        current = self.service.read()
        with patch.object(call, 'set_mute') as refused:
            result = self.service.change(True, current['token'])
        refused.assert_called_once_with(self, True)
        self.assertFalse(result['changed'])
        self.assertFalse(result['muted'])
        self.assertTrue(result['message'])

    def test_two_views_cannot_apply_opposing_commands_from_same_snapshot(self):
        initial = self.service.read()
        results = []
        workers = [threading.Thread(target=lambda: results.append(self.service.change(True, initial['token']))) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(2)
        self.assertEqual(sorted(result['changed'] for result in results), [False, True])
        self.assertEqual(self.writes, 1)

    def test_malformed_or_unauthorized_calls_never_open_device(self):
        for value, token in ((1, 'a' * 32), (False, {}), (True, 'short')):
            with self.assertRaises(ValueError):
                self.service.change(value, token)
        bridge = call.WorkspaceCallBridge()
        bridge._trusted = Mock(side_effect=ValueError('foreign window'))
        for method, args in [(bridge.workspace_call_mute_state, ()), (bridge.workspace_call_mute_set, (True, 'a' * 32))]:
            with self.assertRaises(ValueError):
                method(*args)
        self.assertEqual(self.opens, 0)
        self.assertFalse(hasattr(bridge, '_call_mute_state'))


@unittest.skipUnless(os.name == 'nt', 'Requires Windows Core Audio')
class NativeReadTests(unittest.TestCase):
    def test_real_windows_capture_endpoint_read_only(self):
        service = call.CallMute()
        status = service.read()
        if not status['available']:
            self.skipTest('No default communications input is available on this host.')
        self.assertIs(type(status['muted']), bool)
        self.assertEqual(status['scope'], call.SCOPE)
        self.assertEqual(len(status['token']), 32)

    def test_sdk_vtable_mute_argument_abi(self):
        # Exercise the actual ctypes call/invoke path without touching hardware.
        written = []
        setter = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, call.W.BOOL, ctypes.c_void_p)(
            lambda _this, value, context: written.append((bool(value), context)) or 0)
        getter = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(call.W.BOOL))(
            lambda _this, output: output.__setitem__(0, int(written[-1][0])) or 0)
        table = (ctypes.c_void_p * 16)()
        table[14] = ctypes.cast(setter, ctypes.c_void_p).value
        table[15] = ctypes.cast(getter, ctypes.c_void_p).value
        instance = ctypes.cast(table, ctypes.c_void_p)
        pointer = ctypes.cast(ctypes.pointer(instance), ctypes.c_void_p)
        call.set_mute(pointer, True)
        self.assertTrue(call.get_mute(pointer))
        call.set_mute(pointer, False)
        self.assertFalse(call.get_mute(pointer))
        self.assertEqual(written, [(True, None), (False, None)])


if __name__ == '__main__':
    unittest.main()
