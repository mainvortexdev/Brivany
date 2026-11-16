"""Client calls with synthetic UI/audio/ASR/Meta/TTS. Never uses real accounts."""
from contextlib import nullcontext
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from desktop.experience.telephony import TelephoneBridge
from services.telephony.realtime import LivePhoneSession
from services.telephony.common import TelephonyError
from services.telephony.whatsapp_client import ClientSocket, WhatsAppClientGateway, TERMINAL
from services.telephony.whatsapp_client_audio import VirtualAudio
from services.telephony.whatsapp_client_settings import ClientSettings
from services.telephony.whatsapp_client_simulation import SimulatedClient, SimulatedAudio, SimulatedProviders
from services.telephony.whatsapp_client_ui import OfficialWhatsAppClient, displayed_number

DESTINATION = '+18295550101'


def until(predicate, seconds=4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.005)
    raise AssertionError('Synthetic WhatsApp route timed out')


class ClientTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.settings = ClientSettings(self.root/'client.json')
        self.clients, self.audios, self.providers = [], [], []

    def gateway(self, **overrides):
        def factory(kind, bucket):
            def create(_):
                value = kind(); bucket.append(value); return value
            return create
        options = {'client_factory': factory(SimulatedClient, self.clients),
                   'audio_factory': factory(SimulatedAudio, self.audios),
                   'providers_factory': factory(SimulatedProviders, self.providers)}
        options.update(overrides)
        gateway = WhatsAppClientGateway(self.root/'calls.sqlite3', self.settings, **options)
        self.addCleanup(gateway.close)
        return gateway

    def draft(self, **patches):
        return {'id': str(uuid4()), 'destination': DESTINATION,
                'objective': 'OBJETIVO-PRIVADO-SINTETICO', 'mode': 'simulation', **patches}

    def finish(self, gateway, draft):
        until(lambda: gateway.request('/v1/calls/'+draft['id'])['state'] in TERMINAL | {'uncertain'})
        gateway.worker.join(3)
        return gateway.request('/v1/calls/'+draft['id'])

    def test_settings_are_atomic_persistent_and_simulation_is_default(self):
        self.assertEqual(self.settings.read()['mode'], 'simulation')
        self.assertFalse(self.settings.path.exists())
        self.settings.update({'selected_channel': 'whatsapp_client', 'receive_device': 'rx', 'transmit_device': 'tx'})
        value = ClientSettings(self.settings.path).read()
        self.assertEqual(value['selected_channel'], 'whatsapp_client')
        self.assertEqual(value['receive_device'], 'rx')
        original = self.settings.path.read_bytes()
        for patch_value in ({'mode': 'anything'}, {'real_enabled': 'yes'}, {'token': 'bad'},
                            {'controls': {'recipient': 'same', 'call': 'same', 'hangup': '', 'state': ''}},
                            {'receipts': {'telephone': 'not-an-id', 'whatsapp_client': None}}):
            with self.assertRaises(TelephonyError):
                self.settings.update(patch_value)
            self.assertEqual(self.settings.path.read_bytes(), original)

    def test_invalid_configuration_does_not_fall_back_to_live_or_defaults(self):
        self.settings.path.write_text('{broken', encoding='utf-8')
        with self.assertRaises(TelephonyError):
            self.gateway().info()
        self.assertEqual(self.clients, [])

    def test_receipts_for_both_channels_survive_independent_writes(self):
        ids = {key:str(uuid4()) for key in ('telephone','whatsapp_client')}
        threads = [threading.Thread(target=self.settings.set_receipt,args=(key,value)) for key,value in ids.items()]
        for thread in threads:thread.start()
        for thread in threads:thread.join()
        self.assertEqual(ClientSettings(self.settings.path).read()['receipts'], ids)

    def test_info_and_review_have_no_devices_model_or_dial_side_effects(self):
        gateway = self.gateway()
        bridge = TelephoneBridge(); bridge._trusted = lambda: None
        bridge._whatsapp_call_settings = self.settings
        bridge._whatsapp_call_client = gateway
        self.assertTrue(bridge.workspace_telephone_info('whatsapp_client')['simulation'])
        draft = bridge.workspace_telephone_prepare(DESTINATION, 'Consulta sintética.', 'whatsapp_client')
        self.assertTrue(draft['simulation'])
        self.assertEqual(self.clients, [])
        bridge.workspace_telephone_discard(draft['id'])
        with self.assertRaises(TelephonyError):
            bridge.workspace_telephone_confirm(draft['id'])
        self.assertEqual(self.clients, [])

    def test_desktop_confirm_runs_two_voice_turns_and_persists_only_receipt(self):
        gateway = self.gateway()
        bridge = TelephoneBridge(); bridge._trusted = lambda: None
        bridge._whatsapp_call_settings, bridge._whatsapp_call_client = self.settings, gateway
        bridge.workspace_telephone_select_channel('whatsapp_client')
        draft = bridge.workspace_telephone_prepare(DESTINATION, 'OBJETIVO-PRIVADO-SINTETICO', 'whatsapp_client')
        with patch('socket.create_connection', side_effect=AssertionError('External network forbidden')), \
             patch('services.telephony.whatsapp_client.LiveProviders', side_effect=AssertionError('Paid provider forbidden')):
            bridge.workspace_telephone_confirm(draft['id'])
            result = self.finish(gateway, draft)
        self.assertEqual(result['state'], 'completed')
        self.assertTrue(result['simulation'])
        self.assertEqual(result['metrics']['completed_turns'], 2)
        self.assertEqual(result['metrics']['audio_ack_boundary'], 'virtual_audio_submitted')
        self.assertEqual(self.providers[0].muse.packets, 2)
        self.assertGreaterEqual(self.audios[0].packets, 3)
        self.assertTrue(self.audios[0].closed)
        self.assertTrue(self.providers[0].muse.closed)
        self.assertTrue(self.clients[0].ended)
        self.assertEqual(ClientSettings(self.settings.path).read()['receipts']['whatsapp_client'], draft['id'])
        self.assertNotIn(b'OBJETIVO-PRIVADO', (self.root/'calls.sqlite3').read_bytes())
        self.assertNotIn('history', result)
        with self.assertRaises(TelephonyError):
            bridge.workspace_telephone_confirm(draft['id'])
        self.assertEqual(len(self.clients), 1)
        bridge.workspace_telephone_forget_receipt('whatsapp_client')
        self.assertIsNone(self.settings.read()['receipts']['whatsapp_client'])

    def test_duplicate_request_is_not_redialed_and_changed_objective_is_rejected(self):
        gateway = self.gateway(); draft = self.draft()
        gateway.request('/v1/calls', draft); self.finish(gateway, draft)
        self.assertEqual(gateway.request('/v1/calls', draft)['state'], 'completed')
        with self.assertRaises(TelephonyError):
            gateway.request('/v1/calls', {**draft, 'objective': 'otro encargo'})
        self.assertEqual(len(self.clients), 1)

    def test_changed_mode_after_review_is_rejected_before_any_adapter(self):
        gateway = self.gateway(); draft = self.draft()
        self.settings.update({'mode': 'live'})
        with self.assertRaisesRegex(TelephonyError, 'Cambió el modo'):
            gateway.request('/v1/calls', draft)
        self.assertEqual(self.clients, [])

    def test_live_is_disabled_and_unconfigured_without_opening_a_client(self):
        self.settings.update({'mode': 'live'})
        gateway = self.gateway()
        self.assertFalse(gateway.info()['outbound'])
        with self.assertRaises(TelephonyError):
            gateway.request('/v1/calls', self.draft(mode='live'))
        self.assertEqual(self.clients, [])

    def test_simulation_rejects_an_accidentally_injected_real_adapter(self):
        client = Mock(simulation=False)
        gateway = self.gateway(client_factory=lambda _: client)
        draft = self.draft(); gateway.request('/v1/calls', draft)
        result = self.finish(gateway, draft)
        self.assertEqual(result['state'], 'failed')
        client.prepare.assert_not_called(); client.dial.assert_not_called()

    def test_cancel_while_ringing_stops_without_asr_and_blocks_concurrent_call(self):
        class Ringing(SimulatedClient):
            def state(self):
                return 'completed' if self.ended else 'ringing'
        client = Ringing()
        gateway = self.gateway(client_factory=lambda _: client)
        draft = self.draft(); gateway.request('/v1/calls', draft)
        until(lambda: client.dialed)
        with self.assertRaises(TelephonyError):
            gateway.request('/v1/calls', self.draft())
        result = gateway.request('/v1/calls/'+draft['id']+'/cancel', {})
        self.assertTrue(result['cancel_requested'])
        self.assertEqual(self.finish(gateway, draft)['state'], 'canceled')
        self.assertEqual(self.providers[0].spoken, 0)
        self.assertTrue(client.ended)

    def test_busy_does_not_start_voice(self):
        class Busy(SimulatedClient):
            def state(self):
                return 'busy'
        gateway = self.gateway(client_factory=lambda _: Busy())
        draft = self.draft(); gateway.request('/v1/calls', draft)
        self.assertEqual(self.finish(gateway, draft)['state'], 'busy')
        self.assertEqual(self.providers[0].spoken, 0)

    def test_audio_failure_before_dial_never_invokes_call(self):
        audio = SimulatedAudio()
        audio.start = Mock(side_effect=TelephonyError('Synthetic failure'))
        gateway = self.gateway(audio_factory=lambda _: audio)
        draft = self.draft(); gateway.request('/v1/calls', draft)
        self.assertEqual(self.finish(gateway, draft)['state'], 'failed')
        self.assertFalse(self.clients[0].dialed)
        self.assertTrue(audio.closed)

    def test_voice_output_failure_after_connection_is_not_reported_as_success(self):
        audio = SimulatedAudio()
        audio.write = Mock(side_effect=TelephonyError('Synthetic output disconnected'))
        gateway = self.gateway(audio_factory=lambda _: audio)
        draft = self.draft(); gateway.request('/v1/calls', draft)
        result = self.finish(gateway, draft)
        self.assertEqual(result['state'], 'failed')
        self.assertTrue(result['metrics']['failed'])
        self.assertTrue(self.clients[0].ended)
        self.assertTrue(self.providers[0].muse.closed)

    def test_uncertain_hangup_blocks_retries_even_after_restart(self):
        class Uncertain(SimulatedClient):
            def hangup(self):
                raise TelephonyError('Synthetic UI disappeared')
        gateway = self.gateway(client_factory=lambda _: Uncertain())
        draft = self.draft(); gateway.request('/v1/calls', draft)
        self.assertEqual(self.finish(gateway, draft)['state'], 'uncertain')
        gateway.close()
        restarted = self.gateway()
        self.assertEqual(restarted.request('/v1/calls', draft)['state'], 'uncertain')
        with self.assertRaisesRegex(TelephonyError, 'por confirmar'):
            restarted.request('/v1/calls', self.draft())

    def test_wrong_origin_and_unknown_channel_are_rejected(self):
        bridge = TelephoneBridge(); bridge._trusted = Mock(side_effect=TelephonyError('Foreign origin'))
        with self.assertRaises(TelephonyError):
            bridge.workspace_telephone_prepare(DESTINATION, 'x', 'whatsapp_client')
        bridge._trusted = lambda: None
        with self.assertRaises(TelephonyError):
            bridge.workspace_telephone_info('arbitrary')


