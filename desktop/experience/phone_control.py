"""Short-lived, locally approved HTTPS control for one phone."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
from collections import deque
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import unicodedata
from urllib.parse import urlsplit

from .phone_input import KEYS, MUSIC, SLIDES, WindowsPhoneInput, capture_primary
from .scripts import post_script
from .workspace_phone import FileServer, ROOT, local_addresses, tls_identity

SITE = Path(__file__).with_name('phone_remote')
SCOPES = frozenset({'input', 'screen', 'music', 'slides', 'power'})
COOKIE = '__Host-brivany-control'
INVITE_TTL = 120
SESSION_TTL = 600
POWER_TTL = 30
SECRET = re.compile(r'[A-Za-z0-9_-]{43}')
ACTION_SCOPES = {'move':'input', 'click':'input', 'scroll':'input', 'text':'input', 'key':'input',
                 'tap-screen':'input', 'music':'music', 'slides':'slides', 'power':'power'}


class Rejected(ValueError):
    def __init__(self, message, status=403):
        super().__init__(message)
        self.status = status


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def parse_action(payload):
    if not isinstance(payload, dict) or set(payload) != {'seq', 'kind', 'value'}:
        raise Rejected('Control no válido.', 422)
    seq, kind, value = payload['seq'], payload['kind'], payload['value']
    if not integer(seq, 1, 2**31 - 1) or not isinstance(kind, str) or kind not in ACTION_SCOPES or not isinstance(value, dict):
        raise Rejected('Control no válido.', 422)
    if kind in ('move', 'tap-screen'):
        low, high = (-240, 240) if kind == 'move' else (0, 65535)
        valid = set(value) == {'x', 'y'} and all(integer(value[axis], low, high) for axis in ('x', 'y'))
    elif kind == 'scroll':
        valid = set(value) == {'ticks'} and integer(value['ticks'], -5, 5) and value['ticks'] != 0
    elif kind == 'click':
        valid = set(value) == {'button'} and value['button'] in ('left', 'right')
    elif kind == 'text':
        text = value.get('text')
        valid = (set(value) == {'text'} and isinstance(text, str) and 1 <= len(text) <= 160
                 and all(unicodedata.category(char) not in ('Cc', 'Cs') and char not in '\u2028\u2029' for char in text))
    elif kind == 'power':
        valid = set(value) == {'action'} and value['action'] in ('lock', 'shutdown')
    else:
        choices = {'key': KEYS, 'music': MUSIC, 'slides': SLIDES}[kind]
        selected = value.get('key')
        valid = set(value) == {'key'} and isinstance(selected, str) and selected in choices
    if not valid:
        raise Rejected('Control no válido.', 422)
    return seq, kind, value


class PhoneControl:
    def __init__(self, folder=None, *, addresses=local_addresses, clock=time.monotonic,
                 identity=tls_identity, driver=WindowsPhoneInput, capture=capture_primary, publish=None):
        self.folder = Path(folder) if folder else DATA_ROOT / '.local' / 'phone-control'
        self.addresses, self.clock, self.identity = addresses, clock, identity
        self.driver_factory, self.capture = driver, capture
        self.publish = publish or (lambda _: None)
        self.lock, self.lifecycle = threading.RLock(), threading.RLock()
        self.closed = False
        self.revision = self.generation = 0
        self.server = self.worker = self.timer = self.power_timer = None
        self.state, self.deadline = 'idle', 0
        self.origin = self.invite = self.qr = self.fingerprint = None
        self._reset_authority()

    def _reset_authority(self):
        self.grant = self.peer = self.code = self.driver = self.pending = None
        self.attempts = self.seq = 0
        self.scopes = frozenset()
        self.recent = deque()
        self.last_frame = float('-inf')
        self.capture_busy = False

    def _alive(self):
        return self.server is not None and self.clock() < self.deadline

    def _snapshot(self):
        active = self._alive()
        result = {'state':self.state if active or self.server is None else 'expired', 'revision':self.revision,
                  'scopes':sorted(self.scopes) if active else [],
                  'expires_in':max(0, round(self.deadline - self.clock())) if active else 0}
        return result

    def snapshot(self):
        with self.lock:
            value = self._snapshot()
            pending = self.pending if self._alive() and self.pending and self.clock() < self.pending['until'] else None
            value.update(qr=self.qr if self._alive() else None, fingerprint=self.fingerprint,
                         power={k:pending[k] for k in ('id','action')} if pending else None)
            return value

    def _emit(self):
        try:
            self.publish(self.snapshot())
        except Exception:
            pass

    def _arm(self, seconds):
        if self.timer:
            self.timer.cancel()
        generation = self.generation
        def expire():
            with self.lifecycle:
                if generation != self.generation or not self.server or self.clock() < self.deadline:
                    return
                self._stop('expired')
            self._emit()
        self.timer = threading.Timer(seconds, expire)
        self.timer.daemon = True
        self.timer.start()

    def start(self, address):
        if not isinstance(address, str) or address not in self.addresses():
            raise ValueError('Elige la red del teléfono en Ajustes → Melodi WorkSpace.')
        with self.lifecycle:
            if self.closed:
                raise ValueError('El control móvil está cerrado.')
            if self._alive():
                raise ValueError('Termina la conexión anterior antes de abrir otra.')
            self._stop('idle')
            try:
                import segno
                context, fingerprint, _ = self.identity(address, self.folder / 'identity')
                driver = self.driver_factory()
                server = FileServer((address, 0), handler_for(self), context)
            except (OSError, ValueError, ImportError):
                raise ValueError('No se pudo abrir el control móvil. Comprueba la red y la instalación.') from None
            try:
                origin = f'https://{address}:{server.server_port}'
                invite = secrets.token_urlsafe(32)
                qr = segno.make_qr(origin + '/#' + invite, error='m').png_data_uri(scale=5, border=4)
                with self.lock:
                    self.server, self.driver = server, driver
                    self.origin, self.invite, self.qr, self.fingerprint = origin, invite, qr, fingerprint
                    self.state, self.deadline = 'waiting', self.clock() + INVITE_TTL
                    self.revision += 1
                self.worker = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .25},
                                               daemon=True, name='brivany-phone-control')
                self.worker.start()
                self._arm(INVITE_TTL)
            except Exception:
                if self.server is server:
                    self._stop('idle')
                else:
                    server.server_close()
                raise ValueError('No se pudo preparar el QR de control móvil.') from None
        self._emit()
        return self.snapshot()

    def _stop(self, state):
        with self.lock:
            server, worker, timer, power_timer = self.server, self.worker, self.timer, self.power_timer
            self.server = self.worker = self.timer = self.power_timer = None
            self.origin = self.invite = self.qr = None
            self.state, self.deadline = state, 0
            self.generation += 1
            self.revision += 1
            self._reset_authority()
        for scheduled in (timer, power_timer):
            if scheduled:
                scheduled.cancel()
        if server:
            server.close_clients()
            if worker and worker.is_alive():
                server.shutdown()
            server.close_clients()
            server.server_close()
        if worker and worker is not threading.current_thread() and worker.is_alive():
            worker.join(2)

    def stop(self):
        with self.lifecycle:
            self._stop('ended')
        self._emit()
        return self.snapshot()

    def close(self):
        with self.lifecycle:
            self.closed = True
            self._stop('ended')
        self._emit()

    def claim(self, token, peer):
        with self.lock:
            if not self._alive() or self.state != 'waiting' or not self.invite or not SECRET.fullmatch(token) or not hmac.compare_digest(token, self.invite):
                raise Rejected('El QR caducó o ya se usó.')
            self.grant = secrets.token_urlsafe(32)
            self.peer = peer
            self.code = f'{secrets.randbelow(1000000):06d}'
            self.invite = self.qr = None
            self.state = 'review'
            self.revision += 1
            grant, code = self.grant, self.code
        self._emit()
        return grant, code

    def approve(self, code, scopes):
        if (not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code) or not isinstance(scopes, list)
                or not 1 <= len(scopes) <= len(SCOPES) or any(not isinstance(item, str) or item not in SCOPES for item in scopes)):
            raise ValueError('Introduce el código del teléfono y elige qué permitir.')
        with self.lifecycle:
            with self.lock:
                if not self._alive() or self.state != 'review' or not self.grant:
                    raise ValueError('La solicitud de conexión caducó.')
                matched = hmac.compare_digest(code, self.code)
                if matched:
                    self.code = None
                    self.scopes = frozenset(scopes)
                    self.deadline = self.clock() + SESSION_TTL
                    self.state = 'active'
                    self.revision += 1
                else:
                    self.attempts += 1
            if not matched:
                if self.attempts >= 5:
                    self._stop('ended')
                    self._emit()
                    raise ValueError('Demasiados códigos incorrectos. Genera otro QR.')
                raise ValueError('El código no coincide con el del teléfono.')
            self._arm(SESSION_TTL)
        self._emit()
        return self.snapshot()

    def _authenticate(self, grant, peer, scope=None):
        if (not self._alive() or not self.grant or self.peer != peer or not SECRET.fullmatch(grant)
                or not hmac.compare_digest(grant, self.grant)):
            raise Rejected('Conexión finalizada.')
        if scope and (self.state != 'active' or scope not in self.scopes):
            raise Rejected('Este control no está autorizado.')

    def remote_state(self, grant, peer):
        with self.lock:
            self._authenticate(grant, peer)
            value = self._snapshot()
            value.update(seq=self.seq, code=self.code, paused=bool(self.pending))
            return value

    def action(self, grant, peer, payload):
        seq, kind, value = parse_action(payload)
        with self.lock:
            self._authenticate(grant, peer, ACTION_SCOPES[kind])
            if self.pending:
                raise Rejected('Espera la decisión en el PC.', 409)
            if kind == 'tap-screen' and 'screen' not in self.scopes:
                raise Rejected('La pantalla no está autorizada.')
            if seq <= self.seq:
                raise Rejected('La entrada ya se procesó.', 409)
            now = self.clock()
            while self.recent and self.recent[0] <= now - 1:
                self.recent.popleft()
            if len(self.recent) >= 28:
                raise Rejected('Espera un momento antes de volver a intentar.', 429)
            self.recent.append(now)
            self.seq = seq
            if kind != 'power':
                self.driver.run(kind, value)
                return {'ok':True}
            pending_id = secrets.token_hex(16)
            self.pending = {'id':pending_id, 'action':value['action'], 'until':now + POWER_TTL}
            self.revision += 1
            def expire_power():
                with self.lock:
                    if not self.pending or self.pending['id'] != pending_id:
                        return
                    self.pending = self.power_timer = None
                    self.revision += 1
                self._emit()
            self.power_timer = threading.Timer(POWER_TTL, expire_power)
            self.power_timer.daemon = True
            self.power_timer.start()
        self._emit()
        return {'ok':True, 'pending':True}

    def decide_power(self, identifier, accepted):
        if not isinstance(identifier, str) or type(accepted) is not bool:
            raise ValueError('Decisión no válida.')
        with self.lifecycle:
            with self.lock:
                pending = self.pending
                if (not self._alive() or self.state != 'active' or not self.grant or not pending
                        or identifier != pending['id'] or self.clock() >= pending['until']):
                    raise ValueError('La solicitud de energía caducó.')
                if accepted:
                    self.grant = None
                else:
                    self.pending = None
                if self.power_timer:
                    self.power_timer.cancel()
                    self.power_timer = None
                driver = self.driver
                self.revision += 1
            if accepted:
                self._stop('ended')
                self._emit()
                try:
                    driver.power(pending['action'])
                except (OSError, RuntimeError):
                    raise ValueError('Windows no confirmó la solicitud de energía.') from None
        self._emit()
        return self.snapshot()

    def frame(self, grant, peer):
        with self.lock:
            self._authenticate(grant, peer, 'screen')
            if self.pending:
                raise Rejected('La pantalla está en pausa.', 409)
            if self.capture_busy or self.clock() - self.last_frame < .45:
                raise Rejected('Espera el siguiente fotograma.', 429)
            self.capture_busy, self.last_frame = True, self.clock()
            generation = self.generation
        try:
            data = self.capture()
            if not isinstance(data, bytes) or not data.startswith(b'\xff\xd8') or len(data) > 512 * 1024:
                raise Rejected('Pantalla no disponible.', 503)
            with self.lock:
                self._authenticate(grant, peer, 'screen')
                if self.pending:
                    raise Rejected('La pantalla está en pausa.', 409)
                return data
        finally:
            with self.lock:
                if generation == self.generation:
                    self.capture_busy = False

    def disconnect(self, grant, peer):
        with self.lock:
            self._authenticate(grant, peer)
            self.grant = None
            return self.generation

    def retire(self, generation):
        with self.lifecycle:
            if generation != self.generation:
                return
            self._stop('ended')
        self._emit()


def handler_for(control):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'Brivany'
        sys_version = ''

        def log_message(self, *_):
            pass

        def reply(self, status, data=b'', mime='application/json', headers=()):
            self.send_response(status)
            for key, value in (
                ('Content-Type', mime), ('Content-Length', str(len(data))), ('Cache-Control', 'no-store'),
                ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'no-referrer'), ('Connection', 'close'),
                ('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"),
                *headers,
            ):
                self.send_header(key, value)
            self.end_headers()
            self.close_connection = True
            self.wfile.write(data)

        def json_reply(self, status, value, headers=()):
            self.reply(status, json.dumps(value, ensure_ascii=False).encode('utf-8'), headers=headers)

        def check_origin(self):
            with control.lock:
                origin = control.origin
            if (not origin or self.headers.get_all('Host') != [urlsplit(origin).netloc]
                    or self.headers.get_all('Origin', []) not in ([], [origin])
                    or (self.command == 'POST' and self.headers.get_all('Origin') != [origin])):
                raise Rejected('Origen no autorizado.')

        def token(self):
            raw = self.headers.get_all('Cookie', [])
            if len(raw) != 1 or len(raw[0]) > 2048:
                return ''
            cookies = SimpleCookie()
            cookies.load(raw[0])
            return cookies[COOKIE].value if COOKIE in cookies else ''

        def do_GET(self):
            try:
                self.check_origin()
                assets = {'/':('index.html','text/html; charset=utf-8'), '/remote.js':('remote.js','text/javascript; charset=utf-8'),
                          '/remote.css':('remote.css','text/css; charset=utf-8')}
                from services.brand import FONT_ROOT
                for style in ('Light','Regular','Medium'):
                    font_name='BrivanyEditorial-'+style+'.woff2'
                    assets['/fonts/'+font_name]=(FONT_ROOT/font_name,'font/woff2')
                if self.path in assets:
                    name, mime = assets[self.path]
                    self.reply(200, (SITE / name).read_bytes(), mime)
                elif self.path == '/state':
                    self.json_reply(200, control.remote_state(self.token(), self.client_address[0]))
                elif self.path == '/frame':
                    self.reply(200, control.frame(self.token(), self.client_address[0]), 'image/jpeg')
                else:
                    self.reply(404)
            except Rejected as error:
                self.json_reply(error.status, {'error':str(error)})
            except (ValueError, OSError):
                self.json_reply(503, {'error':'Pantalla o conexión no disponible.'})

        def do_POST(self):
            try:
                self.check_origin()
                length = self.headers.get_all('Content-Length', [])
                if self.headers.get('Transfer-Encoding') or len(length) != 1 or not re.fullmatch(r'[0-9]{1,4}', length[0]):
                    raise Rejected('Solicitud no válida.', 400)
                length = int(length[0])
                peer = self.client_address[0]
                if self.path == '/claim' and length == 0:
                    header = self.headers.get('Authorization', '')
                    if len(header) != 50 or not header.startswith('Bearer '):
                        raise Rejected('QR no válido.')
                    token, code = control.claim(header[7:], peer)
                    cookie = f'{COOKIE}={token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age={INVITE_TTL + SESSION_TTL}'
                    self.json_reply(200, {'state':'review','code':code}, [('Set-Cookie',cookie)])
                elif self.path == '/action' and 1 <= length <= 4096 and self.headers.get_content_type() == 'application/json':
                    payload = json.loads(self.rfile.read(length))
                    self.json_reply(200, control.action(self.token(), peer, payload))
                elif self.path == '/disconnect' and length == 0:
                    generation = control.disconnect(self.token(), peer)
                    try:
                        self.json_reply(200, {'ok':True}, [('Set-Cookie',f'{COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')])
                        self.wfile.flush()
                    finally:
                        control.retire(generation)
                else:
                    self.reply(404)
            except Rejected as error:
                self.json_reply(error.status, {'error':str(error)})
            except (ValueError, OSError):
                self.json_reply(422, {'error':'El PC no aceptó el control.'})
    return Handler


class WorkspacePhoneControlBridge:
    _control_init = threading.Lock()

    def _publish_phone_control(self, value):
        for name in ('_bar_window','_work_window'):
            window = getattr(self, name, None)
            if window:
                data = value if name == '_work_window' else {
                    'state':value['state'], 'revision':value['revision'], 'power':bool(value['power'])}
                script = 'window.BrivanyPhoneControl?.receive(' + json.dumps(data, ensure_ascii=True) + ')'
                post_script(window, script, 'phone-control')

    def _phone_control(self):
        with self._control_init:
            if getattr(self, '_exit_requested', False):
                raise ValueError('Brivany se está cerrando.')
            if not getattr(self, '_phone_control_service', None):
                self._phone_control_service = PhoneControl(publish=self._publish_phone_control)
            return self._phone_control_service

    def _stop_phone_control(self):
        service = getattr(self, '_phone_control_service', None)
        if service and not service.closed:
            service.stop()

    def _close_phone_control(self):
        with self._control_init:
            service = getattr(self, '_phone_control_service', None)
            if service and not service.closed:
                service.close()

    def workspace_phone_control_state(self):
        self._trusted()
        service = getattr(self, '_phone_control_service', None)
        return service.snapshot() if service else {'state':'idle','revision':0,'scopes':[],'available':os.name == 'nt'}

    def workspace_phone_control_start(self):
        self._trusted()
        service = self._phone_control()
        with service.lifecycle:
            if not self._work().active:
                raise ValueError('Abre Melodi WorkSpace para vincular el teléfono.')
            return service.start(self._phone().configuration()['address'])

    def workspace_phone_control_approve(self, code, scopes):
        self._trusted()
        return self._phone_control().approve(code, scopes)

    def workspace_phone_control_stop(self):
        self._trusted()
        return self._phone_control().stop()

    def workspace_phone_control_power(self, identifier, accepted):
        self._trusted()
        return self._phone_control().decide_power(identifier, accepted)
