"""Owned HTTP callbacks, fake telephony/voice/model. Never calls a real number."""
import base64
from contextlib import contextmanager
import hashlib
import hmac
from http.client import HTTPConnection
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode, urlsplit
from uuid import uuid4
import wave
from xml.etree import ElementTree as ET

from desktop.experience.telephony import TelephoneBridge
from services.telephony.dialogue import Reply
from services.telephony.server import Server
from services.telephony.service import Calls
from services.telephony.trial import LimitedTrialTransport, TrialHandler, TrialProxyVerifier, load_trial_credentials, trial_config
from services.telephony.twilio import Configuration, ProviderError, TelephonyError, Twilio, number

DID = '+18095550100'
DESTINATION = '+18295550101'
CALL = 'CA' + '1' * 32
INCOMING = 'CA' + '2' * 32
RECORDING = 'RE' + '3' * 32
GOAL = 'Consulta el horario de la prueba.'


class TestTransport:
    def __init__(self):
        self.started, self.hangups, self.media = [], [], []
        self.failure = None

    def start(self, *args):
        self.started.append(args)
        if self.failure:
            raise self.failure
        return CALL

    def hangup(self, value):
        self.hangups.append(value)
        return 'canceled'

    def recording(self, value):
        self.media.append(value)
        return b'ID3-synthetic-recording'


