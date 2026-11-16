"""Single custom console call. Public listener serves only its signed Twilio hooks."""
import argparse
import json
import os
import re
import threading
import time
from pathlib import Path
from uuid import uuid4
from urllib.request import build_opener, ProxyHandler

from .dialogue import MelodiDialogue
from .server import Handler, OUTBOUND_PATH, OUTBOUND_WEBHOOK, Server
from .service import Calls
from .twilio import Configuration, NoRedirect, ProviderError, TelephonyError, https_origin, number, sid


class TrialHandler(Handler):
    def _webhook_authorized(self, path, fields):
        if super()._webhook_authorized(path, fields):
            return True
        # A supplied invalid signature must never fall back to the trial proxy.
        if self.headers.get_all('X-Twilio-Signature'):
            return False
        proxy = getattr(self.server, 'trial_proxy', None)
        match = re.fullmatch(OUTBOUND_WEBHOOK, path)
        return bool(proxy and match and match[2] != 'status' and proxy.verify(match[1], fields))

    def do_GET(self):
        if not re.fullmatch(OUTBOUND_PATH + r'audio/[a-f0-9]{32}', self.path):
            self._send(404)
            return
        super().do_GET()

    def do_POST(self):
        if not re.fullmatch(OUTBOUND_WEBHOOK, self.path):
            # Drain only a bounded, well-framed form so Windows can deliver the
            # rejection before closing a socket with otherwise unread input.
            try:
                self._body('application/x-www-form-urlencoded', 16384)
            except (ValueError, UnicodeError):
                pass
            self._send(404)
            return
        super().do_POST()


class TrialProxyVerifier:
    """Explicit console-only compatibility for Twilio's unsigned trial interceptor.

    The random per-call URL is a bearer capability. Before binding its first
    request, independently verify the active call through authenticated Twilio
    REST. Never trust caller-supplied account, phone numbers or provider ID alone.
    Only the already-verified call is cached, until its local session expires.
    """
    def __init__(self, calls, provider=None):
        from .twilio import Twilio
        self.calls = calls
        self.provider = provider or Twilio(calls.config, opener=build_opener(ProxyHandler({}), NoRedirect()))
        self.lock = threading.Lock()
        self.verified = None
        self.attempts = 0

    def verify(self, capability, fields):
        if not self.calls.console_accepts(capability, fields):
            return False
        candidate = capability, fields['CallSid']
        with self.lock:
            if self.verified is not None:
                return self.verified == candidate and self.calls.console_accepts(capability, fields)
            if self.attempts >= 3:
                return False
            self.attempts += 1
            try:
                actual = self.provider._request('/Calls/' + fields['CallSid'] + '.json', timeout=2.5, limit=16384)
            except ProviderError:
                return False
            config = self.calls.config
            if (not isinstance(actual, dict) or actual.get('sid') != fields['CallSid']
                    or actual.get('account_sid') != config.account
                    or actual.get('from') != config.caller_id or actual.get('to') != fields['To']
                    or actual.get('status') != 'in-progress' or actual.get('direction') != 'outbound-api'
                    or not self.calls.console_accepts(capability, fields)):
                return False
            self.verified = candidate
            return True


def load_trial_credentials(path):
    from services.google_oauth import WindowsDPAPIProtector

    try:
        protected = path.read_bytes()
        if len(protected) > 16384:
            raise ValueError()
        values = json.loads(WindowsDPAPIProtector().unprotect(protected))
        allowed = {'BRIVANY_TWILIO_ACCOUNT_SID', 'BRIVANY_TWILIO_AUTH_TOKEN',
                   'BRIVANY_TWILIO_TRIAL_FROM', 'BRIVANY_TWILIO_TRIAL_TO'}
        if set(values) != allowed or any(not isinstance(value, str) for value in values.values()):
            raise ValueError()
        for name, value in values.items():
            os.environ[name] = value
    except Exception:
        raise TelephonyError('No se pudo leer la configuración protegida de la prueba.') from None


def trial_config(origin, account, auth, caller, destination):
    origin = https_origin(origin)
    caller, destination = number(caller), number(destination)
    if (not sid(account, 'AC') or not re.fullmatch(r'[A-Fa-f0-9]{32}', auth)
            or caller == destination or not re.fullmatch(r'\+1(?:809|829|849)\d{7}', destination)):
        raise TelephonyError('Revisa la cuenta, el emisor y el destino dominicano verificado.')
    return Configuration(origin, '', account, auth, caller, frozenset({destination}), True, False)


