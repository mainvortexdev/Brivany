"""Opt-in device activity policy and local Spotify gain, without audio capture."""
import json
import os
from pathlib import Path,PureWindowsPath
import threading
import time


def game_paths():
    paths=set()
    if os.name!='nt':return paths
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'System\GameConfigStore\Children') as root:
            for i in range(winreg.QueryInfoKey(root)[0]):
                try:
                    with winreg.OpenKey(root,winreg.EnumKey(root,i)) as key:
                        value=winreg.QueryValueEx(key,'MatchedExeFullPath')[0]
                        if isinstance(value,str):paths.add(value.casefold().replace('/','\\'))
                except OSError:continue
    except OSError:pass
    return paths


def excluded_game(family,excluded=(),registered=()):
    known={'cs2.exe','dota2.exe','valorant-win64-shipping.exe','fortniteclient-win64-shipping.exe','robloxplayerbeta.exe','minecraft.windows.exe','league of legends.exe','overwatch.exe','rocketleague.exe','eldenring.exe','gta5.exe','gta5_enhanced.exe','rdr2.exe','cyberpunk2077.exe','starfield.exe','bf6.exe'}
    skip={item.casefold().replace('/','\\') for item in (*excluded,*registered)}
    for raw in family:
        path=raw.casefold().replace('/','\\');name=PureWindowsPath(path).name
        if path in skip or name in skip or name in known:return True
        if any(part in path for part in ('\\steamapps\\common\\','\\epic games\\','\\gog galaxy\\games\\','\\xboxgames\\','\\games\\')):return True
        if name.endswith('-win64-shipping.exe') or name.endswith('-wingdk-shipping.exe'):return True
    return False


def mixed_output(family):
    # FxSound renders the complete output mix, including our own Spotify host.
    # React to the original browser/app session instead of feeding that mix back.
    return bool(family and PureWindowsPath(family[0]).name.casefold()=='fxsound.exe')


class MusicDucking:
    def __init__(self,path,apply,*,meter_factory=None,clock=time.monotonic,supported=None,should_monitor=None):
        self.path=Path(path);self.apply=apply;self.clock=clock;self.supported=os.name=='nt' if supported is None else supported
        if should_monitor is not None and not callable(should_monitor):raise ValueError('La condición de monitorización debe ser una función.')
        self.meter_factory=meter_factory;self.should_monitor=should_monitor;self.lock=threading.RLock();self.stop=threading.Event();self.thread=None;self.monitoring=False
        self.changed = threading.Event()
        self.playing = None
        self.enabled=True;self.excluded=[];self.registered=game_paths();self.ducked=False;self.last_sound=-1e9;self.error='';self.internal=set()
        try:
            saved=json.loads(self.path.read_text(encoding='utf-8'));self.enabled=saved.get('enabled',True) is True
            self.excluded=[item for item in saved.get('excluded',[]) if isinstance(item,str) and 0<len(item)<=32768][:100]
        except (OSError,ValueError,TypeError):pass

    def status(self):
        with self.lock:return {'supported':self.supported,'enabled':self.enabled,'ducked':self.ducked,'monitoring':self.monitoring,'error':self.error,'excluded':[PureWindowsPath(p).name for p in self.excluded]}

    def configure(self,enabled=None,exclude=None,remove=None):
        with self.lock:
            if enabled is not None:
                if type(enabled) is not bool:raise ValueError('Estado de reducción de música no válido.')
                self.enabled=enabled
            if exclude is not None:
                if not isinstance(exclude,str) or not 1<=len(exclude)<=32768 or not exclude.lower().endswith('.exe') or any(ord(c)<32 for c in exclude):raise ValueError('Elige un ejecutable de juego.')
                if len(self.excluded)>=100:raise ValueError('Se alcanzó el límite de exclusiones.')
                if exclude.casefold() not in {p.casefold() for p in self.excluded}:self.excluded.append(exclude)
            if remove is not None:
                if type(remove) is not int or not 0<=remove<len(self.excluded):raise ValueError('Exclusión no disponible.')
                self.excluded.pop(remove)
            self.path.parent.mkdir(parents=True,exist_ok=True);temporary=self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps({'enabled':self.enabled,'excluded':self.excluded}),encoding='utf-8');temporary.replace(self.path)
            if not self.enabled:self.last_sound=-1e9;self._set(False)
            self.playback_changed(force=True)
            return self.status()

    def _set(self,value):
        if self.ducked==value:return
        try:self.apply(value);self.ducked=value;self.error=''
        except Exception:self.error='No se pudo ajustar la música.'

    def set_internal(self,source,active):
        with self.lock:
            if active:self.internal.add(source)
            else:self.internal.discard(source)

    def observe(self,sessions):
        with self.lock:
            if self.error=='No se pudo consultar el audio del dispositivo.':self.error=''
            audible=bool(self.internal) or any(not s.get('owned') and not s.get('muted') and s.get('volume',1)>0 and s.get('peak',0)>.002 and not mixed_output(s.get('family',())) and not excluded_game(s.get('family',()),self.excluded,self.registered) for s in sessions)
            now=self.clock()
            if self.enabled and self.supported and audible:self.last_sound=now
            self._set(self.enabled and self.supported and now-self.last_sound<1.5)

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive() or not self.supported or self.stop.is_set():return
            self.thread=threading.Thread(target=self._run,name='brivany-music-ducking',daemon=True);self.thread.start()

    def _needed(self):
        try:
            return self.enabled and (self.should_monitor is None or self.should_monitor())
        except Exception:
            return False

    def playback_changed(self, *, force=False):
        """Wake on the first local playback and on actual state transitions."""
        with self.lock:
            if self.stop.is_set():
                return
            needed = self._needed()
            if not force and needed == self.playing:
                return
            self.playing = needed
            self.changed.set()
            if needed and self.should_monitor is not None:
                self.start()

    def _run(self):
        meter=None
        def release():
            nonlocal meter
            if meter is not None:
                try:meter.close()
                except Exception:pass
                meter=None
            with self.lock:self.monitoring=False
        try:
            while not self.stop.is_set():
                # Clear before observing the predicate so no transition is
                # lost between the predicate and the blocking wait.
                self.changed.clear()
                if self.stop.is_set():break
                if not self._needed():
                    # COM meter lives and dies on this worker. A paused/absent
                    # local player never enumerates endpoints or audio sessions.
                    release()
                    with self.lock:self.last_sound=-1e9;self._set(False)
                    self.changed.wait()
                    continue
                try:
                    if meter is None:
                        if self.meter_factory:meter=self.meter_factory()
                        else:
                            from .audio_sessions import WindowsSessionMeter
                            meter=WindowsSessionMeter()
                        with self.lock:self.monitoring=True
                    sessions=meter.read()
                    with self.lock:
                        if self.stop.is_set():break
                        if self._needed():self.observe(sessions)
                except Exception:
                    release()
                    with self.lock:self._set(False);self.error='No se pudo consultar el audio del dispositivo.'
                    self.changed.wait(2)
                    continue
                self.changed.wait(.1)
        except Exception:
            with self.lock:self.error='La reducción automática de música no está disponible.'
        finally:
            release()
            with self.lock:self.last_sound=-1e9;self._set(False)

    def close(self):
        self.stop.set()
        self.changed.set()
        if self.thread and self.thread is not threading.current_thread():self.thread.join(timeout=3)
        with self.lock:self._set(False)
