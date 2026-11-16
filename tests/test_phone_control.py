"""Owned TLS listener, simulated screen and input/power. No desktop changes."""
from concurrent.futures import ThreadPoolExecutor
import ctypes
import http.client
import io
import json
from pathlib import Path
import ssl
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

from PIL import Image
from desktop.experience.phone_control import PhoneControl, Rejected, WorkspacePhoneControlBridge, parse_action
from desktop.experience.phone_input import Input, WindowsPhoneInput, capture_primary
from desktop.experience.workspace_phone import tls_identity
from tests.test_workspace_phone import FixtureProtector


class Driver:
    def __init__(self):
        self.events = []
        self.power_events = []
    def run(self, kind, value):
        self.events.append((kind, value))
    def power(self, value):
        self.power_events.append(value)


def own_frame():
    raw = io.BytesIO()
    with Image.new('RGB', (420, 245), '#2b405f') as image:
        image.save(raw, 'JPEG')
    return raw.getvalue()


class ControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.identity_folder = tempfile.TemporaryDirectory()
        cls.identity = tls_identity('127.0.0.1', cls.identity_folder.name, FixtureProtector())
        cls.tls = ssl.create_default_context(cadata=cls.identity[2])

    @classmethod
    def tearDownClass(cls):
        cls.identity_folder.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.driver, self.events = Driver(), []
        self.now = 100.0
        self.control = PhoneControl(Path(self.temp.name), addresses=lambda:['127.0.0.1'],
            identity=lambda *_:self.identity, clock=lambda:self.now, driver=lambda:self.driver,
            capture=own_frame, publish=self.events.append)
        self.addCleanup(self.control.close)

    def open(self):
        state = self.control.start('127.0.0.1')
        self.origin, self.invite = self.control.origin, self.control.invite
        self.assertEqual(state['state'], 'waiting')
        self.assertTrue(state['qr'].startswith('data:image/png;base64,'))

    def request(self, method, path, body=None, headers=None):
        parsed = urlsplit(self.origin)
        client = http.client.HTTPSConnection(parsed.hostname, parsed.port, context=self.tls, timeout=3)
        try:
            client.request(method, path, body, headers=headers or {})
            response = client.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            client.close()

    def claim_request(self):
        return self.request('POST','/claim', headers={'Origin':self.origin,'Authorization':'Bearer '+self.invite})

    def claim(self):
        status, headers, raw = self.claim_request()
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';',1)[0]
        self.code = json.loads(raw)['code']
        return headers

    def action(self, seq, kind, value, *, origin=None, cookie=None):
        return self.request('POST','/action', json.dumps({'seq':seq,'kind':kind,'value':value}),
            {'Origin':origin or self.origin,'Cookie':self.cookie if cookie is None else cookie,'Content-Type':'application/json'})

    def test_pairing_is_single_use_and_needs_local_code_and_scopes(self):
        self.assertIsNone(self.control.server)
        self.assertIsNone(self.control.driver)
        self.open()
        self.assertEqual(self.request('GET','/state')[0], 403)
        with ThreadPoolExecutor(2) as pool:
            outcomes = list(pool.map(lambda _:self.claim_request(), range(2)))
        self.assertEqual(sorted(result[0] for result in outcomes), [200,403])
        _, headers, body = next(result for result in outcomes if result[0] == 200)
        self.assertIn('Secure; HttpOnly; SameSite=Strict', headers['Set-Cookie'])
        self.cookie = headers['Set-Cookie'].split(';',1)[0]
        self.code = json.loads(body)['code']
        state = self.control.snapshot()
        self.assertNotIn('code', state)
        self.assertIsNone(state['qr'])
        self.assertEqual(self.action(1,'music',{'key':'next'})[0],403)
        with self.assertRaises(ValueError):self.control.approve('000000' if self.code != '000000' else '000001',['music'])
        with self.assertRaises(ValueError):self.control.approve(self.code,[])
        value = self.control.approve(self.code,['music'])
        self.assertEqual(value['scopes'],['music'])
        self.assertEqual(self.action(1,'music',{'key':'next'})[0],200)
        self.assertEqual(self.action(2,'text',{'text':'owned'})[0],403)
        self.assertEqual(self.driver.events,[('music',{'key':'next'})])

    def test_real_https_screen_unicode_pointer_and_slide(self):
        self.open(); self.claim(); self.control.approve(self.code,['input','screen','slides','music'])
        for seq, kind, value in [(1,'move',{'x':120,'y':-10}),(2,'text',{'text':'Nota propia 🙂'}),
                                  (3,'slides',{'key':'next'}),(4,'music',{'key':'volume-up'}),(5,'scroll',{'ticks':-1}),
                                  (6,'tap-screen',{'x':63000,'y':850})]:
            self.assertEqual(self.action(seq,kind,value)[0],200)
        self.assertEqual(len(self.driver.events),6)
        headers = {'Cookie':self.cookie}
        status, response_headers, raw = self.request('GET','/frame',headers=headers)
        self.assertEqual((status,response_headers['Content-Type'],response_headers['Cache-Control']),(200,'image/jpeg','no-store'))
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual(image.size,(420,245))
            self.assertLess(sum(abs(actual-expected) for actual,expected in zip(image.getpixel((0,0)),(43,64,95))),8)
        self.assertEqual(self.request('GET','/frame',headers=headers)[0],429)

    def test_file_cookie_cross_origin_and_replays_are_rejected(self):
        self.open(); self.claim(); self.control.approve(self.code,['input'])
        self.assertEqual(self.action(1,'text',{'text':'owned'},origin='https://foreign.invalid')[0],403)
        self.assertEqual(self.action(1,'text',{'text':'owned'},cookie='__Host-brivany-file='+'a'*43)[0],403)
        self.assertEqual(self.request('GET','/file',headers={'Cookie':self.cookie})[0],404)
        self.assertEqual(self.request('GET','/state',headers={'Cookie':self.cookie,'Host':'foreign.invalid'})[0],403)
        self.assertEqual(self.action(1,'text',{'text':'owned'})[0],200)
        self.assertEqual(self.action(1,'text',{'text':'owned'})[0],409)
        self.assertEqual(self.action(2,'tap-screen',{'x':100,'y':100})[0],403)
        self.assertEqual(len(self.driver.events),1)

    def test_approved_power_revokes_first_and_rejected_power_resumes_input(self):
        self.open(); self.claim(); self.control.approve(self.code,['input','power','screen'])
        self.assertEqual(self.action(1,'power',{'action':'shutdown'})[0],200)
        self.assertEqual(self.driver.power_events,[])
        self.assertEqual(self.action(2,'click',{'button':'left'})[0],409)
        self.assertEqual(self.request('GET','/frame',headers={'Cookie':self.cookie})[0],409)
        self.control.decide_power(self.control.snapshot()['power']['id'],False)
        self.assertEqual(self.action(2,'click',{'button':'left'})[0],200)
        self.assertEqual(self.action(3,'power',{'action':'lock'})[0],200)
        native = self.driver.power
        def proof(action):
            self.assertIsNone(self.control.server)
            self.assertIsNone(self.control.grant)
            native(action)
        self.driver.power = proof
        self.assertEqual(self.control.decide_power(self.control.snapshot()['power']['id'],True)['state'],'ended')
        self.assertEqual(self.driver.power_events,['lock'])

    def test_expiration_and_remote_disconnect_retire_listener(self):
        self.open(); self.claim(); self.control.approve(self.code,['power'])
        self.action(1,'power',{'action':'shutdown'})
        pending = self.control.snapshot()['power']['id']
        self.now += 31
        with self.assertRaises(ValueError):self.control.decide_power(pending,True)
        self.assertEqual(self.driver.power_events,[])
        self.now += 601
        self.assertEqual(self.request('GET','/state',headers={'Cookie':self.cookie})[0],403)
        self.open(); self.claim(); self.control.approve(self.code,['input'])
        status, headers, raw = self.request('POST','/disconnect',headers={'Origin':self.origin,'Cookie':self.cookie})
        self.assertEqual(status,200); self.assertIn('Max-Age=0',headers['Set-Cookie'])
        until = time.monotonic()+2
        while self.control.server is not None and time.monotonic()<until:
            time.sleep(.01)
        self.assertIsNone(self.control.server); self.assertEqual(self.control.snapshot()['state'],'ended')

    def test_revoked_grant_cannot_be_approved_while_listener_is_retiring(self):
        self.open(); self.claim()
        generation = self.control.disconnect(self.control.grant,'127.0.0.1')
        with self.assertRaises(ValueError):self.control.approve(self.code,['power'])
        self.control.retire(generation)

        self.open(); self.claim(); self.control.approve(self.code,['power'])
        self.assertEqual(self.action(1,'power',{'action':'shutdown'})[0],200)
        pending = self.control.snapshot()['power']['id']
        generation = self.control.disconnect(self.control.grant,'127.0.0.1')
        with self.assertRaises(ValueError):self.control.decide_power(pending,True)
        self.control.retire(generation)
        self.assertEqual(self.driver.power_events,[])

    def test_revocation_during_capture_discards_pending_frame(self):
        entered, release = threading.Event(), threading.Event()
        def slow_capture():
            entered.set(); release.wait(3); return own_frame()
        self.control.capture = slow_capture
        self.open(); self.claim(); self.control.approve(self.code,['screen'])
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(self.control.frame,self.control.grant,'127.0.0.1')
            self.assertTrue(entered.wait(2))
            self.control.stop(); release.set()
            with self.assertRaises(Rejected):future.result(3)

    def test_rate_limit_caps_valid_input(self):
        self.open(); self.claim(); self.control.approve(self.code,['input'])
        grant = self.control.grant
        for seq in range(1,29):
            self.control.action(grant,'127.0.0.1',{'seq':seq,'kind':'move','value':{'x':1,'y':1}})
        with self.assertRaises(Rejected) as error:
            self.control.action(grant,'127.0.0.1',{'seq':29,'kind':'move','value':{'x':1,'y':1}})
        self.assertEqual(error.exception.status,429)
        self.now += 1
        self.assertTrue(self.control.action(grant,'127.0.0.1',{'seq':29,'kind':'move','value':{'x':1,'y':1}})['ok'])


