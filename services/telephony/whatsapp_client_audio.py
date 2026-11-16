"""Demand-started, bounded PCM bridge over two dedicated virtual audio buses.

The selected receive endpoint is a render-loopback, never a physical microphone.
No default-device fallback or global capture. Each WASAPI stream owns its thread.
"""
from contextlib import ExitStack
import queue
import threading

from .common import TelephonyError
from .whatsapp_client_ui import com_thread

RATE = 24000
FRAMES = 960
VIRTUAL_NAMES = ('cable', 'virtual', 'vb-audio', 'fxsound')


def devices(soundcard=None):
    with com_thread():
        if soundcard is None:
            import soundcard
        return [{'id': item.id, 'name': item.name,
                 'virtual': any(word in item.name.casefold() for word in VIRTUAL_NAMES)}
                for item in soundcard.all_speakers()]


class VirtualAudio:
    def __init__(self, receive, transmit, *, soundcard=None):
        self.receive, self.transmit = receive, transmit
        self.sc = soundcard
        self.closed = threading.Event()
        self.commands = queue.Queue(maxsize=4)
        self.generation = 0
        self.lock = threading.Lock()
        self.ready = [threading.Event(), threading.Event()]
        self.threads = []
        self.failure = None
        self.fail_callback = None

    @staticmethod
    def readiness(settings, *, soundcard=None):
        if not settings['receive_device'] or not settings['transmit_device']:
            return 'Selecciona dos canales virtuales para el audio de WhatsApp.'
        if settings['receive_device'] == settings['transmit_device']:
            return 'La entrada y la salida de Melodi deben usar canales separados.'
        try:
            available = {item['id']: item for item in devices(soundcard)}
            for key in ('receive_device', 'transmit_device'):
                if settings[key] not in available or not available[settings[key]]['virtual']:
                    return 'Conecta los canales virtuales seleccionados para WhatsApp.'
        except Exception:
            return 'No se pudo consultar el audio de WhatsApp.'
        return ''

    def _fail(self):
        self.failure = TelephonyError('Se interrumpió un canal de audio de WhatsApp.')
        self.closed.set()
        for event in self.ready:
            event.set()
        if self.fail_callback:
            self.fail_callback()

    def start(self, accept, fail):
        self.fail_callback = fail
        self.threads = [threading.Thread(target=self._capture, args=(accept,), daemon=True, name='whatsapp-capture'),
                        threading.Thread(target=self._render, daemon=True, name='whatsapp-render')]
        for thread in self.threads:
            thread.start()
        if not all(event.wait(3) for event in self.ready) or self.failure:
            self.close()
            raise TelephonyError('No se pudieron abrir los canales virtuales de WhatsApp.')

    def _library(self):
        if self.sc is None:
            import soundcard
            return soundcard
        return self.sc

    def _capture(self, accept):
        try:
            with com_thread():
                import numpy as np
                sc = self._library()
                microphone = sc.get_microphone(id=self.receive, include_loopback=True)
                if not microphone.isloopback:
                    raise TelephonyError('La entrada no es el audio del cliente WhatsApp.')
                with microphone.recorder(samplerate=RATE, blocksize=FRAMES * 2) as recorder:
                    self.ready[0].set()
                    while not self.closed.is_set():
                        data = recorder.record(numframes=FRAMES)
                        if data.ndim != 2 or len(data) != FRAMES or not np.isfinite(data).all():
                            raise TelephonyError('El canal virtual produjo audio no válido.')
                        pcm = (np.clip(data.mean(axis=1), -1, 1) * 32767).astype('<i2').tobytes()
                        accept(pcm)
        except Exception:
            self._fail()

    def _render(self):
        try:
            with com_thread(), ExitStack() as stack:
                import numpy as np
                speaker = self._library().get_speaker(id=self.transmit)
                # A reset is performed only on the stream-owning thread.
                player = stack.enter_context(speaker.player(samplerate=RATE, channels=2, blocksize=FRAMES))
                current_generation = self.generation
                self.ready[1].set()
                while not self.closed.is_set():
                    try:
                        generation, raw, done, result = self.commands.get(timeout=.04)
                    except queue.Empty:
                        continue
                    try:
                        if generation != self.generation:
                            continue
                        if current_generation != generation:
                            stack.close()
                            player = stack.enter_context(speaker.player(samplerate=RATE, channels=2, blocksize=FRAMES))
                            current_generation = generation
                        mono = np.frombuffer(raw, dtype='<i2').astype('float32') / 32768
                        player.play(np.repeat(mono[:, None], 2, axis=1))
                        result.append(True)
                    finally:
                        done.set()
        except Exception:
            self._fail()
        finally:
            self._drain()

    def write(self, raw):
        if not isinstance(raw, bytes) or not raw or len(raw) > 3840 or len(raw) % 2:
            raise TelephonyError('Paquete de voz virtual no válido.')
        done, result = threading.Event(), []
        with self.lock:
            generation = self.generation
        try:
            self.commands.put_nowait((generation, raw, done, result))
        except queue.Full:
            raise TelephonyError('El canal virtual de voz se quedó atrás.') from None
        if not done.wait(1) or self.closed.is_set() or not result:
            raise TelephonyError('No se confirmó el envío al canal virtual.')

    def _drain(self):
        while True:
            try:
                self.commands.get_nowait()[2].set()
            except queue.Empty:
                return

    def clear(self):
        with self.lock:
            self.generation += 1
            self._drain()

    def close(self):
        self.closed.set()
        self.clear()
        for thread in self.threads:
            if thread is not threading.current_thread():
                thread.join(1)
