"""Deepgram streaming STT (Nova-3) behind the Muse event shape River consumes.

Same contract as `ink_asr.InkAsrSocket`. Deepgram's live endpoint sends
`Results` with interim text for the current stretch (`is_final` closes a
stretch, `speech_final` / `UtteranceEnd` close the utterance). River expects
cumulative partials per turn, so a turn's text is its finalized stretches plus
the latest interim:

    first words / SpeechStarted     -> speechStart     {turnId, audioProcessedMs}
    Results (interim or is_final)   -> transcript      {transcript (cumulative), audioProcessedMs}
    speech_final / UtteranceEnd     -> speechComplete  {turnId, transcript, audioProcessedMs}

`audioProcessedMs` is the end of the reported words in the sent audio
(Deepgram's `start + duration`). No speaker labels are used: speakers come from
local clustering. No audio or text is stored.
"""
from packages.providers.provider_access import endpoint,demo_headers
import json
import os
import queue
import threading
import time
from urllib.parse import urlencode

from websockets.exceptions import ConnectionClosedOK

DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen'
DEEPGRAM_MODEL = 'nova-3'
DRAIN_SECONDS = 4


def deepgram_key():
    return os.environ.get('BRIVANY_DEEPGRAM_API_KEY', '').strip()


def deepgram_url(sample_rate=24000, language='multi'):
    return DEEPGRAM_URL + '?' + urlencode({
        'model': DEEPGRAM_MODEL, 'language': language, 'encoding': 'linear16', 'sample_rate': sample_rate,
        'channels': 1, 'interim_results': 'true', 'punctuate': 'true', 'endpointing': 300,
        'utterance_end_ms': 1000, 'vad_events': 'true'})


class DeepgramAsrSocket:
    """Duck-types the subset of a websockets connection River uses for Muse."""

    def __init__(self, *, connector=None, key=None, open_timeout=5, language=None):
        if connector is None:
            from websockets.sync.client import connect as connector
        key = (key if key is not None else deepgram_key()).strip()
        if not key:
            raise ValueError('Configura Deepgram para usar su transcripción.')
        language = language or os.environ.get('BRIVANY_DEEPGRAM_LANGUAGE', 'multi').strip() or 'multi'
        self.socket = connector(endpoint(deepgram_url(language=language)), additional_headers=demo_headers({'Authorization': 'Token ' + key}),
                                open_timeout=open_timeout, close_timeout=1, max_size=262144, max_queue=16,
                                compression=None, proxy=None,
                                # Audio flows continuously; a client ping timing out
                                # under load closed the stream (real trial 2026-11-11).
                                ping_interval=None)
        self.events = queue.Queue(maxsize=256)
        self.frames = 0
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.turn = 0
        self.open_turn = False
        self.finalized = ''
        self.ending = False
        self.reader = threading.Thread(target=self._read, daemon=True, name='brivany-deepgram-asr')
        self.reader.start()

    # -- River side -------------------------------------------------------
    def send(self, data):
        if isinstance(data, (bytes, bytearray)):
            with self.lock:
                self.frames += len(data) // 2
            self.socket.send(bytes(data))
            return
        message = json.loads(data)
        if isinstance(message, dict) and message.get('type') == 'endStream':
            self.ending = True
            try:
                self.socket.send(json.dumps({'type': 'Finalize'}))
            except Exception:
                pass
            threading.Thread(target=self._drain, daemon=True, name='brivany-deepgram-drain').start()
            return
        self._put({'sessionId': 'deepgram-local'})  # Muse handshake: configured by URL.

    def recv(self, timeout=None):
        try:
            item = self.events.get(timeout=timeout)
        except queue.Empty:
            if self.closed.is_set():
                raise ConnectionClosedOK(None, None) from None
            raise TimeoutError() from None
        if item is None:
            raise ConnectionClosedOK(None, None)
        return item

    def close(self):
        self.closed.set()
        try:
            self.socket.send(json.dumps({'type': 'CloseStream'}))
        except Exception:
            pass
        try:
            self.socket.close()
        except Exception:
            pass

    def _drain(self, limit=DRAIN_SECONDS):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline and self.open_turn and not self.closed.is_set():
            time.sleep(.05)
        if self.open_turn:
            for event in self._complete(self._position_ms()):
                self._put(event)
        self._put(None)

    # -- Deepgram side ----------------------------------------------------
    def _position_ms(self):
        with self.lock:
            return round(self.frames / 24, 2)

    def _put(self, event):
        try:
            self.events.put_nowait(json.dumps(event) if event is not None else None)
        except queue.Full:
            pass

    def _read(self):
        try:
            for raw in self.socket:
                if not isinstance(raw, str):
                    continue
                for event in self.translate(json.loads(raw)):
                    self._put(event)
        except Exception:
            pass
        finally:
            self.closed.set()
            self._put(None)

    def _start(self, at):
        self.turn += 1; self.open_turn = True; self.finalized = ''
        return {'type': 'speechStart', 'turnId': str(self.turn), 'audioProcessedMs': at}

    def _complete(self, at):
        text = self.finalized.strip(); self.open_turn = False; self.finalized = ''
        return [{'type': 'speechComplete', 'turnId': str(self.turn), 'transcript': text, 'audioProcessedMs': at}]

    def translate(self, event):
        """Pure mapping of one Deepgram event to zero or more Muse-shaped events."""
        if not isinstance(event, dict):
            return []
        kind = event.get('type')
        if kind == 'Results':
            try:
                text = ' '.join(str(event['channel']['alternatives'][0].get('transcript') or '').split())
            except (KeyError, IndexError, TypeError, AttributeError):
                return []
            start, duration = event.get('start'), event.get('duration')
            at = round((start + duration) * 1000, 2) if all(type(v) in (int, float) for v in (start, duration)) else self._position_ms()
            out = []
            if text and not self.open_turn:
                out.append(self._start(round(start * 1000, 2) if type(start) in (int, float) else at))
            if not self.open_turn:
                return out
            current = (self.finalized + ' ' + text).strip()
            if text:
                out.append({'type': 'transcript', 'transcript': current, 'audioProcessedMs': at})
            if event.get('is_final'):
                self.finalized = current
                if event.get('speech_final') and self.finalized:
                    out.extend(self._complete(at))
            return out
        if kind == 'UtteranceEnd':
            if self.open_turn and self.finalized:
                return self._complete(self._position_ms())
            return []
        if kind == 'Error' or kind == 'error':
            if self.ending:
                return []
            return [{'type': 'error', 'message': str(event.get('description') or event.get('message') or 'Deepgram')[:300]}]
        return []