class LimitedTrialTransport:
    """A single REST dial within the limited account. No retries after submission."""
    def __init__(self, config):
        from .twilio import Twilio
        self.twilio = Twilio(config, opener=build_opener(ProxyHandler({}), NoRedirect()))
        self.failure = None

    def start(self, destination, answer_path, status_path):
        config = self.twilio.config
        if destination not in config.destinations:
            raise TelephonyError('El destino de la prueba no está habilitado.')
        fields = [
            ('To', destination), ('From', config.caller_id), ('Url', config.public_origin + answer_path),
            ('Method', 'POST'), ('Timeout', '25'), ('TimeLimit', '100'),
            ('StatusCallback', config.public_origin + status_path),
            ('StatusCallbackMethod', 'POST'),
            *[('StatusCallbackEvent', event) for event in ('initiated', 'ringing', 'answered', 'completed')],
        ]
        try:
            result = self.twilio._request('/Calls.json', fields=fields)
        except ProviderError as error:
            self.failure = {'http_status': error.http_status, 'provider_code': error.provider_code,
                            'uncertain': error.uncertain}
            raise
        if not isinstance(result, dict) or not sid(result.get('sid'), 'CA'):
            raise ProviderError('Twilio no confirmó la referencia de la llamada. Revisa los registros antes de repetir.', uncertain=True)
        return result['sid']

    def hangup(self, provider_id):
        return self.twilio.hangup(provider_id)


def main():
    parser = argparse.ArgumentParser(description='Preparar una única llamada de prueba en Twilio Console')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--credentials-file', type=Path)
    parser.add_argument('--dial', action='store_true', help='Iniciar una llamada mediante la API de Twilio')
    parser.add_argument('--console-proxy', action='store_true',
                        help='Validar el interceptor de consola mediante la API autenticada de Twilio')
    parser.add_argument('--confirmed-voice-credits', action='store_true')
    args = parser.parse_args()
    if args.dial and args.console_proxy:
        parser.error('--console-proxy corresponde a llamadas iniciadas desde la consola')
    if not args.confirmed_voice_credits:
        parser.exit(2, 'Confirma una cuota de voz de al menos 1.000 créditos antes de preparar la prueba.\n')
    try:
        if args.credentials_file:
            load_trial_credentials(args.credentials_file)
        config = trial_config(*(os.getenv(name, '').strip() for name in (
            'BRIVANY_CALL_PUBLIC_ORIGIN', 'BRIVANY_TWILIO_ACCOUNT_SID', 'BRIVANY_TWILIO_AUTH_TOKEN',
            'BRIVANY_TWILIO_TRIAL_FROM', 'BRIVANY_TWILIO_TRIAL_TO')))
        if not all(os.getenv(name, '').strip() for name in (
                'BRIVANY_CARTESIA_API_KEY', 'BRIVANY_META_API_KEY', 'BRIVANY_META_MODEL')):
            raise TelephonyError('Configura la voz y la API de Meta de Melodi.')
        dialogue = MelodiDialogue()
        transport = LimitedTrialTransport(config) if args.dial else None
        calls = Calls(':memory:', config, transport, dialogue, console_trial=True)
        try:
            with Server(args.port, calls, TrialHandler) as server:
                if args.console_proxy:
                    server.trial_proxy = TrialProxyVerifier(calls)
                server.timeout = .25
                identifier = str(uuid4())
                calls.start(identifier, next(iter(config.destinations)), 'Prueba de conversación breve con Melodi.')
                ready = False
                reported_failure = False
                previous = None
                deadline = time.monotonic() + 270
                while time.monotonic() < deadline:
                    server.handle_request()
                    if not args.dial and not ready and (url := calls.console_answer_url(identifier)):
                        print(url, flush=True)
                        ready = True
                    state = calls.console_progress(identifier)
                    if state != previous:
                        print(json.dumps(state), flush=True)
                        previous = state
                    if transport and transport.failure and not reported_failure:
                        print(json.dumps({'dial_result': transport.failure}), flush=True)
                        reported_failure = True
                        if not transport.failure['uncertain']:
                            break
                    if state['state'] in {'failed', 'completed', 'canceled', 'no-answer', 'busy'}:
                        break
        finally:
            calls.close()
    except (OSError, TelephonyError):
        parser.exit(2, 'No se pudo preparar la llamada de prueba. Revisa las APIs, la cuota y la configuración.\n')


if __name__ == '__main__':
    main()
