"""One-use local Netelip setup. Saves with Windows DPAPI, never dials or registers."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import parse_qs

from services.telephony.sip import SIPAccount, save_profile

PAGE = '''<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar Melodi</title><style>
body{font:16px system-ui;background:#101114;color:#eee;margin:48px auto;padding:24px;max-width:420px}
h1{font-size:24px}label{display:block;margin:20px 0}input,button{box-sizing:border-box;width:100%;font:inherit;
padding:12px;border-radius:12px;border:1px solid #48494e;background:#202126;color:#eee}
label input{margin-top:8px}button{background:#eee;color:#151515;cursor:pointer}p{color:#bfc0c5;line-height:1.5}
</style><h1>Conectar Melodi</h1><form method="post" autocomplete="off">
<label>Usuario SIP<input name="username" required maxlength="64"></label>
<label>Contraseña SIP<input name="password" type="password" required maxlength="256"></label>
<label>Servidor<input name="server" value="sip-am.netelip.com" required maxlength="253"></label>
<p>La conexión se guarda cifrada en este PC. Cada llamada requiere revisión y confirmación.</p>
<button>Guardar conexión</button></form></html>'''.encode('utf-8')


def main():
    capability = '/' + secrets.token_urlsafe(32)
    complete = threading.Event()
    destination = Path('.local/telephony/sip.dpapi').resolve()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def send(self, code, body):
            self.send_response(code)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}' or self.path != capability:
                self.send(404, b'')
                return
            self.send(200, PAGE)
        def do_POST(self):
            host = f'127.0.0.1:{self.server.server_port}'
            size = self.headers.get('Content-Length', '')
            if (self.path != capability or self.headers.get('Host') != host
                    or self.headers.get('Origin') != 'http://' + host
                    or self.headers.get('Transfer-Encoding')
                    or len(self.headers.get_all('Content-Length', [])) != 1
                    or not re.fullmatch(r'[0-9]{1,4}', size) or int(size) > 4096
                    or self.headers.get_content_type() != 'application/x-www-form-urlencoded'
                    or complete.is_set()):
                self.send(403, b'')
                return
            try:
                values = parse_qs(self.rfile.read(int(size)).decode('utf-8'), strict_parsing=True, max_num_fields=3)
                if set(values) != {'username','password','server'} or any(len(item) != 1 for item in values.values()):
                    raise ValueError('form')
                account = SIPAccount(values['username'][0].strip(), values['password'][0],
                    True, values['server'][0].strip())
                if not re.fullmatch(r'sip-(?:am|eu)\.netelip\.com', account.server):
                    raise ValueError('server')
                save_profile(destination, account)
                complete.set()
                self.send(200, '<title>Melodi conectada</title><p>Conexión guardada. No se inició ninguna llamada.</p>'.encode('utf-8'))
            except Exception:
                self.send(422, '<p>Revisa los campos. No se guardó la conexión.</p>'.encode('utf-8'))
    class FormServer(HTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            return connection, address
    with FormServer(('127.0.0.1', 0), Handler) as server:
        server.timeout = .5
        print(f'http://127.0.0.1:{server.server_port}' + capability, flush=True)
        deadline = time.monotonic() + 600
        while not complete.is_set() and time.monotonic() < deadline:
            server.handle_request()
    print(json.dumps({'credentials_saved':complete.is_set(), 'calls_placed':0}), flush=True)


if __name__ == '__main__':
    main()
