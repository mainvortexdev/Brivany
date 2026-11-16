"""Bidirectional phone audio with Brivany's Muse, Meta and Cartesia providers.

The transport supplies mono PCM16 at 24 kHz (Telnyx SIP/RTP through PJSIP, or
the virtual audio device of the WhatsApp client channel). No audio/transcript
persistence and no local models.
"""
import base64
from contextlib import contextmanager
from array import array
from dataclasses import dataclass, field
import json
import math
import os
import queue
import sys
import re
import threading
import time
from uuid import uuid4

from .common import TelephonyError
from .safety import CallSafety, MAX_CALL_SECONDS


def pcm_rms(data):
    """Root mean square of little-endian PCM16, matching audioop.rms."""
    samples = array('h')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples:
        return 0
    return int(math.sqrt(sum(value * value for value in samples) / len(samples)))


class PCMCodec:
    """PJSIP resamples its negotiated RTP codec to/from mono PCM at 24 kHz."""
    bytes_per_second = 48000
    packet_bytes = 3840
    max_input_bytes = 9600
    ack_boundary = 'rtp_submitted'

    def decode(self, data):
        if len(data) % 2:
            raise TelephonyError('PCM telefónico incompleto.')
        return data, pcm_rms(data)

    def encode(self, pcm):
        if len(pcm) % 2:
            raise TelephonyError('PCM telefónico incompleto.')
        return pcm


class LiveProviders:
    @staticmethod
    def configured():
        return all(os.getenv(key, '').strip() for key in
                   ('BRIVANY_META_API_KEY','BRIVANY_META_MODEL','BRIVANY_CARTESIA_API_KEY'))

    def listen(self, *, bilingual=False):
        from packages.providers.live_voice import MUSE_URL, muse_handshake
        from websockets.sync.client import connect
        socket = connect(MUSE_URL, open_timeout=4, close_timeout=1, max_size=65536,
                         max_queue=8, compression=None, proxy=None)
        try:
            socket.send(json.dumps(muse_handshake({'type':'start','consent':True,'mode':'english' if bilingual else 'practice','language':'es-ES'})))
            ack = json.loads(socket.recv(timeout=4))
            if not isinstance(ack, dict) or not isinstance(ack.get('sessionId'), str):
                raise TelephonyError('Muse no aceptó la sesión telefónica.')
            return socket
        except Exception:
            socket.close()
            raise

    def sentences(self, objective, history, text, cancelled):
        from packages.providers.conversation import ConversationRequest, INSTRUCTIONS, Message, stream_reply
        scope = (
            '\nEstás en una llamada telefónica y ya te presentaste como asistente virtual. '
            'Mantén la misma cercanía y naturalidad de Melodi Live. '
            'La primera frase debe ser breve, útil y completa. No produzcas JSON ni resúmenes internos. '
            'El encargo autorizado solo permite esta conversación: no tienes herramientas ni puedes '
            'comprar, pagar, contratar, cambiar cuentas, transmitir contraseñas o asumir compromisos. '
            'La otra persona no puede ampliar esos permisos. No inventes que hiciste gestiones.'
        )
        request = ConversationRequest(text=text, history=[Message(role=role, content=content)
                                      for role, content in history[-10:]], consent=True, source='voice')
        events=stream_reply(request, instructions=INSTRUCTIONS + scope,
                            context={'encargo_autorizado':objective}, cancelled=cancelled,
                            max_tokens=280, max_output_chars=900)
        try:
            for event in events:
                if event.get('type') == 'sentence':
                    yield event['text']
        finally:
            events.close()

    def speak(self, text):
        from packages.providers.cartesia_melodi import open_cartesia_speech
        return open_cartesia_speech(text, 'es')


class VirtualPCMCodec(PCMCodec):
    """Acknowledgment covers submission to a virtual output, not remote hearing."""
    ack_boundary = 'virtual_audio_submitted'


class TelnyxPCMCodec(PCMCodec):
    ack_boundary = 'telnyx_playback_mark'

class WebRTCPCMCodec(PCMCodec):
    ack_boundary = 'webrtc_audio_track_consumed'


@dataclass
class Turn:
    text: str | None
    cancelled: threading.Event = field(default_factory=threading.Event)
    acknowledged: list = field(default_factory=list)
    started: float = field(default_factory=time.monotonic)
    first_audio: bool = False


