"""Loopback-only credential form. Stores a Twilio trial credential with user DPAPI."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import argparse
import hashlib
from html import escape
import json
import os
from pathlib import Path
import re
import secrets
import threading
import subprocess
import time
from urllib.parse import parse_qs

from services.google_oauth import WindowsDPAPIProtector
from services.telephony.trial import trial_config


PAGE = b'''<!doctype html><html lang="es"><meta charset="utf-8"><title>Configurar llamada de Melodi</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><body>
<h1>Conectar Twilio con Melodi</h1>
<form method="post" autocomplete="off">
<p><label>Account SID <input name="account" required pattern="AC[a-fA-F0-9]{32}"></label></p>
<p><label>Auth Token <input name="auth" type="password" required pattern="[a-fA-F0-9]{32}"></label></p>
<p><label>Numero temporal de Twilio <input name="from" inputmode="tel" required></label></p>
<p><label>Tu numero verificado <input name="to" inputmode="tel" required></label></p>
<button>Guardar en este equipo</button></form></body></html>'''


def main():
    parser = argparse.ArgumentParser(description='Conectar una credencial existente de Twilio a la prueba de Melodi')
    parser.add_argument('--share', action='store_true', help='Publicar solo este formulario temporal mediante Cloudflare')
    args = parser.parse_args()
    page = PAGE
    for name, environment in (('account', 'BRIVANY_TWILIO_ACCOUNT_SID'), ('from', 'BRIVANY_TWILIO_TRIAL_FROM'),
                              ('to', 'BRIVANY_TWILIO_TRIAL_TO')):
        marker = f'name="{name}"'.encode('ascii')
        value = escape(os.getenv(environment, ''), quote=True).encode('utf-8')
        page = page.replace(marker, marker + b' value="' + value + b'"')
    destination = Path('.local/telephony/twilio-trial.dpapi').resolve()
    capability = '/' + secrets.token_urlsafe(32)
    complete = threading.Event()
    protector = WindowsDPAPIProtector()
    public_origin = [None]
    connector = None
    if not protector.available:
        raise SystemExit('Esta configuracion requiere el almacen seguro de Windows.')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, code, body):
            self.send_response(code)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            expected = f'127.0.0.1:{self.server.server_port}'
            hosts = {expected, public_origin[0].removeprefix('https://') if public_origin[0] else ''}
            if self.headers.get('Host') not in hosts or self.path != capability:
                self.send(404, b'')
                return
            self.send(200, b'<title>Melodi conectada</title><p>Configuracion guardada en este equipo.</p>' if complete.is_set() else page)

        def do_POST(self):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            allowed = {origin, public_origin[0]}
            expected_host = self.headers.get('Origin', '').split('://')[-1]
            size = self.headers.get('Content-Length', '')
            if (self.path != capability or self.headers.get('Host') != expected_host
                    or self.headers.get('Origin') not in allowed or self.headers.get('Transfer-Encoding')
                    or len(self.headers.get_all('Content-Length', [])) != 1
                    or self.headers.get_content_type() != 'application/x-www-form-urlencoded'
                    or not re.fullmatch(r'\d{1,4}', size) or int(size) > 4096 or complete.is_set()):
                self.send(403, b'')
                return
            try:
                stage = 'form'
                values = parse_qs(self.rfile.read(int(size)).decode('utf-8'), strict_parsing=True, max_num_fields=4)
                if set(values) != {'account', 'auth', 'from', 'to'} or any(len(value) != 1 for value in values.values()):
                    raise ValueError()
                account, auth, caller, phone = (values[name][0].strip() for name in ('account', 'auth', 'from', 'to'))
                stage = 'configuration'
                checked = trial_config('https://calls.example.test', account, auth, caller, phone)
                configuration = dict(zip(('BRIVANY_TWILIO_ACCOUNT_SID', 'BRIVANY_TWILIO_AUTH_TOKEN',
                                          'BRIVANY_TWILIO_TRIAL_FROM', 'BRIVANY_TWILIO_TRIAL_TO'),
                                         (checked.account, checked.auth_token, checked.caller_id, next(iter(checked.destinations)))))
                stage = 'encryption'
                protected = protector.protect(json.dumps(configuration).encode('utf-8'))
                stage = 'save'
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_name(destination.name + '.' + secrets.token_hex(8) + '.tmp')
                try:
                    temporary.write_bytes(protected)
                    temporary.replace(destination)
                finally:
                    temporary.unlink(missing_ok=True)
                complete.set()
                self.send(200, b'<title>Melodi conectada</title><p>Configuracion guardada en este equipo.</p>')
            except Exception as error:
                print(json.dumps({'saved': False, 'stage': stage, 'error_type': type(error).__name__}), flush=True)
                self.send(422, b'<p>Revisa los cuatro campos. No se guardo la configuracion.</p>')

    class FormServer(HTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            return connection, address

    with FormServer(('127.0.0.1', 0), Handler) as server:
        server.timeout = .5
        origin = f'http://127.0.0.1:{server.server_port}'
        if args.share:
            executable = Path('.local/tools/cloudflared-2026.10.7-windows-amd64.exe').resolve()
            if hashlib.sha256(executable.read_bytes()).hexdigest() != '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343':
                raise SystemExit('El conector temporal no coincide con la version verificada.')
            connector = subprocess.Popen([str(executable), 'tunnel', '--no-autoupdate', '--protocol', 'http2',
                                          '--url', origin], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                                         creationflags=subprocess.CREATE_NO_WINDOW)
            def read_connector():
                for line in connector.stdout:
                    match = re.search(r'\|\s+(https://[a-z0-9-]+\.trycloudflare\.com)\s+\|', line)
                    if match:
                        public_origin[0] = match[1]
                    if 'Registered tunnel connection' in line and public_origin[0]:
                        print(public_origin[0] + capability, flush=True)
            reader = threading.Thread(target=read_connector, daemon=True)
            reader.start()
        else:
            print(origin + capability, flush=True)
        try:
            deadline = time.monotonic() + 900
            while not complete.is_set() and time.monotonic() < deadline:
                server.handle_request()
        finally:
            if connector:
                if connector.poll() is None:
                    connector.terminate()
                connector.wait(timeout=5)
                reader.join(2)
    print(json.dumps({'credentials_saved': complete.is_set()}), flush=True)


if __name__ == '__main__':
    main()
