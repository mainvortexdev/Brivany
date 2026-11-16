"""Twilio transport and verified Voice webhook input."""
import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


MAX_AUDIO = 2 * 1024 * 1024
VOICE_LANGUAGE = 'es-US'


class TelephonyError(ValueError):
    pass


class ProviderError(TelephonyError):
    def __init__(self, message, *, uncertain=False, http_status=None, provider_code=None):
        super().__init__(message)
        self.uncertain = uncertain
        self.http_status, self.provider_code = http_status, provider_code


def number(value):
    if not isinstance(value, str) or len(value) > 35 or not re.fullmatch(r'[+0-9 .()-]+', value):
        raise TelephonyError('Introduce un número de teléfono válido.')
    value = re.sub(r'[ .()-]', '', value)
    if re.fullmatch(r'(809|829|849)[0-9]{7}', value):
        value = '+1' + value
    elif re.fullmatch(r'1(809|829|849)[0-9]{7}', value):
        value = '+' + value
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}', value):
        raise TelephonyError('Usa el prefijo internacional, por ejemplo +1 para República Dominicana.')
    return value


def sid(value, prefix):
    return isinstance(value, str) and re.fullmatch(prefix + r'[a-fA-F0-9]{32}', value) is not None


def https_origin(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (parsed.scheme == 'https' and parsed.hostname and port in (None, 443)
                and not parsed.username and not parsed.password and parsed.path in ('', '/')
                and not parsed.query and not parsed.fragment and re.fullmatch(r'[a-zA-Z0-9.-]+', parsed.hostname)):
            return 'https://' + parsed.hostname.lower()
    except (TypeError, ValueError):
        pass
    raise TelephonyError('Configura un origen HTTPS dedicado a las llamadas.')


@dataclass(frozen=True, repr=False)
class Configuration:
    public_origin: str
    gateway_token: str
    account: str
    auth_token: str
    caller_id: str
    destinations: frozenset
    outbound: bool
    voicemail: bool

    @classmethod
    def environment(cls):
        origin = https_origin(os.getenv('BRIVANY_CALL_PUBLIC_ORIGIN', ''))
        token = os.getenv('BRIVANY_CALL_GATEWAY_TOKEN', '')
        account = os.getenv('BRIVANY_TWILIO_ACCOUNT_SID', '')
        auth = os.getenv('BRIVANY_TWILIO_AUTH_TOKEN', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token) or not sid(account, 'AC') or not re.fullmatch(r'[A-Fa-f0-9]{32}', auth):
            raise TelephonyError('Configura las credenciales de la pasarela de llamadas.')
        caller = number(os.getenv('BRIVANY_TWILIO_RD_NUMBER', ''))
        if not re.fullmatch(r'\+1(?:809|829|849)[0-9]{7}', caller):
            raise TelephonyError('Configura un número emisor de República Dominicana.')
        destinations = frozenset(number(item.strip()) for item in os.getenv('BRIVANY_CALL_ALLOWED_DESTINATIONS', '').split(',') if item.strip())
        if len(destinations) > 30 or caller in destinations:
            raise TelephonyError('Revisa los destinos habilitados para llamadas.')
        outbound = os.getenv('BRIVANY_CALL_OUTBOUND_ENABLED') == '1'
        voicemail = os.getenv('BRIVANY_CALL_VOICEMAIL_ENABLED') == '1'
        if outbound and not destinations:
            raise TelephonyError('Configura al menos un destino habilitado.')
        return cls(origin, token, account, auth, caller, destinations, outbound, voicemail)


def valid_webhook(config, path, fields, signature):
    """Twilio form webhook signature for the exact configured HTTPS URL.

    The handler rejects duplicate fields, queries and proxy-derived origins.
    """
    if not isinstance(signature, str) or len(signature) != 28:
        return False
    material = config.public_origin + path
    material += ''.join(key + fields[key] for key in sorted(fields))
    expected = base64.b64encode(hmac.digest(config.auth_token.encode(), material.encode(), hashlib.sha1)).decode('ascii')
    try:
        return hmac.compare_digest(expected, signature)
    except TypeError:
        return False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Twilio:
    def __init__(self, configuration, *, opener=None):
        self.config = configuration
        self.opener = opener or build_opener(NoRedirect())
        self.base = 'https://api.twilio.com/2010-04-01/Accounts/' + configuration.account

    def _request(self, path, *, fields=None, limit=65536, audio=False, timeout=9):
        credentials = base64.b64encode(f'{self.config.account}:{self.config.auth_token}'.encode()).decode('ascii')
        headers = {'Authorization': 'Basic ' + credentials, 'Accept': 'audio/mpeg' if audio else 'application/json'}
        body = None if fields is None else urlencode(fields).encode('ascii')
        if fields is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = Request(self.base + path, body, headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ProviderError('La respuesta de telefonía excedió el límite.', uncertain=fields is not None)
                if audio:
                    if response.headers.get_content_type() not in ('audio/mpeg', 'audio/mp3') or not data:
                        raise ProviderError('El mensaje de voz todavía no está disponible.')
                    return data
                return json.loads(data)
        except HTTPError as error:
            status = error.code
            code = None
            try:
                payload = json.loads(error.read(4096))
                value = payload.get('code') if isinstance(payload, dict) else None
                if type(value) is int and 0 <= value <= 999999:
                    code = value
            except (OSError, ValueError):
                pass
            finally:
                error.close()
            raise ProviderError('El proveedor de telefonía rechazó la solicitud.',
                                uncertain=fields is not None and status >= 500,
                                http_status=status, provider_code=code) from None
        except (URLError, TimeoutError, OSError, ValueError) as error:
            if isinstance(error, ProviderError):
                raise
            raise ProviderError('No se pudo confirmar la respuesta de telefonía.', uncertain=fields is not None) from None

    def start(self, to, answer_path, status_path):
        result = self._request('/Calls.json', fields=[
            ('To', to), ('From', self.config.caller_id), ('Url', self.config.public_origin + answer_path),
            ('Method', 'POST'), ('Timeout', '25'), ('TimeLimit', '180'), ('Record', 'false'),
            ('StatusCallback', self.config.public_origin + status_path), ('StatusCallbackMethod', 'POST'),
            *[('StatusCallbackEvent', event) for event in ('initiated', 'ringing', 'answered', 'completed')],
        ])
        value = result.get('sid') if isinstance(result, dict) else None
        if not sid(value, 'CA'):
            raise ProviderError('El proveedor no devolvió una referencia de llamada válida.', uncertain=True)
        return value

    def hangup(self, call_id):
        if not sid(call_id, 'CA'):
            raise TelephonyError('Llamada no válida.')
        path = '/Calls/' + call_id + '.json'
        current = self._request(path).get('status')
        if current in ('completed', 'canceled', 'busy', 'failed', 'no-answer'):
            return current
        if current not in ('queued', 'ringing', 'initiated', 'in-progress'):
            raise ProviderError('El proveedor no confirmó el estado de la llamada.')
        try:
            result = self._request(path, fields={'Status': 'completed' if current == 'in-progress' else 'canceled'})
        except ProviderError as error:
            # A ringing call can be answered just as the cancel is sent.
            status = self._request(path).get('status')
            if status in ('completed', 'canceled', 'busy', 'failed', 'no-answer'):
                return status
            if current != 'in-progress' and status == 'in-progress':
                result = self._request(path, fields={'Status': 'completed'})
            else:
                raise error
        status = result.get('status')
        if status not in ('completed', 'canceled', 'busy', 'failed', 'no-answer'):
            raise ProviderError('El proveedor no confirmó el cierre de la llamada.')
        return status

    def recording(self, recording_id):
        if not sid(recording_id, 'RE'):
            raise TelephonyError('Mensaje no válido.')
        return self._request('/Recordings/' + recording_id + '.mp3', limit=MAX_AUDIO, audio=True)
