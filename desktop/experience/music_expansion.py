"""Opt-in idle music scene. Constructors never capture audio or create UI."""
import ctypes
from ctypes import wintypes
import json
import math
import threading
import time
from urllib.parse import urlsplit

PAGE='/workspace-music-expansion'


def windows_idle_seconds():
    class LastInput(ctypes.Structure):
        _fields_=[('size',wintypes.UINT),('tick',wintypes.DWORD)]
    value=LastInput(ctypes.sizeof(LastInput),0)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(value)):return 0
    # GetLastInputInfo is a wrapping 32-bit counter, independent of UTC.
    ctypes.windll.kernel32.GetTickCount.restype=wintypes.DWORD
    return ((ctypes.windll.kernel32.GetTickCount()-value.tick)&0xffffffff)/1000


def spectrum_bins(raw,rate=24000,count=64):
    import numpy as np
    samples=np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768
    if not len(samples) or not np.isfinite(samples).all():return [0.0]*count
    samples=samples[-2048:];samples=samples-samples.mean();power=np.abs(np.fft.rfft(samples*np.hanning(len(samples))))/max(1,len(samples))
    edges=np.geomspace(40,min(rate/2,10000),count+1);frequencies=np.fft.rfftfreq(len(samples),1/rate);result=[]
    for start,end in zip(edges[:-1],edges[1:]):
        values=power[(frequencies>=start)&(frequencies<end)];peak=float(values.max()) if len(values) else 0
        result.append(round(max(0,min(1,(20*math.log10(max(peak,1e-8))+76)/64)),4))
    return result


class MusicSpectrum:
    def __init__(self,capture=None):
        self.capture=capture;self.lock=threading.Lock();self.stop_event=None;self.thread=None;self.bins=[0.0]*64;self.state='off'
    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive() and self.stop_event and not self.stop_event.is_set():return
            self.stop_event=threading.Event();stop=self.stop_event;self.state='starting'
        def accept(sequence,raw,**kwargs):
            bins=spectrum_bins(raw)
            with self.lock:
                if self.stop_event is stop and not stop.is_set():self.bins=bins;self.state='audio'
        def fail(message):
            with self.lock:
                if self.stop_event is stop and not stop.is_set():self.state='unavailable';self.bins=[0.0]*64
        def run():
            from services.work.audio import capture_loopback
            try:(self.capture or capture_loopback)(accept,stop,fail=fail)
            except Exception:fail('El audio del sistema no está disponible.')
        self.thread=threading.Thread(target=run,name='brivany-music-spectrum',daemon=True);self.thread.start()
    def snapshot(self):
        with self.lock:return {'state':self.state,'bins':list(self.bins)}
    def stop(self):
        with self.lock:
            if self.stop_event:self.stop_event.set()
            self.state='off';self.bins=[0.0]*64


class IdleMusicController:
    def __init__(self,source,show,hide,*,idle=windows_idle_seconds,suppressed=lambda:False,interval=1):
        self.source=source;self.show=show;self.hide=hide;self.idle=idle;self.suppressed=suppressed;self.interval=interval
        self.enabled=False;self.visible=False;self.previewing=False;self.song=None;self.stopped=threading.Event();self.activity=threading.Event();self.thread=None;self.lock=threading.RLock();self.dismissed_idle=None
    def configure(self,enabled):
        if type(enabled) is not bool:raise ValueError('Estado de Expansión musical no válido.')
        self.enabled=enabled
        if not enabled:
            self.activity.clear()
            if self.visible:self.hide()
            self.visible=False;self.previewing=False;self.song=None;return
        self.activity.set()
        if not self.thread or not self.thread.is_alive():
            self.stopped.clear();self.thread=threading.Thread(target=self._run,name='brivany-music-idle',daemon=True);self.thread.start()
    def tick(self):
        if not self.enabled:return
        idle=max(0,self.idle())
        if self.dismissed_idle is not None:
            if idle<60:self.dismissed_idle=None
            else:return
        if (idle<60 and not self.previewing) or self.suppressed():
            if self.visible:self.hide()
            self.visible=False;self.previewing=False;self.song=None;return
        song=self.source()
        if not self.enabled or self.stopped.is_set() or self.idle()<60 and not self.previewing:return
        if not song or song.get('playing') is not True:
            if self.visible:self.hide()
            self.visible=False;self.previewing=False;self.song=None;return
        self.song=dict(song)
        if not self.visible:self.visible=True;self.show(self.song)
    def dismiss(self):
        self.previewing=False
        self.dismissed_idle=self.idle()
        if self.visible:self.hide()
        self.visible=False
    def preview(self):
        if not self.enabled:raise ValueError('Marca primero Expansión musical.')
        song=self.source()
        if not song or song.get('playing') is not True:raise ValueError('No se detecta música sonando en Spotify o YouTube. En YouTube, revisa la extensión de Brivany.')
        self.dismissed_idle=None;self.song=dict(song);self.previewing=True;self.visible=True;self.show(self.song)
        return {'opened':True,'preview':True}
    def _run(self):
        while not self.stopped.is_set():
            self.activity.wait()
            if self.stopped.wait(self.interval):break
            try:self.tick()
            except Exception:
                if self.visible:self.hide()
                self.visible=False;self.previewing=False;self.song=None
    def close(self):
        self.enabled=False;self.stopped.set();self.activity.set()
        if self.visible:self.hide()
        self.visible=False


