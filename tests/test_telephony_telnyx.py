"""Telnyx setup, call review and lifecycle with the API and SIP worker replaced."""
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from desktop.experience.telephony import TelephoneBridge
from services.telephony.common import ProviderError, TelephonyError
from services.telephony.telnyx import (NAME, TelnyxAPI, TelnyxAccount, TelnyxGateway, explain,
                                       load_profile, provision, save_profile)
from tests.test_telephony_realtime import SyntheticProviders

KEY = 'KEY0123456789ABCDEF_synthetic_fixture_key'
CALLER = '+18095550100'
DESTINATION = '+18295550101'
OTHER = '+18495550102'


def until(predicate, seconds=4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('Synthetic Telnyx fixture timed out.')


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class FakeTelnyx:
    """Records every request; serves a tiny in-memory account."""
    def __init__(self, owned=(CALLER,), verified=()):
        self.requests = []
        self.profiles, self.connections = [], []
        self.owned, self.verified = list(owned), list(verified)

    def open(self, request, timeout=None):
        url = urlsplit(request.full_url)
        body = json.loads(request.data) if request.data else None
        self.requests.append({'method': request.get_method(), 'path': url.path, 'query': parse_qs(url.query),
                              'body': body, 'authorization': request.get_header('Authorization')})
        path, method = url.path.removeprefix('/v2'), request.get_method()
        if request.get_header('Authorization') != 'Bearer ' + KEY:
            raise HTTPError(request.full_url, 401, 'Unauthorized', {}, io.BytesIO(b'{"errors":[{"code":"10009"}]}'))
        if path == '/balance':
            return self.reply({'balance': '10.00', 'available_credit': '10.00', 'currency': 'USD'})
        if path == '/phone_numbers':
            return self.reply([{'phone_number': n, 'status': 'active'} for n in self.owned])
        if path == '/verified_numbers':
            return self.reply([{'phone_number': n, 'verified_at': '2026-11-11T00:00:00Z'} for n in self.verified])
        for collection, kind in ((self.profiles, '/outbound_voice_profiles'), (self.connections, '/credential_connections')):
            if path == kind and method == 'GET':
                return self.reply(collection)
            if path == kind and method == 'POST':
                item = {'id': str(len(collection) + 1000), **body}
                collection.append(item)
                return self.reply(item)
            if path.startswith(kind + '/') and method == 'PATCH':
                item = next(item for item in collection if item['id'] == path.rsplit('/', 1)[1])
                item.update(body)
                return self.reply(item)
        raise HTTPError(request.full_url, 404, 'Not Found', {}, io.BytesIO(b'{"errors":[{"code":"404","title":"Not found"}]}'))

    @staticmethod
    def reply(data):
        return Response(json.dumps({'data': data}).encode())


class TelnyxAPITests(unittest.TestCase):
    def test_check_sip_command_reports_the_actual_registration_result(self):
        from tools.setup_telnyx import main
        for state, code in (('activa', 0), ('fallida', 1)):
            with self.subTest(registration=state):
                output = io.StringIO()
                with patch('tools.setup_telnyx.load_local_config'), \
                     patch('tools.setup_telnyx.saved', return_value=object()), \
                     patch('tools.setup_telnyx.check_sip', return_value={'sip_registration': state}), \
                     patch('sys.stdout', output):
                    self.assertEqual(main(['check-sip']), code)
                self.assertEqual(json.loads(output.getvalue())['ok'], code == 0)

    def test_key_is_sent_only_as_bearer_and_never_shown(self):
        fake = FakeTelnyx()
        api = TelnyxAPI(KEY, opener=fake)
        self.assertEqual(api.balance()['currency'], 'USD')
        self.assertNotIn(KEY, repr(api))
        self.assertEqual(fake.requests[0]['authorization'], 'Bearer ' + KEY)
        with self.assertRaisesRegex(ProviderError, 'clave API') as caught:
            TelnyxAPI('KEY' + 'x' * 30, opener=fake).balance()
        self.assertNotIn('x' * 30, str(caught.exception))
        with self.assertRaises(TelephonyError):
            TelnyxAPI('')

    def test_provision_creates_once_then_updates_with_a_fresh_password(self):
        fake = FakeTelnyx()
        api = TelnyxAPI(KEY, opener=fake)
        first = provision(api, caller_id=CALLER, countries=['do', 'US'], daily_limit=5, max_rate=.3)
        self.assertEqual(len(fake.profiles), 1)
        self.assertEqual(len(fake.connections), 1)
        profile, connection = fake.profiles[0], fake.connections[0]
        self.assertEqual(profile['name'], NAME)
        self.assertEqual(profile['whitelisted_destinations'], ['DO', 'US'])
        self.assertTrue(profile['daily_spend_limit_enabled'])
        self.assertEqual(profile['daily_spend_limit'], '5.00')
        self.assertEqual(profile['concurrent_call_limit'], 1)
        self.assertEqual(connection['outbound'], {'outbound_voice_profile_id': profile['id'], 'channel_limit': 1,
                                                  'ani_override': CALLER, 'ani_override_type': 'always'})
        self.assertTrue(4 <= len(connection['user_name']) <= 32 and connection['user_name'].isalnum())
        self.assertEqual(first.username, connection['user_name'])
        self.assertEqual(first.password, connection['password'])
        self.assertEqual(first.server, 'sip.telnyx.com')
        second = provision(api, caller_id=CALLER)
        self.assertEqual((len(fake.profiles), len(fake.connections)), (1, 1))
        self.assertEqual(second.username, first.username)
        self.assertNotEqual(second.password, first.password)
        self.assertEqual(fake.connections[0]['password'], second.password)
        self.assertNotIn(first.password, repr(first))

    def test_caller_must_be_owned_or_verified_before_anything_changes(self):
        fake = FakeTelnyx(owned=[], verified=[OTHER])
        api = TelnyxAPI(KEY, opener=fake)
        with self.assertRaisesRegex(TelephonyError, 'verificado'):
            provision(api, caller_id=CALLER)
        self.assertFalse(any(item['method'] in ('POST', 'PATCH') for item in fake.requests))
        self.assertEqual(provision(api, caller_id=OTHER).caller_id, OTHER)

    def test_invalid_limits_and_countries_are_refused_without_requests(self):
        fake = FakeTelnyx()
        api = TelnyxAPI(KEY, opener=fake)
        for options in ({'countries': ['Dominicana']}, {'daily_limit': 0}, {'max_rate': 9}, {'region': 'mars'}):
            with self.assertRaises(TelephonyError):
                provision(api, caller_id=CALLER, **options)
        self.assertEqual(fake.requests, [])

    def test_sip_codes_become_actionable_messages(self):
        self.assertIn('número emisor', explain(403))
        self.assertIn('saldo', explain(402))
        self.assertIn('ocupado', explain(486))
        self.assertIn('499', explain(499))

    def test_windows_profile_is_encrypted_and_roundtrips(self):
        from services.google_oauth import WindowsDPAPIProtector
        if not WindowsDPAPIProtector().available:
            self.skipTest('Windows DPAPI is not available.')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'telnyx.dpapi'
            account = TelnyxAccount('syntheticuser', 'synthetic-secret-keep-private', caller_id=CALLER,
                                    connection_id='1000', profile_id='1001')
            save_profile(path, account)
            self.assertNotIn(account.password.encode(), path.read_bytes())
            self.assertEqual(load_profile(path), account)
            path.write_bytes(b'invalid ciphertext')
            with self.assertRaisesRegex(TelephonyError, 'No se pudo abrir'):
                load_profile(path)


class WaitingNative:
    def __init__(self, configuration, call_id, notify):
        self.closed = threading.Event()
        self.configuration = configuration
        self.identifier = call_id
        self.notify = notify
        self.started = threading.Event()

    def start(self, destination):
        self.started.set()
        self.closed.wait(4)
        raise TelephonyError('Canceled synthetic connection.')

    def close(self):
        self.closed.set()

    def shutdown(self):
        self.close()


class RejectedNative(WaitingNative):
    """Telnyx answers the INVITE with 403, as with an invalid caller ID."""
    def start(self, destination):
        self.started.set()
        self.notify({'type': 'sip_response', 'id': self.identifier, 'sip_status': 403, 'method': 'INVITE'})
        self.notify({'type': 'call', 'id': self.identifier, 'state': 'failed', 'sip_status': 403})
        raise TelephonyError('No se pudo establecer la conexión SIP.')


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.account = TelnyxAccount('syntheticuser', 'synthetic-password', caller_id=CALLER,
                                     connection_id='1000', profile_id='1001')
        self.created = []
        self.kind = WaitingNative

        def factory(*args):
            value = self.kind(*args)
            self.created.append(value)
            return value
        self.factory = factory
        self.path = Path(self.directory.name) / 'telnyx.sqlite3'
        self.gateway = TelnyxGateway(self.path, self.account, SyntheticProviders(), native_factory=factory)
        self.addCleanup(self.gateway.close)
        gateway = self.gateway

        class Desktop(TelephoneBridge):
            def _trusted(self):
                pass

            def _telephone_gateway(self):
                return gateway
        self.desktop = Desktop()
        from services.telephony.whatsapp_client_settings import ClientSettings
        self.desktop._whatsapp_call_settings = ClientSettings(Path(self.directory.name) / 'client.json')

    def test_info_names_telnyx_and_masks_the_caller(self):
        info = self.desktop.workspace_telephone_info()
        self.assertEqual((info['provider'], info['outbound'], info['incoming']), ('telnyx', True, 'mobile'))
        self.assertEqual(info['caller_id'], '…0100')
        self.assertNotIn(CALLER, json.dumps(info))

    def test_review_does_not_dial_and_confirmation_is_one_use(self):
        draft = self.desktop.workspace_telephone_prepare(DESTINATION, 'Encargo sintético confidencial.')
        self.assertEqual(self.created, [])
        self.desktop.workspace_telephone_confirm(draft['id'])
        until(lambda: len(self.created) == 1 and self.created[0].started.is_set())
        self.assertEqual(self.created[0].configuration['allow'], [DESTINATION])
        self.assertEqual(self.created[0].configuration['server'], 'sip.telnyx.com')
        with self.assertRaises(TelephonyError):
            self.desktop.workspace_telephone_confirm(draft['id'])
        self.gateway.request('/v1/calls', draft)
        self.assertEqual(len(self.created), 1)
        self.desktop.workspace_telephone_cancel(draft['id'])
        until(lambda: not self.gateway.worker.is_alive())
        self.assertEqual(self.desktop.workspace_telephone_status(draft['id'])['state'], 'canceled')
        self.assertEqual(len(self.created), 1)
        with self.assertRaises(TelephonyError):
            self.gateway.request('/v1/calls', {**draft, 'destination': OTHER})

    def test_rejected_invite_is_explained_to_the_person(self):
        self.kind = RejectedNative
        draft = self.desktop.workspace_telephone_prepare(DESTINATION, 'Prueba sintética.')
        self.desktop.workspace_telephone_confirm(draft['id'])
        until(lambda: self.gateway.worker and not self.gateway.worker.is_alive())
        status = self.desktop.workspace_telephone_status(draft['id'])
        self.assertEqual(status['state'], 'failed')
        self.assertIn('número emisor', status['result'])

    def test_missing_caller_or_voice_blocks_before_the_sip_worker(self):
        gateway = TelnyxGateway(':memory:', TelnyxAccount('syntheticuser', 'synthetic-password'),
                                SyntheticProviders(), native_factory=self.factory)
        try:
            info = gateway.request('/v1/info')
            self.assertFalse(info['outbound'])
            self.assertIn('número emisor', info['reason'])
            with self.assertRaisesRegex(TelephonyError, 'número emisor'):
                gateway.request('/v1/calls', {'id': str(uuid4()), 'destination': DESTINATION, 'objective': 'Prueba.'})
        finally:
            gateway.close()
        with patch.dict('os.environ', {}, clear=True):
            gateway = TelnyxGateway(':memory:', self.account, native_factory=self.factory)
            try:
                with self.assertRaisesRegex(TelephonyError, 'Conecta la voz'):
                    gateway.request('/v1/calls', {'id': str(uuid4()), 'destination': DESTINATION, 'objective': 'Prueba.'})
            finally:
                gateway.close()
        self.assertEqual(self.created, [])

    def test_invalid_number_never_starts_and_there_is_no_mailbox(self):
        self.assertEqual(self.gateway.request('/v1/voicemails'), {'messages': []})
        with self.assertRaises(TelephonyError):
            self.gateway.request('/v1/calls', {'id': str(uuid4()), 'destination': 'sip:x@example.test', 'objective': 'Prueba.'})
        with self.assertRaises(TelephonyError):
            self.desktop.workspace_telephone_recording('RE' + '0' * 32)
        self.assertEqual(self.created, [])

    def test_restart_never_redials_or_stores_objective_or_credentials(self):
        draft = self.desktop.workspace_telephone_prepare(DESTINATION, 'Encargo sintético confidencial.')
        self.desktop.workspace_telephone_confirm(draft['id'])
        until(lambda: len(self.created) == 1 and self.created[0].started.is_set())
        self.gateway.close()
        replacement = TelnyxGateway(self.path, self.account, SyntheticProviders(), native_factory=self.factory)
        try:
            self.assertEqual(replacement.request('/v1/calls', draft)['state'], 'interrupted')
            self.assertEqual(len(self.created), 1)
            dump = '\n'.join(replacement.db.iterdump())
            for secret in ('confidencial', 'synthetic-password', 'syntheticuser', CALLER):
                self.assertNotIn(secret, dump)
        finally:
            replacement.close()

    def test_no_profile_means_not_configured(self):
        class Bare(TelephoneBridge):
            def _trusted(self):
                pass
        with tempfile.TemporaryDirectory() as directory, \
                patch('desktop.experience.telephony.DATA_ROOT', Path(directory)):
            self.assertEqual(Bare().workspace_telephone_info()['configured'], False)


if __name__ == '__main__':
    unittest.main()
