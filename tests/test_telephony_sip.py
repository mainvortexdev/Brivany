"""Native SIP leg for Telnyx: diagnostics, URI format and loopback RTP with paid providers replaced."""
import base64
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from desktop.experience.telephony import TelephoneBridge
from services.telephony.common import TelephonyError
from services.telephony.realtime import LivePhoneSession
from services.telephony.sip import NativeSIP
from services.telephony.telnyx import TelnyxAccount, TelnyxGateway
from tests.test_telephony_realtime import SyntheticProviders, pcm

DESTINATION = '+18295550101'
OTHER = '+18495550102'


def until(predicate, seconds=4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('Local SIP fixture timed out.')


class NativeSIPTests(unittest.TestCase):
    def test_sip_response_diagnostic_exports_codes_without_headers_or_private_identifiers(self):
        from services.telephony.sip_engine import response_diagnostic
        message='SIP/2.0 403 Forbidden\r\nCSeq: 123 INVITE\r\nReason: Q.850;cause=21;text="Call rejected"\r\nAuthorization: Digest secret-fixture\r\nTo: <sip:+18095550100@example.test>\r\nCall-ID: private-call-id\r\nWarning: 399 example.test "Rejected"\r\n\r\n'
        self.assertEqual(response_diagnostic(message),{'sip_status':403,'method':'INVITE','reason_protocol':'Q.850','reason_cause':21,'warning_code':399})
        self.assertIsNone(response_diagnostic('INVITE sip:test SIP/2.0\r\n'))
        self.assertIsNone(response_diagnostic('SIP/2.0 200 OK\r\nCSeq: 123 REGISTER\r\n'))
    def test_telnyx_destinations_and_registrar_use_e164_sip_uris(self):
        from services.telephony.sip_engine import target
        self.assertEqual(target('sip.telnyx.com', 5060, 'udp', DESTINATION), 'sip:+18295550101@sip.telnyx.com:5060')
        self.assertEqual(target('sip.telnyx.com', 5060, 'tcp'), 'sip:sip.telnyx.com:5060;transport=tcp')
        self.assertEqual(target('sip.telnyx.com', 5061, 'tls', DESTINATION), 'sips:+18295550101@sip.telnyx.com:5061')

    def test_worker_scoped_to_one_number_refuses_any_other_before_starting(self):
        configuration = TelnyxAccount('syntheticuser', 'synthetic-password', caller_id='+18095550100').engine()
        configuration['allow'] = [OTHER]
        native = NativeSIP(configuration, str(uuid4()), lambda _:None)
        with self.assertRaises(TelephonyError):
            native.start(DESTINATION)
        self.assertIsNone(native.process)

    def test_early_media_does_not_complete_call_start_until_answered(self):
        configuration = TelnyxAccount('syntheticuser', 'synthetic-password', caller_id='+18095550100').engine()
        configuration['allow'] = [DESTINATION]
        native = NativeSIP(configuration, str(uuid4()), lambda _:None)
        native.ready = native.media_ready = True
        finished = threading.Event()
        with patch.object(native, 'connect', return_value=native), patch.object(native, '_command'):
            worker = threading.Thread(target=lambda:(native.start(DESTINATION),finished.set()), daemon=True)
            worker.start()
            self.assertFalse(finished.wait(.08))
            with native.condition:
                native.answered = True
                native.condition.notify_all()
            self.assertTrue(finished.wait(1))
            worker.join(1)


@unittest.skipUnless((Path(__file__).resolve().parents[1]/'.local/tools/pjsua2-runtime').is_dir(),
                     'Native PJSUA2 runtime is not installed.')
class SIPLiveLoopbackTests(unittest.TestCase):
    def test_native_registration_reaches_a_loopback_registrar_without_dialing(self):
        """Exercise register=True, which peer-to-peer RTP tests do not enter.

        The local registrar accepts REGISTER without a digest challenge. This
        checks worker startup and registration events, not carrier authentication.
        """
        registrar = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        registrar.bind(('127.0.0.1', 0))
        registrar.settimeout(.1)
        stopped = threading.Event()
        methods = []

        def serve():
            while not stopped.is_set():
                try:
                    packet, address = registrar.recvfrom(8192)
                except socket.timeout:
                    continue
                except OSError:
                    return
                lines = packet.decode('utf-8').split('\r\n')
                method = lines[0].split(' ', 1)[0]
                methods.append(method)
                if method != 'REGISTER':
                    continue
                headers = {}
                for line in lines[1:]:
                    key, separator, value = line.partition(':')
                    if separator:
                        headers.setdefault(key.lower(), []).append(value.strip())
                response = ['SIP/2.0 200 OK']
                for name in ('via', 'from', 'to', 'call-id', 'cseq', 'contact'):
                    for value in headers.get(name, []):
                        if name == 'to' and ';tag=' not in value:
                            value += ';tag=local-registrar'
                        response.append(name + ': ' + value)
                response.extend(['Expires: ' + headers.get('expires', ['300'])[0],
                                 'Content-Length: 0', '', ''])
                registrar.sendto('\r\n'.join(response).encode('utf-8'), address)

        server = threading.Thread(target=serve, daemon=True)
        native = NativeSIP({'server': '127.0.0.1', 'port': registrar.getsockname()[1],
                            'transport': 'udp', 'username': 'synthetic-user',
                            'password': 'synthetic-password', 'bind': '127.0.0.1',
                            'register': True, 'allow': []}, str(uuid4()), lambda _:None)
        server.start()
        try:
            native.connect()
            self.assertTrue(native.ready)
            self.assertTrue(native.registered)
            self.assertEqual(native.registration_status, 200)
        finally:
            native.shutdown()
            stopped.set()
            server.join(1)
            registrar.close()
        self.assertTrue(methods)
        self.assertEqual(set(methods), {'REGISTER'})

    def test_desktop_confirm_drives_native_gateway_and_hangup_finishes_receipt(self):
        from tools.check_sip_native import Peer
        peer = Peer('gateway-receiver')
        self.addCleanup(peer.close)
        created = []
        def factory(configuration, call_id, notify):
            native = NativeSIP({'server':'127.0.0.1', 'port':5060, 'transport':'udp',
                'username':'gateway-caller', 'password':'', 'register':False, 'bind':'127.0.0.1',
                'peer':True}, call_id, notify, local_peer_port=peer.port)
            created.append(native)
            return native
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        providers = SyntheticProviders()
        providers.model_finish.set()
        gateway = TelnyxGateway(Path(directory.name)/'telnyx.sqlite3',
            TelnyxAccount('syntheticuser', 'synthetic-password', caller_id='+18095550100'),
            providers, native_factory=factory)
        self.addCleanup(gateway.close)
        class Desktop(TelephoneBridge):
            def _trusted(self):
                pass
            def _telephone_gateway(self):
                return gateway
        desktop = Desktop()
        from services.telephony.whatsapp_client_settings import ClientSettings
        desktop._whatsapp_call_settings = ClientSettings(Path(directory.name)/'client.json')
        draft = desktop.workspace_telephone_prepare(DESTINATION, 'Dos turnos de prueba local.')
        self.assertEqual(created, [])
        desktop.workspace_telephone_confirm(draft['id'])
        until(lambda:desktop.workspace_telephone_status(draft['id'])['state'] == 'in-progress', 8)
        until(lambda:len(providers.spoken) == 1)
        time.sleep(.2)  # Wait for the synthetic opening's RTP clock.
        providers.muse.utterance(1, 'Primer turno de prueba del panel.')
        until(lambda:len(providers.spoken) >= 3)
        time.sleep(.3)
        providers.muse.utterance(2, 'Segundo turno de prueba del panel.')
        until(lambda:len(providers.spoken) >= 5)
        time.sleep(.3)
        peer.send({'type':'hangup', 'id':'peer'})
        until(lambda:not gateway.worker.is_alive())
        self.assertEqual(desktop.workspace_telephone_status(draft['id'])['state'], 'completed')
        self.assertEqual(len(created), 1)
        self.assertTrue(providers.muse.closed.is_set())

    def test_native_rtp_connects_live_pcm_and_two_reply_turns_then_remote_hangup(self):
        from tools.check_sip_native import Peer
        peer = Peer('receiver')
        self.addCleanup(peer.close)
        call_id = str(uuid4())
        states = []
        native = NativeSIP({'server':'127.0.0.1', 'port':5060, 'transport':'udp',
            'username':'caller', 'password':'', 'register':False, 'bind':'127.0.0.1',
            'peer':True}, call_id, states.append, local_peer_port=peer.port)
        self.addCleanup(native.shutdown)
        native.start(DESTINATION)
        self.assertTrue(any(event.get('type') == 'sip_response' and
                            event.get('method') == 'INVITE' and
                            event.get('sip_status') == 200 for event in states))
        providers = SyntheticProviders()
        session = LivePhoneSession(native, native.stream_id, 'Prueba de conversación sintética.',
                                   native.closed, providers, audio_format='pcm_24000', max_seconds=12)
        worker = threading.Thread(target=session.run, daemon=True)
        worker.start()
        self.addCleanup(session.close)
        until(lambda:providers.spoken and session.current is None)
        while not peer.events.empty():
            peer.events.get_nowait()
        peer.send({'type':'audio', 'id':'peer', 'pcm':base64.b64encode(pcm(.08)).decode()})
        until(lambda:any(any(block) for block in providers.muse.audio))
        self.assertTrue(all(len(block) <= 9600 and len(block)%2 == 0 for block in providers.muse.audio))
        providers.muse.utterance(1, 'Primer turno sintético.')
        peer.wait('audio', condition=lambda event:any(base64.b64decode(event['pcm'])))
        self.assertFalse(providers.model_ended)
        providers.model_finish.set()
        until(lambda:session.metrics['completed_turns'] == 1)
        providers.muse.utterance(2, 'Segundo turno sintético.')
        until(lambda:session.metrics['completed_turns'] == 2)
        peer.send({'type':'hangup', 'id':'peer'})
        worker.join(4)
        self.assertFalse(worker.is_alive())
        self.assertFalse(session.metrics['failed'])
        self.assertEqual(session.metrics['audio_ack_boundary'], 'rtp_submitted')
        self.assertEqual(session.history, [])
        self.assertTrue(providers.muse.closed.is_set())
        self.assertTrue(any(event.get('state') == 'completed' for event in states))


if __name__ == '__main__':
    unittest.main()
