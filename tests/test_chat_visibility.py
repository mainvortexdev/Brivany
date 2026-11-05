"""Visibility policy, persisted choice and bounded Windows hook lifecycle."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from desktop.experience.chat_visibility import ChatVisibility,ExternalTypingMonitor


class FakeMonitor(ExternalTypingMonitor):
    def __init__(self):super().__init__();self.supported=False


class ChatVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'workspace-ui.json';self.monitor=FakeMonitor();self.policy=ChatVisibility(self.path,self.monitor)
    def tearDown(self):self.policy.close();self.temp.cleanup()
    def test_only_typing_in_another_process_requests_hide(self):
        self.policy.opened_chat(True)
        self.monitor.record(0x41,os.getpid());self.monitor.record(0x09,os.getpid()+1);self.monitor.record(0x41,os.getpid()+1,True)
        self.assertFalse(self.policy.should_hide())
        self.monitor.record(0x41,os.getpid()+1);self.assertTrue(self.policy.should_hide());self.assertFalse(self.policy.should_hide())
        self.assertFalse(hasattr(self.monitor,'keys'));self.assertNotIn('text',vars(self.monitor))
    def test_manual_mode_persists_and_ignores_external_typing(self):
        self.policy.opened_chat(True);self.policy.configure('manual');self.monitor.record(0x41,os.getpid()+1)
        self.assertFalse(self.policy.should_hide());self.assertFalse(self.monitor.active)
        restored=ChatVisibility(self.path,FakeMonitor());self.assertEqual(restored.status()['mode'],'manual');restored.close()
    def test_reopening_discards_old_typing_signal(self):
        self.policy.opened_chat(True);self.monitor.record(0x41,os.getpid()+1);self.policy.opened_chat(False);self.policy.opened_chat(True)
        self.assertFalse(self.policy.should_hide())
    def test_invalid_configuration_does_not_replace_saved_choice(self):
        self.policy.configure('manual')
        with self.assertRaises(ValueError):self.policy.configure('on-cursor-leave')
        self.assertEqual(self.policy.status()['mode'],'manual')
    @unittest.skipUnless(sys.platform=='win32','Windows hook lifecycle')
    def test_native_hook_starts_and_unhooks_without_recording_key_content(self):
        monitor=ExternalTypingMonitor()
        try:
            monitor.enable(True);self.assertTrue(monitor.ready.wait(3));self.assertTrue(monitor.hook)
            monitor.enable(False);self.assertFalse(monitor.active)
        finally:monitor.close()
        self.assertFalse(monitor.thread.is_alive());self.assertIsNone(monitor.hook)