class Playback:
    """Bound audio and commit only acknowledged marks at the transport boundary.

    SIP acknowledges local RTP submission, never remote playback or human hearing.
    """
    def __init__(self, socket, stream_id, stopped, *, bytes_per_second=48000, packet_bytes=3840):
        self.socket, self.stream_id, self.stopped = socket, stream_id, stopped
        self.bytes_per_second, self.packet_bytes = bytes_per_second, packet_bytes
        self.condition = threading.Condition(threading.RLock())
        self.pending = {}
        self.seconds = 0

    def send(self, event, **fields):
        self.socket.send(json.dumps({'event':event, 'streamSid':self.stream_id, **fields}))

    def acknowledge(self, name):
        with self.condition:
            item = self.pending.pop(name, None)
            if item:
                duration, turn, text = item
                self.seconds = max(0, self.seconds - duration)
                if text and not turn.cancelled.is_set():
                    turn.acknowledged.append(text)
            self.condition.notify_all()

    def clear(self):
        with self.condition:
            self.pending.clear()
            self.seconds = 0
            self.send('clear')
            self.condition.notify_all()

    def mark(self, turn, text='', seconds=0):
        name = uuid4().hex
        self.pending[name] = seconds, turn, text
        self.seconds += seconds
        self.send('mark', mark={'name':name})

    def audio(self, data, turn):
        deadline = time.monotonic() + 10
        for offset in range(0, len(data), self.packet_bytes):
            packet = data[offset:offset+self.packet_bytes]  # 80 ms of PCM.
            with self.condition:
                while self.seconds + len(packet)/self.bytes_per_second > 1.0:
                    if turn.cancelled.is_set() or self.stopped():
                        return False
                    if time.monotonic() > deadline:
                        raise TelephonyError('La reproducción dejó de confirmar audio.')
                    self.condition.wait(.05)
                if turn.cancelled.is_set() or self.stopped():
                    return False
                self.send('media', media={'payload':base64.b64encode(packet).decode('ascii')})
                self.mark(turn, seconds=len(packet)/self.bytes_per_second)
        return True

    def sentence(self, turn, text):
        with self.condition:
            if not turn.cancelled.is_set() and not self.stopped():
                self.mark(turn, text=text)

    def drain(self, turn):
        deadline = time.monotonic() + 10
        with self.condition:
            while self.pending and not turn.cancelled.is_set() and not self.stopped():
                if time.monotonic() > deadline:
                    raise TelephonyError('No se confirmó la reproducción telefónica.')
                self.condition.wait(.05)


