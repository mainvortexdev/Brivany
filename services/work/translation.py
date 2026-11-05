"""Replay an accepted recording completely; write translated voice, never loop it back."""
import json
from pathlib import Path
import queue
import threading
import time
import wave
from services.work.audio import RATE,PACKET_FRAMES
from packages.providers.pcm_pacing import PCMFrameClock


class WaveOutput:
    def __init__(self,path):
        self.path=Path(path);self.writer=wave.open(str(path),'wb');self.writer.setnchannels(1);self.writer.setsampwidth(2);self.writer.setframerate(RATE);self.bytes=0;self.lock=threading.RLock();self.closed=False
    def set_levels(self,**kwargs):pass
    def push_original(self,raw):pass
    def push_translation_paced(self,raw,*,stopped=None):
        with self.lock:
            if self.closed or stopped is not None and stopped.is_set():return False
            if len(raw)%2:raise ValueError('PCM traducido incompleto.')
            self.writer.writeframesraw(raw);self.bytes+=len(raw);return True
    def finish(self,timeout=3):self.close();return True
    def stats(self):return {'translated_pcm_bytes':self.bytes,'output':'temporary_wav','physical_playback_verified':False}
    def close(self):
        with self.lock:
            if not self.closed:self.writer.close();self.closed=True


class RecordingPeer:
    def __init__(self,path,target,progress,cancelled):
        self.reader=wave.open(str(path),'rb');self.target=target;self.progress=progress;self.cancelled=cancelled;self.initial=True;self.finished_input=False
        self.started=None;self.frames=0;self.padded_frames=0;self.paused=False;self.ready=False;self.lock=threading.Lock();self.terminal=None;self.closed=False;self.total_frames=self.reader.getnframes();self.pacing=PCMFrameClock();self.pending=None
    def recv(self,timeout=8):
        if self.cancelled.is_set() or self.closed:return json.dumps({'type':'stop'})
        if self.initial:self.initial=False;return json.dumps({'type':'start','consent':True,'target_language':self.target,'original_gain':0,'voice_mode':'auto'})
        if not self.ready or self.paused or self.finished_input:time.sleep(min(timeout,.1));raise TimeoutError()
        raw=self.pending if self.pending is not None else self.reader.readframes(PACKET_FRAMES);self.pending=raw
        if not raw:self.finished_input=True;return json.dumps({'type':'finish'})
        # Pace replay and honor provider backpressure. Audio remains on disk, not dropped.
        with self.lock:delay=self.pacing.delay(time.monotonic())
        if self.cancelled.wait(delay):return json.dumps({'type':'stop'})
        with self.lock:
            if self.paused:raise TimeoutError()
            self.pacing.sent(time.monotonic());self.pending=None
        self.frames+=len(raw)//2
        if len(raw)<PACKET_FRAMES*2:self.padded_frames=PACKET_FRAMES-len(raw)//2;raw+=bytes(self.padded_frames*2)
        return raw
    def send(self,raw):
        event=json.loads(raw)
        if event.get('type')=='ready':self.ready=True
        if event.get('type')=='flow-control':
            # Restart pacing after a pause; never release a burst of buffered input.
            with self.lock:self.pacing.reset();self.paused=bool(event.get('paused'))
        if event.get('type') in {'done','error'}:self.terminal=event
        if event.get('type') not in {'transcript'}:self.progress(event)
    def close(self):self.closed=True;self.reader.close()


def translate_recording(source,destination,target,cancelled,progress=lambda event:None,*,bridge_factory=None):
    from packages.providers.river_translation import RiverBridge
    output=WaveOutput(destination);peer=RecordingPeer(source,target,progress,cancelled)
    bridge=(bridge_factory or RiverBridge)(0,mixer_factory=lambda:output)
    try:
        bridge.handle(peer)
        terminal=peer.terminal or {}
        expected=(peer.total_frames+peer.padded_frames)*2
        complete=terminal.get('type')=='done' and peer.frames==peer.total_frames and terminal.get('input_bytes')==expected and output.bytes>0
        return {'complete_input_processed':complete,'source_frames':peer.total_frames,'submitted_frames':peer.frames,'padding_frames':peer.padded_frames,
            'input_bytes_confirmed':terminal.get('input_bytes'),'translated_frames':output.bytes//2,'billing_amount':None,
            'provider_segments':terminal.get('segments'),'error':None if complete else terminal.get('code','translation_incomplete'),
            'semantic_completeness_verified':False,'physical_playback_verified':False}
    finally:output.close();peer.close();bridge.close()
