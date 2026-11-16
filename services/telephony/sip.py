"""Native SIP leg used by the Telnyx gateway. No public webhook or physical audio devices.

The SIP worker (`sip_engine`) runs in its own process; credentials reach it only
through stdin. Caller ID is set on the Telnyx connection, not by this process.
"""
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from uuid import UUID

from .common import TelephonyError
from .sip_engine import config as validate_engine

ROOT = Path(__file__).resolve().parents[2]
TERMINAL = {'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted'}


def identifier(value):
    try:
        if str(UUID(value)) == value:
            return value
    except (ValueError, TypeError, AttributeError):
        pass
    raise TelephonyError('Llamada no válida.')


class NativeSIP:
    """Private JSON IPC, credentials on stdin, bounded audio, native code isolated."""
    def __init__(self, configuration, call_id, notify, *, local_peer_port=None):
        self.configuration = validate_engine(configuration)
        self.identifier = identifier(call_id)
        if local_peer_port is not None and not self.configuration['peer']:
            raise TelephonyError('El par de prueba debe ser local.')
        self.local_peer_port = local_peer_port
        self.notify = notify
        self.stream_id = 'sip-' + self.identifier
        self.events = queue.Queue(maxsize=256)
        self.condition = threading.Condition()
        self.write_lock = threading.RLock()
        self.closed = threading.Event()
        self.process = self.reader = None
        self.ready = self.registered = self.media_ready = self.failed = False
        self.answered = False
        self.early_media_sink = None  # Optional in-memory diagnostic; never persisted by the gateway.
        self.registration_status = 0
        self.sequence = 0

    def _command(self, value):
        with self.write_lock:
            if self.closed.is_set() and value.get('type') not in ('stop', 'hangup'):
                raise TelephonyError('La llamada terminó.')
            if not self.process or self.process.poll() is not None:
                raise TelephonyError('La conexión SIP se cerró.')
            try:
                self.process.stdin.write(json.dumps(value, separators=(',', ':')) + '\n')
                self.process.stdin.flush()
            except (OSError, ValueError):
                raise TelephonyError('La conexión SIP se cerró.') from None

    def _event(self, name, **fields):
        self.sequence += 1
        self.events.put_nowait(json.dumps({'event':name, 'streamSid':self.stream_id,
            'sequenceNumber':str(self.sequence), **fields}))

    def _read(self):
        try:
            while True:
                raw = self.process.stdout.readline(16385)
                if not raw:
                    break
                if len(raw) > 16384 or not raw.endswith('\n'):
                    raise ValueError('ipc_limit')
                event = json.loads(raw)
                kind = event.get('type')
                if kind in ('audio', 'mark', 'call', 'sip_response', 'media_ready', 'dtmf') and event.get('id') != self.identifier:
                    raise ValueError('call_identity')
                with self.condition:
                    if kind == 'ready':
                        self.ready = True
                    elif kind == 'registration':
                        self.registration_status = int(event.get('sip_status', 0))
                        self.registered = event.get('state') == 'registered' and event.get('sip_status') == 200
                        if not self.registered and event.get('sip_status', 0) >= 300:
                            self.failed = True
                    elif kind == 'media_ready':
                        if event.get('format') != 'pcm_s16le' or event.get('rate') != 24000:
                            raise ValueError('media_format')
                        self.media_ready = True
                    elif kind == 'call':
                        if event.get('state') == 'in-progress':
                            self.answered = True
                        if event.get('state') in TERMINAL:
                            self.closed.set()
                    elif kind == 'audio':
                        data = base64.b64decode(event['pcm'], validate=True)
                        if not 0 < len(data) <= 9600 or len(data) % 2:
                            raise ValueError('pcm')
                        if not self.answered:
                            if self.early_media_sink is not None:
                                self.early_media_sink(data)
                            continue  # Ringback/announcements are not the callee's conversation.
                        self._event('media', media={'track':'inbound', 'payload':event['pcm']})
                    elif kind == 'mark':
                        if event.get('boundary') != 'rtp_submitted':
                            raise ValueError('mark_boundary')
                        self._event('mark', mark={'name':event['name']})
                    elif kind == 'dtmf':
                        self._event('dtmf', dtmf={'digit':event.get('digit')})
                    elif kind == 'error':
                        self.failed = True
                    self.condition.notify_all()
                if kind in ('call','sip_response'):
                    self.notify(event)
        except Exception:
            self.failed = True
        finally:
            if not self.closed.is_set():
                self.failed = True
                self.notify({'type':'call', 'id':self.identifier, 'state':'interrupted'})
            self.closed.set()
            with self.condition:
                self.condition.notify_all()

    def _wait(self, predicate, seconds):
        deadline = time.monotonic() + seconds
        with self.condition:
            while not predicate():
                if self.failed or self.closed.is_set() or time.monotonic() >= deadline:
                    raise TelephonyError('No se pudo establecer la conexión SIP.')
                self.condition.wait(min(.1, max(0, deadline-time.monotonic())))

    def connect(self):
        """Authenticate only. No INVITE or phone number is sent by this method."""
        if self.process or self.closed.is_set():
            raise TelephonyError('La llamada ya se inició.')
        # Providers stay in the parent. Native code needs only SIP credentials.
        system_variables = {'PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC',
                            'TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA',
                            'PROGRAMFILES','PROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH'}
        environment = {key:value for key,value in os.environ.items() if key.upper() in system_variables}
        self.process = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', '-m',
            'services.telephony.sip_engine'], cwd=ROOT, env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self._command(self.configuration)
        self.configuration['password'] = ''
        self.reader = threading.Thread(target=self._read, daemon=True, name='sip-native-events')
        self.reader.start()
        self._wait(lambda:self.ready, 8)
        if self.configuration['register']:
            self._wait(lambda:self.registered, 15)
        return self

    def start(self, destination):
        if self.local_peer_port is None and destination not in self.configuration['allow']:
            raise TelephonyError('Este destino todavía no está habilitado para Melodi.')
        self.connect()
        if self.local_peer_port is None:
            self._command({'type':'dial', 'id':self.identifier, 'destination':destination})
        else:
            self._command({'type':'local_dial', 'id':self.identifier, 'port':self.local_peer_port})
        self._wait(lambda:self.media_ready and self.answered, 60)
        return self

    def send(self, raw):
        event = json.loads(raw)
        if event.get('streamSid') != self.stream_id:
            raise TelephonyError('El stream no coincide.')
        kind = event.get('event')
        value = {'id':self.identifier}
        if kind == 'media':
            value.update(type='audio', pcm=event['media']['payload'])
        elif kind == 'mark':
            value.update(type='mark', name=event['mark']['name'])
        elif kind == 'clear':
            value['type'] = 'clear'
        else:
            raise TelephonyError('Evento de audio no válido.')
        self._command(value)

    def recv(self, timeout=.25):
        if self.closed.is_set():
            raise TelephonyError('La llamada terminó.')
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError() from None

    def close(self):
        with self.write_lock:
            self.closed.set()
            if self.process and self.process.poll() is None:
                try:
                    self._command({'type':'hangup', 'id':self.identifier})
                except TelephonyError:
                    pass
        with self.condition:
            self.condition.notify_all()

    def shutdown(self):
        self.close()
        if self.process:
            try:
                if self.process.poll() is None:
                    self._command({'type':'stop'})
                self.process.wait(3)
            except (TelephonyError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(3)
            for stream in (self.process.stdin, self.process.stdout):
                stream.close()
        if self.reader and self.reader is not threading.current_thread():
            self.reader.join(1)
