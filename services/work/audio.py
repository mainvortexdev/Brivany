"""PCM24k tape: bounded pre-roll, loss diagnostics and continuous accepted spool."""
from collections import deque
import ctypes
import importlib.util
import json
from pathlib import Path
import queue
import threading
import time
import warnings
import wave

RATE=24000
PACKET_FRAMES=1920


class AudioTape:
    def __init__(self,directory,*,seconds=120,max_seconds=3600):
        self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=True)
        self.ring=deque();self.limit=RATE*seconds;self.max_frames=RATE*max_seconds;self.frames=0;self.ring_frames=0;self.expected_sequence=0
        self.gaps=[];self.discontinuities=0;self.writer=None;self.recorded_frames=0;self.recording=False;self.prefix_truncated=False;self.start_frame=None
        self.lock=threading.RLock();self.closed=False
    def append(self,sequence,raw,*,discontinuity=False):
        if not isinstance(raw,bytes) or not raw or len(raw)%2:raise ValueError('PCM16 inválido.')
        with self.lock:
            if self.closed:raise ValueError('La captura está cerrada.')
            if type(sequence) is not int or sequence<self.expected_sequence:raise ValueError('Paquete de audio duplicado o fuera de orden.')
            if sequence!=self.expected_sequence:self.gaps.append({'expected_sequence':self.expected_sequence,'received_sequence':sequence})
            self.expected_sequence=sequence+1
            if discontinuity:self.discontinuities+=1
            size=len(raw)//2
            self.ring.append((self.frames,raw));self.frames+=size;self.ring_frames+=size
            while self.ring_frames>self.limit and self.ring:
                first,data=self.ring[0];excess=self.ring_frames-self.limit
                if len(data)//2<=excess:self.ring.popleft();self.ring_frames-=len(data)//2
                else:self.ring[0]=(first+excess,data[excess*2:]);self.ring_frames-=excess
            if self.recording:
                if self.recorded_frames+size>self.max_frames:self.gaps.append({'reason':'recording_limit','omitted_frames':size});raise ValueError('La grabación alcanzó su límite. Detén y revisa el audio conservado.')
                self.writer.writeframesraw(raw);self.recorded_frames+=size
    def accept(self,start_frame=0):
        with self.lock:
            if self.recording:raise ValueError('Ya se está conservando este audio.')
            if not self.ring:raise ValueError('Aún no hay audio en la memoria temporal.')
            oldest=self.ring[0][0];self.prefix_truncated=start_frame<oldest;self.start_frame=max(oldest,start_frame)
            self.writer=wave.open(str(self.directory/'original.wav'),'wb');self.writer.setnchannels(1);self.writer.setsampwidth(2);self.writer.setframerate(RATE)
            for first,data in self.ring:
                end=first+len(data)//2
                if end>self.start_frame:
                    raw=data[max(0,self.start_frame-first)*2:];self.writer.writeframesraw(raw);self.recorded_frames+=len(raw)//2
            self.recording=True
    def finish(self):
        with self.lock:
            self.recording=False
            if self.writer:self.writer.close();self.writer=None
            return self.directory/'original.wav'
    def status(self):
        with self.lock:return {'buffer_seconds':round(self.ring_frames/RATE,2),'captured_frames':self.frames,'recorded_frames':self.recorded_frames,
            'recorded_seconds':round(self.recorded_frames/RATE,2),'recording':self.recording,'prefix_truncated':self.prefix_truncated,
            'packet_gaps':len(self.gaps),'driver_discontinuities':self.discontinuities,'hardware_continuity_verified':False,
            'coverage':'gaps_detected' if self.gaps or self.discontinuities or self.prefix_truncated else 'no_gaps_detected'}
    def close(self):
        with self.lock:self.finish();self.ring.clear();self.ring_frames=0;self.closed=True


