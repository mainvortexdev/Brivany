"""Explicit local PCM output on Windows. No browser, recording or persistence.

The mixer owns bounded decoded PCM queues. WinMM scheduling is not physical
speaker verification. It is instantiated only after a user starts local output.
"""
from __future__ import annotations

from collections import deque
import ctypes
import math
import os
import struct
import threading
import time

SAMPLE_RATE=24000
FRAME_SAMPLES=480  # 20 ms; four submitted WinMM buffers (80 ms nominal).
FRAME_BYTES=FRAME_SAMPLES*2
DEVICE_BUFFERS=4  # Device completed 63 ms batches; 60 ms starved between callbacks.
LIMITS={'original':SAMPLE_RATE*2,'translation':SAMPLE_RATE*2*3}
TRANSLATION_LEAD_BYTES=SAMPLE_RATE*2*240//1000


class NativeAudioError(RuntimeError):
    """Safe diagnostics; never include PCM, arbitrary driver text or secrets."""
    def __init__(self,code,message):self.code=code;super().__init__(message)


def _fail(code='native_audio_output',message='No se pudo reproducir audio en el dispositivo de este ordenador.'):
    raise NativeAudioError(code,message)


def status():
    """Passive device count only: no handle, thread, audio, file or network."""
    available=False
    if os.name=='nt':
        try:
            library=ctypes.WinDLL('winmm',use_last_error=True)
            library.waveOutGetNumDevs.argtypes=[];library.waveOutGetNumDevs.restype=ctypes.c_uint
            available=library.waveOutGetNumDevs()>0
        except (OSError,AttributeError):pass
    return {'available':available,'backend':'windows_winmm' if os.name=='nt' else None,
        'sample_rate':SAMPLE_RATE,'channels':1,'format':'pcm16','physical_output_verified':False,
        'output_location':'server_computer','browser_audio_output':False,
        'flush_translation_scope':'queued_pcm_only_excludes_inflight_and_device_buffers','submitted_audio_max_ms':80,'mixer_frame_max_ms':20}