class ExpansionAPI:
    def __init__(self,host):self._host=host;self._window=None
    def _trusted(self):
        host=self._host
        if host.closed or not self._window or host.window is not self._window:raise ValueError('Expansión musical cerrada.')
        current,base=urlsplit(self._window.get_current_url() or ''),urlsplit(host.base)
        if (current.scheme,current.hostname,current.port,current.path)!=(base.scheme,base.hostname,base.port,PAGE) or current.username or current.password:raise ValueError('Pantalla musical no autorizada.')
        return host
    def ready(self):
        host=self._trusted()
        if not host.controller.enabled or not host.controller.visible or host.controller.idle()<60 and not host.controller.previewing:host.controller.dismiss();return {'ready':False}
        if host.guard:host.guard.cancel();host.guard=None
        host.spectrum.start();host.window.show();return {'ready':True}
    def state(self):
        host=self._trusted();song=host.controller.song
        if not song:return {'track':None,'lyrics':{'status':'unavailable','lines':[]},'spectrum':host.spectrum.snapshot()}
        return {'track':song,'lyrics':host.lyrics(song),'spectrum':host.spectrum.snapshot(),'preview':host.controller.previewing}
    def spectrum(self):return self._trusted().spectrum.snapshot()
    def close(self):self._trusted().controller.dismiss();return {'closed':True}


class ExpansionWindow:
    def __init__(self,base,session,lyrics,*,controller=None,spectrum=None):
        self.base=base;self.session=session;self.lyrics=lyrics;self.controller=controller;self.spectrum=spectrum or MusicSpectrum()
        self.window=None;self.closed=False;self.lock=threading.RLock();self.creating=False;self.epoch=0;self.guard=None
    def show(self,song):
        import webview
        with self.lock:
            if self.closed or self.creating:return
            if self.window:self.window.show();return
            self.creating=True;epoch=self.epoch
        window=None
        try:
            screen=next((item for item in webview.screens if getattr(item,'is_primary',False)),webview.screens[0]);api=ExpansionAPI(self)
            url=self.session.entry(self.base,PAGE) if self.session else self.base+PAGE
            window=webview.create_window('Brivany · Expansión musical',url,js_api=api,width=int(screen.width),height=int(screen.height),x=int(getattr(screen,'x',0)),y=int(getattr(screen,'y',0)),frameless=True,easy_drag=False,hidden=True,background_color='#03060a')
            with self.lock:
                if self.closed or epoch!=self.epoch:window.destroy();return
                self.window=window;api._window=window
            if self.session:self.session.bind_window(window,self.base)
            window.events.closed+=lambda:self._closed(window)
            self.guard=threading.Timer(12,self.hide);self.guard.daemon=True;self.guard.start()
        finally:
            with self.lock:self.creating=False
    def _closed(self,window):
        with self.lock:
            if self.window is not window:return
            self.window=None
            if self.guard:self.guard.cancel();self.guard=None
        self.spectrum.stop()
    def hide(self):
        with self.lock:
            self.epoch+=1;window=self.window;self.window=None
            if self.guard:self.guard.cancel();self.guard=None
        self.spectrum.stop()
        if window:window.destroy()
    def close(self):self.closed=True;self.hide()
