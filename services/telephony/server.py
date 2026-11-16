"""Run a dedicated loopback gateway behind a configured HTTPS reverse proxy."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import parse_qsl

from .service import Calls
from .twilio import Configuration, ProviderError, TelephonyError, Twilio, valid_webhook

CALL_PATH = r'/v1/calls/([a-f0-9-]{36})'
RECORDING_PATH = r'/v1/voicemails/(RE[a-fA-F0-9]{32})/audio'
OUTBOUND_PATH = r'/twilio/out/([a-f0-9]{64})/'
OUTBOUND_WEBHOOK = OUTBOUND_PATH + r'(answer|status|wait|turn/[0-9]{1,2})'
INCOMING_PATHS = {
    '/twilio/mailbox/incoming': 'incoming', '/twilio/mailbox/consent': 'mailbox_consent',
    '/twilio/mailbox/finish': 'mailbox_finish', '/twilio/mailbox/recorded': 'mailbox_recorded',
}


def unique_object(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError('Campos duplicados.')
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = 'Brivany-Telephony'

    def log_message(self, *_):
        # Webhook paths may contain ephemeral audio capabilities.
        pass

    def _send(self, code, data=b'', mime='application/json; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Connection', 'close')
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _json(self, value, code=200):
        self._send(code, json.dumps(value, ensure_ascii=False).encode('utf-8'))

    def _body(self, mime, limit):
        length = self.headers.get('Content-Length', '')
        if (self.headers.get('Transfer-Encoding') or not re.fullmatch(r'[0-9]{1,5}', length)
                or len(self.headers.get_all('Content-Length', [])) != 1 or int(length) > limit
                or self.headers.get_content_type() != mime):
            raise TelephonyError('Solicitud no válida.')
        return self.rfile.read(int(length)).decode('utf-8', errors='strict')

    def _authorized(self):
        values = self.headers.get_all('Authorization', [])
        if len(values) == 1 and len(values[0]) <= 150:
            expected = 'Bearer ' + self.server.calls.config.gateway_token
            if hmac.compare_digest(values[0].encode(), expected.encode()):
                return True
        self._json({'error': 'Acceso no autorizado.'}, 401)
        return False

    def _form(self):
        pairs = parse_qsl(self._body('application/x-www-form-urlencoded', 16384), keep_blank_values=True,
                          strict_parsing=True, max_num_fields=96, errors='strict')
        return unique_object(pairs)

    def _webhook_authorized(self, path, fields):
        signatures = self.headers.get_all('X-Twilio-Signature', [])
        return len(signatures) == 1 and valid_webhook(self.server.calls.config, path, fields, signatures[0])

    def do_GET(self):
        calls = self.server.calls
        try:
            audio = re.fullmatch(OUTBOUND_PATH + r'audio/([a-f0-9]{32})', self.path)
            if audio:
                clip = calls.clip(*audio.groups())
                if clip is None:
                    self._send(404)
                else:
                    self._send(200, clip, 'audio/wav')
                return
            if not self.path.startswith('/v1/') or not self._authorized():
                if not self.path.startswith('/v1/'):
                    self._send(404)
                return
            call = re.fullmatch(CALL_PATH, self.path)
            recording = re.fullmatch(RECORDING_PATH, self.path)
            if self.path == '/v1/info':
                self._json(calls.info())
            elif self.path == '/v1/voicemails':
                self._json(calls.mailbox())
            elif recording:
                self._send(200, calls.recording(recording[1]), 'audio/mpeg')
            elif call:
                self._json(calls.status(call[1]))
            else:
                self._send(404)
        except ProviderError as error:
            self._json({'error': str(error)}, 502)
        except TelephonyError as error:
            self._json({'error': str(error)}, 404)
        except (OSError, TimeoutError):
            pass

    def do_POST(self):
        calls = self.server.calls
        try:
            if self.path.startswith('/v1/'):
                if not self._authorized():
                    return
                value = json.loads(self._body('application/json', 8192), object_pairs_hook=unique_object)
                if self.path == '/v1/calls' and isinstance(value, dict) and set(value) == {'id', 'destination', 'objective'}:
                    self._json(calls.start(value['id'], value['destination'], value['objective']), 202)
                elif re.fullmatch(CALL_PATH + '/cancel', self.path) and value == {}:
                    self._json(calls.cancel(self.path.split('/')[3]))
                else:
                    self._send(404)
                return
            outgoing = re.fullmatch(OUTBOUND_WEBHOOK, self.path)
            incoming = INCOMING_PATHS.get(self.path)
            if not outgoing and not incoming:
                self._send(404)
                return
            fields = self._form()
            if not self._webhook_authorized(self.path, fields):
                self._send(403)
                return
            if incoming:
                result = getattr(calls, incoming)(fields)
            else:
                capability, action = outgoing.groups()
                if action == 'status':
                    result = calls.callback_status(capability, fields)
                elif action.startswith('turn/'):
                    result = calls.turn(capability, int(action.split('/')[1]), fields)
                else:
                    result = getattr(calls, action)(capability, fields)
            if result is None:
                self._send(204)
            else:
                self._send(200, result, 'text/xml; charset=utf-8')
        except (UnicodeError, ValueError) as error:
            if self.path.startswith('/v1/'):
                self._json({'error': str(error) if isinstance(error, TelephonyError) else 'Solicitud no válida.'}, 422)
            else:
                self._send(400)
        except (OSError, TimeoutError):
            pass


class Server(ThreadingHTTPServer):
    daemon_threads = False
    request_queue_size = 16

    def __init__(self, port, calls, handler=Handler):
        self.calls = calls
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(('127.0.0.1', port), handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        request.settimeout(10)
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Avoid exposing any webhook data in tracebacks or proxy logs.
        pass


def main():
    parser = argparse.ArgumentParser(description='Pasarela separada de llamadas de Melodi')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--state', type=Path, default=Path('.local/telephony/gateway.sqlite3'))
    parser.add_argument('--realtime', action='store_true', help='Audio bidireccional; requiere una cuenta que admita Media Streams')
    parser.add_argument('--media-port', type=int, default=8790)
    parser.add_argument('--media-origin', help='Origen HTTPS del proxy WebSocket; usa el origen de la pasarela si se omite')
    args = parser.parse_args()
    try:
        config = Configuration.environment()
        if config.outbound and not all(os.getenv(key, '').strip() for key in ('BRIVANY_CARTESIA_API_KEY', 'BRIVANY_META_API_KEY', 'BRIVANY_META_MODEL')):
            raise TelephonyError('Configura la voz y el modelo de Melodi en la pasarela antes de habilitar salientes.')
        if not 0<=args.media_port<=65535:
            raise TelephonyError('Puerto de media no válido.')
        calls = Calls(args.state, config, Twilio(config),
                      realtime_origin=(args.media_origin or config.public_origin) if args.realtime else None)
        media = None
        try:
            if args.realtime:
                from .realtime import MediaBridge
                media = MediaBridge(calls,args.media_port).start()
            with Server(args.port, calls) as server:
                print(f'Pasarela de llamadas en 127.0.0.1:{server.server_port}', flush=True)
                server.serve_forever()
        finally:
            if media:
                media.close()
            calls.close()
    except KeyboardInterrupt:
        return 0
    except (TelephonyError, OSError) as error:
        parser.exit(2, f'{error}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