class _WaveOutDriver:
    """WinMM PCM driver; one writer, explicit reset/close and retained buffers."""
    paced_output=True  # waveOutWrite capacity bounds device lead to four frames.
    def __init__(self,endpoint_id=None):
        if os.name!='nt':_fail('native_audio_unavailable','La salida local de audio requiere Windows en este ordenador.')
        class WaveFormat(ctypes.Structure):
            _pack_=1
            _fields_=[('wFormatTag',ctypes.c_uint16),('nChannels',ctypes.c_uint16),('nSamplesPerSec',ctypes.c_uint32),
                ('nAvgBytesPerSec',ctypes.c_uint32),('nBlockAlign',ctypes.c_uint16),('wBitsPerSample',ctypes.c_uint16),('cbSize',ctypes.c_uint16)]
        class WaveHeader(ctypes.Structure):
            _fields_=[('lpData',ctypes.c_void_p),('dwBufferLength',ctypes.c_uint32),('dwBytesRecorded',ctypes.c_uint32),
                ('dwUser',ctypes.c_size_t),('dwFlags',ctypes.c_uint32),('dwLoops',ctypes.c_uint32),('lpNext',ctypes.c_void_p),('reserved',ctypes.c_size_t)]
        self.Header=WaveHeader;self.library=ctypes.WinDLL('winmm',use_last_error=True);self.handle=ctypes.c_void_p()
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.CreateEventW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_wchar_p];self.kernel.CreateEventW.restype=ctypes.c_void_p
        self.kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint32];self.kernel.WaitForSingleObject.restype=ctypes.c_uint32
        self.kernel.SetEvent.argtypes=[ctypes.c_void_p];self.kernel.SetEvent.restype=ctypes.c_int
        self.kernel.CloseHandle.argtypes=[ctypes.c_void_p];self.kernel.CloseHandle.restype=ctypes.c_int
        self.completion=self.kernel.CreateEventW(None,False,False,None)
        if not self.completion:_fail('native_audio_open','No se pudo preparar la señal de salida de audio de Windows.')
        self.pending=[];self.lock=threading.RLock();self.stopping=threading.Event();self.closed=False;self._period_active=False
        self.submitted_bytes=0;self.submitted_frames=0
        definitions={
            'waveOutOpen':([ctypes.POINTER(ctypes.c_void_p),ctypes.c_uint,ctypes.POINTER(WaveFormat),ctypes.c_size_t,ctypes.c_size_t,ctypes.c_uint],ctypes.c_uint),
            'waveOutPrepareHeader':([ctypes.c_void_p,ctypes.POINTER(WaveHeader),ctypes.c_uint],ctypes.c_uint),
            'waveOutWrite':([ctypes.c_void_p,ctypes.POINTER(WaveHeader),ctypes.c_uint],ctypes.c_uint),
            'waveOutUnprepareHeader':([ctypes.c_void_p,ctypes.POINTER(WaveHeader),ctypes.c_uint],ctypes.c_uint),
            'waveOutReset':([ctypes.c_void_p],ctypes.c_uint),'waveOutClose':([ctypes.c_void_p],ctypes.c_uint),
            'waveOutGetPosition':([ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint],ctypes.c_uint),
            'timeBeginPeriod':([ctypes.c_uint],ctypes.c_uint),'timeEndPeriod':([ctypes.c_uint],ctypes.c_uint)}
        for name,(args,result) in definitions.items():
            method=getattr(self.library,name);method.argtypes=args;method.restype=result
        format_=WaveFormat(1,1,SAMPLE_RATE,SAMPLE_RATE*2,2,16,0)
        try:device_id=wave_device_id(endpoint_id,self.library) if endpoint_id else 0xffffffff
        except Exception:
            self.kernel.CloseHandle(self.completion);self.completion=None;raise
        result=self.library.waveOutOpen(ctypes.byref(self.handle),device_id,ctypes.byref(format_),self.completion,0,0x00050000)  # CALLBACK_EVENT
        if result or not self.handle.value:
            self.kernel.CloseHandle(self.completion);self.completion=None
            _fail('native_audio_open','No se pudo abrir el altavoz de Windows. Revisa el dispositivo de salida.')
        # Windows' default ~15.6 ms timer quantum turned a requested 20 ms
        # mix tick into ~31 ms waits on the tested WinMM device. A temporary
        # 1 ms request keeps the 20 ms pipeline responsive between callbacks.
        # It belongs only to this explicit audio session and is paired on close.
        self._period_active=self.library.timeBeginPeriod(1)==0

    def _wait(self,milliseconds):
        if self.stopping.is_set():return
        result=self.kernel.WaitForSingleObject(self.completion,milliseconds)
        if result not in {0,258} and not self.stopping.is_set():_fail('native_audio_stalled','Se perdió la señal del dispositivo de audio.')

    def _reap(self):
        retained=[]
        for index,(buffer,header) in enumerate(self.pending):
            if header.dwFlags&1:
                if self.library.waveOutUnprepareHeader(self.handle,ctypes.byref(header),ctypes.sizeof(header)):
                    # Earlier successfully unprepared pointers must not be
                    # revisited; buffers still owned by WinMM stay strongly held.
                    self.pending=retained+self.pending[index:];_fail()
            else:retained.append((buffer,header))
        self.pending=retained

    def write(self,raw):
        deadline=time.monotonic()+1
        while True:
            if self.stopping.is_set():return
            with self.lock:
                if self.closed:return
                self._reap()
                if len(self.pending)<DEVICE_BUFFERS:
                    buffer=ctypes.create_string_buffer(raw,len(raw));header=self.Header()
                    header.lpData=ctypes.cast(buffer,ctypes.c_void_p);header.dwBufferLength=len(raw)
                    result=self.library.waveOutPrepareHeader(self.handle,ctypes.byref(header),ctypes.sizeof(header))
                    if result:_fail()
                    # Keep both objects alive before passing a pointer to WinMM.
                    self.pending.append((buffer,header))
                    if self.library.waveOutWrite(self.handle,ctypes.byref(header),ctypes.sizeof(header)):
                        if self.library.waveOutUnprepareHeader(self.handle,ctypes.byref(header),ctypes.sizeof(header))==0:self.pending.remove((buffer,header))
                        _fail()
                    self.submitted_bytes+=len(raw);self.submitted_frames+=1
                    return
            if time.monotonic()>=deadline:_fail('native_audio_stalled','El dispositivo de audio dejó de aceptar bloques. La sesión se detuvo.')
            self._wait(50)

    def stats(self):
        """Native progress only, without reading back or persisting any PCM.

        WinMM's cursor is a device report, not proof that a human heard audio.
        TIME_BYTES is a 32-bit counter; callers comparing snapshots must account
        for wrapping (after roughly 24 hours at this format).
        """
        class MMTime(ctypes.Structure):
            _fields_=[('type',ctypes.c_uint32),('position',ctypes.c_uint32),('reserved',ctypes.c_uint32)]
        with self.lock:
            cursor=MMTime(4,0,0);position=None
            if not self.closed and not self.library.waveOutGetPosition(self.handle,ctypes.byref(cursor),ctypes.sizeof(cursor)) and cursor.type==4:position=cursor.position
            return {'submitted_bytes':self.submitted_bytes,'submitted_frames':self.submitted_frames,
                'position_bytes':position,'position_counter_bits':32,'position_sample_rate':SAMPLE_RATE,
                'position_reported_by':'winmm_TIME_BYTES','physical_output_verified':False}

    def drain(self,timeout):
        deadline=time.monotonic()+max(0,timeout)
        while not self.stopping.is_set():
            with self.lock:
                if self.closed:return True
                self._reap()
                if not self.pending:return True
            if time.monotonic()>=deadline:return False
            self._wait(50)
        return False

    def close(self):
        self.stopping.set()
        if self.completion:self.kernel.SetEvent(self.completion)
        try:
            with self.lock:
                if self.closed:return
                if self.library.waveOutReset(self.handle):_fail('native_audio_close','El dispositivo local no confirmó la detención del audio.')
                deadline=time.monotonic()+1
                while self.pending and time.monotonic()<deadline:
                    self._reap()
                    if self.pending:time.sleep(.005)
                result=self.library.waveOutClose(self.handle)
                if result:_fail('native_audio_close','No se pudo cerrar completamente el dispositivo de audio.')
                self.closed=True;self.handle=ctypes.c_void_p();self.pending.clear()
        finally:
            if self._period_active:self._period_active=False;self.library.timeEndPeriod(1)
            if self.closed and self.completion:self.kernel.CloseHandle(self.completion);self.completion=None


