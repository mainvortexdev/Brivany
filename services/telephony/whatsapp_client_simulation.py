"""Explicit local rehearsal. No accounts, physical devices, remote AI or speech."""
import json
import math
import queue
import struct
import threading


class SimulatedClient:
    simulation = True
    def __init__(self):
        self.destination = None
        self.dialed = False
        self.ended = False
    def prepare(self, destination, stopped):
        self.destination = destination
    def dial(self, destination):
        if destination != self.destination:
            raise ValueError('Destination changed')
        self.dialed = True
    def state(self):
        return 'completed' if self.ended else 'in-progress' if self.dialed else 'dialing'
    def hangup(self):
        self.ended = True


class SimulatedAudio:
    simulation = True
    def __init__(self):
        self.packets = 0
        self.clears = 0
        self.closed = False
        self.accept = None
    def start(self, accept, fail):
        self.accept = accept
    def write(self, raw):
        self.packets += 1
    def clear(self):
        self.clears += 1
    def close(self):
        self.closed = True


class SimulatedListen:
    def __init__(self):
        self.events = queue.Queue()
        self.closed = False
        self.packets = 0
    def send(self, data):
        self.packets += 1
    def recv(self, timeout=.25):
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError() from None
    def utterance(self, turn, text):
        self.events.put(json.dumps({'type': 'speechStart', 'turnId': turn}))
        self.events.put(json.dumps({'type': 'speechComplete', 'turnId': turn, 'transcript': text}))
    def close(self):
        self.closed = True


class SimulatedSpeech:
    def __init__(self, owner):
        self.owner = owner
        self.done = False
        self.sent = False
        self.closed = False
    def read1(self, maximum):
        if self.sent or self.closed:
            self.done = not self.closed
            return b''
        self.sent = True
        return b''.join(struct.pack('<h', round(1500 * math.sin(2 * math.pi * 440 * i / 24000))) for i in range(960))
    def close(self):
        self.closed = True
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()


class SimulatedProviders:
    simulation = True
    def __init__(self):
        self.muse = SimulatedListen()
        self.spoken = 0
    def listen(self):
        return self.muse
    def speak(self, text):
        self.spoken += 1
        return SimulatedSpeech(self)
    def sentences(self, objective, history, text, cancelled):
        yield 'Esta es una respuesta de la prueba local de Melodi.'