class InputTests(unittest.TestCase):
    def test_bad_packets_and_nonliteral_keys_are_rejected(self):
        for kind,value in [('move',{'x':True,'y':1}),('move',{'x':250,'y':0}),('text',{'text':'line\nline'}),
                           ('text',{'text':'\ud800'}),('key',{'key':'Ctrl+Alt+Del'}),('power',{'action':'restart'}),
                           ('music',{'key':[]}),('slides',{'key':'launch'}),('shell',{'command':'dir'})]:
            with self.subTest(kind=kind), self.assertRaises(Rejected):parse_action({'seq':1,'kind':kind,'value':value})

    def test_win32_abi_and_released_key_pairs(self):
        driver = object.__new__(WindowsPhoneInput)
        driver.user = Mock()
        recorded = []
        def intercept(count, values, size):
            self.assertEqual(size,40 if ctypes.sizeof(ctypes.c_void_p)==8 else 28)
            recorded.extend((event.kind,event.key.scan,event.key.flags) for event in values)
            return count
        driver.user.SendInput.side_effect = intercept
        driver.run('text',{'text':'A🙂'})
        self.assertEqual([(x[1],x[2]) for x in recorded],[(65,4),(65,6),(0xD83D,4),(0xD83D,6),(0xDE42,4),(0xDE42,6)])
        driver.user.SendInput.side_effect = [1,1]
        with self.assertRaises(ValueError):driver.run('key',{'key':'enter'})
        release = ctypes.cast(driver.user.SendInput.call_args.args[1], ctypes.POINTER(Input)).contents
        self.assertEqual((release.key.virtual, release.key.flags),(0x0d,2))

    def test_preview_encoder_scales_an_owned_frame(self):
        with patch('PIL.ImageGrab.grab',return_value=Image.new('RGB',(1600,900),'#234563')):
            with Image.open(io.BytesIO(capture_primary())) as result:
                self.assertEqual(result.size,(960,540))
                self.assertEqual(result.format,'JPEG')

    def test_untrusted_desktop_bridge_cannot_create_listener(self):
        bridge = WorkspacePhoneControlBridge()
        bridge._trusted = Mock(side_effect=ValueError('foreign origin'))
        for method, args in [('start',()),('approve',('123456',['input'])),('power',('a',True)),('stop',()),('state',())]:
            with self.assertRaises(ValueError):getattr(bridge,'workspace_phone_control_'+method)(*args)
        self.assertFalse(hasattr(bridge,'_phone_control_service'))


if __name__ == '__main__':unittest.main()
