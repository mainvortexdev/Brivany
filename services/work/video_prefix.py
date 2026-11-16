"""A private, bounded cache of the first ten seconds of selected videos."""
from dataclasses import dataclass
import json
import math
import re
import secrets
import threading
import time

from websockets.exceptions import ConnectionClosed
from packages.providers.prefix_translation import PREFIX_MS, PREFIX_BYTES


DURATION_MS = PREFIX_MS
PCM_BYTES = PREFIX_BYTES
FRAME_BYTES = 3840
MAX_FRAMES = (PCM_BYTES + FRAME_BYTES - 1) // FRAME_BYTES
MAX_AGE = 600
MAX_OPENING_ANCHOR_MS = 800
ANCHOR_TOLERANCE_MS = 120
SOURCE = re.compile(r'(?:youtube:[A-Za-z0-9_-]{11}|video:[0-9a-f]{1,8})\Z')
PREPARATION_PHASES = frozenset({'content_gate_ms','translation_ms','asr_ms','turn_classification_ms','prosody_ms',
                              'local_timbre_ms','postprocess_ms','total_ms'})


@dataclass(frozen=True)
class Entry:
    id: str
    token: str
    source: str
    position_ms: int
    expires: float
    prepared: object
    capture_receive_ms: float | None = None


class VideoPrefixCache:
    def __init__(self, factory, *, clock=time.monotonic):
        self.factory = factory
        self.clock = clock
        self.lock = threading.Lock()
        self.entries = {}
        self.cancelled = None
        self.completed = 0
        self.reused = 0

    def clear(self):
        with self.lock:
            self.entries.clear()
            if self.cancelled:
                self.cancelled.set()

    def _expire(self):
        now = self.clock()
        for key in list(self.entries):
            if self.entries[key].expires <= now:
                del self.entries[key]

    def status(self):
        with self.lock:
            self._expire()
            return {'active': self.cancelled is not None, 'cached': len(self.entries),
                    'completed': self.completed, 'reused': self.reused}

    def take(self, *, token, identifier, source, position_ms):
        if (not isinstance(identifier, str) or not isinstance(source, str) or
                type(position_ms) is not int or not 0 <= position_ms <= MAX_OPENING_ANCHOR_MS + ANCHOR_TOLERANCE_MS):
            return None
        with self.lock:
            self._expire()
            key = next((key for key, entry in self.entries.items()
                        if entry.token == token and entry.source == source and entry.id == identifier), None)
            if key is None:
                return None
            entry = self.entries[key]
            if abs(entry.position_ms - position_ms) > ANCHOR_TOLERANCE_MS:return None
            self.reused += 1
            del self.entries[key]
            return entry.prepared

    @staticmethod
    def _send(socket, event):
        socket.send(json.dumps(event, ensure_ascii=False, allow_nan=False))

    def _ready(self, socket, entry):
        prepared = entry.prepared
        turns = []
        for turn in prepared.turns:
            row = {'start_ms':turn.start_ms, 'end_ms':turn.end_ms, 'speaker':turn.speaker,
                   'content':turn.content, 'text':'' if turn.content in ('singing','music') else turn.text}
            if turn.prosody:
                row.update(emotion=turn.prosody.emotion, confidence=turn.prosody.confidence,
                           voice_register=turn.prosody.voice_register, register_confidence=turn.prosody.register_confidence,
                           voice_timbre=turn.prosody.voice_timbre,timbre_confidence=turn.prosody.timbre_confidence)
            turns.append(row)
        metrics = {}
        for row in getattr(prepared,'preparation_metrics',()):
            if not isinstance(row,tuple) or len(row)!=2:continue
            name,value=row
            if isinstance(name,str) and name in PREPARATION_PHASES and type(value) in (int,float) and math.isfinite(value) and 0<=value<=60000:
                metrics[name]=value
        if type(entry.capture_receive_ms) in (int,float) and math.isfinite(entry.capture_receive_ms) and 0<=entry.capture_receive_ms<=12000:
            metrics['capture_receive_ms']=entry.capture_receive_ms
        self._send(socket, {'type':'prefix-ready', 'prefix_id':entry.id, 'position_ms':entry.position_ms,
                           'duration_ms':prepared.duration_ms, 'resume_from_ms':prepared.resume_from_ms,
                           'turns':turns, 'preparation_metrics':metrics})

    def handle(self, socket, token):
        raw = socket.recv(timeout=4)
        options = json.loads(raw) if isinstance(raw, str) else None
        if not isinstance(options, dict) or set(options)-{'type','source','position_ms','generation'} or options.get('type') != 'prepare-video':
            raise ValueError('Solicitud de preparación no válida.')
        source, position_ms = options.get('source'), options.get('position_ms')
        generation = options.get('generation','')
        if not isinstance(generation,str) or generation and not re.fullmatch(r'[A-Za-z0-9_-]{16,64}',generation):
            raise ValueError('Identificador de preparación no válido.')
        if not isinstance(source, str) or not SOURCE.fullmatch(source) or type(position_ms) is not int or not 0 <= position_ms <= MAX_OPENING_ANCHOR_MS:
            raise ValueError('La preparación requiere el principio de un video elegible.')
        key = (token, source, generation)
        with self.lock:
            self._expire()
            entry = self.entries.get(key)
            busy = self.cancelled is not None
            cancelled = threading.Event()
            if entry is None and not busy:
                self.cancelled = cancelled
        if entry:
            self._ready(socket, entry)
            return
        if busy:
            self._send(socket, {'type':'error','code':'prefix_busy','message':'Ya se está preparando otro video.'})
            return

        worker = None
        try:
            self._send(socket, {'type':'prefix-capture','duration_ms':DURATION_MS,'sample_rate':24000,'input_frame_ms':80})
            pcm = bytearray()
            started = time.monotonic()
            while not cancelled.is_set():
                remaining = 12 - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError('La captura inicial superó su plazo.')
                packet = socket.recv(timeout=remaining)
                if isinstance(packet, str) and json.loads(packet) == {'type':'finish'}:
                    break
                if not isinstance(packet, bytes) or len(packet) != FRAME_BYTES or len(pcm) >= MAX_FRAMES * FRAME_BYTES:
                    raise ValueError('Audio de preparación inválido.')
                pcm.extend(packet)
            if cancelled.is_set():
                return
            if len(pcm) != MAX_FRAMES * FRAME_BYTES:
                raise ValueError('No se recibieron los siete segundos de audio.')
            capture_receive_ms=round((time.monotonic()-started)*1000,3)

            result = []
            finished = threading.Event()
            def prepare():
                try:
                    result.append((self.factory(bytes(pcm[:PCM_BYTES]), cancelled=cancelled), None))
                except Exception as error:
                    code=getattr(error,'code',None)
                    safe=code if isinstance(code,str) and re.fullmatch(r'prefix_[a-z0-9_]{1,40}',code) else 'prefix_unavailable'
                    result.append((None,safe))
                finally:
                    finished.set()

            worker = threading.Thread(target=prepare, name='brivany-video-prefix', daemon=True)
            worker.start()
            while not finished.is_set() and not cancelled.is_set():
                try:
                    socket.recv(timeout=.1)
                except TimeoutError:
                    continue
                cancelled.set()
            if cancelled.is_set():
                return
            prepared, error = result[0]
            if prepared is None:
                self._send(socket, {'type':'error','code':error,'message':'No se pudo preparar la transcripción inicial.'})
                return
            entry = Entry(secrets.token_urlsafe(24), token, source, position_ms, self.clock() + MAX_AGE, prepared,capture_receive_ms)
            with self.lock:
                if cancelled.is_set():
                    return
                self._expire()
                while len(self.entries) >= 6:
                    del self.entries[next(iter(self.entries))]
                self.entries[key] = entry
                self.completed += 1
            self._ready(socket, entry)
        except ConnectionClosed:
            pass
        finally:
            cancelled.set()
            if worker:
                worker.join()
            with self.lock:
                self.cancelled = None
