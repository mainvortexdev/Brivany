"""Cartesia Ink-2 streaming STT behind the Muse event shape River consumes.

River's direct translation reads Muse events (speechStart, cumulative
transcript partials, speechComplete). This adapter opens Cartesia's turn
WebSocket (`/stt/turns/websocket`, model `ink-2`) and translates its events:

    turn.start  -> speechStart      {turnId, audioProcessedMs}
    turn.update -> transcript       {transcript (cumulative), audioProcessedMs}
    turn.end    -> speechComplete   {turnId, transcript, audioProcessedMs}

`turn.eager_end` is ignored: in the 2026-11-11 trial `turn.end` followed it by
80-110 ms, and finalizing early would drop speech after a `turn.resume`.
Ink-2 reports no timestamps or speaker labels; `audioProcessedMs` is the audio
position sent when the event arrived (an upper bound, adequate for direct
capture, not for synchronized video). Speakers come from local clustering.
No audio or text is stored.
"""
import json
import os
import queue
import threading
import time
from urllib.parse import urlencode

from websockets.exceptions import ConnectionClosedOK

INK_URL = 'wss://api.cartesia.ai/stt/turns/websocket'
INK_MODEL = 'ink-2'
CARTESIA_VERSION = '2026-08-14'
INK_LANGUAGES = frozenset({'en', 'es', 'fr', 'hi', 'ja'})
DRAIN_SECONDS = 4


def ink_url(sample_rate=24000):
    return INK_URL + '?' + urlencode({'model': INK_MODEL, 'encoding': 'pcm_s16le', 'sample_rate': sample_rate,
                                      'cartesia_version': CARTESIA_VERSION})


class InkAsrSocket:
    """Duck-types the subset of a websockets connection River uses for Muse."""

    def __init__(self, *, connector=None, key=None, open_timeout=5):
        if connector is None:
            from websockets.sync.client import connect as connector
        key = (key if key is not None else os.environ.get('BRIVANY_CARTESIA_API_KEY', '')).strip()
        if not key:
            raise ValueError('Configura Cartesia para usar Ink-2.')
        self.socket = connector(ink_url(), additional_headers={'X-API-Key': key}, open_timeout=open_timeout,
                                close_timeout=1, max_size=262144, max_queue=16, compression=None, proxy=None)
        self.events = queue.Queue(maxsize=256)
        self.frames = 0
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.turn = 0
        self.open_turn = False
        self.ending = False
        self.reader = threading.Thread(target=self._read, daemon=True, name='brivany-ink-asr')
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
            # The turns endpoint rejects a "finalize" command (real trial
            # 2026-11-11: error and lost last clause). River already sent
            # trailing silence, so wait for the open turn to end, then close.
            self.ending = True
            threading.Thread(target=self._drain, daemon=True, name='brivany-ink-drain').start()
            return
        # Muse handshake: Ink is configured by URL; acknowledge locally.
        self._put({'sessionId': 'ink-local'})

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
            self.socket.close()
        except Exception:
            pass

    def _drain(self, limit=DRAIN_SECONDS):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline and self.open_turn and not self.closed.is_set():
            time.sleep(.05)
        self._put(None)

    # -- Ink side ---------------------------------------------------------
    def _position_ms(self):
        with self.lock:
            return round(self.frames / 24, 2)

    def _put(self, event):
        try:
            self.events.put_nowait(json.dumps(event) if event is not None else None)
        except queue.Full:
            pass  # River fails on its own ingress limits; never block the reader.

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

    def translate(self, event):
        """Pure mapping of one Ink event to zero or more Muse-shaped events."""
        if not isinstance(event, dict):
            return []
        kind = event.get('type'); at = self._position_ms()
        turn = event.get('turn_id')
        if kind == 'error':
            if self.ending:
                return []  # Closing: never turn shutdown noise into a failure.
            return [{'type': 'error', 'message': str(event.get('message') or event.get('error') or 'Ink-2')[:300]}]
        if kind == 'turn.start':
            self.turn += 1; self.open_turn = True
            return [{'type': 'speechStart', 'turnId': str(turn if turn is not None else self.turn), 'audioProcessedMs': at}]
        text = event.get('transcript')
        if not isinstance(text, str):
            return []
        if kind == 'turn.update':
            return [{'type': 'transcript', 'transcript': text, 'audioProcessedMs': at}]
        if kind == 'turn.end':
            self.open_turn = False
            return [{'type': 'speechComplete', 'turnId': str(turn if turn is not None else self.turn),
                     'transcript': text, 'audioProcessedMs': at}]
        return []
