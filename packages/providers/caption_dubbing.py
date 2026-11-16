"""Caption-scheduled dubbing: translate and voice ahead, play on the video's clock.

The silent Brave extension supplies the video's captions (with word onsets) and
its playback position. While Directa runs, this scheduler:

1. translates captions that start within the next ``LOOKAHEAD`` seconds,
2. synthesizes each one ``SYNTH_LEAD`` seconds before it is spoken, with the
   voice of the speaker currently heard (clone when ready),
3. hands the PCM to the output so it starts when the video reaches the
   caption's start, compensating the mixer's queue lead.

So when the original says "chocolate" at 42.0 s, the translation starts at
42.0 s too, instead of after recognition + translation + synthesis. Text and
audio stay in memory; nothing is stored. Live recognition keeps running for
speaker identity and cloning; its own voice is suppressed while this is active.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import math
import re
import threading
import time

LOOKAHEAD = 8.0          # seconds of captions translated ahead
SYNTH_LEAD = 2.2         # start synthesis this long before the caption
OUTPUT_LEAD = .24        # NativeMixer keeps a 240 ms translation queue
LATE_LIMIT = .8          # a caption reached later than this is skipped
STALE_AFTER = 1.6        # no clock update while playing -> inactive
SEEK_JUMP = 1.5          # position jump that means a seek
WORDS_PER_SECOND = 2.8   # natural pace guidance for the target voice
MAX_SPEED = 1.3
CHUNK_BYTES = 24000 * 2 * 2   # 2 s pushes (mixer accepts up to 3 s)
MAX_COMPRESSION = 1.5    # pitch-preserving speed-up to fit a caption's slot
SAMPLE_RATE = 24000


def time_compress(pcm, ratio):
    """Shorten speech by ``ratio`` keeping pitch (WSOLA overlap-add).

    20 ms Hann frames, 10 ms synthesis hop, ±5 ms similarity search so the
    waveform stays continuous. Returns PCM16 mono bytes.
    """
    import numpy as np
    if ratio <= 1.01 or len(pcm) < 4800:
        return pcm
    x = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype='<i2').astype(np.float32)
    frame, hop, search = 480, 240, 120
    window = np.hanning(frame).astype(np.float32)
    analysis = hop * ratio
    out_len = int(len(x) / ratio) + frame
    y = np.zeros(out_len + frame, dtype=np.float32); norm = np.zeros_like(y)
    previous = None; k = 0
    while True:
        center = int(round(k * analysis)); out = k * hop
        if center + frame + search >= len(x) or out + frame >= len(y):
            break
        if previous is None:
            start = center
        else:
            low, high = max(0, center - search), min(len(x) - frame, center + search)
            # Choose the shift whose frame best continues the previous output.
            target = previous
            best, start = -1e30, center
            for candidate in range(low, high + 1, 8):
                score = float(np.dot(x[candidate:candidate + hop], target))
                if score > best:
                    best, start = score, candidate
        piece = x[start:start + frame] * window
        y[out:out + frame] += piece; norm[out:out + frame] += window
        previous = x[start + hop:start + hop + hop]
        if len(previous) < hop:
            break
        k += 1
    norm[norm < 1e-3] = 1.
    result = (y / norm)[:max(0, k * hop + hop)]
    return np.clip(result, -32768, 32767).astype('<i2').tobytes()


def spoken_words(text):
    return len(re.findall(r"\w+(?:['’]\w+)*", text or '', flags=re.UNICODE))


def delivery_speed(text, seconds):
    """Speed guidance so a translation fits its caption, never slower than 1."""
    if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= .2:
        return 1.
    needed = spoken_words(text) / seconds
    return round(min(MAX_SPEED, max(1., needed / WORDS_PER_SECOND)), 3)


class _Unit:
    __slots__ = ('key', 'start', 'end', 'text', 'translation', 'pcm', 'state', 'voice')

    def __init__(self, cue):
        self.start = float(cue['start']); self.end = float(cue['end']); self.text = cue['text']
        words = cue.get('words') or []
        # Start on the first spoken word, not the caption's display time.
        if words:
            self.start = max(self.start, min(float(w[0]) for w in words))
        self.key = (round(self.start * 1000), self.text)
        self.translation = None; self.pcm = None; self.state = 'new'; self.voice = None


class CaptionDubbing:
    def __init__(self, timeline_source, *, target, translator_factory, synthesizer, output_getter,
                 voice_hint=lambda: None, clock=time.monotonic, on_stage=lambda *_a, **_k: None):
        if target not in ('es', 'en', 'fr'):
            raise ValueError('Idioma de doblaje no válido.')
        self.timeline_source = timeline_source; self.target = target
        self.translator_factory = translator_factory; self.synthesizer = synthesizer
        self.output_getter = output_getter; self.voice_hint = voice_hint; self.clock = clock; self.on_stage = on_stage
        self.lock = threading.RLock(); self.stopped = threading.Event(); self.units = {}
        self.revision = None; self.last_position = None; self.generation = 0; self.is_active = False
        self.translations = ThreadPoolExecutor(max_workers=2, thread_name_prefix='brivany-caption-mt')
        self.synthesis = ThreadPoolExecutor(max_workers=1, thread_name_prefix='brivany-caption-tts')
        self.playback = []; self.playback_ready = threading.Condition(self.lock)
        self.player = threading.Thread(target=self._player, daemon=True, name='brivany-caption-player')
        self.translators = threading.local(); self.counts = {'translated': 0, 'synthesized': 0, 'played': 0, 'skipped_late': 0, 'seeks': 0}
        self.thread = threading.Thread(target=self._run, daemon=True, name='brivany-caption-dubbing')

    # -- public ---------------------------------------------------------
    def start(self):
        self.thread.start(); self.player.start(); return self

    def close(self):
        self.stopped.set()
        self.translations.shutdown(wait=False, cancel_futures=True)
        self.synthesis.shutdown(wait=False, cancel_futures=True)
        closer = getattr(self.synthesizer, 'close', None)
        if callable(closer):
            try:
                closer()
            except Exception:
                pass

    def active(self):
        """True while captions drive the voice (live voice must stay silent)."""
        with self.lock:
            return self.is_active and not self.stopped.is_set()

    def status(self):
        with self.lock:
            return {'active': self.is_active, **self.counts, 'scheduled': sum(u.state == 'ready' for u in self.units.values())}

    # -- clock ----------------------------------------------------------
    def _now(self, timeline):
        position = float(timeline['position'])
        if timeline.get('paused'):
            return position, True
        age = self.clock() - float(timeline['position_at'])
        return position + age, age <= STALE_AFTER

    # -- loop -----------------------------------------------------------
    def _run(self):
        while not self.stopped.wait(.04):
            try:
                self._tick()
            except Exception:
                with self.lock:
                    self.is_active = False

    def _tick(self):
        timeline = self.timeline_source()
        if not timeline or not timeline.get('cues'):
            with self.lock:
                self.is_active = False
            return
        now, fresh = self._now(timeline)
        paused = bool(timeline.get('paused'))
        with self.lock:
            if self.last_position is not None and (now < self.last_position - .3 or now > self.last_position + SEEK_JUMP):
                self._reset('seek')
            self.last_position = now
            if timeline.get('revision') != self.revision:
                self.revision = timeline.get('revision')
                for cue in timeline['cues']:
                    unit = _Unit(cue)
                    self.units.setdefault(unit.key, unit)
            near = [u for u in self.units.values() if u.end > now - .5 and u.start < now + 3]
            self.is_active = fresh and not paused and bool(near)
            if paused or not fresh:
                return
            generation = self.generation
            for unit in sorted(self.units.values(), key=lambda u: u.start):
                if unit.start > now + LOOKAHEAD:
                    break
                if unit.end < now - .5 or unit.state in ('skipped', 'played'):
                    continue
                if unit.state == 'new' and unit.start >= now - .2:
                    unit.state = 'translating'
                    self.translations.submit(self._translate, unit, generation)
                elif unit.state == 'translated' and unit.start - now <= SYNTH_LEAD:
                    unit.state = 'synthesizing'
                    unit.voice = self.voice_hint()
                    self.synthesis.submit(self._synthesize, unit, generation)
                elif unit.state == 'ready' and now >= unit.start - OUTPUT_LEAD:
                    if now > unit.start + LATE_LIMIT:
                        unit.state = 'skipped'; self.counts['skipped_late'] += 1
                        self.on_stage('caption_dub_late', start=unit.start, late_ms=round((now - unit.start) * 1000))
                        continue
                    unit.state = 'playing'
                    self.playback.append((unit, generation)); self.playback_ready.notify_all()

    def _slot(self, unit):
        """Seconds available until the next caption starts (at least its own span)."""
        later = [u.start for u in self.units.values() if u.start > unit.start + .05]
        until_next = (min(later) - unit.start) if later else (unit.end - unit.start + 1.)
        return max(.4, min(until_next, 30.))

    def _player(self):
        """One output producer: captions never overlap or interleave."""
        while not self.stopped.is_set():
            with self.lock:
                while not self.playback and not self.stopped.is_set():
                    self.playback_ready.wait(.1)
                if self.stopped.is_set():
                    return
                unit, generation = self.playback.pop(0)
            self._play(unit, generation)

    def _reset(self, reason):
        # After a seek every caption may be heard again: keep translations (no
        # new request), drop prepared audio (voice/timing may differ now).
        self.generation += 1; self.counts['seeks'] += 1; self.playback.clear()
        for unit in self.units.values():
            unit.pcm = None
            if unit.state != 'translating':  # its in-flight result is still valid
                unit.state = 'translated' if unit.translation else 'new'
        output = self.output_getter()
        flush = getattr(output, 'flush_translation', None)
        if callable(flush):
            try:
                flush()
            except Exception:
                pass
        self.on_stage('caption_dub_reset', reason=reason)

    # -- workers --------------------------------------------------------
    def _translator(self):
        translator = getattr(self.translators, 'value', None)
        if translator is None:
            translator = self.translators.value = self.translator_factory()
        return translator

    def _translate(self, unit, generation):
        if self.stopped.is_set():
            return
        started = self.clock()
        try:
            translator = self._translator()
            seconds = max(.3, unit.end - unit.start)
            # Auto captions cut sentences mid-way and carry no punctuation:
            # the two previous phrases resolve meaning (they are not spoken).
            with self.lock:
                earlier = sorted((u for u in self.units.values() if u.start < unit.start), key=lambda u: u.start)[-2:]
            context = [{'source_text': u.text} for u in earlier]
            stream = getattr(translator, 'stream_for_duration', None)
            deltas = stream(unit.text, self.target, context, duration_ms=max(1, min(30000, round(seconds * 1000)))) if callable(stream) \
                else translator.stream(unit.text, self.target, context)
            text = ' '.join(''.join(deltas).split())
        except Exception:
            text = ''
        with self.lock:
            # A translation does not depend on timing: keep it across seeks.
            unit.translation = text or None
            if unit.state == 'translating':
                unit.state = 'translated' if text else 'skipped'
            if text:
                self.counts['translated'] += 1
        self.on_stage('caption_dub_translated', start=unit.start, ms=round((self.clock() - started) * 1000), ok=bool(text))

    def _synthesize(self, unit, generation):
        if self.stopped.is_set():
            return
        started = self.clock()
        try:
            speed = delivery_speed(unit.translation, unit.end - unit.start)
            pcm = self.synthesizer(unit.translation, voice=unit.voice, language=self.target, speed=speed)
            if pcm:
                from .dubbing_audio import trim_synthesis_padding
                pcm = trim_synthesis_padding(pcm[:len(pcm) // 2 * 2])[0]
                with self.lock:
                    slot = self._slot(unit)
                seconds = len(pcm) / (2 * SAMPLE_RATE)
                if seconds > slot * 1.02:
                    pcm = time_compress(pcm, min(MAX_COMPRESSION, seconds / slot))
        except Exception:
            pcm = None
        with self.lock:
            if generation != self.generation:
                if unit.state == 'synthesizing':
                    unit.state = 'translated'
                return
            if not pcm:
                unit.state = 'skipped'; return
            unit.pcm = pcm; unit.state = 'ready'; self.counts['synthesized'] += 1
        self.on_stage('caption_dub_ready', start=unit.start, ms=round((self.clock() - started) * 1000),
                      audio_ms=round(len(pcm) / 48))

    def _play(self, unit, generation):
        output = self.output_getter()
        if output is None:
            with self.lock:
                unit.state = 'skipped'
            return
        pcm = unit.pcm or b''
        for offset in range(0, len(pcm), CHUNK_BYTES):
            with self.lock:
                if generation != self.generation or self.stopped.is_set():
                    return
            chunk = pcm[offset:offset + CHUNK_BYTES]
            if len(chunk) % 2:
                chunk = chunk[:-1]
            if not chunk:
                break
            try:
                if not output.push_translation_paced(chunk, stopped=self.stopped, timeout=6):
                    return
            except Exception:
                return
        with self.lock:
            if generation == self.generation:
                unit.state = 'played'; unit.pcm = None; self.counts['played'] += 1
        self.on_stage('caption_dub_played', start=unit.start)


class CartesiaSynthesizer:
    """One Sonic WebSocket, one complete context per caption (raw PCM 24 kHz)."""

    def __init__(self, *, connect=None, url=None, model=None, key=None, default_voice=None):
        import os
        from websockets.sync.client import connect as ws_connect
        from .river_translation import CARTESIA_URL, SONIC_MODEL, VOICES
        self.connect = connect or ws_connect; self.url = url or CARTESIA_URL; self.model = model or SONIC_MODEL
        self.key = key if key is not None else os.environ.get('BRIVANY_CARTESIA_API_KEY', '')
        self.default_voice = default_voice or VOICES['low']; self.socket = None; self.lock = threading.Lock(); self.count = 0

    def _socket(self):
        if self.socket is None:
            self.socket = self.connect(self.url, additional_headers={'X-API-Key': self.key}, open_timeout=5,
                                       close_timeout=1, max_size=2 ** 22, compression=None, proxy=None)
        return self.socket

    def __call__(self, text, *, voice=None, language='es', speed=1.):
        import base64
        import json
        with self.lock:
            self.count += 1; context = f'caption-{self.count}'
            request = {'model_id': self.model, 'transcript': text, 'voice': voice or self.default_voice,
                       'language': language, 'context_id': context, 'continue': False, 'max_buffer_delay_ms': 0,
                       'output_format': {'container': 'raw', 'encoding': 'pcm_s16le', 'sample_rate': 24000}}
            if speed > 1:
                request['generation_config'] = {'speed': speed}
            try:
                socket = self._socket(); socket.send(json.dumps(request)); pcm = b''
                while True:
                    event = json.loads(socket.recv(timeout=10))
                    if event.get('context_id') not in (None, context):
                        continue
                    if event.get('type') == 'error':
                        raise ValueError('Cartesia rechazó la voz del subtítulo.')
                    if event.get('type') == 'chunk' and event.get('data'):
                        pcm += base64.b64decode(event['data'])
                    if event.get('done') or event.get('type') == 'done':
                        return pcm
            except Exception:
                self.close()
                raise

    def close(self):
        socket, self.socket = self.socket, None
        if socket is not None:
            try:
                socket.close()
            except Exception:
                pass
