"""WASAPI render-only capture and a disjoint playback route. No microphone.

On Windows 10 an existing FxSound virtual route gives a clean source endpoint
and its physical destination. Never capture a mix that contains our own TTS.
"""
import ctypes as C
from ctypes import wintypes as W
import math
from pathlib import PureWindowsPath
import time
import numpy as np
from desktop.experience.audio_sessions import WindowsSessionMeter,GUID,call,query,release
from packages.providers.native_audio import wave_device_id


class MixFormat(C.Structure):
    _pack_=1
    _fields_=[('tag',W.WORD),('channels',W.WORD),('rate',W.DWORD),('bytes_per_second',W.DWORD),('align',W.WORD),('bits',W.WORD),('extra',W.WORD)]


def is_fxsound_source(endpoint):
    class Caps(C.Structure):
        _fields_=[('manufacturer',W.WORD),('product',W.WORD),('version',W.DWORD),('name',W.WCHAR*32),('formats',W.DWORD),('channels',W.WORD),('reserved',W.WORD),('support',W.DWORD)]
    library=C.WinDLL('winmm');index=wave_device_id(endpoint,library);caps=Caps()
    library.waveOutGetDevCapsW.argtypes=[C.c_size_t,C.POINTER(Caps),W.UINT]
    return library.waveOutGetDevCapsW(index,C.byref(caps),C.sizeof(caps))==0 and 'fxsound' in caps.name.casefold()