FLUX_URL = 'wss://api.deepgram.com/v2/listen'
FLUX_MODEL = 'flux-general-en'


class DeepgramFluxSocket(DeepgramAsrSocket):
    """Deepgram Flux (English, turn-based): cumulative TurnInfo per turn.

        TurnInfo StartOfTurn            -> speechStart
        TurnInfo Update / TurnResumed   -> transcript (cumulative)
        TurnInfo EndOfTurn              -> speechComplete
    EagerEndOfTurn is treated as an update (a resume may follow).
    """

    def __init__(self, *, connector=None, key=None, open_timeout=5, language=None):
        if connector is None:
            from websockets.sync.client import connect as connector
        def flux_connector(_url, **options):
            url = FLUX_URL + '?' + urlencode({'model': FLUX_MODEL, 'encoding': 'linear16', 'sample_rate': 24000})
            return connector(endpoint(url), **options)
        super().__init__(connector=flux_connector, key=key, open_timeout=open_timeout, language=language)

    def translate(self, event):
        if not isinstance(event, dict):
            return []
        kind = event.get('type')
        if kind in ('Error', 'error', 'FatalError'):
            if self.ending:
                return []
            return [{'type': 'error', 'message': str(event.get('description') or event.get('message') or 'Deepgram Flux')[:300]}]
        if kind != 'TurnInfo':
            return []
        name = event.get('event'); text = ' '.join(str(event.get('transcript') or '').split())
        end = event.get('audio_window_end')
        at = round(end * 1000, 2) if type(end) in (int, float) else self._position_ms()
        out = []
        if name == 'StartOfTurn' or (text and not self.open_turn and name in ('Update', 'TurnResumed', 'EagerEndOfTurn')):
            if not self.open_turn:
                start = event.get('audio_window_start')
                out.append(self._start(round(start * 1000, 2) if type(start) in (int, float) else at))
        if not self.open_turn:
            return out
        if name in ('Update', 'TurnResumed', 'EagerEndOfTurn', 'StartOfTurn') and text:
            self.finalized = text
            out.append({'type': 'transcript', 'transcript': text, 'audioProcessedMs': at})
        elif name == 'EndOfTurn':
            if text:
                self.finalized = text
            out.extend(self._complete(at))
        return out
