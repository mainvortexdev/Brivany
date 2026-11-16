"""Bounded calls, authenticated callbacks and a mailbox for one configured DID."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import re
import sqlite3
import threading
import time
from pathlib import Path
from uuid import UUID, uuid4
from xml.etree.ElementTree import Element, SubElement, tostring

from .dialogue import MAX_TURNS, OPENING, MelodiDialogue, clean_text
from .twilio import VOICE_LANGUAGE, ProviderError, TelephonyError, https_origin, number, sid

TERMINAL = {'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted'}
PROGRESS = {'preparing': 0, 'dialing': 1, 'uncertain': 1, 'queued': 2, 'initiated': 3, 'ringing': 4, 'in-progress': 5}
CALL_TTL = 300


def xml(response):
    return tostring(response, encoding='utf-8', xml_declaration=True)


def hangup(message=''):
    response = Element('Response')
    if message:
        SubElement(response, 'Say', language=VOICE_LANGUAGE).text = message
    SubElement(response, 'Hangup')
    return xml(response)


@dataclass
class Dialogue:
    objective: str
    cancelled: threading.Event = field(default_factory=threading.Event)
    history: list = field(default_factory=list)
    clips: dict = field(default_factory=dict)
    turn: int = 0
    pending: bool = False
    pending_at: float = 0
    current_clip: str | None = None
    ending: bool = False
    missed: bool = False
    failure: bool = False
    expiry: threading.Timer | None = None
    ready: threading.Event = field(default_factory=threading.Event)
    media_claimed: bool = False


class Calls:
    def __init__(self, path, config, transport, dialogue=None, *, clock=time.time, console_trial=False, realtime_origin=None):
        self.config, self.transport, self.clock = config, transport, clock
        self.dialogue = dialogue or MelodiDialogue()
        self.console_trial = console_trial
        self.realtime_origin = https_origin(realtime_origin) if realtime_origin else None
        if console_trial and self.realtime_origin:
            raise TelephonyError('La cuenta de prueba limitada no admite Media Streams.')
        self.lock = threading.RLock()
        self.live = {}
        self.hangups = set()
        self.closed = False
        if path != ':memory:':
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.db:
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS calls (
                    id TEXT PRIMARY KEY, capability TEXT UNIQUE NOT NULL, destination TEXT NOT NULL,
                    provider_id TEXT, state TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT -1,
                    created REAL NOT NULL, updated REAL NOT NULL, result TEXT NOT NULL DEFAULT '',
                    cancel INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS incoming (
                    provider_id TEXT PRIMARY KEY, caller TEXT, created REAL NOT NULL, accepted INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS voicemail (
                    id TEXT PRIMARY KEY, provider_id TEXT UNIQUE NOT NULL, caller TEXT,
                    seconds INTEGER NOT NULL, created REAL NOT NULL
                );
            ''')
            # After a process restart a call may have gone out. Keep its receipt
            # and require a new explicit operation. Never automatically redial.
            self.db.execute("UPDATE calls SET state='interrupted', result=? WHERE state IN ('preparing','dialing','queued','initiated','ringing','in-progress','uncertain')",
                            ('Se reinició la pasarela. Revisa el estado antes de volver a llamar.',))
        self.worker = ThreadPoolExecutor(max_workers=2, thread_name_prefix='melodi-phone')

    def _row(self, identifier):
        return self.db.execute('SELECT * FROM calls WHERE id=?', (identifier,)).fetchone()

    def _public(self, row):
        if row is None:
            raise TelephonyError('Llamada no disponible.')
        return {key: row[key] for key in ('id', 'destination', 'state', 'created', 'updated', 'result')} | {
            'cancel_requested': bool(row['cancel'])}

    def _update(self, row, **fields):
        fields['updated'] = self.clock()
        assignments = ', '.join(key + '=?' for key in fields)
        with self.db:
            self.db.execute('UPDATE calls SET ' + assignments + ' WHERE id=?', (*fields.values(), row['id']))
        return self._row(row['id'])

    def _expire(self):
        cutoff = self.clock() - CALL_TTL
        rows = self.db.execute("SELECT * FROM calls WHERE created<? AND state NOT IN ('completed','busy','no-answer','failed','canceled','interrupted')", (cutoff,)).fetchall()
        for row in rows:
            self._release(row['id'])
            if row['state'] not in TERMINAL:
                self._update(row, state='interrupted', result='No se confirmó el final de la llamada.')
        with self.db:
            self.db.execute('DELETE FROM incoming WHERE created<?', (self.clock() - 86400,))

    def info(self):
        return {'configured': True, 'outbound': self.config.outbound, 'voicemail': self.config.voicemail,
                'realtime': bool(self.realtime_origin)}

    def start(self, identifier, destination, objective):
        try:
            valid_id = str(UUID(identifier)) == identifier
        except (ValueError, TypeError, AttributeError):
            valid_id = False
        if not valid_id:
            raise TelephonyError('Solicitud de llamada no válida.')
        destination, objective = number(destination), clean_text(objective, 600)
        with self.lock:
            if self.closed or not self.config.outbound:
                raise TelephonyError('Las llamadas salientes todavía no están habilitadas.')
            existing = self._row(identifier)
            if existing:
                if existing['destination'] != destination:
                    raise TelephonyError('La solicitud ya corresponde a otro número.')
                return self._public(existing)
            if destination not in self.config.destinations:
                raise TelephonyError('Este destino todavía no está habilitado para Melodi.')
            self._expire()
            previous = self.db.execute('SELECT * FROM calls ORDER BY created DESC LIMIT 1').fetchone()
            if previous and (self.console_trial or previous['state'] not in TERMINAL or self.clock() - previous['created'] < 30):
                raise TelephonyError('Espera a que termine la llamada anterior.')
            now = self.clock()
            capability = uuid4().hex + uuid4().hex
            with self.db:
                self.db.execute('INSERT INTO calls (id,capability,destination,state,created,updated) VALUES (?,?,?,?,?,?)',
                                (identifier, capability, destination, 'preparing', now, now))
            state = Dialogue(objective)
            self.live[identifier] = state
            def expire():
                with self.lock:
                    if not self.closed and self.live.get(identifier) is state:
                        row = self._row(identifier)
                        self._update(row, state='interrupted', result='No se confirmó el final de la llamada.')
                        self._release(identifier)
            state.expiry = threading.Timer(CALL_TTL, expire)
            state.expiry.daemon = True
            state.expiry.start()
            self.worker.submit(self._dial, identifier, state)
            return self._public(self._row(identifier))

    def _dial(self, identifier, state):
        try:
            greeting = ('Hola, soy Melodi, la asistente virtual de Brivany. Esta es una prueba breve de voz. '
                        'Puedes hablar después del saludo o marcar cero para terminar.') if self.console_trial else OPENING
            clip = None if self.realtime_origin else self.dialogue.synthesize(greeting, state.cancelled)
            with self.lock:
                row = self._row(identifier)
                if self.closed or state.cancelled.is_set() or row['state'] in TERMINAL:
                    return
                if clip is not None:
                    state.current_clip = uuid4().hex
                    state.clips[state.current_clip] = clip
                self._update(row, state='dialing')
                prefix = '/twilio/out/' + row['capability']
                if self.console_trial and self.transport is None:
                    return  # A limited Twilio account dials from the Custom console form.
            provider_id = self.transport.start(row['destination'], prefix + '/answer', prefix + '/status')
            with self.lock:
                row = self._row(identifier)
                if row['provider_id'] and row['provider_id'] != provider_id:
                    raise ProviderError('La pasarela recibió una referencia distinta.', uncertain=True)
                updates = {'provider_id': provider_id}
                if row['state'] == 'dialing':
                    updates['state'] = 'queued'
                row = self._update(row, **updates)
                canceled = row['cancel'] or self.closed
            if canceled:
                self._hangup(identifier, provider_id)
        except Exception as error:
            with self.lock:
                row = self._row(identifier)
                if row['state'] in TERMINAL:
                    return
                if row['state'] == 'preparing':
                    self._update(row, state='failed', result='No se pudo preparar la voz. No se inició la llamada.')
                    self._release(identifier)
                elif not row['provider_id']:
                    uncertain = not isinstance(error, ProviderError) or error.uncertain
                    self._update(row, state='uncertain' if uncertain else 'failed',
                                 result='No se pudo confirmar si se inició. No se volverá a marcar automáticamente.' if uncertain else 'El proveedor rechazó la llamada.')
                    if not uncertain:
                        self._release(identifier)

    def status(self, identifier):
        with self.lock:
            self._expire()
            row = self._row(identifier)
            if row is None:
                return {'id': identifier, 'state': 'not-found', 'result': 'La pasarela no tiene un registro de esa llamada.'}
            return self._public(row)

    def cancel(self, identifier):
        with self.lock:
            row = self._row(identifier)
            self._public(row)
            if row['state'] in TERMINAL or row['cancel']:
                return self._public(row)
            if row['state'] == 'preparing':
                self._release(identifier)
                return self._public(self._update(row, state='canceled', cancel=1))
            state = self.live.get(identifier)
            if state:
                state.cancelled.set()
            row = self._update(row, cancel=1, result='Se solicitó finalizar la llamada.')
            if row['provider_id']:
                self.worker.submit(self._hangup, identifier, row['provider_id'])
            return self._public(row)

    def _hangup(self, identifier, provider_id):
        with self.lock:
            row = self._row(identifier)
            if row['state'] in TERMINAL or identifier in self.hangups:
                return
            self.hangups.add(identifier)
        try:
            state = self.transport.hangup(provider_id)
            with self.lock:
                row = self._row(identifier)
                if row['state'] not in TERMINAL:
                    self._update(row, state=state, result='Llamada detenida.')
                    self._release(identifier)
        except ProviderError:
            with self.lock:
                row = self._row(identifier)
                if row['state'] not in TERMINAL:
                    self._update(row, cancel=0, result='El proveedor no confirmó el cierre. Puedes solicitarlo de nuevo.')
        finally:
            with self.lock:
                self.hangups.discard(identifier)

    def _release(self, identifier):
        state = self.live.pop(identifier, None)
        if state:
            state.cancelled.set()
            state.ready.set()
            if state.expiry:
                state.expiry.cancel()

    def _provider_call(self, fields):
        provider_id = fields.get('CallSid')
        if fields.get('AccountSid') != self.config.account or not sid(provider_id, 'CA'):
            raise TelephonyError('Referencia de llamada no válida.')
        return provider_id

    def _match(self, capability, fields):
        if self.closed:
            raise TelephonyError('La pasarela está cerrada.')
        provider_id = self._provider_call(fields)
        row = self.db.execute('SELECT * FROM calls WHERE capability=?', (capability,)).fetchone()
        if row is None or row['provider_id'] not in (None, provider_id):
            raise TelephonyError('Llamada no disponible.')
        if self.console_trial and (fields.get('From') != self.config.caller_id or fields.get('To') != row['destination']):
            raise TelephonyError('El origen o el destino no coincide con la prueba.')
        if fields.get('To') and fields['To'] != row['destination']:
            raise TelephonyError('El destino de la llamada no coincide.')
        if not row['provider_id']:
            if row['state'] not in {'dialing', 'uncertain', 'interrupted'}:
                raise TelephonyError('Llamada no disponible.')
            row = self._update(row, provider_id=provider_id)
        return row

    def callback_status(self, capability, fields):
        with self.lock:
            row = self._match(capability, fields)
            value = fields.get('CallStatus')
            sequence = fields.get('SequenceNumber', '')
            if (value not in {'queued','initiated','ringing','in-progress','completed','busy','failed','no-answer','canceled'}
                    or not re.fullmatch(r'[0-9]{1,8}', sequence) or int(sequence) <= row['sequence']):
                return
            if row['state'] in TERMINAL and not (row['state'] == 'interrupted' and value in TERMINAL):
                return
            if value in PROGRESS and PROGRESS[value] < PROGRESS.get(row['state'], 0):
                return
            updates = {'sequence': int(sequence), 'state': value}
            if value in TERMINAL:
                self._release(row['id'])
            if row['state'] == 'uncertain' and not row['cancel']:
                updates['result'] = ''
            self._update(row, **updates)

    def _render(self, row, state):
        prefix = self.config.public_origin + '/twilio/out/' + row['capability']
        if state.failure or not state.current_clip:
            return hangup('La asistente no está disponible en este momento. Gracias por atender.')
        response = Element('Response')
        if state.ending:
            SubElement(response, 'Play').text = prefix + '/audio/' + state.current_clip
            SubElement(response, 'Hangup')
        else:
            if state.turn == 0 or self.console_trial:
                SubElement(response, 'Play').text = prefix + '/audio/' + state.current_clip
            gather = SubElement(response, 'Gather', input='speech dtmf', language=VOICE_LANGUAGE, method='POST',
                                action=prefix + '/turn/' + str(state.turn), numDigits='1', timeout='6',
                                speechTimeout='auto', actionOnEmptyResult='true')
            if state.turn != 0 and not self.console_trial:
                SubElement(gather, 'Play').text = prefix + '/audio/' + state.current_clip
        return xml(response)

    def _wait(self, row, state):
        if self.clock() - state.pending_at > (18 if self.console_trial else 36):
            state.failure = state.ending = True
            state.cancelled.set()
            self._update(row, result='Se agotó el tiempo de respuesta de Melodi.')
            return self._render(row, state)
        response = Element('Response')
        SubElement(response, 'Pause', length='2')
        SubElement(response, 'Redirect', method='POST').text = self.config.public_origin + '/twilio/out/' + row['capability'] + '/wait'
        return xml(response)

    def answer(self, capability, fields):
        with self.lock:
            row = self._match(capability, fields)
            state = self.live.get(row['id'])
            if not state or row['cancel'] or row['state'] in TERMINAL:
                return hangup()
            if row['state'] != 'in-progress':
                row = self._update(row, state='in-progress', result='')
            if self.realtime_origin:
                response = Element('Response')
                connect = SubElement(response, 'Connect')
                SubElement(connect, 'Stream', url=self.realtime_origin.replace('https://','wss://',1)
                           + '/twilio/media/' + row['capability'])
                SubElement(response, 'Hangup')
                return xml(response)
            return self._wait(row, state) if state.pending else self._render(row, state)

    def media_pending(self, capability):
        with self.lock:
            if self.closed or not self.realtime_origin:
                return False
            row = self.db.execute('SELECT * FROM calls WHERE capability=?',(capability,)).fetchone()
            state = self.live.get(row['id']) if row else None
            return bool(state and not state.media_claimed and not row['cancel']
                        and row['state']=='in-progress' and row['created']>self.clock()-CALL_TTL)

    def media_attach(self, capability, account, provider_id):
        with self.lock:
            if not self.media_pending(capability):
                raise TelephonyError('La sesión de voz no está disponible.')
            row = self.db.execute('SELECT * FROM calls WHERE capability=?',(capability,)).fetchone()
            if account!=self.config.account or not sid(provider_id,'CA') or provider_id!=row['provider_id']:
                raise TelephonyError('La llamada del stream no coincide.')
            state = self.live[row['id']]
            state.media_claimed=True
            return state.objective,state.cancelled

    def media_finished(self, capability, failed):
        with self.lock:
            if self.closed:
                return
            row = self.db.execute('SELECT * FROM calls WHERE capability=?',(capability,)).fetchone()
            if row and row['state'] not in TERMINAL:
                self._update(row,result='Se interrumpió el canal de voz.' if failed else
                             'Se cerró el canal de voz. No se verificó una gestión externa.')

    def turn(self, capability, index, fields):
        with self.lock:
            row = self._match(capability, fields)
            state = self.live.get(row['id'])
            if not state or row['cancel'] or row['state'] in TERMINAL:
                return hangup()
            if state.pending:
                return self._wait(row, state)
            if state.ending or index != state.turn:
                return self._render(row, state)
            if fields.get('Digits'):
                self._update(row, result='La persona al teléfono pidió terminar.')
                state.ending = True
                return hangup()
            speech = ' '.join(fields.get('SpeechResult', '').split())[:1000]
            if not state.history and speech.strip(' .,!¡¿?').casefold() in {'no', 'no gracias', 'no, gracias', 'no puedo hablar'}:
                self._update(row, result='La persona al teléfono prefirió no continuar.')
                state.ending = True
                return hangup()
            if not speech:
                if not state.missed:
                    state.missed = True
                    state.turn += 1
                    return self._render(row, state)
                self._update(row, result='No se recibió una respuesta audible.')
                state.ending = True
                return hangup()
            state.pending = True
            state.ready.clear()
            state.pending_at = self.clock()
            state.missed = False
            state.turn += 1
            last = len(state.history) // 2 + 1 >= (2 if self.console_trial else MAX_TURNS)
            self.worker.submit(self._respond, row['id'], state, speech, last)
            if not self.console_trial:
                return self._wait(row, state)
        return self.wait(capability, fields)

    def _respond(self, identifier, state, speech, last):
        try:
            reply = self.dialogue.reply(state.objective, list(state.history), speech, last, state.cancelled)
            clip = self.dialogue.synthesize(reply.text, state.cancelled)
            with self.lock:
                row = self._row(identifier)
                if state.cancelled.is_set() or row['state'] in TERMINAL:
                    return
                state.history.extend((('user', speech), ('assistant', reply.text)))
                state.current_clip = uuid4().hex
                state.clips = {state.current_clip: clip}
                state.ending = reply.end or last
                if state.ending:
                    self._update(row, result=reply.result or 'La conversación terminó. No se confirmó el resultado del encargo.')
        except Exception:
            with self.lock:
                if not state.cancelled.is_set():
                    state.failure = state.ending = True
                    self._update(self._row(identifier), result='Melodi no pudo completar la conversación.')
        finally:
            with self.lock:
                state.pending = False
                state.ready.set()

    def wait(self, capability, fields):
        if self.console_trial:
            with self.lock:
                row = self._match(capability, fields)
                pending = self.live.get(row['id'])
            if pending and pending.pending:
                # The trial interceptor has a five-second fetch deadline that
                # also includes its network hops. Keep ample transit headroom.
                pending.ready.wait(1.0)
        with self.lock:
            row = self._match(capability, fields)
            state = self.live.get(row['id'])
            if not state or row['cancel'] or row['state'] in TERMINAL:
                return hangup()
            return self._wait(row, state) if state.pending else self._render(row, state)

    def clip(self, capability, clip_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM calls WHERE capability=?', (capability,)).fetchone()
            if row and row['created'] > self.clock() - CALL_TTL and not row['cancel']:
                state = self.live.get(row['id'])
                if state:
                    return state.clips.get(clip_id)
        return None

    def console_answer_url(self, identifier):
        with self.lock:
            row = self._row(identifier)
            if self.console_trial and row and row['state'] == 'dialing' and self.live.get(identifier):
                return self.config.public_origin + '/twilio/out/' + row['capability'] + '/answer'
        return None

    def console_accepts(self, capability, fields):
        """Check the one trial session without binding an unverified provider ID."""
        with self.lock:
            if self.closed or not self.console_trial or fields.get('AccountSid') != self.config.account:
                return False
            provider_id = fields.get('CallSid')
            if not sid(provider_id, 'CA'):
                return False
            row = self.db.execute('SELECT * FROM calls WHERE capability=?', (capability,)).fetchone()
            return bool(row and row['id'] in self.live and not row['cancel']
                        and row['created'] > self.clock() - CALL_TTL
                        and row['state'] not in TERMINAL
                        and row['provider_id'] in (None, provider_id)
                        and fields.get('From') == self.config.caller_id
                        and fields.get('To') == row['destination'])

    def console_progress(self, identifier):
        with self.lock:
            row = self._row(identifier)
            state = self.live.get(identifier)
            if not self.console_trial or not row:
                return None
            return {'state': row['state'], 'turns': len(state.history) // 2 if state else None,
                    'ending': bool(state and state.ending), 'failed': bool(state and state.failure)}

    def incoming(self, fields):
        provider_id = self._provider_call(fields)
        if not self.config.voicemail or fields.get('To') != self.config.caller_id:
            return hangup()
        with self.lock:
            try:
                caller = number(fields.get('From'))
            except TelephonyError:
                caller = None
            with self.db:
                self.db.execute('DELETE FROM incoming WHERE created<?', (self.clock() - 86400,))
                self.db.execute('INSERT OR IGNORE INTO incoming (provider_id,caller,created) VALUES (?,?,?)',
                                (provider_id, caller, self.clock()))
        response = Element('Response')
        gather = SubElement(response, 'Gather', input='dtmf', numDigits='1', timeout='6', method='POST',
                            action=self.config.public_origin + '/twilio/mailbox/consent')
        SubElement(gather, 'Say', language=VOICE_LANGUAGE).text = 'Buzón de voz de Melodi. Para grabar un mensaje de hasta un minuto, pulsa uno. Si no quieres grabar, puedes colgar.'
        SubElement(response, 'Hangup')
        return xml(response)

    def mailbox_consent(self, fields):
        provider_id = self._provider_call(fields)
        if not self.config.voicemail or fields.get('Digits') != '1':
            return hangup()
        with self.lock, self.db:
            row = self.db.execute('SELECT * FROM incoming WHERE provider_id=?', (provider_id,)).fetchone()
            if not row or row['created'] < self.clock() - 600:
                return hangup()
            self.db.execute('UPDATE incoming SET accepted=1 WHERE provider_id=?', (provider_id,))
        response = Element('Response')
        SubElement(response, 'Say', language=VOICE_LANGUAGE).text = 'Deja tu mensaje después del tono. Pulsa numeral cuando termines.'
        origin = self.config.public_origin
        SubElement(response, 'Record', method='POST', action=origin + '/twilio/mailbox/finish', maxLength='60',
                   timeout='5', playBeep='true', finishOnKey='#', transcribe='false',
                   recordingStatusCallback=origin + '/twilio/mailbox/recorded',
                   recordingStatusCallbackMethod='POST', recordingStatusCallbackEvent='completed')
        return xml(response)

    def mailbox_finish(self, fields):
        self._provider_call(fields)
        return hangup('Gracias por dejar tu mensaje.')

    def mailbox_recorded(self, fields):
        provider_id = self._provider_call(fields)
        recording = fields.get('RecordingSid')
        duration = fields.get('RecordingDuration', '')
        if (not self.config.voicemail or fields.get('RecordingStatus') != 'completed'
                or fields.get('RecordingSource') != 'RecordVerb' or not sid(recording, 'RE')
                or not re.fullmatch(r'[0-9]{1,3}', duration) or not 1 <= int(duration) <= 60):
            return
        with self.lock, self.db:
            row = self.db.execute('SELECT * FROM incoming WHERE provider_id=? AND accepted=1', (provider_id,)).fetchone()
            if row and not self.db.execute('SELECT 1 FROM voicemail WHERE provider_id=?', (provider_id,)).fetchone():
                self.db.execute('INSERT OR IGNORE INTO voicemail VALUES (?,?,?,?,?)',
                                (recording, provider_id, row['caller'], int(duration), row['created']))

    def mailbox(self):
        with self.lock:
            return {'messages': [dict(row) for row in self.db.execute(
                'SELECT id,caller,seconds,created FROM voicemail ORDER BY created DESC LIMIT 30')]}

    def recording(self, identifier):
        with self.lock:
            if not self.config.voicemail or not self.db.execute('SELECT 1 FROM voicemail WHERE id=?', (identifier,)).fetchone():
                raise TelephonyError('Mensaje de voz no disponible.')
        return self.transport.recording(identifier)

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for identifier in list(self.live):
                self._release(identifier)
        self.worker.shutdown(wait=True, cancel_futures=True)
        with self.lock:
            self.db.close()