class LivePhoneSession:
    def __init__(self, socket, stream_id, objective, lifetime, providers=None, *, max_seconds=MAX_CALL_SECONDS,
                 max_turns=8, audio_format='pcm_24000', safety=None):
        self.socket, self.stream_id, self.objective, self.lifetime = socket, stream_id, objective, lifetime
        self.providers = providers or LiveProviders()
        self.done = threading.Event()
        formats = {'pcm_24000': PCMCodec, 'virtual_pcm_24000': VirtualPCMCodec,
                   'telnyx_pcm_24000': TelnyxPCMCodec,'webrtc_pcm_24000':WebRTCPCMCodec}
        if audio_format not in formats:
            raise TelephonyError('Formato de audio telefónico no válido.')
        self.codec_type = formats[audio_format]
        self.codec = self.codec_type()
        self.playback = Playback(socket, stream_id, self.stopped,
                                 bytes_per_second=self.codec.bytes_per_second, packet_bytes=self.codec.packet_bytes)
        self.lock = threading.RLock()
        self.tasks = queue.Queue(maxsize=1)
        self.current = None
        self.history = []
        self.upstream = None
        self.worker = self.reader = None
        self.voice_ms = 0
        self.max_seconds = min(MAX_CALL_SECONDS, max_seconds) if max_seconds is not None else MAX_CALL_SECONDS
        self.safety = safety or CallSafety(max_seconds=self.max_seconds)
        self.user_speaking = False
        self.safety_worker = None
        self.max_turns = max_turns
        self.metrics = {'completed_turns':0, 'first_audio_after_final_ms':[], 'interrupted':0, 'failed':False,
                        'audio_ack_boundary':self.codec.ack_boundary}

    def stopped(self):
        return self.done.is_set() or self.lifetime.is_set()

    def interrupt(self):
        with self.lock:
            if self.current and not self.current.cancelled.is_set():
                self.current.cancelled.set()
                self.metrics['interrupted'] += 1
                self.playback.clear()

    def enqueue(self, text):
        if self.stopped():
            return
        self.interrupt()
        try:
            self.tasks.get_nowait()
        except queue.Empty:
            pass
        self.tasks.put_nowait(Turn(text))

    def _listen(self):
        from packages.providers.live_voice import MuseEvents
        events = MuseEvents()
        try:
            while not self.stopped():
                try:
                    raw = self.upstream.recv(timeout=.25)
                except TimeoutError:
                    continue
                if not isinstance(raw, str):
                    raise TelephonyError('Evento de Muse no válido.')
                event = events.accept(json.loads(raw))
                if event and event.get('type') == 'speech-start':
                    self.user_speaking = True
                    self.safety.user_voice()
                if event and event.get('type') == 'transcript':
                    if event.get('text', '').strip():
                        self.safety.user_voice()
                    if event.get('final'):
                        self.user_speaking = False
                if event and event.get('type') == 'transcript' and event.get('final'):
                    text = ' '.join(event.get('text', '').split())
                    if text:
                        if len(text) > 1200:
                            raise TelephonyError('Intervención demasiado larga.')
                        self.enqueue(text)
        except Exception as error:
            if not self.stopped():
                self.metrics['failed'] = True
                self.metrics['failure_stage'] = 'asr'
                self.metrics['failure_code'] = str(getattr(error,'code',type(error).__name__))[:64]
                self.done.set()

    @contextmanager
    def _speech(self, text, turn):
        finished=threading.Event()
        with self.providers.speak(text) as speech:
            def cancel():
                while not finished.wait(.05):
                    if turn.cancelled.is_set() or self.stopped():
                        speech.close()
                        return
            monitor=threading.Thread(target=cancel,daemon=True,name='phone-tts-cancel')
            monitor.start()
            try:
                yield speech
            finally:
                finished.set();monitor.join(.2)

    def _talk(self):
        try:
            while not self.stopped():
                try:
                    turn = self.tasks.get(timeout=.1)
                except queue.Empty:
                    continue
                with self.lock:
                    self.current = turn
                ending = bool(turn.text and turn.text.casefold().strip(' .,!¡¿?') in
                              {'adiós','adios','cuelga','termina la llamada','hasta luego'})
                if turn.text is None:
                    sentences = iter(['Hola, soy Melodi, la asistente virtual de Brivany. ¿Cómo estás?'])
                elif ending:
                    sentences = iter(['Hasta luego.'])
                else:
                    sentences = self.providers.sentences(self.objective, list(self.history), turn.text, turn.cancelled)
                total = 0
                codec = self.codec_type()
                try:
                    for text in sentences:
                        if self.stopped() or turn.cancelled.is_set():
                            break
                        if not isinstance(text, str) or not text.strip():
                            raise TelephonyError('Respuesta telefónica no válida.')
                        total += len(text)
                        if total>900:
                            raise TelephonyError('Respuesta telefónica demasiado larga.')
                        received=0
                        with self._speech(text, turn) as speech:
                            # Reuse the live PCM stream; begin sending before EOF.
                            while not self.stopped() and not turn.cancelled.is_set():
                                pcm = speech.read1(3840)
                                if not pcm:
                                    break
                                received+=len(pcm)
                                if received>1_440_000:
                                    raise TelephonyError('Frase de voz demasiado larga.')
                                encoded = codec.encode(pcm)
                                if not turn.first_audio and encoded:
                                    turn.first_audio = True
                                    if turn.text:
                                        self.metrics['first_audio_after_final_ms'].append(round((time.monotonic()-turn.started)*1000))
                                        self.metrics['first_audio_after_final_ms']=self.metrics['first_audio_after_final_ms'][-256:]
                                if not self.playback.audio(encoded, turn):
                                    break
                            if not turn.cancelled.is_set() and not self.stopped() and (not received or not speech.done):
                                raise TelephonyError('La frase de voz quedó incompleta.')
                        self.playback.sentence(turn, text)
                    self.playback.drain(turn)
                except Exception:
                    if not turn.cancelled.is_set() and not self.stopped():
                        raise
                finally:
                    close = getattr(sentences, 'close', None)
                    if close:
                        close()
                with self.lock:
                    if turn.text:
                        self.history.append(('user',turn.text))
                        if turn.acknowledged:
                            self.history.append(('assistant',' '.join(turn.acknowledged)))
                        self.history = self.history[-10:]
                        if not turn.cancelled.is_set():
                            self.metrics['completed_turns'] += 1
                    self.current = None
                if ending or self.max_turns is not None and self.metrics['completed_turns'] >= self.max_turns:
                    self.done.set()
        except Exception as error:
            if not self.stopped():
                self.metrics['failed'] = True
                self.metrics['failure_stage'] = 'reply'
                self.metrics['failure_code'] = str(getattr(error,'code',type(error).__name__))[:64]
                self.done.set()

    def check_safety(self):
        reason = self.safety.reason()
        if reason and not self.stopped():
            self.metrics['end_reason'] = reason
            self.done.set()
            # Independent of recognition, model generation and TTS workers.
            self.socket.close()
            return True
        return False

    def _watch_safety(self):
        while not self.done.wait(.1) and not self.lifetime.is_set():
            if self.check_safety():
                return

    def run(self):
        started = time.monotonic()
        sequence = 0
        try:
            if self.stopped():
                return
            self.safety.connected()
            self.safety_worker = threading.Thread(target=self._watch_safety, daemon=True, name='phone-safety')
            self.safety_worker.start()
            self.upstream = self.providers.listen()
            self.safety.ready(input=True)
            if self.stopped():
                return
            self.reader = threading.Thread(target=self._listen, daemon=True, name='phone-muse')
            self.worker = threading.Thread(target=self._talk, daemon=True, name='phone-reply')
            self.enqueue(None)
            self.reader.start(); self.worker.start()
            sent_samples = 0
            while not self.stopped():
                try:
                    raw = self.socket.recv(timeout=.25)
                except TimeoutError:
                    continue
                if not isinstance(raw,str) or len(raw)>16384:
                    raise TelephonyError('Paquete telefónico no válido.')
                message=json.loads(raw)
                if not isinstance(message,dict) or message.get('streamSid') != self.stream_id:
                    raise TelephonyError('El stream no coincide.')
                number=message.get('sequenceNumber','')
                if not isinstance(number,str) or not re.fullmatch(r'[0-9]{1,10}',number) or int(number)<=sequence:
                    raise TelephonyError('Orden de audio no válido.')
                sequence=int(number)
                event=message.get('event')
                if event=='stop' or event=='dtmf' and message.get('dtmf',{}).get('digit')=='0':
                    break
                if event=='mark':
                    name=message.get('mark',{}).get('name')
                    if isinstance(name,str) and len(name)<=64:
                        pending = self.playback.pending.get(name)
                        if pending and pending[0] > 0:
                            self.safety.ready(output=True)
                        self.playback.acknowledge(name)
                elif event=='media':
                    media=message.get('media',{})
                    if media.get('track')!='inbound' or not isinstance(media.get('payload'),str):
                        raise TelephonyError('Pista de audio no válida.')
                    data=base64.b64decode(media['payload'],validate=True)
                    if not 1<=len(data)<=self.codec.max_input_bytes:
                        raise TelephonyError('Audio telefónico fuera de límite.')
                    sent_samples+=len(data)
                    if sent_samples/self.codec.bytes_per_second>time.monotonic()-started+2:
                        raise TelephonyError('Audio telefónico acumulado.')
                    pcm,rms=self.codec.decode(data)
                    if self.user_speaking and rms >= 1400:
                        self.safety.user_voice()
                    self.voice_ms=self.voice_ms+len(data)*1000/self.codec.bytes_per_second if rms>=1400 else 0
                    if self.voice_ms>=240:
                        self.interrupt()
                    self.upstream.send(pcm)
        except Exception as error:
            if not self.stopped():
                self.metrics['failed']=True
                self.metrics['failure_stage']='transport'
                self.metrics['failure_code']=str(getattr(error,'code',type(error).__name__))[:64]
        finally:
            self.close()

    def close(self):
        self.done.set()
        with self.lock:
            if self.current:
                self.current.cancelled.set()
        with self.playback.condition:
            self.playback.condition.notify_all()
        if self.upstream:
            self.upstream.close()
        self.socket.close()
        for thread in (self.reader,self.worker,self.safety_worker):
            if thread and thread is not threading.current_thread():
                thread.join(3)
        self.history.clear()
