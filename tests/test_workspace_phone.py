"""Real loopback HTTPS with an owned file. No LAN listener or phone is claimed."""
import base64
import http.client
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import socket
import ssl
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlsplit

from desktop.experience.workspace_phone import PhoneTransfer, WorkspacePhoneBridge, tls_identity, COOKIE
from desktop.experience.workspace_files import FileShelf, WorkspaceFilesBridge, INLINE_BYTES as MAX_FILE_BYTES


class FixtureProtector:
    """Ephemeral authenticated storage substitute; production uses user DPAPI."""
    available = True
    def __init__(self):
        from cryptography.fernet import Fernet
        self.cipher = Fernet(Fernet.generate_key())
    def protect(self, value):
        return self.cipher.encrypt(value)
    def unprotect(self, value):
        return self.cipher.decrypt(value)


class PhoneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.identity_folder = tempfile.TemporaryDirectory()
        cls.context, cls.fingerprint, cls.certificate = tls_identity('127.0.0.1', cls.identity_folder.name, FixtureProtector())
        cls.client_context = ssl.create_default_context(cadata=cls.certificate)

    @classmethod
    def tearDownClass(cls):
        cls.identity_folder.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.events = []
        self.transfer = PhoneTransfer(Path(self.temp.name) / 'phone', addresses=lambda: ['127.0.0.1'],
            identity=lambda *args: (self.context, self.fingerprint, self.certificate), publish=self.events.append)
        self.addCleanup(self.transfer.close)
        self.payload = ('Contenido propio.\n' * 80).encode('utf-8')

    def share(self):
        value = self.transfer.share('Síntesis propia.txt', self.payload)
        self.origin = self.transfer.origin
        self.token = urlsplit(value['link']).fragment
        return value

    def request(self, method, path, headers=None):
        parsed = urlsplit(self.origin)
        client = http.client.HTTPSConnection(parsed.hostname, parsed.port, context=self.client_context, timeout=3)
        try:
            client.request(method, path, headers=headers or {})
            response = client.getresponse(); return response.status, dict(response.getheaders()), response.read()
        finally:
            client.close()

    def claim(self):
        code, headers, body = self.request('POST', '/claim', {'Origin': self.origin, 'Authorization': 'Bearer ' + self.token})
        self.assertEqual(code, 200)
        self.cookie = headers['Set-Cookie'].split(';', 1)[0]
        return headers, json.loads(body)

    def test_idle_has_no_service_timer_identity_or_file_memory(self):
        self.assertFalse(self.transfer.snapshot()['active'])
        self.assertIsNone(self.transfer.server); self.assertIsNone(self.transfer.worker); self.assertIsNone(self.transfer.timer)
        self.assertTrue(self.transfer.data is None); self.assertFalse(self.transfer.folder.exists())
        self.assertEqual(self.transfer.configuration()['address'], '127.0.0.1')
        self.assertFalse(self.transfer.folder.exists())

    def test_only_own_selected_address_is_allowed_and_setting_does_not_start_server(self):
        for address in ('0.0.0.0', '8.8.8.8', 'https://host', None, []):
            with self.assertRaises(ValueError):
                self.transfer.configure(address)
        self.transfer.configure('127.0.0.1')
        self.assertEqual(self.transfer.configuration()['address'], '127.0.0.1')
        self.assertIsNone(self.transfer.server)

    def test_real_tls_one_use_claim_cookie_and_exact_download(self):
        self.share(); headers, metadata = self.claim()
        self.assertEqual(metadata['name'], 'Síntesis propia.txt'); self.assertEqual(metadata['size'], len(self.payload))
        for flag in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'):
            self.assertTrue(flag in headers['Set-Cookie'])
        self.assertFalse('Access-Control-Allow-Origin' in headers)
        code, _, _ = self.request('POST', '/claim', {'Origin': self.origin, 'Authorization': 'Bearer ' + self.token})
        self.assertEqual(code, 403)
        code, headers, content = self.request('GET', '/file', {'Cookie': self.cookie})
        self.assertEqual(code, 200); self.assertTrue(content == self.payload)
        self.assertEqual(headers['Content-Type'], 'application/octet-stream'); self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertIn('attachment;', headers['Content-Disposition'])
        self.assertTrue(unquote(headers['Content-Disposition'].split("UTF-8''")[1]) == 'Síntesis propia.txt')
        # The client can finish reading before the server thread records the
        # final write. Await that observation without weakening the byte check.
        deadline=time.monotonic()+1
        while self.transfer.snapshot()['state']!='sent' and time.monotonic()<deadline:
            time.sleep(.005)
        self.assertEqual(self.transfer.snapshot()['state'], 'sent')

    def test_unauthorized_paths_do_not_expose_file_or_api_and_cross_origin_is_rejected(self):
        self.share()
        for path in ('/file', '/info', '/api/computer/status', '/../../.env'):
            code, _, body = self.request('GET', path)
            self.assertEqual(code, 403); self.assertFalse(self.payload in body)
        code, _, _ = self.request('GET', '/', {'Host': 'evil.test'})
        self.assertEqual(code, 403)
        code, _, _ = self.request('POST', '/claim', {'Origin': 'https://evil.test', 'Authorization': 'Bearer ' + self.token})
        self.assertEqual(code, 403)
        self.claim()  # Foreign origin did not consume the real capability.

    def test_static_phone_page_has_no_credential_and_has_csp(self):
        self.share(); code, headers, body = self.request('GET', '/')
        self.assertEqual(code, 200); self.assertFalse(self.token.encode('ascii') in body)
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(headers['Referrer-Policy'], 'no-referrer')

    def test_phone_page_uses_share_locale_and_only_its_ui_messages(self):
        from desktop.experience.workspace_phone import PHONE_MESSAGES
        class Metadata(HTMLParser):
            def __init__(self):
                super().__init__()
                self.locale=None
                self.messages=None
            def handle_starttag(self,tag,attrs):
                attrs=dict(attrs)
                if tag=='html':
                    self.locale=attrs.get('lang')
                if tag=='meta' and attrs.get('name')=='brivany-phone-language':
                    self.messages=json.loads(attrs['content'])

        for locale,label in [('es','Descargar'),('en','Download'),('fr','Télécharger'),('pt-BR','Baixar')]:
            with self.subTest(locale=locale):
                self.transfer.share('Síntesis propia.txt',self.payload,locale=locale)
                self.origin=self.transfer.origin
                parser=Metadata()
                status,_,body=self.request('GET','/')
                self.assertEqual(status,200)
                parser.feed(body.decode('utf-8'))
                self.assertEqual(parser.locale,locale)
                self.assertEqual(parser.messages.get('Descargar','Descargar'),label)
                self.assertIn(('>'+label+'</a>').encode('utf-8'),body)
                self.assertEqual(set(parser.messages),set(PHONE_MESSAGES) if locale!='es' else set())
                self.assertNotIn(self.transfer.secret.encode('ascii'),body)
                self.assertNotIn(b'Scroll to read',body)

    def test_invalid_locale_leaves_current_share_intact(self):
        initial=self.share()
        with self.assertRaisesRegex(ValueError,'idioma'):
            self.transfer.share('Otro.txt',b'other',locale='../../outside')
        self.assertEqual(self.transfer.snapshot(),initial)

    def test_range_and_invalid_ranges(self):
        self.share(); self.claim()
        code, headers, body = self.request('GET', '/file', {'Cookie': self.cookie, 'Range': 'bytes=4-20'})
        self.assertEqual(code, 206); self.assertTrue(body == self.payload[4:21])
        self.assertEqual(headers['Content-Range'], f'bytes 4-20/{len(self.payload)}')
        for value in ('bytes=20-4', 'bytes=-1', 'bytes=999999-', 'bytes=0-1,3-4', 'bytes=' + '9' * 100 + '-'):
            code, _, _ = self.request('GET', '/file', {'Cookie': self.cookie, 'Range': value})
            self.assertEqual(code, 416)

    def test_malformed_and_non_ascii_capabilities_are_denied_without_processing(self):
        self.share()
        for value in ('', 'é' * 43, '../path', 'x' * 200):
            code, _, _ = self.request('POST', '/claim', {'Origin': self.origin, 'Authorization': 'Bearer ' + value})
            self.assertEqual(code, 403)
        self.claim()
        code, _, _ = self.request('GET', '/file', {'Cookie': COOKIE + '=invalid'})
        self.assertEqual(code, 403)

    def test_cancel_closes_socket_thread_and_erases_payload_and_credentials(self):
        self.share(); self.claim(); worker = self.transfer.worker; port = self.transfer.server.server_port
        self.transfer.stop()
        self.assertFalse(worker.is_alive()); self.assertTrue(self.transfer.data is None)
        self.assertTrue(self.transfer.grant is None); self.assertTrue(self.transfer.secret is None); self.assertTrue(self.transfer.qr is None)
        with socket.socket() as client:
            client.settimeout(.5); self.assertNotEqual(client.connect_ex(('127.0.0.1', port)), 0)

    def test_real_expiry_timer_retires_listener_without_a_status_poll(self):
        self.assertEqual(self.transfer.ttl, 300)
        self.transfer.ttl = .2  # Same production path with a short test lifetime.
        self.share(); worker = self.transfer.worker
        deadline = time.monotonic() + 3
        while worker.is_alive() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertFalse(worker.is_alive())
        self.assertEqual(self.transfer.snapshot()['state'], 'expired')
        self.assertTrue(self.transfer.data is None)
        self.assertTrue(self.transfer.secret is None)

    def test_new_share_retires_old_cookie_and_old_timer_cannot_cancel_new_session(self):
        clock = [100.0]; self.transfer.clock = lambda: clock[0]
        self.share(); self.claim(); grant = self.transfer.grant; old_worker = self.transfer.worker
        clock[0] = 101; self.share(); self.assertFalse(old_worker.is_alive())
        self.assertIsNone(self.transfer.content(grant))
        clock[0] = 400.5; self.transfer.expire(); self.assertTrue(self.transfer.snapshot()['active'])
        clock[0] = 402; self.transfer.expire(); self.assertFalse(self.transfer.snapshot()['active'])
        self.assertEqual(self.transfer.snapshot()['state'], 'expired'); self.assertTrue(self.transfer.data is None)

    def test_invalid_payload_and_ambiguous_network_never_bind(self):
        for name, payload in [('../file.txt', b'x'), ('x\n.txt', b'x'), ('file.txt', False), ('file.txt', b'x' * (MAX_FILE_BYTES + 1))]:
            with self.assertRaises(ValueError):
                self.transfer.share(name, payload)
        self.transfer.addresses = lambda: ['192.168.1.10', '10.0.0.10']
        with self.assertRaises(ValueError):
            self.share()
        self.assertIsNone(self.transfer.server)

    def test_shelf_snapshot_rejects_changed_files_and_remains_immutable(self):
        shelf = FileShelf(); self.addCleanup(shelf.close)
        path = Path(self.temp.name) / 'owned.txt'; path.write_bytes(self.payload)
        identifier = shelf.add_path(str(path)); name, data = shelf.share_payload(identifier)
        self.assertTrue(data == self.payload); path.write_bytes(b'changed')
        self.assertTrue(data == self.payload)
        with self.assertRaises(ValueError):
            shelf.share_payload(identifier)

    def test_removing_shared_item_revokes_service_and_public_actions_require_trust(self):
        class Bridge(WorkspacePhoneBridge, WorkspaceFilesBridge):
            pass
        bridge = Bridge(); bridge._trusted = lambda: None; bridge._workspace_file_transfer = self.transfer
        bridge._workspace_file_shelf = FileShelf(); self.addCleanup(bridge._workspace_file_shelf.close)
        item = bridge._workspace_file_shelf.add_upload('owned.txt', base64.b64encode(self.payload).decode('ascii'))
        bridge.workspace_phone_share(item); bridge.workspace_files_remove(item)
        self.assertFalse(self.transfer.snapshot()['active'])
        reject = WorkspacePhoneBridge(); reject._trusted = Mock(side_effect=PermissionError('untrusted'))
        for method, args in [('workspace_phone_settings', ()), ('workspace_phone_state', ()), ('workspace_phone_share', ('id',)), ('workspace_phone_stop', ())]:
            with self.subTest(method=method), self.assertRaises(PermissionError):
                getattr(reject, method)(*args)
        self.assertFalse(hasattr(reject, '_workspace_phone'))

    def test_actual_qr_decodes_to_only_the_temporary_capability(self):
        import cv2
        import numpy as np
        value = self.share()
        raw = base64.b64decode(value['qr'].partition(',')[2])
        pixels = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
        decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
        self.assertTrue(decoded == value['link'])

    def test_remove_during_share_creation_cannot_leave_a_live_file_grant(self):
        import threading
        class Bridge(WorkspacePhoneBridge, WorkspaceFilesBridge):
            pass
        bridge = Bridge(); bridge._trusted = lambda: None; bridge._workspace_file_transfer = self.transfer
        bridge._workspace_file_shelf = FileShelf(); self.addCleanup(bridge._workspace_file_shelf.close)
        identifier = bridge._workspace_file_shelf.add_upload('owned.txt', base64.b64encode(self.payload).decode('ascii'))
        entered, release, removed = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def identity(*args):
            entered.set(); release.wait(2)
            return self.context, self.fingerprint, self.certificate
        self.transfer.identity = identity
        def share():
            try:bridge.workspace_phone_share(identifier)
            except ValueError:pass  # Withdrawal may legitimately cancel startup.
            except Exception:errors.append('share failed')
        def remove():
            try:bridge.workspace_files_remove(identifier)
            except Exception:errors.append('remove failed')
            finally:removed.set()
        sharing = threading.Thread(target=share); removal = threading.Thread(target=remove)
        sharing.start()
        try:
            self.assertTrue(entered.wait(2)); removal.start()
            removed.wait(.05)  # Force the overlap; no particular locking strategy is required.
        finally:
            release.set(); sharing.join(timeout=4)
            if removal.ident is not None:removal.join(timeout=4)
        self.assertEqual(errors, [])
        self.assertFalse(self.transfer.snapshot()['active'])

    def test_bind_failure_rolls_back_listener_and_payload(self):
        with patch('desktop.experience.workspace_phone.FileServer', side_effect=OSError('fixture bind failure')):
            with self.assertRaises(ValueError):
                self.share()
        self.assertIsNone(self.transfer.server); self.assertIsNone(self.transfer.worker)
        self.assertIsNone(self.transfer.timer); self.assertTrue(self.transfer.data is None)
        self.assertFalse(self.transfer.snapshot()['active'])

    def test_late_removal_hook_cannot_cancel_a_different_new_file(self):
        import threading
        class Bridge(WorkspacePhoneBridge, WorkspaceFilesBridge):
            pass
        bridge = Bridge(); bridge._trusted = lambda: None; bridge._workspace_file_transfer = self.transfer
        shelf = bridge._workspace_file_shelf = FileShelf(); self.addCleanup(shelf.close)
        first = shelf.add_upload('first.txt', base64.b64encode(self.payload).decode('ascii'))
        second = shelf.add_upload('second.txt', base64.b64encode(b'owned second file').decode('ascii'))
        bridge.workspace_phone_share(first); shelf.remove(first)
        entered, release = threading.Event(), threading.Event(); errors = []
        def identity(*args):
            entered.set(); release.wait(2)
            return self.context, self.fingerprint, self.certificate
        self.transfer.identity = identity
        def sharing():
            try:bridge.workspace_phone_share(second)
            except Exception:errors.append('new share failed')
        starting = threading.Thread(target=sharing)
        starting.start(); self.assertTrue(entered.wait(2))
        removing = threading.Thread(target=lambda: bridge._workspace_file_removed(first))
        removing.start(); time.sleep(.05); release.set()
        starting.join(timeout=4); removing.join(timeout=4)
        self.assertEqual(errors, [])
        self.assertTrue(self.transfer.snapshot()['active'])
        self.assertEqual(self.transfer.snapshot()['name'], 'second.txt')

    def test_shutdown_rejects_late_native_factory_and_service_start(self):
        bridge = WorkspacePhoneBridge(); bridge._trusted = lambda: None; bridge._exit_requested = True
        with self.assertRaises(ValueError):
            bridge.workspace_phone_state()
        self.assertFalse(hasattr(bridge, '_workspace_phone'))
        self.transfer.close()
        with self.assertRaises(ValueError):
            self.share()

    def test_concurrent_claims_only_issue_one_device_grant(self):
        import threading
        self.share(); barrier = threading.Barrier(3); results = []
        def request():
            barrier.wait()
            code, _, _ = self.request('POST', '/claim', {'Origin': self.origin, 'Authorization': 'Bearer ' + self.token})
            results.append(code)
        workers = [threading.Thread(target=request) for _ in range(2)]
        for worker in workers:worker.start()
        barrier.wait()
        for worker in workers:worker.join(timeout=5)
        self.assertEqual(sorted(results), [200, 403])

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI integration')
    def test_real_user_dpapi_keeps_tls_identity_stable_without_plaintext_persistent_key(self):
        path = Path(self.temp.name) / 'identity'
        _, first, certificate = tls_identity('127.0.0.1', path)
        _, second, _ = tls_identity('127.0.0.1', path)
        self.assertTrue(first == second)
        identity = next(path.glob('*.identity')).read_bytes()
        self.assertFalse(b'PRIVATE KEY' in identity); self.assertFalse(b'BEGIN CERTIFICATE' in identity)
        self.assertEqual(ssl.create_default_context(cadata=certificate).verify_mode, ssl.CERT_REQUIRED)


if __name__ == '__main__':
    unittest.main()
