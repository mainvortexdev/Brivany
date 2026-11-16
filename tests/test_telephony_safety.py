"""Accelerated local phone watchdogs: no operator, model, microphone or audio file."""
import threading
import unittest

from services.telephony.safety import CallSafety
from services.telephony.realtime import LivePhoneSession
from tests.test_telephony_realtime import STREAM, Transport, SyntheticProviders, wait
from tests.test_telnyx_call_control import Fixture


class Clock:
    def __init__(self): self.now = 0.
    def __call__(self): return self.now


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.safety = CallSafety(clock=self.clock)

    def ready(self):
        self.safety.connected()
        self.safety.ready(input=True, output=True)

    def test_fifteen_seconds_of_user_silence_closes_at_the_boundary(self):
        self.ready()
        self.clock.now = 14.999
        self.assertIsNone(self.safety.reason())
        self.clock.now = 15
        self.assertEqual(self.safety.reason(), 'user_silence')

    def test_bot_audio_and_transport_activity_do_not_reset_user_silence(self):
        self.ready()
        self.clock.now = 14
        self.safety.ready(output=True)
        self.clock.now = 15
        self.assertEqual(self.safety.reason(), 'user_silence')

    def test_user_voice_resets_silence_but_does_not_extend_the_absolute_limit(self):
        self.ready()
        for second in range(10, 90, 10):
            self.clock.now = second
            self.safety.user_voice()
            self.assertIsNone(self.safety.reason())
        self.clock.now = 90
        self.safety.user_voice()
        self.assertEqual(self.safety.reason(), 'maximum_duration')

    def test_missing_input_or_output_is_a_communication_timeout(self):
        for input_ready, output_ready in ((False, False), (True, False), (False, True)):
            with self.subTest(input=input_ready, output=output_ready):
                self.clock.now = 0
                safety = CallSafety(clock=self.clock)
                safety.connected()
                safety.ready(input=input_ready, output=output_ready)
                self.clock.now = 14
                safety.user_voice()
                self.clock.now = 15
                self.assertEqual(safety.reason(), 'communication_timeout')

    def test_none_and_a_larger_duration_cannot_disable_the_hard_cap(self):
        for requested in (None, 150, 600, float('inf')):
            with self.subTest(requested=requested):
                self.clock.now = 0
                safety = CallSafety(clock=self.clock, max_seconds=requested)
                self.clock.now = 89.999
                self.assertIsNone(safety.reason())
                self.clock.now = 90
                self.assertEqual(safety.reason(), 'maximum_duration')

    def test_watchdog_hangs_up_even_when_recognition_startup_is_blocked(self):
        entered, release = threading.Event(), threading.Event()
        providers = SyntheticProviders()
        def blocked_listen():
            entered.set()
            release.wait(3)
            return providers.muse
        providers.listen = blocked_listen
        transport = Transport()
        session = LivePhoneSession(transport, STREAM, 'Prueba sintética.', threading.Event(), providers,
                                   max_seconds=None, safety=self.safety)
        worker = threading.Thread(target=session.run, daemon=True)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.clock.now = 15
            wait(lambda:transport.closed, seconds=1)
            self.assertEqual(session.metrics['end_reason'], 'communication_timeout')
            self.assertEqual(providers.spoken, [])
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertTrue(providers.muse.closed.is_set())


class CarrierSafetyTests(Fixture, unittest.TestCase):
    def setUp(self):
        self.setup_fixture()
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.calls.close)
        self.clock = Clock()
        self.calls.clock = self.clock

    def test_answer_without_a_websocket_closes_after_fifteen_seconds(self):
        value = self.payload('conversation')
        self.calls.start(value)
        self.receive(value['id'], 'call.answered')
        self.clock.now = 15
        self.assertEqual(self.calls.check_safety(), 1)
        self.assertEqual(self.calls.status(value['id'])['end_reason'], 'communication_timeout')
        self.assertTrue(self.api.requests[-1][1].endswith('/hangup'))
        self.assertEqual(self.calls.check_safety(), 0)
        while self.calls.process_one():
            pass
        self.assertFalse(any(path.endswith('/streaming_start') for _,path,_ in self.api.requests))

    def test_voice_silence_uses_the_independent_carrier_hangup(self):
        value = self.payload('conversation')
        self.calls.start(value)
        self.receive(value['id'], 'call.answered')
        safety = self.calls.runtime[value['id']].safety
        safety.ready(input=True, output=True)
        self.clock.now = 10
        safety.user_voice()
        self.clock.now = 24.99
        self.assertEqual(self.calls.check_safety(), 0)
        self.clock.now = 25
        self.assertEqual(self.calls.check_safety(), 1)
        self.assertEqual(self.calls.status(value['id'])['end_reason'], 'user_silence')

    def test_ninety_seconds_closes_even_with_continuous_voice_and_is_sent_to_telnyx(self):
        value = self.payload('conversation')
        self.calls.start(value)
        self.assertEqual(self.api.requests[0][2]['time_limit_secs'], 90)
        self.clock.now = 20
        self.receive(value['id'], 'call.answered')
        safety = self.calls.runtime[value['id']].safety
        safety.ready(input=True, output=True)
        for second in range(30, 90, 10):
            self.clock.now = second
            safety.user_voice()
            self.assertEqual(self.calls.check_safety(), 0)
        self.clock.now = 90
        safety.user_voice()
        self.assertEqual(self.calls.check_safety(), 1)
        self.assertEqual(self.calls.status(value['id'])['end_reason'], 'maximum_duration')
        self.assertEqual(sum(path.endswith('/hangup') for _,path,_ in self.api.requests), 1)