class UIAdapterTests(unittest.TestCase):
    def backend(self):
        values = {'recipient': '+1 (829) 555-0101', 'state': '00:03'}
        return SimpleNamespace(attach=Mock(), text=Mock(side_effect=lambda key: values[key]),
                               invoke=Mock(), values=values)

    def test_exact_recipient_and_fixed_chat_uri_before_invoke(self):
        backend = self.backend(); opener = Mock()
        client = OfficialWhatsAppClient({}, backend=backend, opener=opener)
        client.prepare(DESTINATION, threading.Event())
        backend.invoke.assert_not_called()
        opener.assert_called_once_with('whatsapp://send?phone=18295550101')
        client.dial(DESTINATION)
        backend.invoke.assert_called_once_with('call')
        self.assertEqual(client.state(), 'in-progress')
        client.hangup(); self.assertEqual(backend.invoke.call_args.args, ('hangup',))

    def test_changed_chat_rejects_dial_and_does_not_hangup_another_recipient(self):
        backend = self.backend(); client = OfficialWhatsAppClient({}, backend=backend, opener=Mock())
        backend.values['recipient'] = '+18495550102'
        with self.assertRaises(TelephonyError):
            client.dial(DESTINATION)
        backend.invoke.assert_not_called()
        backend.values['recipient'] = DESTINATION
        client.dial(DESTINATION)
        backend.values['recipient'] = '+18495550102'
        with self.assertRaises(TelephonyError):
            client.hangup()
        self.assertEqual(backend.invoke.call_count, 1)

    def test_recipient_extraction_is_not_a_search_inside_untrusted_text(self):
        for value in ('Contact 18295550101 says call me', '18295550101;run', '<b>18295550101</b>'):
            self.assertIsNone(displayed_number(value))
        self.assertEqual(displayed_number('+1 (829) 555-0101'), DESTINATION)

    def test_canceled_prepare_has_no_launch_or_control_action(self):
        stopped = threading.Event(); stopped.set(); opener = Mock(); backend = self.backend()
        with self.assertRaises(TelephonyError):
            OfficialWhatsAppClient({}, backend=backend, opener=opener).prepare(DESTINATION, stopped)
        opener.assert_not_called(); backend.attach.assert_not_called()

    def test_existing_call_is_rejected_and_ready_after_connection_means_ended(self):
        backend = self.backend(); backend.ready_for_call = Mock(return_value=False)
        client = OfficialWhatsAppClient({}, backend=backend, opener=Mock())
        with self.assertRaises(TelephonyError):client.dial(DESTINATION)
        backend.invoke.assert_not_called()
        backend.ready_for_call.return_value = True
        client.dial(DESTINATION); self.assertEqual(client.state(),'in-progress')
        backend.values['state'] = 'ready'
        self.assertEqual(client.state(),'completed')


