"""Call Control contracts on loopback with synthetic keys, audio and providers."""
import asyncio
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
from urllib.parse import urlsplit
from uuid import uuid4
from unittest.mock import patch

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from services.telephony.call_control import CallControl, ControlConfig, rd_number, valid_signature
from services.telephony.call_control_http import create_app
from services.telephony.call_control_client import ControlClient
from services.telephony.common import ProviderError, TelephonyError
from services.telephony.telnyx_media import decode_mulaw, encode_mulaw, PhoneResampler
from tests.test_telephony_realtime import SyntheticProviders, pcm
from tools.setup_telnyx_control import save_environment,reconnect_control

CALLER, DESTINATION = '+18295550100', '+18495550101'
SECRET = 'synthetic-control-token-' + 'x' * 24


class FakeAPI:
    def __init__(self):
        self.requests = []
        self.error = None
        self.block = None
        self.entered = threading.Event()

    def request(self, method, path, body=None, params=None):
        self.requests.append((method, path, body))
        if path == '/calls':
            if self.error:
                raise self.error
            return {'data': {'call_control_id': 'v3:synthetic-' + body['command_id']}}
        if self.block:
            self.entered.set()
            self.block.wait(4)
        return {'data': {'result': 'ok'}}


class Fixture:
    def setup_fixture(self, worker=False):
        self.directory = tempfile.TemporaryDirectory()
        self.signer = Ed25519PrivateKey.generate()
        key = base64.b64encode(self.signer.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()
        self.config = ControlConfig('10001', CALLER, 'https://calls.example.test', key, SECRET)
        self.api = FakeAPI()
        self.calls = CallControl(Path(self.directory.name) / 'calls.sqlite3', self.config, self.api,
                                 voice_ready=lambda: True, start_worker=worker)

    def payload(self, mode='message', identifier=None):
        return {'id': identifier or str(uuid4()), 'to': DESTINATION, 'mode': mode,
                'confirmed': True, 'objective': 'Encargo privado sintético.', 'message': 'Mensaje privado sintético.'}

    def event(self, identifier, kind, event_id=None, **extra):
        body = {'data': {'id': event_id or str(uuid4()), 'event_type': kind,
                        'occurred_at': datetime.now(timezone.utc).isoformat(),
                        'payload': {'call_control_id': 'v3:synthetic-' + identifier,
                                    'client_state': base64.b64encode(identifier.encode()).decode(),
                                    'connection_id': self.config.connection_id, **extra}}}
        raw = json.dumps(body).encode()
        return raw, self.headers(raw)

    def headers(self, body):
        timestamp = str(int(time.time()))
        signature = base64.b64encode(self.signer.sign(timestamp.encode() + b'|' + body)).decode()
        return {'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp}

    def receive(self, identifier, kind, event_id=None, **extra):
        raw, headers = self.event(identifier, kind, event_id, **extra)
        return self.calls.receive(raw, headers['telnyx-signature-ed25519'], headers['telnyx-timestamp'])


class ControlTests(Fixture, unittest.TestCase):
    def setUp(self):
        self.setup_fixture()
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.calls.close)

    def test_rd_validation_happens_before_any_dial(self):
        for value in ('+18095550100', '+18295550100', '+18495550100'):
            self.assertEqual(rd_number(value), value)
        for value in ('8495550101', '+1 8495550101', '+1849555010', '+184955501010', '+12125550100', 'sip:test@example.test'):
            with self.subTest(number=value), self.assertRaises(TelephonyError):
                self.calls.start({**self.payload(), 'to': value})

    def test_reconnecting_changes_only_existing_application_webhook_without_call_or_budget_mutation(self):
        api_calls=[];saved={'application_name':'Brivany Melodi Call Control','active':True,'webhook_event_url':self.config.webhook,'outbound':{'channel_limit':1,'outbound_voice_profile_id':'existing-profile'}}
        class API:
            def request(_self,method,path,body=None):
                api_calls.append((method,path,body))
                if method=='PATCH':saved.update(body)
                return {'data':dict(saved)}
        path=Path(self.directory.name)/'reconnect.env';path.write_text('UNRELATED=preserved\n')
        with patch('tools.setup_telnyx_control.load_local_config'),patch('tools.setup_telnyx_control.load_environment'),patch('tools.setup_telnyx_control.ControlConfig.environment',return_value=self.config),patch.dict('os.environ',{},clear=False):
            result=reconnect_control('https://replacement.example.test',api=API(),path=path)
        self.assertEqual([call for call in api_calls if call[0]!='GET'],[('PATCH','/call_control_applications/10001',{'webhook_event_url':'https://replacement.example.test/webhooks/telnyx'})])
        self.assertEqual(result.token,self.config.token);self.assertEqual(result.from_number,CALLER)
        self.assertIn('UNRELATED=preserved',path.read_text());self.assertEqual(saved['outbound']['channel_limit'],1)
        with self.assertRaises(TelephonyError):
            self.calls.start({**self.payload(), 'confirmed': False})
        self.assertEqual(self.api.requests, [])

    def test_dial_uses_the_call_control_app_and_exact_webhook_from_and_command_id(self):
        value = self.payload()
        self.calls.start(value)
        method, path, body = self.api.requests[0]
        self.assertEqual((method, path), ('POST', '/calls'))
        self.assertEqual((body['to'], body['from']), (DESTINATION, CALLER))
        self.assertEqual(body['connection_id'], '10001')
        self.assertEqual(body['webhook_url'], 'https://calls.example.test/webhooks/telnyx')
        self.assertEqual(body['command_id'], value['id'])
        self.assertNotIn('answering_machine_detection', body)
        self.calls.start(value)
        self.assertEqual(len(self.api.requests), 1)
        with self.assertRaises(TelephonyError):
            self.calls.start({**value, 'message': 'Otro mensaje.'})

    def test_signature_covers_raw_body_and_timestamp_and_refuses_replay(self):
        raw, headers = self.event(str(uuid4()), 'call.answered')
        signature, timestamp = headers.values()
        self.assertTrue(valid_signature(self.config.verification_key, raw, signature, timestamp))
        self.assertFalse(valid_signature(self.config.verification_key, raw + b' ', signature, timestamp))
        self.assertFalse(valid_signature(self.config.verification_key, raw, signature, timestamp, now=int(timestamp)+301))
        self.assertFalse(valid_signature(self.config.verification_key, raw, signature, timestamp, now=int(timestamp)-301))
        with self.assertRaises(PermissionError):
            self.calls.receive(raw, '', timestamp)

    def test_duplicate_answer_events_produce_one_speak_and_ended_one_hangup(self):
        value = self.payload()
        self.calls.start(value)
        event_id = str(uuid4())
        self.assertTrue(self.receive(value['id'], 'call.answered', event_id))
        self.assertFalse(self.receive(value['id'], 'call.answered', event_id))
        self.receive(value['id'], 'call.answered')
        while self.calls.process_one():
            pass
        self.assertEqual([p.rsplit('/', 1)[-1] for _, p, _ in self.api.requests], ['calls', 'speak'])
        self.receive(value['id'], 'call.speak.ended')
        self.calls.process_one()
        self.assertTrue(self.api.requests[-1][1].endswith('/hangup'))
        self.receive(value['id'], 'call.hangup', hangup_cause='NORMAL_CLEARING')
        self.assertEqual(self.calls.status(value['id'])['state'], 'completed')
        self.assertIsNotNone(self.calls.status(value['id'])['duration_seconds'])

    def test_hangup_received_before_answer_work_prevents_late_speech(self):
        value = self.payload()
        self.calls.start(value)
        self.receive(value['id'], 'call.answered')
        self.receive(value['id'], 'call.hangup', hangup_cause='NORMAL_CLEARING')
        self.receive(value['id'], 'call.initiated')
        self.receive(value['id'], 'call.answered')
        while self.calls.process_one():
            pass
        self.assertEqual(len(self.api.requests), 1)
        self.assertEqual(self.calls.status(value['id'])['state'], 'completed')

    def test_unowned_webhooks_never_start_voice_or_create_a_call(self):
        self.assertFalse(self.receive(str(uuid4()), 'call.answered'))
        self.assertEqual(self.api.requests, [])

    def test_uncertain_dial_is_not_retried_and_signed_event_can_recover_it(self):
        self.api.error = ProviderError('Synthetic timeout.', uncertain=True)
        value = self.payload()
        self.assertEqual(self.calls.start(value)['state'], 'uncertain')
        self.calls.start(value)
        self.assertEqual(len(self.api.requests), 1)
        self.receive(value['id'], 'call.answered')
        self.assertEqual(self.calls.status(value['id'])['state'], 'in-progress')

    def test_provider_refusal_and_second_concurrent_call_do_not_redial(self):
        self.api.error = ProviderError('Sintético 403.', http_status=403)
        value = self.payload()
        with self.assertRaises(ProviderError):
            self.calls.start(value)
        self.assertEqual(self.calls.start(value)['state'], 'failed')
        self.assertEqual(len(self.api.requests), 1)
        self.api.error = None
        self.calls.start(self.payload())
        with self.assertRaises(TelephonyError):
            self.calls.start(self.payload())

    def test_cancel_during_dial_hangs_up_once_when_the_control_id_arrives(self):
        original = self.api.request
        entered, release = threading.Event(), threading.Event()
        def request(method, path, body=None, params=None):
            if path == '/calls':
                entered.set()
                release.wait(2)
            return original(method, path, body, params)
        value = self.payload()
        self.api.request = request
        worker = threading.Thread(target=self.calls.start, args=(value,))
        worker.start()
        self.assertTrue(entered.wait(1))
        self.calls.cancel(value['id'])
        release.set()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(sum(path.endswith('/hangup') for _, path, _ in self.api.requests), 1)

    def test_unrelated_signed_connection_cannot_bind_an_uncertain_call(self):
        self.api.error = ProviderError('Synthetic timeout.', uncertain=True)
        value = self.payload()
        self.calls.start(value)
        self.assertFalse(self.receive(value['id'], 'call.answered', connection_id='99999'))
        self.assertTrue(self.receive(value['id'], 'call.answered'))
        self.assertEqual(self.calls.status(value['id'])['result'], '')

    def test_provision_uses_a_call_control_application_and_preserves_sip_credentials(self):
        from tools.setup_telnyx_control import provision_control
        from services.telephony.telnyx import NAME
        key = self.config.verification_key
        requests, application = [], {}
        class AccountAPI:
            _key = 'KEY01234567890123456789_synthetic'
            def phone_numbers(self): return []
            def verified_numbers(self): return [{'phone_number': CALLER}]
            def items(self, path):
                return [{'id': '20001', 'name': NAME}] if path == '/outbound_voice_profiles' else []
            def request(self, method, path, body=None):
                requests.append((method, path, body))
                if path == '/public_key': return {'data': {'public': key}}
                if path.startswith('/outbound_voice_profiles/'):
                    return {'data': {'id': '20001', **body}}
                if method == 'POST': application.update(id='30001', **body)
                return {'data': application.copy()}
        path = Path(self.directory.name) / 'setup.env'
        with patch('tools.setup_telnyx_control.load_local_config'), patch.dict('os.environ', {}, clear=True):
            config = provision_control(self.config.origin, CALLER, api=AccountAPI(), path=path)
        self.assertEqual(config.connection_id, '30001')
        self.assertEqual(application['webhook_event_url'], config.webhook)
        self.assertEqual(application['outbound']['outbound_voice_profile_id'], '20001')
        self.assertEqual(application['webhook_api_version'], '2')
        self.assertFalse(any('/credential_connections' in path for _, path, _ in requests))
        self.assertIn('TELNYX_CONNECTION_ID=30001', path.read_text(encoding='utf-8'))

    def test_no_objective_message_credentials_or_full_numbers_in_journal_or_status(self):
        value = self.payload()
        self.calls.start(value)
        self.receive(value['id'], 'call.hangup', hangup_cause='UNALLOCATED_NUMBER')
        data = '\n'.join(self.calls.db.iterdump()) + json.dumps(self.calls.status(value['id']))
        for secret in (value['objective'], value['message'], CALLER, DESTINATION, SECRET):
            self.assertNotIn(secret, data)

    def test_restart_marks_interrupted_and_never_replays_dial(self):
        value = self.payload()
        self.calls.start(value)
        # A separate connection simulates process recovery, not a second API call.
        restored = CallControl(Path(self.directory.name) / 'calls.sqlite3', self.config, self.api,
                               voice_ready=lambda: True, start_worker=False)
        try:
            self.assertEqual(restored.start(value)['state'], 'interrupted')
            self.assertEqual(len(self.api.requests), 1)
        finally:
            restored.close()

    def test_environment_merge_preserves_unrelated_lines_and_newlines(self):
        path = Path(self.directory.name) / 'config.env'
        path.write_bytes(b'# keep\r\nUNRELATED=unchanged\r\nTELNYX_CONNECTION_ID=old\r\n')
        save_environment({'TELNYX_CONNECTION_ID': '10001', 'WEBHOOK_BASE_URL': self.config.origin}, path)
        text = path.read_bytes()
        self.assertIn(b'UNRELATED=unchanged\r\n', text)
        self.assertEqual(text.count(b'TELNYX_CONNECTION_ID='), 1)
        self.assertIn(b'WEBHOOK_BASE_URL=https://calls.example.test\r\n', text)

    def test_mulaw_codec_matches_native_reference_and_resampling_is_bounded(self):
        try:
            import audioop
        except ImportError:
            audioop = None
        if audioop:
            self.assertEqual(decode_mulaw(bytes(range(256))), audioop.ulaw2lin(bytes(range(256)), 2))
            samples = b''.join(struct.pack('<h', value) for value in range(-32768, 32768))
            self.assertEqual(encode_mulaw(samples), audioop.lin2ulaw(samples, 2))
        codec = PhoneResampler()
        encoded = codec.encode(pcm(.08))
        decoded = codec.decode(base64.b64encode(encoded).decode())
        self.assertTrue(0 < len(encoded) <= 640)
        self.assertTrue(0 < len(decoded) <= 3840)
        self.assertTrue(any(decoded))


class HTTPTests(Fixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.setup_fixture(worker=True)
        self.providers = SyntheticProviders()
        self.providers.model_finish.set()
        self.client = TestClient(TestServer(create_app(self.calls, lambda: self.providers)))
        await self.client.start_server()
        self.auth = {'Authorization': 'Bearer ' + SECRET}

    async def asyncTearDown(self):
        if self.api.block:
            self.api.block.set()
        await self.client.close()
        self.directory.cleanup()

    async def test_outbound_requires_local_token_confirmation_and_no_browser_origin(self):
        self.assertEqual((await self.client.post('/api/calls/outbound', json=self.payload())).status, 401)
        self.assertEqual((await self.client.post('/api/calls/outbound', json=self.payload(), headers={**self.auth, 'Origin': 'https://untrusted.test'})).status, 401)
        self.assertEqual((await self.client.post('/api/calls/outbound', json={**self.payload(), 'confirmed': False}, headers=self.auth)).status, 422)
        self.assertEqual(self.api.requests, [])
        self.assertEqual((await self.client.get('/health')).status, 200)
        self.assertEqual((await self.client.get('/.env')).status, 404)

    async def test_signed_webhook_ack_does_not_wait_for_provider_action(self):
        value = self.payload()
        self.calls.start(value)
        self.api.block = threading.Event()
        raw, headers = self.event(value['id'], 'call.answered')
        response = await asyncio.wait_for(self.client.post('/webhooks/telnyx', data=raw, headers={**headers, 'Content-Type': 'application/json'}), timeout=1.5)
        self.assertEqual(response.status, 200)
        self.assertFalse(self.api.block.is_set())
        duplicate = await self.client.post('/webhooks/telnyx', data=raw, headers={**headers, 'Content-Type': 'application/json'})
        self.assertFalse((await duplicate.json())['accepted'])
        self.api.block.set()

    async def test_unsigned_webhook_cannot_advance_call_and_client_maps_review(self):
        value = self.payload()
        raw, _ = self.event(value['id'], 'call.answered')
        self.assertEqual((await self.client.post('/webhooks/telnyx', data=raw, headers={'Content-Type': 'application/json'})).status, 401)
        config = ControlConfig(self.config.connection_id, CALLER, self.config.origin,
                               self.config.verification_key, SECRET, self.client.server.port)
        client = ControlClient(config)
        result = await asyncio.to_thread(client.request, '/v1/calls', {'id': value['id'], 'destination': DESTINATION, 'objective': 'Conversación sintética.'})
        self.assertEqual(result['mode'], 'conversation')
        self.assertEqual(result['state'], 'dialing')

    async def test_real_websocket_bridge_uses_synthetic_voice_pcm_and_zero_to_hangup(self):
        value = self.payload('conversation')
        self.calls.start(value)
        self.receive(value['id'], 'call.answered')
        path = urlsplit(self.calls.media_url(value['id'])).path
        unsigned = await self.client.get(path)
        self.assertEqual(unsigned.status, 401)
        headers = self.headers(self.calls.media_url(value['id']).encode())
        ws = await self.client.ws_connect(path, headers=headers)
        stream = 'synthetic-media-stream'
        await ws.send_json({'event': 'connected', 'version': '1.0.0'})
        await ws.send_json({'event': 'start', 'stream_id': stream, 'start': {
            'call_control_id': 'v3:synthetic-' + value['id'],
            'media_format': {'encoding': 'PCMU', 'sample_rate': 8000, 'channels': 1}}})
        packets, sent_input, sent_zero = 0, False, False
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            message = await ws.receive(timeout=6)
            if message.type != WSMsgType.TEXT:
                break
            event = json.loads(message.data)
            if event['event'] == 'media':
                packets += 1
                self.assertTrue(any(decode_mulaw(base64.b64decode(event['media']['payload']))))
            elif event['event'] == 'mark':
                await ws.send_json({'event': 'mark', 'stream_id': stream, 'mark': event['mark']})
                if not sent_input:
                    for _ in range(8):
                        await ws.send_json({'event': 'media', 'stream_id': stream, 'media': {'track': 'inbound', 'payload': base64.b64encode(b'\xce' * 160).decode()}})
                    for _ in range(100):
                        if self.providers.muse.audio:
                            break
                        await asyncio.sleep(.01)
                    self.providers.muse.utterance(1, 'Intervención sintética.')
                    sent_input = True
                if len(self.providers.spoken) >= 3 and not sent_zero:
                    await ws.send_json({'event': 'dtmf', 'stream_id': stream, 'dtmf': {'digit': '0'}})
                    sent_zero = True
        await ws.close()
        for _ in range(100):
            if any(path.endswith('/hangup') for _, path, _ in self.api.requests):
                break
            await asyncio.sleep(.01)
        self.assertTrue(sent_zero)
        self.assertGreater(packets, 0)
        self.assertTrue(any(any(block) for block in self.providers.muse.audio))
        self.assertTrue(any(path.endswith('/hangup') for _, path, _ in self.api.requests))
        metrics = self.calls.status(value['id'])['conversation']
        self.assertEqual(metrics['audio_ack_boundary'], 'telnyx_playback_mark')
        self.assertFalse(metrics['failed'])


if __name__ == '__main__':
    unittest.main()
