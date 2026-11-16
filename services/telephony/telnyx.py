"""Melodi calls over Telnyx: REST API for setup, SIP/RTP for the live conversation.

Brivany registers to a Telnyx credential connection from this computer, so no
public webhook, tunnel or open port is needed. The API key stays in `.env`
(BRIVANY_TELNYX_API_KEY) and is only used by the explicit setup tool; the
encrypted profile holds the SIP credential that Telnyx generated for Brivany.
"""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import string
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .common import ProviderError, TelephonyError, clean_text, masked, number
from .realtime import LivePhoneSession, LiveProviders
from .sip import TERMINAL, NativeSIP, identifier
from .sip_engine import config as validate_engine

API = 'https://api.telnyx.com/v2'
NAME = 'Brivany Melodi'
SERVERS = {'us': 'sip.telnyx.com', 'eu': 'sip.telnyx.eu', 'ca': 'sip.telnyx.ca',
           'au': 'sip.telnyx.com.au', 'me': 'sip.telnyx.me'}
PORTS = {'udp': 5060, 'tcp': 5060, 'tls': 5061}
PROFILE_FIELDS = {'username', 'password', 'server', 'transport', 'caller_id', 'connection_id', 'profile_id', 'outbound'}

# SIP final responses, translated into something the person can act on.
SIP_REASONS = {
    402: 'Telnyx indicó saldo insuficiente. Revisa el saldo de la cuenta.',
    403: 'Telnyx rechazó la llamada. Revisa el número emisor, los países permitidos y el nivel de la cuenta.',
    404: 'Telnyx no reconoce ese destino. Revisa el número.',
    407: 'Telnyx no aceptó la credencial SIP. Vuelve a ejecutar la configuración.',
    408: 'Nadie contestó a tiempo.',
    480: 'El teléfono no está disponible ahora.',
    484: 'El número está incompleto.',
    486: 'El número está ocupado.',
    487: 'Llamada cancelada.',
    488: 'Telnyx no aceptó el formato de audio.',
    503: 'Telnyx no encontró ruta para ese destino. Puede requerir verificar la cuenta para ese país.',
    603: 'La llamada fue rechazada.',
}