class TestVoice:
    def __init__(self):
        self.turns = []
        self.block = None

    def synthesize(self, text, cancel):
        if self.block:
            self.block.wait(2)
        if cancel.is_set():
            raise TelephonyError('cancelled fixture')
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
            audio.writeframes(b'\x00\x00' * 240)
        return buffer.getvalue()

    def reply(self, objective, history, spoken, last, cancel):
        self.turns.append((objective, history, spoken, last))
        if not history:
            return Reply('¿Cuál es el horario de la prueba?', False, '')
        return Reply('Gracias por confirmar el horario.', True, 'La persona indicó las nueve.')


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Configuration('https://calls.example.test', 'fixture_token_' + 'x' * 32, 'AC' + 'a' * 32,
                                    'b' * 32, DID, frozenset({DESTINATION}), True, True)
        self.transport, self.voice = TestTransport(), TestVoice()
        self.path = Path(self.temp.name) / 'gateway.sqlite3'
        self.calls = Calls(self.path, self.config, self.transport, self.voice)
        self.addCleanup(self.calls.close)
        self.server = Server(0, self.calls)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval':.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.identifier = str(uuid4())

    def stop_server(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

    def request(self, path, data=None, *, headers=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET' if data is None else 'POST', path, body=data, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def owner(self, path, value=None):
        code, body = self.request(path, None if value is None else json.dumps(value).encode(), headers={
            'Content-Type':'application/json', 'Authorization':'Bearer ' + self.config.gateway_token})
        return code, (body if path.endswith('/audio') and code == 200 else json.loads(body))

    def signed(self, path, fields, signature=None):
        if signature is None:
            content = self.config.public_origin + path + ''.join(k + v for k, v in sorted(fields.items()))
            signature = base64.b64encode(hmac.new(self.config.auth_token.encode(), content.encode(), hashlib.sha1).digest()).decode()
        return self.request(path, urlencode(fields).encode(), headers={
            'Content-Type':'application/x-www-form-urlencoded', 'X-Twilio-Signature':signature})

    def wait(self, test):
        end = time.monotonic() + 3
        while time.monotonic() < end:
            value = test()
            if value:
                return value
            time.sleep(.01)
        self.fail('Local fixture timed out.')

    def launch(self):
        value = {'id':self.identifier, 'destination':DESTINATION, 'objective':GOAL}
        self.assertEqual(self.owner('/v1/calls', value)[0], 202)
        self.wait(lambda: self.calls.status(self.identifier)['state'] == 'queued')
        self.assertEqual(self.owner('/v1/calls', value)[0], 202)
        self.assertEqual(len(self.transport.started), 1)
        return self.transport.started[0][1].removesuffix('/answer')

    def fields(self, call=CALL, **more):
        return {'CallSid':call, 'AccountSid':self.config.account, **more}

    def test_console_trial_serves_one_signed_two_turn_call_without_dialing_or_mailbox(self):
        sender = '+17375550100'
        config = trial_config(self.config.public_origin, self.config.account, self.config.auth_token, sender, DESTINATION)
        calls = Calls(':memory:', config, None, self.voice, console_trial=True)
        original = self.server
        try:
            with Server(0, calls, TrialHandler) as server:
                self.server = server
                listener = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
                listener.start()
                try:
                    calls.start(self.identifier, DESTINATION, GOAL)
                    url = self.wait(lambda: calls.console_answer_url(self.identifier))
                    prefix = urlsplit(url).path.removesuffix('/answer')
                    fields = self.fields(From=sender, To=DESTINATION)
                    self.assertEqual(self.request('/v1/info')[0], 404)
                    self.assertEqual(self.signed('/twilio/mailbox/incoming', fields)[0], 404)
                    self.assertEqual(self.signed(prefix + '/answer', fields, 'x' * 28)[0], 403)
                    self.assertEqual(self.signed(prefix + '/answer', {**fields, 'From': DID})[0], 400)
                    code, document = self.signed(prefix + '/answer', fields)
                    self.assertEqual(code, 200)
                    self.assertEqual(self.request(urlsplit(ET.fromstring(document).findtext('Play')).path)[0], 200)
                    self.assertEqual(self.signed(prefix + '/turn/0', {**fields, 'SpeechResult': 'Sí, te escucho.'})[0], 200)
                    self.wait(lambda: calls.console_progress(self.identifier)['turns'] == 1)
                    self.assertEqual(self.signed(prefix + '/turn/1', {**fields, 'SpeechResult': 'A las nueve.'})[0], 200)
                    self.wait(lambda: calls.console_progress(self.identifier)['ending'])
                    final = ET.fromstring(self.signed(prefix + '/wait', fields)[1])
                    self.assertEqual([node.tag for node in final], ['Play', 'Hangup'])
                    self.assertEqual(self.transport.started, [])
                    self.assertTrue(self.voice.turns[-1][3])
                    with self.assertRaises(TelephonyError):
                        calls.start(str(uuid4()), DESTINATION, GOAL)
                finally:
                    server.shutdown()
                    listener.join(2)
        finally:
            self.server = original
            calls.close()

    def test_console_proxy_requires_live_api_proof_then_reuses_only_that_call(self):
        sender = '+17375550100'
        config = trial_config(self.config.public_origin, self.config.account, self.config.auth_token, sender, DESTINATION)
        calls = Calls(':memory:', config, None, self.voice, console_trial=True)
        original = self.server
        provider = Mock()
        provider._request.return_value = {'sid':CALL, 'account_sid':config.account, 'from':sender,
            'to':DESTINATION, 'status':'in-progress', 'direction':'outbound-api'}
        try:
            with Server(0, calls, TrialHandler) as server:
                self.server = server
                listener = threading.Thread(target=server.serve_forever, kwargs={'poll_interval':.01}, daemon=True)
                listener.start()
                try:
                    calls.start(self.identifier, DESTINATION, GOAL)
                    url = self.wait(lambda:calls.console_answer_url(self.identifier))
                    prefix = urlsplit(url).path.removesuffix('/answer')
                    fields = self.fields(From=sender, To=DESTINATION)
                    def unsigned(path, values):
                        return self.request(path, urlencode(values).encode(), headers={'Content-Type':'application/x-www-form-urlencoded'})
                    self.assertEqual(unsigned(prefix+'/answer',fields)[0],403)
                    server.trial_proxy = TrialProxyVerifier(calls, provider)
                    self.assertEqual(self.signed(prefix+'/answer',fields,'x'*28)[0],403)
                    self.assertEqual(unsigned('/twilio/out/'+'0'*64+'/answer',fields)[0],403)
                    self.assertEqual(unsigned(prefix+'/answer',{**fields,'To':DID})[0],403)
                    provider._request.assert_not_called()
                    self.assertEqual(unsigned(prefix+'/answer',fields)[0],200)
                    provider._request.assert_called_once_with('/Calls/'+CALL+'.json',timeout=2.5,limit=16384)
                    self.assertEqual(unsigned(prefix+'/turn/0',{**fields,'SpeechResult':'Sí, puedo hablar.'})[0],200)
                    self.wait(lambda:calls.console_progress(self.identifier)['turns']==1)
                    response = ET.fromstring(unsigned(prefix+'/wait',fields)[1])
                    self.assertEqual([item.tag for item in response],['Play','Gather'])
                    self.assertEqual(list(response.find('Gather')),[])
                    self.assertEqual(self.request(urlsplit(response.findtext('Play')).path)[0],200)
                    self.assertEqual(unsigned(prefix+'/turn/1',{**fields,'SpeechResult':'A las nueve.'})[0],200)
                    self.wait(lambda:calls.console_progress(self.identifier)['ending'])
                    final = ET.fromstring(unsigned(prefix+'/wait',fields)[1])
                    self.assertEqual([item.tag for item in final],['Play','Hangup'])
                    self.assertEqual(unsigned(prefix+'/wait',{**fields,'CallSid':INCOMING})[0],403)
                    calls.cancel(self.identifier)
                    self.assertEqual(unsigned(prefix+'/wait',fields)[0],403)
                    self.assertEqual(provider._request.call_count,1)
                finally:
                    server.shutdown();listener.join(2)
        finally:
            self.server = original
            calls.close()

    def test_console_pending_reply_leaves_network_headroom_then_serves_its_audio(self):
        sender = '+17375550100'
        config = trial_config(self.config.public_origin, self.config.account, self.config.auth_token, sender, DESTINATION)
        calls = Calls(':memory:', config, None, self.voice, console_trial=True)
        original = self.server
        gate = threading.Event()
        try:
            with Server(0,calls,TrialHandler) as server:
                self.server=server
                listener=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True)
                listener.start()
                try:
                    calls.start(self.identifier,DESTINATION,GOAL)
                    url=self.wait(lambda:calls.console_answer_url(self.identifier))
                    prefix=urlsplit(url).path.removesuffix('/answer')
                    fields=self.fields(From=sender,To=DESTINATION)
                    self.assertEqual(self.signed(prefix+'/answer',fields)[0],200)
                    self.voice.block=gate
                    started=time.monotonic()
                    code,body=self.signed(prefix+'/turn/0',{**fields,'SpeechResult':'Hola.'})
                    elapsed=time.monotonic()-started
                    self.assertEqual(code,200)
                    self.assertLess(elapsed,2)
                    self.assertEqual([item.tag for item in ET.fromstring(body)],['Pause','Redirect'])
                    gate.set()
                    self.wait(lambda:calls.console_progress(self.identifier)['turns']==1)
                    reply=ET.fromstring(self.signed(prefix+'/wait',fields)[1])
                    self.assertEqual([item.tag for item in reply],['Play','Gather'])
                    self.assertEqual(self.request(urlsplit(reply.findtext('Play')).path)[0],200)
                finally:
                    gate.set();server.shutdown();listener.join(2)
        finally:
            self.voice.block=None
            self.server=original
            calls.close()

    def test_console_proxy_fails_closed_for_unproven_remote_call_and_limits_attempts(self):
        sender = '+17375550100'
        config = trial_config(self.config.public_origin, self.config.account, self.config.auth_token, sender, DESTINATION)
        calls = Calls(':memory:', config, None, self.voice, console_trial=True)
        self.addCleanup(calls.close)
        calls.start(self.identifier, DESTINATION, GOAL)
        url = self.wait(lambda:calls.console_answer_url(self.identifier))
        capability = urlsplit(url).path.split('/')[3]
        fields = self.fields(From=sender, To=DESTINATION)
        actual = {'sid':CALL,'account_sid':config.account,'from':sender,'to':DESTINATION,
                  'status':'in-progress','direction':'outbound-api'}
        for key, wrong in (('sid',INCOMING),('account_sid','AC'+'c'*32),('from',DID),
                           ('to',DID),('status','completed'),('direction','inbound')):
            with self.subTest(key=key):
                provider=Mock();provider._request.return_value={**actual,key:wrong}
                self.assertFalse(TrialProxyVerifier(calls,provider).verify(capability,fields))
                self.assertEqual(calls.status(self.identifier)['state'],'dialing')
        provider=Mock();provider._request.side_effect=ProviderError('fixture unavailable')
        verifier=TrialProxyVerifier(calls,provider)
        for _ in range(4):
            self.assertFalse(verifier.verify(capability,fields))
        self.assertEqual(provider._request.call_count,3)
        self.assertEqual(calls.status(self.identifier)['state'],'dialing')

    def test_outbound_signed_audio_turns_result_and_ordered_status(self):
        prefix = self.launch()
        answer = self.fields(To=DESTINATION)
        self.assertEqual(self.signed(prefix + '/answer', answer, 'x' * 28)[0], 403)
        code, data = self.signed(prefix + '/answer', answer)
        self.assertEqual(code, 200)
        twiml = ET.fromstring(data)
        self.assertEqual([node.tag for node in twiml], ['Play', 'Gather'])
        clip = urlsplit(twiml.findtext('Play')).path
        code, data = self.request(clip)
        self.assertEqual(code, 200)
        with wave.open(io.BytesIO(data)) as audio:
            self.assertEqual((audio.getframerate(), audio.getnchannels(), audio.getnframes()), (24000, 1, 240))
        self.assertEqual(self.request(clip[:-1] + ('e' if clip[-1] != 'e' else 'f'))[0], 404)
        speech = self.fields(SpeechResult='Sí, puedo atender.')
        self.assertIn(b'<Pause', self.signed(prefix + '/turn/0', speech)[1])
        self.signed(prefix + '/turn/0', speech)  # webhook retry while work is pending or ready
        self.wait(lambda: b'/turn/1' in self.signed(prefix + '/wait', answer)[1])
        self.assertEqual(len(self.voice.turns), 1)
        self.assertEqual(self.voice.turns[0][0], GOAL)
        self.assertEqual(self.request(clip)[0], 404)
        self.signed(prefix + '/turn/1', self.fields(SpeechResult='A las nueve.'))
        done = self.wait(lambda: self.signed(prefix + '/wait', answer)[1] if self.calls.status(self.identifier)['result'] else None)
        self.assertIn(b'<Hangup', done)
        self.assertEqual(len(self.voice.turns), 2)
        self.signed(prefix + '/status', self.fields(CallStatus='completed', SequenceNumber='3'))
        self.signed(prefix + '/status', self.fields(CallStatus='ringing', SequenceNumber='1'))
        result = self.owner('/v1/calls/' + self.identifier)[1]
        self.assertEqual(result['state'], 'completed')
        self.assertEqual(result['result'], 'La persona indicó las nueve.')
        self.assertFalse(self.calls.live)
        self.assertNotIn('A las nueve.', self.path.read_bytes().decode('latin-1'))

    def test_signed_mailbox_requires_did_consent_and_keeps_one_message(self):
        incoming = self.fields(INCOMING, To=DID, From=DESTINATION)
        recorded = {**incoming, 'RecordingSid':RECORDING, 'RecordingStatus':'completed', 'RecordingSource':'RecordVerb',
                    'RecordingDuration':'12', 'RecordingUrl':'https://untrusted.example.test/never-fetch'}
        self.assertEqual(self.request('/v1/voicemails')[0], 401)
        self.assertNotIn(b'<Gather', self.signed('/twilio/mailbox/incoming', {**incoming,'To':DESTINATION})[1])
        self.assertNotIn(b'<Record', self.signed('/twilio/mailbox/consent', {**incoming,'Digits':'1'})[1])
        self.assertIn(b'<Gather', self.signed('/twilio/mailbox/incoming', incoming)[1])
        self.assertNotIn(b'<Record', self.signed('/twilio/mailbox/consent', {**incoming,'Digits':'2'})[1])
        self.signed('/twilio/mailbox/recorded', recorded)
        self.assertEqual(self.owner('/v1/voicemails')[1]['messages'], [])
        self.assertIn(b'<Record', self.signed('/twilio/mailbox/consent', {**incoming,'Digits':'1'})[1])
        self.assertEqual(self.signed('/twilio/mailbox/recorded', recorded, 'x' * 28)[0], 403)
        for fields in (recorded, recorded, {**recorded, 'RecordingSid':'RE' + '4'*32}):
            self.assertEqual(self.signed('/twilio/mailbox/recorded', fields)[0], 204)
        messages = self.owner('/v1/voicemails')[1]['messages']
        self.assertEqual(len(messages), 1)
        self.assertEqual((messages[0]['caller'],messages[0]['seconds']), (DESTINATION,12))
        path = '/v1/voicemails/' + RECORDING + '/audio'
        self.assertEqual(self.request(path)[0], 401)
        self.assertEqual(self.owner(path), (200,b'ID3-synthetic-recording'))
        self.assertEqual(self.transport.media, [RECORDING])

    def test_cancel_before_dial_during_synthesis(self):
        self.voice.block = threading.Event()
        self.assertEqual(self.owner('/v1/calls', {'id':self.identifier,'destination':DESTINATION,'objective':GOAL})[0], 202)
        self.assertEqual(self.owner('/v1/calls/' + self.identifier + '/cancel', {})[1]['state'], 'canceled')
        self.voice.block.set()
        self.assertFalse(self.calls.live)
        self.assertEqual(self.transport.started, [])

    def test_cancel_queued_receipt_finishes_without_waiting_for_webhook(self):
        self.launch()
        self.owner('/v1/calls/' + self.identifier + '/cancel', {})
        self.wait(lambda: self.calls.status(self.identifier)['state'] == 'canceled')
        self.assertEqual(self.transport.hangups, [CALL])

    def test_uncertain_post_never_redials_and_late_callback_can_reconcile(self):
        self.transport.failure = ProviderError('fixture timeout', uncertain=True)
        value = {'id':self.identifier,'destination':DESTINATION,'objective':GOAL}
        self.owner('/v1/calls', value)
        self.wait(lambda: self.calls.status(self.identifier)['state'] == 'uncertain')
        self.assertEqual(self.owner('/v1/calls', value)[1]['state'], 'uncertain')
        self.assertEqual(self.owner('/v1/calls', {**value,'id':str(uuid4())})[0], 422)
        self.assertEqual(len(self.transport.started), 1)
        self.signed(self.transport.started[0][2], self.fields(CallStatus='busy', SequenceNumber='2'))
        self.assertEqual(self.calls.status(self.identifier)['state'], 'busy')

    def test_read_only_defaults_destination_and_forged_callback(self):
        self.assertEqual(self.request('/v1/info')[0], 401)
        self.assertEqual(self.owner('/v1/info')[1], {'configured':True,'outbound':True,'voicemail':True,'realtime':False})
        self.assertEqual(self.owner('/v1/calls', {'id':self.identifier,'destination':DID,'objective':GOAL})[0], 422)
        self.assertEqual(self.transport.started, [])
        self.assertEqual(self.signed('/twilio/mailbox/incoming', self.fields(INCOMING, To=DID, AccountSid='AC'+'0'*32))[0], 400)


class DesktopReviewTests(unittest.TestCase):
    def setUp(self):
        from services.telephony.whatsapp_client_settings import ClientSettings
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.bridge = TelephoneBridge()
        self.bridge._whatsapp_call_settings = ClientSettings(Path(folder.name)/'client.json')
        self.bridge._trusted = Mock()
        self.gateway = Mock()
        self.bridge._telephone_gateway = lambda: self.gateway

    def test_review_and_discard_are_local_confirm_consumes_once(self):
        draft = self.bridge.workspace_telephone_prepare('829-555-0101', GOAL)
        self.assertEqual(draft['destination'], DESTINATION)
        self.gateway.request.assert_not_called()
        self.bridge.workspace_telephone_discard(draft['id'])
        with self.assertRaises(TelephonyError):self.bridge.workspace_telephone_confirm(draft['id'])
        draft = self.bridge.workspace_telephone_prepare(DESTINATION, GOAL)
        self.bridge.workspace_telephone_confirm(draft['id'])
        self.gateway.request.assert_called_once_with('/v1/calls', draft)
        with self.assertRaises(TelephonyError):self.bridge.workspace_telephone_confirm(draft['id'])

    def test_timeout_keeps_receipt_and_does_not_repeat_post(self):
        draft = self.bridge.workspace_telephone_prepare(DESTINATION, GOAL)
        self.gateway.request.side_effect = ProviderError('fixture timeout', uncertain=True)
        result = self.bridge.workspace_telephone_confirm(draft['id'])
        self.assertEqual((result['id'], result['state']), (draft['id'],'uncertain'))
        with self.assertRaises(TelephonyError):self.bridge.workspace_telephone_confirm(draft['id'])
        self.gateway.request.assert_called_once()

    def test_invalid_and_untrusted_requests_do_not_touch_gateway(self):
        self.bridge._trusted.side_effect = TelephonyError('foreign origin')
        with self.assertRaises(TelephonyError):self.bridge.workspace_telephone_mailbox()
        self.bridge._trusted.side_effect = None
        for value in ('911','+1 829 555 0101;ext=1','https://bad.test'):
            with self.assertRaises(TelephonyError):number(value)
        self.gateway.request.assert_not_called()


class TwilioContractTests(unittest.TestCase):
    def test_trial_rest_dial_has_fixed_destination_and_limited_duration(self):
        config = trial_config('https://calls.example.test', 'AC'+'a'*32, 'b'*32, '+17375550100', DESTINATION)
        transport = LimitedTrialTransport(config)
        with patch.object(transport.twilio, '_request', return_value={'sid':CALL}) as request:
            self.assertEqual(transport.start(DESTINATION, '/answer', '/status'), CALL)
        fields = dict(request.call_args.kwargs['fields'])
        self.assertEqual((fields['To'], fields['TimeLimit']), (DESTINATION, '100'))
        with patch.object(transport.twilio, '_request', return_value={}):
            with self.assertRaises(ProviderError) as result:
                transport.start(DESTINATION, '/answer', '/status')
            self.assertTrue(result.exception.uncertain)

    def test_dial_contract_no_outbound_recording_and_fixed_limits(self):
        config = Configuration('https://calls.example.test','x'*32,'AC'+'a'*32,'b'*32,DID,frozenset(),False,False)
        transport = Twilio(config)
        with patch.object(transport, '_request', return_value={'sid':CALL}) as request:
            self.assertEqual(transport.start(DESTINATION,'/answer','/status'),CALL)
        fields = dict(request.call_args.kwargs['fields'])
        self.assertEqual((fields['From'],fields['To'],fields['TimeLimit'],fields['Record']), (DID,DESTINATION,'180','false'))
        self.assertEqual(fields['Url'],'https://calls.example.test/answer')

    def test_cancel_while_ringing_races_answer_and_uses_completed(self):
        config = Configuration('https://calls.example.test','x'*32,'AC'+'a'*32,'b'*32,DID,frozenset(),False,False)
        transport = Twilio(config)
        with patch.object(transport,'_request',side_effect=[{'status':'ringing'},ProviderError('answered'),{'status':'in-progress'},{'status':'completed'}]) as request:
            self.assertEqual(transport.hangup(CALL),'completed')
        self.assertEqual(request.call_args_list[1].kwargs['fields'],{'Status':'canceled'})
        self.assertEqual(request.call_args_list[3].kwargs['fields'],{'Status':'completed'})


@unittest.skipUnless(os.name == 'nt', 'DPAPI requires Windows')
class TrialCredentialTests(unittest.TestCase):
    def test_loopback_form_rejects_cross_origin_and_saves_only_protected_credentials(self):
        from services.google_oauth import WindowsDPAPIProtector
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            process = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', '-m', 'tools.prepare_melodi_trial'],
                cwd=temp, env={**os.environ, 'PYTHONPATH':str(root)}, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
                creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                url = urlsplit(process.stdout.readline().strip())
                self.assertEqual(url.hostname, '127.0.0.1')
                client = HTTPConnection(url.hostname, url.port, timeout=3)
                try:
                    client.request('GET', url.path)
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.getheader('Referrer-Policy'), 'same-origin')
                    response.read()
                finally:
                    client.close()
                body = urlencode({'account':'AC'+'a'*32, 'auth':'b'*32, 'from':'+17375550100', 'to':DESTINATION})
                for origin, expected in (('null', 403), ('https://foreign.invalid', 403), (f'http://{url.netloc}', 200)):
                    client = HTTPConnection(url.hostname, url.port, timeout=3)
                    try:
                        client.request('POST', url.path, body, {'Content-Type':'application/x-www-form-urlencoded','Origin':origin})
                        response = client.getresponse()
                        self.assertEqual(response.status, expected)
                        response.read()
                    finally:
                        client.close()
                self.assertEqual(process.wait(timeout=3), 0)
                file = Path(temp)/'.local/telephony/twilio-trial.dpapi'
                protected = file.read_bytes()
                self.assertNotIn(('b'*32).encode(), protected)
                decoded = json.loads(WindowsDPAPIProtector().unprotect(protected))
                self.assertEqual(decoded['BRIVANY_TWILIO_TRIAL_TO'], DESTINATION)
                with patch.dict(os.environ, {}, clear=True):
                    load_trial_credentials(file)
                    self.assertEqual(os.environ['BRIVANY_TWILIO_AUTH_TOKEN'], 'b'*32)
                file.write_bytes(b'invalid fixture')
                with self.assertRaises(TelephonyError):load_trial_credentials(file)
            finally:
                if process.poll() is None:
                    process.kill(); process.wait(3)
                process.stdout.close(); process.stderr.close()


if __name__ == '__main__':unittest.main()