def capture_loopback(accept,stopped,*,fail):
    """Windows WASAPI shared loopback; no microphone or capture before invocation."""
    initialized=False
    try:
        import sys
        if sys.platform=='win32':
            initialized=ctypes.windll.ole32.CoInitializeEx(None,0) in (0,1)
        import soundcard as sc
        import numpy as np
        speaker=sc.default_speaker()
        if speaker is None:raise ValueError('No hay una salida de audio disponible.')
        microphone=sc.get_microphone(id=speaker.id,include_loopback=True)
        if not microphone.isloopback:raise ValueError('No se confirmó una entrada de audio del sistema.')
        # Multi-channel avoids the documented WASAPI single-channel limitation.
        with microphone.recorder(samplerate=RATE,blocksize=PACKET_FRAMES*4) as recorder:
            sequence=0
            while not stopped.is_set():
                with warnings.catch_warnings(record=True) as seen:
                    warnings.simplefilter('always');data=recorder.record(numframes=PACKET_FRAMES)
                if data.ndim!=2 or not len(data) or not np.isfinite(data).all():raise ValueError('El dispositivo no produjo PCM válido.')
                raw=(np.clip(data.mean(axis=1),-1,1)*32767).astype('<i2').tobytes()
                accept(sequence,raw,discontinuity=bool(seen));sequence+=1
    except Exception:fail('No se pudo mantener la captura del audio del sistema. Revisa el dispositivo y la cobertura; no se reintentó.')
    finally:
        if initialized:ctypes.windll.ole32.CoUninitialize()


class LanguageMonitor:
    """Opt-in Muse detection. No transcript stored; one pending offer, cooldown."""
    def __init__(self,source_queue,stopped,*,classify,offer,fail,target='es'):
        self.source_queue=source_queue;self.stopped=stopped;self.classify=classify;self.offer=offer;self.fail=fail;self.target=target;self.socket=None
    def run(self):
        from websockets.sync.client import connect
        from packages.providers.live_voice import MUSE_URL,MuseEvents,muse_handshake
        from websockets.exceptions import ConnectionClosed
        sender_done=threading.Event();sender=None
        try:
            with connect(MUSE_URL,open_timeout=5,close_timeout=1,max_size=65536,max_queue=8,compression=None,proxy=None) as socket:
                self.socket=socket;handshake=muse_handshake({'type':'start','consent':True,'mode':'meeting','meetingConsent':True,'language':'en-US' if self.target=='en' else 'es-ES'})
                # Muse's live contract currently admits es-ES/en-US. Bias includes French.
                handshake['languageBias']=['Spanish','English','French'];socket.send(json.dumps(handshake))
                if not isinstance(json.loads(socket.recv(timeout=5)).get('sessionId'),str):raise ValueError()
                def send():
                    try:
                        while not self.stopped.is_set() and not sender_done.is_set():
                            try:raw=self.source_queue.get(timeout=.1)
                            except queue.Empty:continue
                            socket.send(raw)
                    except Exception:sender_done.set()
                sender=threading.Thread(target=send,daemon=True);sender.start();events=MuseEvents();last=0;pending=False
                while not self.stopped.is_set() and not sender_done.is_set():
                    try:raw=socket.recv(timeout=.2)
                    except TimeoutError:continue
                    event=json.loads(raw);value=events.accept(event)
                    if not value or value.get('type')!='transcript' or not value.get('final') or len(value.get('text','').strip())<12 or time.monotonic()-last<20:continue
                    last=time.monotonic();decision=self.classify(value['text'])
                    if decision.get('language') not in {'unknown',self.target} and decision.get('confidence',0)>=.8:
                        self.offer(decision['language'],int(value.get('at',0)*RATE));return
        except Exception:
            if not self.stopped.is_set():self.fail('La detección de idioma se detuvo. No se reintentó; el audio temporal sigue local.')
        finally:
            sender_done.set()
            if sender:sender.join(timeout=1)
            self.socket=None
    def close(self):
        if self.socket:
            try:self.socket.close()
            except Exception:pass
