"""Explicit, short-lived HTTPS delivery of one shelf file. No remote PC control."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
import atexit
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from html import escape
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import tempfile
import threading
import time
from urllib.parse import quote, urlsplit

from .scripts import post_script
from .workspace_files import INLINE_BYTES as MAX_FILE_BYTES
from .workspace_preferences import WORKSPACE_LOCALES

ROOT = Path(__file__).resolve().parents[2]
SITE = Path(__file__).with_name('phone')
TTL = 300
COOKIE = '__Host-brivany-file'
PRIVATE_NETS = tuple(ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
PHONE_MESSAGES = ('Brivany · Tu archivo', 'Tu archivo', 'Descargar', 'Conectando…',
                  'El envío terminó. Genera otro QR en Brivany.', 'El envío terminó.',
                  'No se pudo conectar con Brivany.')


def phone_page(locale):
    messages = {}
    if locale != 'es':
        try:
            catalog = json.loads((SITE.parent/'workspace-locales'/(locale+'.json')).read_text(encoding='utf-8'))
            messages = {text:catalog[text] for text in PHONE_MESSAGES}
        except (OSError, ValueError, KeyError):
            locale = 'es'
    page = (SITE/'index.html').read_text(encoding='utf-8')
    for text in PHONE_MESSAGES:
        page = page.replace('>'+text+'<', '>'+escape(messages.get(text,text))+'<')
    metadata = ('<meta name="brivany-phone-language" data-locale="'+locale+'" content="'
                +escape(json.dumps(messages, ensure_ascii=False), quote=True)+'">')
    return page.replace('<html lang="es">', '<html lang="'+locale+'">', 1).replace('<head>', '<head>'+metadata, 1).encode('utf-8')


def local_addresses():
    """No internet probe, listener, firewall rule or router configuration."""
    try:
        found = {row[4][0] for row in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM)}
    except OSError:
        return []
    return sorted(value for value in found if any(ipaddress.ip_address(value) in network for network in PRIVATE_NETS))


def tls_identity(address, folder, protector=None):
    # These optional libraries are deliberately imported only on Share.
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    if protector is None:
        from services.google_oauth import WindowsDPAPIProtector
        protector = WindowsDPAPIProtector()
    if not protector.available:
        raise ValueError('El envío local necesita el almacén seguro de Windows.')
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    path = folder / (hashlib.sha256(address.encode('ascii')).hexdigest()[:20] + '.identity')
    now = datetime.now(timezone.utc)
    value = None
    if path.is_file():
        try:
            if path.stat().st_size > 65536:
                raise ValueError('identity too large')
            saved = json.loads(protector.unprotect(path.read_bytes()))
            cert = x509.load_pem_x509_certificate(saved['cert'].encode('ascii'))
            names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            if ipaddress.ip_address(address) in names.get_values_for_type(x509.IPAddress) and cert.not_valid_after_utc > now + timedelta(days=7):
                value = saved
        except (OSError, ValueError, KeyError, TypeError, x509.ExtensionNotFound):
            value = None
    if value is None:
        key = ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Brivany · envío local')])
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=90))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(address))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
        value = {'cert': cert.public_bytes(serialization.Encoding.PEM).decode('ascii'),
                 'key': key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()).decode('ascii')}
        encrypted = protector.protect(json.dumps(value).encode('utf-8'))
        temp = path.with_suffix('.new')
        with temp.open('wb') as stream:
            stream.write(encrypted)
        os.replace(temp, path)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    # The persistent identity is DPAPI protected. Plain PEMs exist only long
    # enough to load OpenSSL and are removed before a listener is created.
    with tempfile.TemporaryDirectory(prefix='brivany-local-tls-') as directory:
        certificate, keyfile = Path(directory) / 'cert.pem', Path(directory) / 'key.pem'
        certificate.write_text(value['cert'], encoding='ascii')
        keyfile.write_text(value['key'], encoding='ascii')
        context.load_cert_chain(certificate, keyfile)
    cert = x509.load_pem_x509_certificate(value['cert'].encode('ascii'))
    return context, cert.fingerprint(hashes.SHA256()).hex().upper(), value['cert']


class FileServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 8

    def __init__(self, address, handler, context):
        self.context = context
        self.slots = threading.BoundedSemaphore(8)
        self.connections = set(); self.connection_lock = threading.Lock()
        super().__init__(address, handler)

    def get_request(self):
        raw, address = self.socket.accept(); raw.settimeout(5)
        try:
            stream = self.context.wrap_socket(raw, server_side=True, do_handshake_on_connect=False)
        except Exception:
            raw.close(); raise
        with self.connection_lock:
            self.connections.add(stream)
        return stream, address

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request); return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release(); raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def shutdown_request(self, request):
        with self.connection_lock:
            self.connections.discard(request)
        super().shutdown_request(request)

    def handle_error(self, request, client_address):
        pass  # Never log URLs, cookies, file contents or authorization headers.

    def close_clients(self):
        with self.connection_lock:
            streams = list(self.connections)
        for stream in streams:
            try:
                stream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            stream.close()


class PhoneTransfer:
    def __init__(self, folder=None, *, addresses=local_addresses, clock=time.monotonic,
                 identity=tls_identity, publish=None, ttl=TTL):
        self.folder = Path(folder) if folder else DATA_ROOT / '.local' / 'phone'
        self.addresses, self.clock, self.identity = addresses, clock, identity
        self.publish = publish or (lambda value: None)
        self.ttl = ttl
        self.lock, self.lifecycle = threading.RLock(), threading.RLock()
        self.server = self.worker = self.timer = None
        self.state, self.revision, self.closed = 'idle', 0, False
        self.name = self.data = self.secret = self.grant = self.qr = self.origin = None
        self.deadline = 0; self.fingerprint = None
        self.locale = 'es'

    def configuration(self):
        values = self.addresses()
        selected = None
        try:
            with (self.folder / 'settings.json').open(encoding='utf-8') as stream:
                raw = stream.read(1025)
            if len(raw) < 1024:
                selected = json.loads(raw).get('address')
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        if selected not in values:
            selected = values[0] if len(values) == 1 else None
        return {'addresses': values, 'address': selected, 'active': self.server is not None,
                'fingerprint': self.fingerprint, 'local_https': True, 'ttl_seconds': self.ttl}

    def configure(self, address):
        with self.lifecycle:
            if self.closed:
                raise ValueError('El envío local está cerrado.')
            if self.server:
                raise ValueError('Cancela el envío antes de cambiar de red.')
            if not isinstance(address, str) or address not in self.addresses():
                raise ValueError('Elige una dirección local de este equipo.')
            self.folder.mkdir(parents=True, exist_ok=True)
            target = self.folder / 'settings.json'
            target.write_text(json.dumps({'address': address}), encoding='utf-8')
            self.fingerprint = None
            return self.configuration()

    def snapshot(self):
        with self.lock:
            active = self.server is not None and self.clock() < self.deadline
            return {'state': self.state if active or self.state in {'idle', 'cancelled', 'expired'} else 'expired',
                    'revision': self.revision, 'active': active, 'name': self.name if active else None,
                    'size': len(self.data) if active and self.data is not None else None,
                    'expires_in': max(0, round(self.deadline - self.clock())) if active else 0,
                    'qr': self.qr if active and self.state == 'waiting' else None,
                    'link': self.origin + '/#' + self.secret if active and self.secret else None,
                    'fingerprint': self.fingerprint, 'local_https': True}

    def _emit(self):
        try:
            self.publish(self.snapshot())
        except Exception:
            pass

    def share(self, name, data, *, locale='es'):
        if locale not in WORKSPACE_LOCALES:
            raise ValueError('Elige un idioma disponible en WorkSpace.')
        if (not isinstance(name, str) or not 1 <= len(name) <= 180 or any(ord(c) < 32 or c in '/\\"' for c in name)
                or not isinstance(data, bytes) or len(data) > MAX_FILE_BYTES):
            raise ValueError('Elige un archivo de la bandeja de hasta 8 MiB.')
        with self.lifecycle:
            if self.closed:
                raise ValueError('El envío local está cerrado.')
            address = self.configuration()['address']
            if not address:
                raise ValueError('Elige la red del teléfono en Ajustes → Melodi WorkSpace.')
            try:
                import segno
                context, fingerprint, _ = self.identity(address, self.folder / 'identity')
            except ImportError:
                raise ValueError('Instala las dependencias de Brivany Desktop para generar el QR local.') from None
            self._stop('cancelled')
            server = None
            try:
                server = FileServer((address, 0), transfer_handler(self), context)
                origin = f'https://{address}:{server.server_port}'
                secret = secrets.token_urlsafe(32)
                qr = segno.make_qr(origin + '/#' + secret, error='m').png_data_uri(scale=5, border=4)
                with self.lock:
                    self.server, self.name, self.data = server, name, data
                    self.origin, self.secret, self.grant, self.qr = origin, secret, None, qr
                    self.locale = locale
                    self.deadline = self.clock() + self.ttl; self.fingerprint = fingerprint
                    self.state = 'waiting'; self.revision += 1
                self.worker = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .5},
                                               daemon=True, name='brivany-phone-file')
                self.worker.start()
                self.timer = threading.Timer(self.ttl, self.expire)
                self.timer.daemon = True; self.timer.start()
            except Exception:
                if self.timer:
                    self.timer.cancel()
                if server:
                    if self.worker and self.worker.is_alive():
                        server.shutdown()
                    server.close_clients()
                    server.server_close()
                with self.lock:
                    self.server = self.worker = self.timer = None
                    self.data = self.secret = self.grant = self.qr = None
                    self.state = 'idle'; self.revision += 1
                raise ValueError('No se pudo abrir el envío local. Comprueba la red y vuelve a intentarlo.') from None
        self._emit(); return self.snapshot()

    def _stop(self, state):
        with self.lock:
            server, timer, worker = self.server, self.timer, self.worker
            self.server = self.timer = self.worker = None
            self.data = self.secret = self.grant = self.qr = self.origin = self.name = None
            self.state = state; self.revision += 1
        if timer:
            timer.cancel()
        if server:
            server.close_clients(); server.shutdown(); server.close_clients(); server.server_close()
        if worker and worker is not threading.current_thread() and worker.is_alive():
            worker.join(timeout=2)

    def stop(self):
        with self.lifecycle:
            self._stop('cancelled')
        self._emit(); return self.snapshot()

    def expire(self):
        with self.lifecycle:
            # A cancelled old timer cannot retire a newer share.
            if not self.server or self.clock() < self.deadline:
                return
            self._stop('expired')
        self._emit()

    def close(self):
        with self.lifecycle:
            self.closed = True; self._stop('cancelled')
        self._emit()

    def claim(self, token):
        with self.lock:
            if not self.server or self.clock() >= self.deadline or not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token) or not self.secret or not hmac.compare_digest(token, self.secret):
                return None
            self.grant = secrets.token_urlsafe(32)
            self.secret = self.qr = None; self.state = 'connected'; self.revision += 1
            result = self.grant
        self._emit(); return result

    def content(self, grant):
        with self.lock:
            if not self.server or self.clock() >= self.deadline or not self.grant or not isinstance(grant, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', grant) or not hmac.compare_digest(grant, self.grant):
                return None
            return self.name, self.data

    def sent(self, grant):
        with self.lock:
            if self.content(grant) is None:
                return
            self.state = 'sent'; self.revision += 1
        self._emit()


def transfer_handler(transfer):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'Brivany'
        sys_version = ''

        def log_message(self, *args):
            pass

        def reply(self, status, data=b'', mime='application/json', headers=()):
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            self.send_header('Connection', 'close')
            for key, value in headers:
                self.send_header(key, value)
            self.end_headers(); self.close_connection = True
            if self.command != 'HEAD':
                self.wfile.write(data)

        def allowed(self):
            with transfer.lock:
                origin = transfer.origin
            if not origin or self.headers.get('Host') != urlsplit(origin).netloc:
                self.reply(403); return False
            if self.headers.get('Origin') not in (None, origin):
                self.reply(403); return False
            return True

        def grant(self):
            try:
                values = SimpleCookie(); values.load(self.headers.get('Cookie', '')[:2048])
                return values[COOKIE].value if COOKIE in values else None
            except Exception:
                return None

        def do_POST(self):
            if not self.allowed():
                return
            if self.path != '/claim' or self.headers.get('Origin') != transfer.origin or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                self.reply(403); return
            token = self.headers.get('Authorization', '')
            grant = transfer.claim(token[7:]) if token.startswith('Bearer ') and len(token) < 128 else None
            if grant is None:
                self.reply(403); return
            item = transfer.content(grant)
            if item is None:
                self.reply(403); return
            remaining = max(1, transfer.snapshot()['expires_in'])
            raw = json.dumps({'name': item[0], 'size': len(item[1]), 'expires_in': remaining}).encode('utf-8')
            self.reply(200, raw, headers=[('Set-Cookie', f'{COOKIE}={grant}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age={remaining}')])

        def do_GET(self):
            if not self.allowed():
                return
            files = {'/': ('index.html', 'text/html; charset=utf-8'), '/phone.js': ('phone.js', 'text/javascript; charset=utf-8'), '/phone.css': ('phone.css', 'text/css; charset=utf-8')}
            from services.brand import FONT_ROOT
            for style in ('Light','Regular','Medium'):
                font_name='BrivanyEditorial-'+style+'.woff2'
                files['/fonts/'+font_name]=(FONT_ROOT/font_name,'font/woff2')
            if self.path in files:
                name, mime = files[self.path]
                if name == 'index.html':
                    with transfer.lock:
                        locale = transfer.locale
                    data = phone_page(locale)
                else:
                    data = (SITE / name).read_bytes()
                self.reply(200, data, mime); return
            grant = self.grant(); item = transfer.content(grant)
            if item is None or self.path not in ('/info', '/file'):
                self.reply(403); return
            name, data = item
            if self.path == '/info':
                self.reply(200, json.dumps({'name': name, 'size': len(data), 'expires_in': transfer.snapshot()['expires_in']}).encode('utf-8')); return
            start, end, code = 0, len(data) - 1, 200
            headers = [('Content-Disposition', "attachment; filename=\"Brivany-file\"; filename*=UTF-8''" + quote(name, safe='')),
                       ('Accept-Ranges', 'bytes')]
            if self.headers.get('Range'):
                value = self.headers['Range']
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', value) if len(value) <= 80 else None
                if not match:
                    self.reply(416, headers=[('Content-Range', f'bytes */{len(data)}')]); return
                start, end = int(match[1]), int(match[2]) if match[2] else len(data) - 1
                if not 0 <= start <= end < len(data):
                    self.reply(416, headers=[('Content-Range', f'bytes */{len(data)}')]); return
                code = 206; headers.append(('Content-Range', f'bytes {start}-{end}/{len(data)}'))
            self.send_response(code)
            for key, value in [('Content-Type', 'application/octet-stream'), ('Content-Length', str(max(0, end - start + 1))),
                               ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
                               ('Connection', 'close'), *headers]:
                self.send_header(key, value)
            self.end_headers(); self.close_connection = True
            try:
                for offset in range(start, end + 1, 65536):
                    if transfer.content(grant) is None:
                        return
                    self.wfile.write(data[offset:min(offset + 65536, end + 1)])
                self.wfile.flush()
                if start == 0 and end == len(data) - 1:
                    transfer.sent(grant)
            except (OSError, ssl.SSLError):
                pass

        def do_HEAD(self):
            self.reply(405)
    return Handler


class WorkspacePhoneBridge:
    _phone_lock = threading.RLock()

    def _file_transfer(self):
        with self._phone_lock:
            if getattr(self,'_exit_requested',False):raise ValueError('Brivany se está cerrando.')
            if not getattr(self,'_workspace_file_transfer',None):
                from .drop_transfer import OfficialDrop
                self._workspace_file_transfer=OfficialDrop(publish=self._publish_phone)
                atexit.register(self._workspace_file_transfer.close)
            return self._workspace_file_transfer

    def _phone(self):
        with self._phone_lock:
            if getattr(self, '_exit_requested', False):
                raise ValueError('Brivany se está cerrando.')
            if not getattr(self, '_workspace_phone', None):
                self._workspace_phone = PhoneTransfer(publish=self._publish_phone)
                atexit.register(self._workspace_phone.close)
            return self._workspace_phone

    def _publish_phone(self, value):
        self._configure_phone_edge(value)
        script = 'window.BrivanyWorkspacePhone?.receive(' + json.dumps(value, ensure_ascii=True) + ')'
        for window in (getattr(self, '_bar_window', None), getattr(self, '_work_window', None)):
            if window:
                post_script(window, script, 'workspace-phone')

    def _phone_edge_notice(self, message):
        window=getattr(self,'_work_window',None)
        if window:post_script(window,'window.BrivanyWorkspaceDrop?.notice('+json.dumps(message,ensure_ascii=True)+')','drop-edge-notice')

    def _configure_phone_edge(self, value):
        if getattr(self,'_phone_edge_closing',False):return
        paired=bool(value.get('active') and value.get('state') in {'connected','sent','received','declined','failed','sending','receiving','reconnecting'})
        edge=getattr(self,'_phone_edge_host',None)
        if paired and edge is None:
            import sys
            dispatcher=getattr(getattr(self,'_window',None),'native',None)
            if sys.platform=='win32' and dispatcher is not None:
                try:
                    from .drop_edge import NativeDropEdge
                    def preview(event):
                        window=getattr(self,'_work_window',None)
                        if window:post_script(window,'window.BrivanyWorkspaceDrop?.preview('+json.dumps(event)+')','drop-edge-preview')
                    edge=self._phone_edge_host=NativeDropEdge(dispatcher,self._queue_phone_paths,on_preview=preview,on_error=self._phone_edge_notice)
                except Exception:self._phone_edge_notice('No se pudo preparar el borde de transferencia.')
        if edge:edge.configure(paired,busy=bool(value.get('queued') or value.get('offer_pending') or value.get('state') in {'sending','receiving','reconnecting'}))

    def _queue_phone_paths(self, paths):
        """Called by the owned OLE target, never accepts a path from the web."""
        from .workspace_files import FileShelf,MAX_FILES
        if not isinstance(paths,list) or not 1<=len(paths)<=MAX_FILES:raise ValueError('Elige entre uno y 1.000 archivos.')
        transfer=self._file_transfer();identifier=transfer.snapshot().get('session',{}).get('id')
        shelf=FileShelf()
        try:
            for path in paths:shelf.add_path(path)
            return transfer.enqueue(identifier,list(shelf.items.values()))
        finally:shelf.close()

    def _close_workspace_phone(self):
        self._phone_edge_closing=True
        edge=getattr(self,'_phone_edge_host',None)
        if edge:edge.close()
        remote=getattr(self,'_workspace_file_transfer',None)
        if remote:remote.close()
        value = getattr(self, '_workspace_phone', None)
        if value:
            value.close()

    def workspace_phone_settings(self, address=None):
        self._trusted()
        control = getattr(self, '_phone_control_service', None)
        remote = control.snapshot() if control else {}
        linked = remote.get('state') in ('waiting', 'review', 'active')
        if address is not None and linked:
            raise ValueError('Termina el control móvil antes de cambiar de red.')
        value = self._phone().configure(address) if address is not None else self._phone().configuration()
        official=self._file_transfer().configuration()
        value.update(official_https=official.get('official_https',False),file_origin=official.get('origin'),configured=official.get('configured',True))
        if remote:
            value.update(active=value['active'] or linked, control_fingerprint=remote.get('fingerprint') if linked else None)
        return value

    def workspace_phone_state(self):
        self._trusted(); return self._file_transfer().snapshot()

    def workspace_phone_share(self, identifier, locale='es'):
        self._trusted()
        shelf = self._file_shelf()
        # Couple the selected item and the new grant before another view can
        # remove it. The bounded encrypted upload runs off the UI thread.
        with shelf.lock:
            transfer=self._file_transfer()
            if hasattr(transfer,'share_path'):value=transfer.share_path(dict(shelf.get(identifier)),locale=locale)
            else:
                name,data=shelf.share_payload(identifier);value=transfer.share(name,data,locale=locale)
            self._phone_shared_id = identifier
            return value

    def _workspace_file_removed(self, identifier):
        with self._file_shelf().lock:
            if identifier == getattr(self, '_phone_shared_id', None):
                value = getattr(self, '_workspace_file_transfer', None)
                if value:
                    value.stop()
                self._phone_shared_id = None

    def workspace_phone_stop(self):
        self._trusted(); return self._file_transfer().stop()

    def workspace_phone_pair(self,locale='es'):
        self._trusted();value=self._file_transfer().share_path(locale=locale);self._phone_shared_id=None;return value

    def workspace_phone_read(self,session,source,offset,length):
        self._trusted();return self._file_transfer().read(session,source,offset,length)

    def workspace_phone_update(self,session,event):
        self._trusted();return self._file_transfer().update(session,event)

    def workspace_phone_enqueue(self,session,identifiers):
        self._trusted()
        from .workspace_files import MAX_FILES
        if not isinstance(identifiers,list) or not 1<=len(identifiers)<=MAX_FILES or any(not isinstance(value,str) for value in identifiers):raise ValueError('Elige entre uno y 1.000 archivos.')
        shelf=self._file_shelf()
        with shelf.lock:return self._file_transfer().enqueue(session,[dict(shelf.get(value)) for value in identifiers])

    def workspace_phone_next(self,session,source):
        self._trusted();return self._file_transfer().next_source(session,source)

    def workspace_phone_cancel_queue(self,session):
        self._trusted();return self._file_transfer().clear_outbox(session)

    def workspace_phone_edge(self,session,event):
        self._trusted()
        transfer=self._file_transfer()
        with transfer.lock:transfer._session(session)
        if not isinstance(event,dict) or event.get('state') not in {'idle','preview','offer','sending','receiving','received'} or event.get('edge','right') not in {'left','right','top','bottom'}:raise ValueError('Estado del borde no válido.')
        edge=getattr(self,'_phone_edge_host',None)
        if edge:edge.receive(event['state'],event.get('edge','right'))
        return {'ok':True}

    def workspace_phone_receive_begin(self,session,meta):
        self._trusted();return self._file_transfer().begin_receive(session,meta)

    def workspace_phone_receive_write(self,session,file_id,offset,payload,digest):
        self._trusted();return self._file_transfer().write_receive(session,file_id,offset,payload,digest)

    def workspace_phone_receive_finish(self,session,file_id):
        self._trusted();return self._file_transfer().finish_receive(session,file_id)

    def workspace_phone_receive_abort(self,session,file_id):
        self._trusted();return self._file_transfer().abort_receive(session,file_id)

    def workspace_phone_reveal_received(self,session,file_id):
        self._trusted();return self._file_transfer().reveal_received(session,file_id)
