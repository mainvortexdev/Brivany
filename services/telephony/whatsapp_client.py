"""Reviewed WhatsApp client calls. Simulation by default; no Cloud API calls.

The production adapter requires explicit live settings, calibrated UI controls,
two virtual audio buses and configured live voice. Receipts never contain the
objective, audio or transcripts. An uncertain dial is never replayed.
"""
import base64
import hashlib
import json
from pathlib import Path
import queue
import re
import sqlite3
import threading
import time

from .common import clean_text
from .realtime import LivePhoneSession, LiveProviders
from .sip import identifier
from .common import TelephonyError, number
from .whatsapp_client_audio import VirtualAudio
from .whatsapp_client_settings import ClientSettings
from .whatsapp_client_simulation import SimulatedClient, SimulatedAudio, SimulatedProviders
from .whatsapp_client_ui import OfficialWhatsAppClient, com_thread

TERMINAL = {'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted'}


class ClientEnded(TelephonyError):
    def __init__(self, state):
        self.state = state
        super().__init__('La llamada del cliente terminó.')


class ClientSocket:
    def __init__(self, client, audio, call_id, notify):
        self.client, self.audio = client, audio
        self.stream_id = call_id
        self.notify = notify
        self.closed = threading.Event()
        self.events = queue.Queue(maxsize=32)
        self.lock = threading.Lock()
        self.sequence = 0
        self.connected = self.dial_attempted = self.failed = False
        self.cleanup_failed = False
        self.monitor = None

    def _event(self, event, **fields):
        with self.lock:
            if self.closed.is_set():
                return
            self.sequence += 1
            value = {'event': event, 'streamSid': self.stream_id,
                     'sequenceNumber': str(self.sequence), **fields}
            try:
                self.events.put_nowait(json.dumps(value))
            except queue.Full:
                self.fail()

    def capture(self, pcm):
        if not self.connected or self.closed.is_set():
            return
        if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > 9600:
            self.fail(); return
        self._event('media', media={'track': 'inbound', 'payload': base64.b64encode(pcm).decode('ascii')})

    def fail(self):
        self.failed = True
        self.closed.set()

    def start(self, destination, canceled):
        self.client.prepare(destination, canceled)
        if canceled.is_set():
            raise ClientEnded('canceled')
        self.audio.start(self.capture, self.fail)
        if self.closed.is_set() or canceled.is_set():
            raise ClientEnded('canceled' if canceled.is_set() else 'failed')
        self.notify('dialing')
        self.dial_attempted = True
        self.client.dial(destination)
        deadline = time.monotonic() + 45
        while not canceled.is_set() and not self.closed.is_set() and time.monotonic() < deadline:
            state = self.client.state()
            if state == 'in-progress':
                self.connected = True
                self.notify(state)
                self.monitor = threading.Thread(target=self._monitor, daemon=True, name='whatsapp-state')
                self.monitor.start()
                return
            if state in TERMINAL:
                raise ClientEnded(state)
            self.notify(state)
            canceled.wait(.1)
        raise ClientEnded('canceled' if canceled.is_set() else 'failed' if self.failed else 'no-answer')

    def _monitor(self):
        with com_thread():
            try:
                while not self.closed.wait(.1):
                    state = self.client.state()
                    if state in TERMINAL:
                        self.notify(state)
                        self.closed.set()
            except Exception:
                self.fail()

    def send(self, raw):
        event = json.loads(raw)
        if event.get('streamSid') != self.stream_id or self.closed.is_set():
            raise TelephonyError('El canal de audio del cliente no está disponible.')
        if event['event'] == 'media':
            self.audio.write(base64.b64decode(event['media']['payload'], validate=True))
        elif event['event'] == 'mark':
            self._event('mark', mark=event['mark'])
        elif event['event'] == 'clear':
            self.audio.clear()
        else:
            raise TelephonyError('Evento del cliente no válido.')

    def recv(self, timeout=.25):
        if self.closed.is_set():
            raise TelephonyError('La llamada de WhatsApp terminó.')
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError() from None

    def close(self):
        self.closed.set()
        self.audio.close()

    def shutdown(self):
        self.close()
        if self.dial_attempted:
            try:
                if self.client.state() not in TERMINAL:
                    self.client.hangup()
            except Exception:
                self.cleanup_failed = True
        if self.monitor and self.monitor is not threading.current_thread():
            self.monitor.join(1)