class PCMConverter:
    def __init__(self,rate,channels,bits,tag):
        if not 8000<=rate<=192000 or not 1<=channels<=32 or bits not in (16,24,32) or tag not in (1,3) or tag==3 and bits!=32:raise ValueError('Formato de salida no compatible.')
        self.rate=rate;self.channels=channels;self.bits=bits;self.tag=tag;self.offset=0.;self.tail=np.empty(0)
    def convert(self,raw):
        if len(raw)%(self.channels*self.bits//8):raise ValueError('Paquete WASAPI incompleto.')
        if self.tag==3:values=np.frombuffer(raw,dtype='<f4')
        elif self.bits==16:values=np.frombuffer(raw,dtype='<i2').astype(np.float64)/32768
        elif self.bits==32:values=np.frombuffer(raw,dtype='<i4').astype(np.float64)/2147483648
        else:
            b=np.frombuffer(raw,dtype=np.uint8).reshape(-1,3).astype(np.int32);n=b[:,0]|b[:,1]<<8|b[:,2]<<16;values=((n^0x800000)-0x800000)/8388608
        if not np.isfinite(values).all():raise ValueError('Audio de salida no válido.')
        mono=values.reshape(-1,self.channels).mean(axis=1);data=np.concatenate((self.tail,mono))
        if len(data)<2:self.tail=data;return b''
        positions=np.arange(self.offset,len(data)-1,self.rate/24000)
        out=np.interp(positions,np.arange(len(data)),data)
        self.offset=(positions[-1]+self.rate/24000 if len(positions) else self.offset)-(len(data)-1);self.tail=data[-1:]
        return (np.clip(out,-1,1)*32767).astype('<i2').tobytes()


def choose_route(default,rows):
    forwarded=[s for s in rows if s.get('family') and PureWindowsPath(s['family'][0]).name.casefold()=='fxsound.exe' and s.get('endpoint')!=default]
    endpoints={s['endpoint'] for s in forwarded}
    if len(endpoints)==1:return next(iter(endpoints))
    active={s['endpoint'] for s in forwarded if s.get('active')}
    if len(active)==1:return next(iter(active))
    raise ValueError('No hay una ruta de audio separada para traducir sin eco. Activa FxSound con tu salida habitual y vuelve a iniciar.')


class SilenceClock:
    """Count idle audio periods against one clock, never against wake-up time."""
    def __init__(self,now):self.data(now)
    def data(self,now):self.last_data=now;self.next_at=now+.08
    def due(self,now):
        if now-self.last_data<=.1:return 0
        count=max(0,math.floor((now-self.next_at+1e-9)/.08)+1)
        self.next_at+=count*.08
        return count


class SystemAudioRoute:
    def __init__(self):
        self.meter=WindowsSessionMeter();self.client=None;self.capture=None;self.saved=[];self.closed=False;self.pending=bytearray();self.frames=0;self.discontinuities=0
        try:
            device=C.c_void_p();call(self.meter.enumerator,4,(C.c_int,0),(C.c_int,1),(C.POINTER(C.c_void_p),C.byref(device)))
            try:
                identifier=C.c_void_p();call(device,5,(C.POINTER(C.c_void_p),C.byref(identifier)))
                try:self.source=C.wstring_at(identifier)
                finally:self.meter.ole.CoTaskMemFree.argtypes=[C.c_void_p];self.meter.ole.CoTaskMemFree(identifier)
                if not is_fxsound_source(self.source):raise ValueError('Selecciona FxSound como salida de Windows para traducir sin recapturar la voz traducida.')
                self.output=choose_route(self.source,self.meter.read(True))
                self.client=C.c_void_p();iid=GUID('1CB9AD4C-DBFA-4C32-B178-C2F568A703B2')
                call(device,3,(C.POINTER(GUID),C.byref(iid)),(W.DWORD,23),(C.c_void_p,None),(C.POINTER(C.c_void_p),C.byref(self.client)))
                fmt=C.c_void_p();call(self.client,8,(C.POINTER(C.c_void_p),C.byref(fmt)))
                try:
                    info=C.cast(fmt,C.POINTER(MixFormat)).contents;tag=info.tag
                    if tag==0xfffe:tag=C.cast(fmt.value+24,C.POINTER(W.DWORD)).contents.value
                    self.converter=PCMConverter(info.rate,info.channels,info.bits,tag);self.align=info.align
                    call(self.client,3,(C.c_int,0),(W.DWORD,0x20000),(C.c_longlong,1000000),(C.c_longlong,0),(C.c_void_p,fmt),(C.c_void_p,None))
                finally:self.meter.ole.CoTaskMemFree(fmt)
                self.capture=C.c_void_p();iid=GUID('C8ADBD64-E71E-48A0-A4DE-185C395CD317');call(self.client,14,(C.POINTER(GUID),C.byref(iid)),(C.POINTER(C.c_void_p),C.byref(self.capture)))
                call(self.client,10);self.started=time.monotonic();self.silence_clock=SilenceClock(self.started)
            finally:release(device)
        except Exception:self.close();raise

    def packets(self,stopped):
        sequence=0
        while not stopped.is_set():
            count=W.UINT();call(self.capture,5,(C.POINTER(W.UINT),C.byref(count)))
            if not count.value:
                # Windows may wake an 8 ms wait after 15.6 ms. Resetting the
                # deadline to now+80 ms made idle audio run at ~85% speed.
                # Count elapsed periods, keeping every pending real sample in
                # front of silence rather than deferring that tail until speech
                # resumes. CapturePeer still paces these blocks for the provider.
                for _ in range(self.silence_clock.due(time.monotonic())):
                    self.pending.extend(bytes(3840))
                    raw=bytes(self.pending[:3840]);del self.pending[:3840];self.frames+=1920;yield sequence,raw;sequence+=1
                stopped.wait(.008);continue
            data=C.c_void_p();frames=W.UINT();flags=W.DWORD();position=C.c_ulonglong();qpc=C.c_ulonglong()
            call(self.capture,3,(C.POINTER(C.c_void_p),C.byref(data)),(C.POINTER(W.UINT),C.byref(frames)),(C.POINTER(W.DWORD),C.byref(flags)),(C.POINTER(C.c_ulonglong),C.byref(position)),(C.POINTER(C.c_ulonglong),C.byref(qpc)))
            try:
                raw=bytes(frames.value*self.align) if flags.value&2 else C.string_at(data,frames.value*self.align)
                if flags.value&1:self.discontinuities+=1
                self.pending.extend(self.converter.convert(raw));self.silence_clock.data(time.monotonic())
            finally:call(self.capture,4,(W.UINT,frames.value))
            while len(self.pending)>=3840:
                raw=bytes(self.pending[:3840]);del self.pending[:3840];self.frames+=1920;yield sequence,raw;sequence+=1

    def reduce_original(self,gain=.12):
        # FxSound's physical rendering session is after the capture endpoint.
        # Reducing it never attenuates the PCM sent to ASR and never touches TTS.
        device=C.c_void_p();manager=C.c_void_p();sessions=C.c_void_p()
        try:
            call(self.meter.enumerator,5,(C.c_wchar_p,self.output),(C.POINTER(C.c_void_p),C.byref(device)))
            iid=GUID('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F');call(device,3,(C.POINTER(GUID),C.byref(iid)),(W.DWORD,23),(C.c_void_p,None),(C.POINTER(C.c_void_p),C.byref(manager)))
            call(manager,5,(C.POINTER(C.c_void_p),C.byref(sessions)));size=C.c_int();call(sessions,3,(C.POINTER(C.c_int),C.byref(size)))
            for i in range(size.value):
                control=C.c_void_p();extended=None;volume=None
                try:
                    call(sessions,4,(C.c_int,i),(C.POINTER(C.c_void_p),C.byref(control)));extended=query(control,'BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D');pid=W.DWORD();call(extended,14,(C.POINTER(W.DWORD),C.byref(pid)))
                    _,family=self.meter._identity(pid.value)
                    if not family or PureWindowsPath(family[0]).name.casefold()!='fxsound.exe':continue
                    volume=query(control,'87CE5498-68D6-44E5-9215-6DA47EF883D8');level=C.c_float();call(volume,4,(C.POINTER(C.c_float),C.byref(level)))
                    applied=level.value*gain;call(volume,3,(C.c_float,applied),(C.c_void_p,None));self.saved.append((volume,level.value,applied));volume=None
                finally:
                    for p in (volume,extended,control):release(p)
        finally:
            for p in (sessions,manager,device):release(p)
        if not self.saved:raise ValueError('No se pudo reducir la salida original del video.')

    def close(self):
        if self.closed:return
        self.closed=True
        for volume,before,applied in self.saved:
            try:
                current=C.c_float();call(volume,4,(C.POINTER(C.c_float),C.byref(current)))
                if abs(current.value-applied)<.005:call(volume,3,(C.c_float,before),(C.c_void_p,None))
            except OSError:pass
            finally:release(volume)
        self.saved.clear()
        if self.client:
            try:call(self.client,11)
            except OSError:pass
        release(self.capture);self.capture=None;release(self.client);self.client=None;self.meter.close()