def explain(code):
    return SIP_REASONS.get(code, f'La llamada terminó con el código SIP {code}.' if code else 'No se pudo completar la llamada.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class TelnyxAPI:
    """Minimal Telnyx v2 client. Never logs or returns the API key."""

    def __init__(self, key, *, opener=None, base=API):
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.=-]{20,256}', key.strip()):
            raise TelephonyError('Añade BRIVANY_TELNYX_API_KEY en .env (la clave que empieza por KEY…).')
        self._key = key.strip()
        self.base = base
        self.opener = opener or build_opener(NoRedirect())

    @classmethod
    def from_environment(cls):
        return cls(os.getenv('TELNYX_API_KEY', '').strip() or os.getenv('BRIVANY_TELNYX_API_KEY', ''))

    def __repr__(self):
        return 'TelnyxAPI(<clave oculta>)'

    def request(self, method, path, body=None, params=None):
        url = self.base + path + ('?' + urlencode(params) if params else '')
        data = None if body is None else json.dumps(body).encode('utf-8')
        request = Request(url, data, {'Authorization': 'Bearer ' + self._key, 'Accept': 'application/json',
                                      'Content-Type': 'application/json'}, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(1_048_577)
                if len(raw) > 1_048_576:
                    raise ValueError('response_size')
                value = json.loads(raw) if raw.strip() else {}
                if not isinstance(value, dict):
                    raise ValueError('response_type')
                return value
        except HTTPError as error:
            status = error.code
            code = title = ''
            try:
                detail = json.loads(error.read(65536))
                first = (detail.get('errors') or [{}])[0] if isinstance(detail, dict) else {}
                code = str(first.get('code', ''))[:16]
                title = ' '.join(str(first.get('detail') or first.get('title') or '').split())[:240]
            except (OSError, ValueError, AttributeError, IndexError, TypeError):
                pass
            finally:
                error.close()
            if status == 401:
                message = 'Telnyx rechazó la clave API. Revisa BRIVANY_TELNYX_API_KEY.'
            elif status == 403:
                message = 'La cuenta de Telnyx no permite esta operación' + (f': {title}' if title else '.')
            else:
                message = f'Telnyx respondió {status}' + (f' ({code})' if code else '') + (f': {title}' if title else '.')
            raise ProviderError(message, uncertain=status >= 500, http_status=status, provider_code=code) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise ProviderError('No se pudo conectar con la API de Telnyx.', uncertain=True) from None

    def items(self, path, params=None):
        value = self.request('GET', path, params={'page[size]': 250, **(params or {})})
        data = value.get('data', [])
        return data if isinstance(data, list) else []

    # Read-only
    def balance(self):
        return self.request('GET', '/balance').get('data', {})

    def phone_numbers(self):
        return [item for item in self.items('/phone_numbers') if item.get('status') == 'active']

    def verified_numbers(self):
        try:
            return [item for item in self.items('/verified_numbers') if item.get('verified_at')]
        except ProviderError as error:
            if error.http_status in (403, 404):
                return []
            raise

    def available_numbers(self, country, kind='local', limit=10):
        return self.items('/available_phone_numbers', {'filter[country_code]': country,
                          'filter[phone_number_type]': kind, 'filter[features][]': 'voice',
                          'filter[limit]': limit})

    # Changes in the account; each is called only from an explicit command.
    def request_verification(self, phone, method):
        if method not in ('sms', 'call'):
            raise TelephonyError('Elige sms o call para verificar el número.')
        return self.request('POST', '/verified_numbers', {'phone_number': number(phone), 'verification_method': method})

    def submit_verification(self, phone, code):
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{3,10}', code.strip()):
            raise TelephonyError('El código de verificación no es válido.')
        return self.request('POST', '/verified_numbers/' + quote(number(phone), safe='') + '/actions/verify',
                            {'verification_code': code.strip()})

    def order_number(self, phone, connection_id=''):
        body = {'phone_numbers': [{'phone_number': number(phone)}], 'customer_reference': NAME}
        if connection_id:
            body['connection_id'] = connection_id
        return self.request('POST', '/number_orders', body).get('data', {})


@dataclass(frozen=True)
class TelnyxAccount:
    username: str = field(repr=False)
    password: str = field(repr=False)
    server: str = SERVERS['us']
    transport: str = 'udp'
    caller_id: str = ''
    connection_id: str = ''
    profile_id: str = ''
    outbound: bool = True

    @property
    def port(self):
        return PORTS[self.transport]

    def engine(self):
        if self.server not in SERVERS.values() or self.transport not in PORTS:
            raise TelephonyError('Revisa el servidor SIP de Telnyx.')
        if self.caller_id and number(self.caller_id) != self.caller_id:
            raise TelephonyError('El número emisor debe estar en formato internacional.')
        try:
            return validate_engine({'username': self.username, 'password': self.password,
                                    'server': self.server, 'port': self.port, 'transport': self.transport,
                                    'allow': []})
        except ValueError:
            raise TelephonyError('Revisa la conexión SIP de Telnyx.') from None

    def public(self):
        """Safe summary for status output: no credentials, caller masked."""
        return {'server': self.server, 'transport': self.transport, 'caller_id': masked(self.caller_id),
                'connection': bool(self.connection_id), 'outbound_profile': bool(self.profile_id),
                'outbound': self.outbound}


def _random(length, alphabet=string.ascii_letters + string.digits):
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def find(items, key, value):
    return next((item for item in items if item.get(key) == value), None)


def caller_allowed(api, caller):
    owned = {item.get('phone_number') for item in api.phone_numbers()}
    verified = {item.get('phone_number') for item in api.verified_numbers()}
    return caller in owned or caller in verified


def provision(api, *, caller_id='', countries=('DO', 'US'), daily_limit=5.0, max_rate=0.30,
              region='us', transport='udp', previous=None):
    """Create or update Brivany's outbound profile and SIP credential connection.

    Idempotent: reuses resources named «Brivany Melodi». A fresh SIP password is
    generated on every run, so the saved profile always matches Telnyx.
    """
    countries = sorted({c.strip().upper() for c in countries if c.strip()})
    if not countries or any(not re.fullmatch(r'[A-Z]{2}', c) for c in countries):
        raise TelephonyError('Indica países con su código de dos letras, por ejemplo DO,US.')
    if not 0 < daily_limit <= 100 or not 0 < max_rate <= 2:
        raise TelephonyError('Usa un límite diario entre 0 y 100 USD y una tarifa máxima entre 0 y 2 USD/min.')
    if region not in SERVERS or transport not in PORTS:
        raise TelephonyError('Región o transporte SIP no válidos.')
    if caller_id:
        caller_id = number(caller_id)
        if not caller_allowed(api, caller_id):
            raise TelephonyError('Ese número emisor no es tuyo en Telnyx ni está verificado. '
                                 'Verifícalo o compra un número antes de usarlo.')
    profile_body = {'name': NAME, 'traffic_type': 'conversational', 'service_plan': 'global',
                    'whitelisted_destinations': countries, 'concurrent_call_limit': 1,
                    'daily_spend_limit': f'{daily_limit:.2f}', 'daily_spend_limit_enabled': True,
                    'max_destination_rate': max_rate, 'enabled': True}
    existing = find(api.items('/outbound_voice_profiles'), 'name', NAME)
    if existing:
        profile = api.request('PATCH', '/outbound_voice_profiles/' + quote(str(existing['id'])), profile_body)['data']
    else:
        profile = api.request('POST', '/outbound_voice_profiles', profile_body)['data']
    outbound = {'outbound_voice_profile_id': str(profile['id']), 'channel_limit': 1}
    if caller_id:
        outbound.update(ani_override=caller_id, ani_override_type='always')
    password = _random(32)
    existing = find(api.items('/credential_connections'), 'connection_name', NAME)
    if existing:
        username = str(existing.get('user_name') or '')
        connection = api.request('PATCH', '/credential_connections/' + quote(str(existing['id'])),
                                 {'password': password, 'active': True, 'outbound': outbound})['data']
    else:
        username = 'brivany' + _random(16, string.ascii_lowercase + string.digits)
        connection = api.request('POST', '/credential_connections',
                                 {'connection_name': NAME, 'user_name': username, 'password': password,
                                  'active': True, 'outbound': outbound})['data']
    username = str(connection.get('user_name') or username)
    return TelnyxAccount(username, password, SERVERS[region], transport, caller_id,
                         str(connection['id']), str(profile['id']), True)


def save_profile(path, account):
    """Called only by the explicit setup command; never stores plaintext."""
    from services.google_oauth import WindowsDPAPIProtector
    account.engine()
    protector = WindowsDPAPIProtector()
    if not protector.available:
        raise TelephonyError('Esta conexión requiere el almacén seguro de Windows.')
    values = {key: getattr(account, key) for key in PROFILE_FIELDS}
    protected = protector.protect(json.dumps(values).encode('utf-8'))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        temporary.write_bytes(protected)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_profile(path):
    from services.google_oauth import WindowsDPAPIProtector
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 65536:
            raise ValueError('profile_size')
        value = json.loads(WindowsDPAPIProtector().unprotect(raw))
        if not isinstance(value, dict) or set(value) != PROFILE_FIELDS or type(value['outbound']) is not bool:
            raise ValueError('profile_fields')
        account = TelnyxAccount(**value)
        account.engine()
        return account
    except Exception:
        raise TelephonyError('No se pudo abrir la conexión de Telnyx guardada. Vuelve a ejecutar la configuración.') from None


class TelnyxGateway:
    """WorkSpace review interface; SIP starts only after explicit confirmation."""

    def __init__(self, path, account, providers=None, *, native_factory=NativeSIP):
        account.engine()
        self.account, self.providers, self.native_factory = account, providers, native_factory
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.active = self.worker = None
        self.active_id = None
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS telnyx_calls '
                        '(id TEXT PRIMARY KEY, destination TEXT NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL DEFAULT \'\')')
        self.db.execute("UPDATE telnyx_calls SET state='interrupted', result='Brivany se cerró durante la llamada.' "
                        "WHERE state NOT IN ('completed','busy','no-answer','failed','canceled','interrupted')")
        self.db.commit()

    def _update(self, call_id, state, result=''):
        with self.lock:
            self.db.execute('UPDATE telnyx_calls SET state=?, result=? WHERE id=?', (state, result, call_id))
            self.db.commit()

    def _status(self, call_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM telnyx_calls WHERE id=?', (call_id,)).fetchone()
            return dict(row) if row else {'id': call_id, 'state': 'not-found', 'result': 'Llamada sin registro.'}

    def ready(self):
        if not self.account.outbound:
            return 'Las llamadas salientes están desactivadas en la conexión de Telnyx.'
        if not self.account.caller_id:
            return 'Falta un número emisor de Telnyx. Ejecuta la configuración con --caller.'
        if self.providers is None and not LiveProviders.configured():
            return 'Conecta la voz de Melodi antes de llamar.'
        return ''

    def _run(self, call_id, destination, objective):
        native = session = None
        last = {'code': 0}
        try:
            def notify(event):
                code = event.get('sip_status')
                if event.get('type') == 'sip_response' and event.get('method') == 'INVITE' and isinstance(code, int) and code >= 300:
                    last['code'] = code
                state = event.get('state')
                if state in TERMINAL | {'dialing', 'ringing', 'in-progress'}:
                    if self._status(call_id)['state'] not in TERMINAL:
                        result = ''
                        if state in TERMINAL - {'completed'}:
                            last['code'] = last['code'] or (code if isinstance(code, int) else 0)
                            result = explain(last['code'])
                        self._update(call_id, state, result)
            configuration = self.account.engine()
            configuration['allow'] = [destination]  # Scope this worker to the confirmed call only.
            native = self.native_factory(configuration, call_id, notify)
            with self.lock:
                self.active = native
                if self.stop.is_set() or self._status(call_id)['state'] in TERMINAL:
                    return
            native.start(destination)
            session = LivePhoneSession(native, native.stream_id, objective, native.closed,
                                       self.providers, max_turns=None,
                                       audio_format='pcm_24000')
            session.run()
            if session.metrics['failed'] and self._status(call_id)['state'] not in {'canceled', 'interrupted'}:
                self._update(call_id, 'failed', 'Se interrumpió la conversación de voz.')
            elif self._status(call_id)['state'] not in TERMINAL:
                self._update(call_id, 'completed', 'Llamada finalizada.')
        except Exception:
            if self._status(call_id)['state'] not in TERMINAL:
                self._update(call_id, 'failed', explain(last['code']) if last['code'] else
                             'No se pudo conectar con Telnyx. Revisa la conexión a internet y la configuración.')
        finally:
            if native:
                native.shutdown()
            with self.lock:
                self.active = None
                self.active_id = None

    def request(self, path, value=None, *, audio=False):
        with self.lock:
            if self.stop.is_set():
                raise TelephonyError('Brivany se está cerrando.')
            if path == '/v1/info' and value is None:
                reason = self.ready()
                return {'configured': True, 'outbound': not reason, 'voicemail': False, 'reason': reason,
                        'provider': 'telnyx', 'incoming': 'mobile', 'caller_id': masked(self.account.caller_id)}
            if path == '/v1/voicemails' and value is None:
                return {'messages': []}
            if path == '/v1/calls' and isinstance(value, dict):
                call_id = identifier(value.get('id'))
                destination = number(value.get('destination'))
                objective = clean_text(value.get('objective'), 600)
                existing = self._status(call_id)
                if existing['state'] != 'not-found':
                    if existing['destination'] != destination:
                        raise TelephonyError('La solicitud ya corresponde a otro número.')
                    return existing
                reason = self.ready()
                if reason:
                    raise TelephonyError(reason)
                if self.worker and self.worker.is_alive():
                    raise TelephonyError('Espera a que termine la llamada anterior.')
                self.db.execute('INSERT INTO telnyx_calls (id,destination,state) VALUES (?,?,?)',
                                (call_id, destination, 'preparing'))
                self.db.commit()
                self.active_id = call_id
                self.worker = threading.Thread(target=self._run, args=(call_id, destination, objective),
                                               daemon=True, name='melodi-telnyx-call')
                self.worker.start()
                return self._status(call_id)
            match = re.fullmatch(r'/v1/calls/([a-f0-9-]{36})(/cancel)?', path)
            if match:
                call_id = identifier(match[1])
                if match[2] and value == {}:
                    current = self._status(call_id)
                    if current['state'] != 'not-found' and current['state'] not in TERMINAL:
                        self._update(call_id, 'canceled', 'Llamada cancelada.')
                        if self.active_id == call_id and self.active:
                            self.active.close()
                elif match[2] or value is not None:
                    raise TelephonyError('Solicitud de llamada no válida.')
                return self._status(call_id)
            raise TelephonyError('Función no disponible en la conexión de Telnyx.')

    def close(self):
        with self.lock:
            self.stop.set()
            if self.active:
                self.active.close()
            if self.active_id and self._status(self.active_id)['state'] not in TERMINAL:
                self._update(self.active_id, 'interrupted', 'Brivany se cerró durante la llamada.')
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(8)
        with self.lock:
            if not self.worker or not self.worker.is_alive():
                self.db.close()