def rehearsal(session, socket, providers, canceled):
    """Scripted ASR plus synthetic PCM; nothing is sent to a physical device."""
    def wait(predicate):
        deadline = time.monotonic() + 3
        while not predicate():
            if canceled.is_set() or session.stopped() or time.monotonic() > deadline:
                return False
            canceled.wait(.01)
        return True
    if not wait(lambda: session.current is None and providers.spoken >= 1):
        return
    for turn, text in enumerate(('Hola, ¿podemos hablar?', 'Gracias, podemos continuar.'), 1):
        socket.capture(b'\0\0' * 960)
        providers.muse.utterance(turn, text)
        if not wait(lambda: session.metrics['completed_turns'] >= turn):
            return
    socket._event('stop')


class WhatsAppClientGateway:
    def __init__(self, path, settings, *, client_factory=None, audio_factory=None,
                 providers_factory=None, rehearsal_runner=rehearsal):
        self.settings = settings if isinstance(settings, ClientSettings) else ClientSettings(settings)
        self.client_factory, self.audio_factory, self.providers_factory = client_factory, audio_factory, providers_factory
        self.rehearsal_runner = rehearsal_runner
        self.lock = threading.RLock()
        self.active = self.worker = None
        self.active_id = None
        self.cancelled = threading.Event()
        self.closed = False
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS whatsapp_client_calls '
            '(id TEXT PRIMARY KEY, destination TEXT NOT NULL, action_hash TEXT NOT NULL, mode TEXT NOT NULL, '
            'state TEXT NOT NULL, result TEXT NOT NULL DEFAULT \'\', metrics TEXT NOT NULL DEFAULT \'{}\')')
        # The client might still be in a call after a crash. Do not hide that
        # uncertainty or allow a duplicate attempt after restarting Brivany.
        self.db.execute("UPDATE whatsapp_client_calls SET state=CASE WHEN mode='simulation' THEN 'interrupted' ELSE 'uncertain' END "
                        "WHERE state NOT IN ('completed','busy','no-answer','failed','canceled','interrupted','uncertain')")
        self.db.commit()

    def info(self):
        settings = self.settings.read()
        simulation = settings['mode'] == 'simulation'
        reason = ''
        if not simulation:
            if not settings['real_enabled']:
                reason = 'Las llamadas reales del cliente WhatsApp están deshabilitadas.'
            elif not LiveProviders.configured():
                reason = 'Conecta la voz de Melodi antes de llamar.'
            else:
                reason = OfficialWhatsAppClient.readiness(settings) or VirtualAudio.readiness(settings)
        return {'configured': True, 'outbound': not reason, 'voicemail': False, 'provider': 'whatsapp_client',
                'mode': settings['mode'], 'simulation': simulation, 'reason': reason, 'incoming': 'unavailable',
                'real_client_verified': False}

    def _update(self, call_id, state, result='', metrics=None):
        with self.lock:
            self.db.execute('UPDATE whatsapp_client_calls SET state=?,result=?,metrics=? WHERE id=?',
                (state, result, json.dumps(metrics or {}, separators=(',', ':')), call_id))
            self.db.commit()

    def _status(self, call_id):
        row = self.db.execute('SELECT * FROM whatsapp_client_calls WHERE id=?', (call_id,)).fetchone()
        if not row:
            return {'id': call_id, 'state': 'not-found', 'result': 'Llamada sin registro.', 'channel': 'whatsapp_client'}
        return {'id': row['id'], 'destination': row['destination'], 'state': row['state'], 'result': row['result'],
                'mode': row['mode'], 'simulation': row['mode'] == 'simulation', 'channel': 'whatsapp_client',
                'metrics': json.loads(row['metrics']), 'replay_allowed': False}

    def _run(self, call_id, destination, objective, settings):
        socket = None
        state, result, metrics = 'failed', 'No se pudo completar la llamada del cliente WhatsApp.', {}
        try:
            simulation = settings['mode'] == 'simulation'
            client = self.client_factory(settings) if self.client_factory else (
                SimulatedClient() if simulation else OfficialWhatsAppClient(settings['controls']))
            audio = self.audio_factory(settings) if self.audio_factory else (
                SimulatedAudio() if simulation else VirtualAudio(settings['receive_device'], settings['transmit_device']))
            providers = self.providers_factory(settings) if self.providers_factory else (
                SimulatedProviders() if simulation else LiveProviders())
            if simulation and not all(getattr(item, 'simulation', False) is True for item in (client, audio, providers)):
                raise TelephonyError('La simulación no admite adaptadores reales.')
            def notify(value):
                if value not in TERMINAL | {'dialing', 'ringing', 'in-progress'}:
                    raise TelephonyError('Estado del cliente no válido.')
                with self.lock:
                    if not self.cancelled.is_set() and self._status(call_id)['state'] not in TERMINAL:
                        self._update(call_id, value)
            socket = ClientSocket(client, audio, call_id, notify)
            with self.lock:
                self.active = socket
            with com_thread():
                socket.start(destination, self.cancelled)
                session = LivePhoneSession(socket, call_id, objective, socket.closed,
                    providers, audio_format='virtual_pcm_24000')
                driver = None
                if simulation:
                    driver = threading.Thread(target=self.rehearsal_runner,
                        args=(session, socket, providers, self.cancelled), daemon=True, name='whatsapp-rehearsal')
                    driver.start()
                session.run()
                if driver:
                    driver.join(4)
                metrics = dict(session.metrics)
                if socket.failed or metrics['failed']:
                    state, result = 'failed', 'Se interrumpió la conversación del cliente WhatsApp.'
                else:
                    state = 'completed'
                    result = ('Simulación completada: ' + str(metrics['completed_turns']) + ' turnos de voz.'
                              if simulation else 'La llamada del cliente WhatsApp terminó.')
        except ClientEnded as error:
            state, result = error.state, 'La llamada no llegó a una conversación.'
        except Exception:
            if socket and socket.dial_attempted:
                state, result = 'uncertain', 'Comprueba el cliente WhatsApp antes de volver a llamar.'
        finally:
            if socket:
                with com_thread():
                    socket.shutdown()
                if socket.cleanup_failed:
                    state, result = 'uncertain', 'No se pudo confirmar el cierre en WhatsApp. Comprueba el cliente.'
            with self.lock:
                if self.cancelled.is_set() and state != 'uncertain':
                    state, result = 'canceled', 'Simulación cancelada.' if settings['mode'] == 'simulation' else 'Llamada cancelada.'
                self._update(call_id, state, result, metrics)
                self.active = None
                self.active_id = None

    def request(self, path, value=None, *, audio=False):
        with self.lock:
            if self.closed:
                raise TelephonyError('Brivany se está cerrando.')
            if path == '/v1/info' and value is None:
                return self.info()
            if path == '/v1/voicemails' and value is None:
                return {'messages': []}
            if path == '/v1/calls' and isinstance(value, dict):
                if set(value) - {'id', 'destination', 'objective', 'channel', 'mode'}:
                    raise TelephonyError('Solicitud del cliente WhatsApp no válida.')
                call_id, destination = identifier(value.get('id')), number(value.get('destination'))
                objective = clean_text(value.get('objective'), 600)
                settings = self.settings.read()
                mode = value.get('mode', settings['mode'])
                if mode != settings['mode']:
                    raise TelephonyError('Cambió el modo de WhatsApp. Revisa la llamada otra vez.')
                digest = hashlib.sha256(json.dumps([destination, objective, mode], ensure_ascii=False).encode()).hexdigest()
                existing = self.db.execute('SELECT * FROM whatsapp_client_calls WHERE id=?', (call_id,)).fetchone()
                if existing:
                    if existing['action_hash'] != digest:
                        raise TelephonyError('La revisión ya corresponde a otra llamada.')
                    return self._status(call_id)
                if self.worker and self.worker.is_alive():
                    raise TelephonyError('Espera a que termine la llamada anterior.')
                if self.db.execute("SELECT 1 FROM whatsapp_client_calls WHERE state='uncertain'").fetchone():
                    raise TelephonyError('Hay una llamada de WhatsApp por confirmar. Comprueba el cliente antes de continuar.')
                readiness = self.info()
                if not readiness['outbound']:
                    raise TelephonyError(readiness['reason'])
                self.db.execute('INSERT INTO whatsapp_client_calls(id,destination,action_hash,mode,state) VALUES(?,?,?,?,?)',
                    (call_id, destination, digest, mode, 'preparing'))
                self.db.commit()
                self.cancelled = threading.Event()
                self.active_id = call_id
                self.worker = threading.Thread(target=self._run, args=(call_id, destination, objective, settings),
                    daemon=True, name='melodi-whatsapp-client')
                self.worker.start()
                return self._status(call_id)
            match = re.fullmatch(r'/v1/calls/([a-f0-9-]{36})(/cancel)?', path)
            if match:
                call_id = identifier(match[1])
                if match[2] and value == {}:
                    if self.active_id == call_id:
                        self.cancelled.set()
                        if self.active:
                            self.active.close()
                        return {**self._status(call_id), 'cancel_requested': True}
                elif match[2] or value is not None:
                    raise TelephonyError('Solicitud del cliente WhatsApp no válida.')
                return self._status(call_id)
            raise TelephonyError('Función no disponible en el cliente WhatsApp.')

    def close(self):
        with self.lock:
            self.closed = True
            self.cancelled.set()
            if self.active:
                self.active.close()
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(8)
        if not self.worker or not self.worker.is_alive():
            self.db.close()