class NativeMixer:
    """Bounded, time-paced mono mixer with injectable output for local tests."""
    def __init__(self,driver=None,*,original=.12,translation=.85,observer=None):
        if observer is not None and not callable(observer):raise ValueError('Audio observer must be callable')
        self._condition=threading.Condition(threading.RLock());self._queues={key:deque() for key in LIMITS}
        self._sizes={key:0 for key in LIMITS};self._levels={};self._closed=False;self._closing=False;self._error=None;self._writing=False
        self._accepted={key:0 for key in LIMITS};self._maximum={key:0 for key in LIMITS};self._rejected={key:0 for key in LIMITS}
        self._written_bytes=0;self._writes=0
        self._observer=observer;self._observer_errors=0;self._opened_at=time.monotonic()
        self._delivery_end=None;self._translation_end=None;self._translation_first=None;self._translation_last=None
        self._translation_delivered=0;self._translation_gaps=0;self._translation_gap_total=0.;self._translation_gap_max=0.
        self.set_levels(original=original,translation=translation)
        self.driver=driver if driver is not None else _WaveOutDriver()
        self._thread=threading.Thread(target=self._run,name='brivany-native-audio',daemon=True);self._thread.start()

    def check_error(self):
        with self._condition:
            if self._error is not None:raise self._error
            if self._closed or self._closing:_fail('native_audio_closed','La salida local de audio está cerrada.')

    def _push(self,kind,raw):
        if not isinstance(raw,bytes) or not raw or len(raw)%2:_fail('native_audio_format','Envía audio PCM16 mono de 24 kHz con muestras completas.')
        with self._condition:
            self.check_error()
            if self._sizes[kind]+len(raw)>LIMITS[kind]:
                self._rejected[kind]+=1
                _fail('native_audio_'+kind+'_backlog','La escucha del audio original se atrasó más de un segundo.' if kind=='original' else 'La voz traducida acumuló más de tres segundos sin reproducir. La sesión se detuvo.')
            self._queues[kind].append(raw);self._sizes[kind]+=len(raw);self._accepted[kind]+=len(raw);self._maximum[kind]=max(self._maximum[kind],self._sizes[kind]);self._condition.notify_all()

    def push_original(self,raw):self._push('original',raw)
    def push_translation(self,raw):self._push('translation',raw)

    def push_translation_paced(self,raw,*,stopped,timeout=4):
        """Feed a bounded provider burst in 20 ms frames, with 240 ms queue lead.

        Backpressure waits for the actual mixer, never enlarges its queue and
        polls cancellation. Driver stalls remain errors; PCM is never dropped.
        Only the calling receiver blocks, so ingress and Stop remain responsive.
        """
        if not isinstance(raw,bytes) or not raw or len(raw)%2 or len(raw)>LIMITS['translation']:
            _fail('native_audio_format','Bloque de voz fuera del límite de tres segundos.')
        if type(timeout) not in {int,float} or not math.isfinite(timeout) or not 0<timeout<=6:
            _fail('native_audio_timeout','Tiempo de regulación de audio no válido.')
        deadline=time.monotonic()+timeout
        for offset in range(0,len(raw),FRAME_BYTES):
            frame=raw[offset:offset+FRAME_BYTES]
            with self._condition:
                while True:
                    if stopped.is_set():return False
                    self.check_error()
                    if self._sizes['translation']+len(frame)<=TRANSLATION_LEAD_BYTES:break
                    remaining=deadline-time.monotonic()
                    if remaining<=0:_fail('native_audio_stalled','El dispositivo no consumió la voz dentro del tiempo permitido. Sesión detenida.')
                    self._condition.wait(min(remaining,.025))
                self._push('translation',frame)
        return True

    def stats(self):
        """Aggregate queue/output counters only; no audio or source identifiers."""
        with self._condition:
            result={'sample_rate':SAMPLE_RATE,'queued_ms':{key:round(value/48,3) for key,value in self._sizes.items()},
                'maximum_queued_ms':{key:round(value/48,3) for key,value in self._maximum.items()},
                'accepted_bytes':dict(self._accepted),'rejected_pushes':dict(self._rejected),
                'output_bytes':self._written_bytes,'output_frames':self._writes,'worker_alive':self._thread.is_alive(),
                'error_code':self._error.code if self._error else None,'physical_output_verified':False,
                'translation_delivery':{'timeline':'estimated_from_device_submissions','gap_threshold_ms':20,
                    'first_after_open_ms':round((self._translation_first-self._opened_at)*1000,3) if self._translation_first is not None else None,
                    'last_after_open_ms':round((self._translation_last-self._opened_at)*1000,3) if self._translation_last is not None else None,
                    'delivered_pcm_ms':round(self._translation_delivered/48,3),
                    'gap_count':self._translation_gaps,'gap_total_ms':round(self._translation_gap_total*1000,3),
                    'gap_max_ms':round(self._translation_gap_max*1000,3),'observer_errors':self._observer_errors}}
            if callable(getattr(self.driver,'stats',None)):result['device']=self.driver.stats()
            return result

    def _delivery(self,at,original_size,translation_size):
        """Estimate queued playback intervals; never inspect content samples.

        A burst can submit several buffers at once: its durations are added to
        the existing end time, rather than counting every write as playback now.
        Gaps include natural silence between phrases; they are diagnostics, not
        an assertion that the network or the device failed.
        """
        with self._condition:
            begin=max(at,self._delivery_end) if self._delivery_end is not None else at
            duration=max(original_size,translation_size)/(SAMPLE_RATE*2);self._delivery_end=begin+duration
            gap=0.
            if translation_size:
                if self._translation_first is None:self._translation_first=begin
                if self._translation_end is not None:gap=max(0.,begin-self._translation_end)
                if gap>.020:
                    self._translation_gaps+=1;self._translation_gap_total+=gap;self._translation_gap_max=max(self._translation_gap_max,gap)
                self._translation_end=begin+translation_size/(SAMPLE_RATE*2);self._translation_last=self._translation_end;self._translation_delivered+=translation_size
            observer=self._observer
        if observer:
            try:observer({'at':at,'estimated_start':begin,'duration':duration,'translation_duration':translation_size/(SAMPLE_RATE*2),'translation_gap':gap})
            except Exception:
                # Diagnostics cannot interrupt the user's audio.
                with self._condition:self._observer_errors+=1

    def set_levels(self,*,original=None,translation=None):
        values={key:value for key,value in (('original',original),('translation',translation)) if value is not None}
        if any(type(value) not in {int,float} or not math.isfinite(value) or not 0<=value<=1 for value in values.values()):
            _fail('native_audio_volume','El volumen debe estar entre cero y uno.')
        with self._condition:
            if self._closed or self._closing:_fail('native_audio_closed','La salida local de audio está cerrada.')
            self._levels.update(values)

    def flush_translation(self):
        with self._condition:
            self.check_error();self._queues['translation'].clear();self._sizes['translation']=0;self._condition.notify_all()

    def _take(self,kind,size):
        parts=[];remaining=size
        while remaining and self._queues[kind]:
            raw=self._queues[kind].popleft();part=raw[:remaining];parts.append(part);remaining-=len(part);self._sizes[kind]-=len(part)
            if len(part)<len(raw):self._queues[kind].appendleft(raw[len(part):])
        return b''.join(parts)

    @staticmethod
    def _mix(original,translation,levels):
        count=max(len(original),len(translation))//2
        first=struct.unpack('<'+'h'*(len(original)//2),original) if original else ()
        second=struct.unpack('<'+'h'*(len(translation)//2),translation) if translation else ()
        mixed=[max(-32768,min(32767,round((first[index] if index<len(first) else 0)*levels['original']+
            (second[index] if index<len(second) else 0)*levels['translation']))) for index in range(count)]
        return struct.pack('<'+'h'*count,*mixed)

    def _run(self):
        next_at=time.monotonic()
        driver_paced=getattr(self.driver,'paced_output',False) is True
        try:
            while True:
                with self._condition:
                    while not any(self._sizes.values()) and not self._closing:
                        self._condition.wait();next_at=time.monotonic()
                    if self._closing:return
                    # The real device already clocks consumption. Scheduling a
                    # second 20 ms timer on top of its bounded write wait lost
                    # throughput whenever a Windows wait woke late.
                    delay=0 if driver_paced else next_at-time.monotonic()
                    if delay>0:self._condition.wait(min(delay,.02));continue
                    first=self._take('original',FRAME_BYTES);second=self._take('translation',FRAME_BYTES);levels=dict(self._levels);self._writing=True
                mixed=self._mix(first,second,levels)
                if mixed:
                    self.driver.write(mixed);self._delivery(time.monotonic(),len(first),len(second))
                with self._condition:
                    self._written_bytes+=len(mixed);self._writes+=bool(mixed);self._writing=False;self._condition.notify_all()
                duration=max(len(first),len(second))/(SAMPLE_RATE*2)
                if not driver_paced:next_at=max(next_at,time.monotonic()-.02)+duration
        except Exception:
            with self._condition:
                self._error=NativeAudioError('native_audio_output','El dispositivo local de audio falló. La sesión debe detenerse.')
                self._writing=False;self._condition.notify_all()

    def finish(self,timeout=3):
        if type(timeout) not in {int,float} or not math.isfinite(timeout) or not 0<=timeout<=10:_fail('native_audio_timeout','Tiempo de cierre de audio no válido.')
        deadline=time.monotonic()+timeout
        with self._condition:
            while any(self._sizes.values()) or self._writing:
                self.check_error();remaining=deadline-time.monotonic()
                if remaining<=0:return False
                self._condition.wait(min(remaining,.05))
            self.check_error()
        result=self.driver.drain(max(0,deadline-time.monotonic())) if hasattr(self.driver,'drain') else True
        return result is not False

    def close(self):
        with self._condition:
            if self._closed:return
            self._closing=True
            for key in self._queues:self._queues[key].clear();self._sizes[key]=0
            self._condition.notify_all()
        failure=None
        try:self.driver.close()
        except Exception:failure=NativeAudioError('native_audio_close','No se pudo cerrar completamente la salida local de audio.')
        self._thread.join(timeout=1.5)
        with self._condition:
            self._closed=True
            if failure:self._error=failure
        if self._thread.is_alive():_fail('native_audio_close','El dispositivo local de audio no cerró dentro del límite.')
        if failure:raise failure


def wave_device_id(endpoint_id,library=None):
    """Map an opaque MMDevice endpoint to WinMM, without name truncation."""
    library=library or ctypes.WinDLL('winmm',use_last_error=True)
    library.waveOutGetNumDevs.restype=ctypes.c_uint
    library.waveOutMessage.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_size_t];library.waveOutMessage.restype=ctypes.c_uint
    for index in range(library.waveOutGetNumDevs()):
        size=ctypes.c_ulong()
        if library.waveOutMessage(index,0x0812,ctypes.addressof(size),0) or not 2<=size.value<=65536:continue
        buffer=ctypes.create_unicode_buffer(size.value//2)
        if not library.waveOutMessage(index,0x0811,ctypes.addressof(buffer),size.value) and buffer.value.casefold()==endpoint_id.casefold():return index
    _fail('native_audio_device','La salida seleccionada dejó de estar disponible.')


def open_native_audio(endpoint_id=None,*,observer=None):
    """Explicit factory; caller must open before starting a paid provider."""
    try:return NativeMixer(_WaveOutDriver(endpoint_id),observer=observer) if endpoint_id else NativeMixer(observer=observer)
    except NativeAudioError:raise
    except (OSError,AttributeError):_fail('native_audio_open','No se pudo abrir el altavoz de Windows. Revisa el dispositivo de salida.')