class AudioTests(unittest.TestCase):
    def test_interruption_clears_audio_and_commits_only_acknowledged_response(self):
        from tests.test_telephony_realtime import SyntheticProviders
        providers = SyntheticProviders(); providers.model_finish.set()
        client, audio = SimulatedClient(), SimulatedAudio()
        socket = ClientSocket(client, audio, str(uuid4()), lambda _: None)
        socket.start(DESTINATION, threading.Event())
        session = LivePhoneSession(socket, socket.stream_id, 'Ensayo local.', socket.closed,
                                   providers, max_seconds=15, audio_format='virtual_pcm_24000')
        worker = threading.Thread(target=session.run, daemon=True); worker.start()
        try:
            until(lambda: len(providers.spoken) == 1 and session.current is None)
            providers.block_tts = True
            providers.muse.utterance(1, 'Primer turno sintético.')
            until(lambda: len(providers.spoken) >= 2 and audio.packets >= 2)
            providers.muse.utterance(2, 'Interrumpo para continuar.')
            until(lambda: session.metrics['interrupted'] >= 1)
            providers.block_tts = False
            until(lambda: session.metrics['completed_turns'] >= 1)
            self.assertGreaterEqual(audio.clears, 1)
            self.assertEqual(sum(role == 'assistant' for role, _ in session.history), 1)
            socket._event('stop'); worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertFalse(session.metrics['failed'])
        finally:
            session.close(); socket.shutdown(); worker.join(3)

    def test_readiness_requires_two_distinct_virtual_buses(self):
        sc = SimpleNamespace(all_speakers=lambda: [SimpleNamespace(id='rx', name='Virtual RX'),
             SimpleNamespace(id='tx', name='CABLE TX'), SimpleNamespace(id='physical', name='Realtek Speakers')])
        self.assertEqual(VirtualAudio.readiness({'receive_device': 'rx', 'transmit_device': 'tx'}, soundcard=sc), '')
        for rx, tx in (('rx','rx'), ('rx','physical'), ('missing','tx')):
            self.assertTrue(VirtualAudio.readiness({'receive_device': rx, 'transmit_device': tx}, soundcard=sc))

    def test_virtual_streams_pcm_stereo_clear_and_close_with_substituted_devices(self):
        import numpy as np
        captured, played, players = [], [], []
        def record(numframes):
            time.sleep(.01)
            return np.full((numframes, 2), .25, dtype='float32')
        def player(**_):
            stream = SimpleNamespace(play=lambda data: played.append(data.copy()))
            players.append(stream)
            return nullcontext(stream)
        microphone = SimpleNamespace(isloopback=True, recorder=lambda **_: nullcontext(SimpleNamespace(record=record)))
        sc = SimpleNamespace(get_microphone=Mock(return_value=microphone),
                             get_speaker=Mock(return_value=SimpleNamespace(player=player)))
        audio = VirtualAudio('rx', 'tx', soundcard=sc)
        self.addCleanup(audio.close)
        audio.start(lambda pcm: captured.append(pcm) if not captured else None, lambda: None)
        audio.write(b'\0\x40' * 960)
        audio.clear()
        audio.write(b'\0\x20' * 960)
        until(lambda: bool(captured))
        audio.close()
        self.assertEqual(len(players), 2)
        self.assertEqual(played[0].shape, (960, 2))
        self.assertAlmostEqual(float(played[0][0, 0]), .5)
        self.assertEqual(len(captured[0]), 1920)
        sc.get_microphone.assert_called_once_with(id='rx', include_loopback=True)
        self.assertTrue(all(not thread.is_alive() for thread in audio.threads))

    def test_pcm_shape_limits_are_checked_before_output(self):
        audio = VirtualAudio('rx', 'tx')
        for raw in (b'', b'a', b'a'*3842, 'not bytes'):
            with self.assertRaises(TelephonyError):
                audio.write(raw)

    def test_input_before_connection_is_discarded(self):
        socket = ClientSocket(SimulatedClient(), SimulatedAudio(), str(uuid4()), lambda _: None)
        socket.capture(b'\0\0' * 960)
        self.assertTrue(socket.events.empty())
        socket.connected = True
        socket.capture(b'x')
        self.assertTrue(socket.failed)
        socket.shutdown()

    def test_input_backlog_is_bounded_and_overflow_stops_the_session(self):
        socket = ClientSocket(SimulatedClient(), SimulatedAudio(), str(uuid4()), lambda _: None)
        socket.connected = True
        for _ in range(40):socket.capture(b'\0\0' * 960)
        self.assertLessEqual(socket.events.qsize(), 32)
        self.assertTrue(socket.failed)
        self.assertTrue(socket.closed.is_set())
        socket.shutdown()


if __name__ == '__main__':
    unittest.main()
