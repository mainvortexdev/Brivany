"""Telnyx PCMU/8 kHz WebSocket media ↔ Melodi mono PCM16/24 kHz.

Audio stays in bounded memory. A returned mark means Telnyx reports playback
completion, not that a human heard it. Clearing also clears resampler history.
"""
import asyncio
import base64
import json
import queue
import threading

from .common import TelephonyError


def decode_mulaw(data):
    from array import array
    import sys
    samples = array('h')
    for byte in data:
        code = byte ^ 255
        magnitude = (((code & 15) << 3) + 132) << ((code >> 4) & 7)
        samples.append(132 - magnitude if code & 128 else magnitude - 132)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples.tobytes()


def encode_mulaw(pcm):
    from array import array
    import sys
    if len(pcm) % 2:
        raise TelephonyError('PCM incompleto.')
    samples = array('h')
    samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    encoded = bytearray()
    for sample in samples:
        value = sample >> 2
        mask = 127 if value < 0 else 255
        value = min(abs(value), 8158) + 33
        segment = max(0, value.bit_length() - 6)
        encoded.append(((segment << 4) | ((value >> (segment + 1)) & 15)) ^ mask)
    return bytes(encoded)


class PhoneResampler:
    def __init__(self):
        import soxr
        self.receive = soxr.ResampleStream(8000, 24000, 1, 'int16', quality='LQ')
        self.reset_transmit()

    def reset_transmit(self):
        import soxr
        self.transmit = soxr.ResampleStream(24000, 8000, 1, 'int16', quality='LQ')

    def decode(self, payload):
        import numpy as np
        data = base64.b64decode(payload, validate=True)
        if not 0 < len(data) <= 1600:
            raise TelephonyError('Bloque PCMU fuera de límite.')
        return self.receive.resample_chunk(np.frombuffer(decode_mulaw(data), dtype='<i2')).astype('<i2').tobytes()

    def encode(self, pcm):
        import numpy as np
        if not 0 < len(pcm) <= 9600 or len(pcm) % 2:
            raise TelephonyError('Bloque PCM fuera de límite.')
        result = self.transmit.resample_chunk(np.frombuffer(pcm, dtype='<i2')).astype('<i2').tobytes()
        return encode_mulaw(result)


class TelnyxMediaTransport:
    def __init__(self, websocket, loop, stream_id):
        self.websocket, self.loop, self.stream_id = websocket, loop, stream_id
        self.incoming = queue.Queue(maxsize=256)
        self.sequence = 0
        self.closed = threading.Event()
        self.resampler = PhoneResampler()
        self.send_lock = threading.RLock()
        self.metrics = {'received_media_packets': 0, 'sent_media_packets': 0, 'marks_received': 0}

    def _event(self, kind, **fields):
        self.sequence += 1
        try:
            self.incoming.put_nowait(json.dumps({'event': kind, 'streamSid': self.stream_id,
                                                'sequenceNumber': str(self.sequence), **fields}))
        except queue.Full:
            raise TelephonyError('La entrada de audio se acumuló.') from None

    def feed(self, event):
        kind = event.get('event')
        if kind == 'media':
            media = event.get('media') or {}
            if media.get('track') != 'inbound' or not isinstance(media.get('payload'), str):
                raise TelephonyError('Pista Telnyx no válida.')
            pcm = self.resampler.decode(media['payload'])
            if pcm:
                self._event('media', media={'track': 'inbound', 'payload': base64.b64encode(pcm).decode()})
            self.metrics['received_media_packets'] += 1
        elif kind == 'mark':
            name = (event.get('mark') or {}).get('name')
            if not isinstance(name, str) or len(name) > 64:
                raise TelephonyError('Acuse Telnyx no válido.')
            self._event('mark', mark={'name': name})
            self.metrics['marks_received'] += 1
        elif kind == 'dtmf':
            self._event('dtmf', dtmf={'digit': (event.get('dtmf') or {}).get('digit')})
        elif kind == 'stop':
            self._event('stop')

    def recv(self, timeout=.25):
        try:
            return self.incoming.get(timeout=timeout)
        except queue.Empty:
            if self.closed.is_set():
                raise TelephonyError('El stream Telnyx se cerró.') from None
            raise TimeoutError() from None

    def send(self, raw):
        value = json.loads(raw)
        if value.get('streamSid') != self.stream_id or self.closed.is_set():
            raise TelephonyError('El stream de salida no coincide o terminó.')
        kind = value.get('event')
        with self.send_lock:
            if kind == 'media':
                encoded = self.resampler.encode(base64.b64decode(value['media']['payload'], validate=True))
                if not encoded:
                    return
                message = {'event': 'media', 'media': {'payload': base64.b64encode(encoded).decode()}}
                self.metrics['sent_media_packets'] += 1
            elif kind == 'mark':
                message = {'event': 'mark', 'mark': value['mark']}
            elif kind == 'clear':
                self.resampler.reset_transmit()
                message = {'event': 'clear'}
            else:
                raise TelephonyError('Evento de salida no válido.')
            asyncio.run_coroutine_threadsafe(self.websocket.send_json(message), self.loop).result(timeout=5)

    def close(self):
        if not self.closed.is_set():
            self.closed.set()
            asyncio.run_coroutine_threadsafe(self.websocket.close(), self.loop).result(timeout=5)
