"""One persistent, hidden SDK host with its own narrowly scoped native bridge.

Only this exact local page receives short-lived access tokens. Refresh tokens
and PKCE stay native; WorkSpace, modules and chat never receive them.
"""
from urllib.parse import urlsplit
import json
import secrets
import threading
from services.spotify import SpotifyError
from .scripts import post_script


class SpotifyPlayerBridge:
    def __init__(self,music,base,on_state=None,on_activity=None):
        self._music=music;self._base=base;self._window=None;self._on_state=on_state
        self._pending={};self._lock=threading.Lock()
        self._ducked=False
        self._on_activity=on_activity
    def ducking(self):
        self._trusted();return {'active':self._ducked}
    def set_ducked(self,active):
        self._ducked=active is True
        if self._window:post_script(self._window,'window.BrivanySpotifyPlayer?.duck('+json.dumps(self._ducked)+')','spotify-ducking')
    def _trusted(self):
        value=urlsplit(self._window.get_current_url() if self._window else '')
        base=urlsplit(self._base)
        if (value.scheme,value.hostname,value.port,value.path)!=(base.scheme,base.hostname,base.port,'/spotify-player'):
            raise ValueError('Reproductor no autorizado.')
    def token(self):
        self._trusted();return self._music.sdk_token()
    def event(self,kind,device_id=''):
        self._trusted();state=self._music.sdk_event(kind,device_id)
        if self._on_activity:self._on_activity()
        return state
    def playback(self,value):
        self._trusted();state=self._music.sdk_playback(value)
        if self._on_activity:self._on_activity()
        if state and self._on_state:self._on_state(state)
        return {'ok':True}
    def result(self,identifier,ok):
        self._trusted()
        with self._lock:
            pending=self._pending.get(identifier)
            if pending:pending['ok']=ok is True;pending['event'].set()
        return {'ok':True}
    def command(self,action,value=None):
        if action not in ('play','pause','next','previous','seek','volume'):raise SpotifyError('Control local inválido.')
        if action=='seek' and (type(value) is not int or not 0<=value<=86400000):raise SpotifyError('Posición inválida.')
        if action=='volume' and (type(value) is not int or not 0<=value<=100):raise SpotifyError('Volumen inválido.')
        if not self._window:raise SpotifyError('El reproductor Brivany no está abierto.')
        identifier=secrets.token_hex(16);pending={'event':threading.Event(),'ok':False}
        with self._lock:self._pending[identifier]=pending
        try:
            args=','.join(json.dumps(v) for v in (identifier,action,value))
            self._window.evaluate_js('void window.BrivanySpotifyPlayer.command('+args+')')
            if not pending['event'].wait(8):raise SpotifyError('Brivany no confirmó el control de audio. Vuelve a intentarlo.')
            if not pending['ok']:raise SpotifyError('El reproductor Brivany no pudo completar el control. Revisa la conexión de audio.')
            return {'accepted':True,'state':self._music.sdk_current()}
        finally:
            with self._lock:self._pending.pop(identifier,None)
    def health(self):
        result={'available':False}
        if self._window:
            try:
                from System import Action
                native=self._window.native
                def read():
                    core=native.webview.CoreWebView2
                    result.update(available=True,muted=bool(core.IsMuted),document_audio=bool(core.IsDocumentPlayingAudio),visible=bool(native.Visible))
                if native.InvokeRequired:native.Invoke(Action(read))
                else:read()
            except (ImportError,AttributeError,RuntimeError):pass
        return result
    def close(self):
        if self._window:
            try:self._window.evaluate_js('window.BrivanySpotifyPlayer?.dispose()')
            except Exception:pass
            try:self._window.destroy()
            except Exception:pass
            self._window=None
        with self._lock:
            for pending in self._pending.values():pending['event'].set()
        self._music.sdk_event('idle')
        if self._on_activity:self._on_activity()


def start_player(owner):
    music=owner._music()
    if not music.status()['streaming_access']:
        raise ValueError('Actualiza el acceso de Spotify en Conexiones para reproducir aquí. Spotify Premium es necesario.')
    host=getattr(owner,'_spotify_player_host',None)
    if host and host._window:
        if music.status()['local_player']['state'] in ('starting','ready'):return music.status()['local_player']
        host.close()
    import webview
    ducker=getattr(owner,'_audio_ducker',None)
    def update_activity():
        if ducker and owner._spotify_player_host is host:
            ducker.playback_changed()
    host=SpotifyPlayerBridge(music,owner._base,getattr(owner,'_broadcast_spotify',None),update_activity)
    owner._spotify_player_host=host
    if ducker:host._ducked=ducker.status()['ducked']
    music.sdk_event('starting')
    off_x=off_y=-10000
    try:
        import ctypes
        user=ctypes.WinDLL('user32',use_last_error=True);off_x=user.GetSystemMetrics(76)-640;off_y=user.GetSystemMetrics(77)-360
    except AttributeError:pass
    entry=getattr(owner,'_desktop_url',lambda path:owner._base+path)
    host._window=webview.create_window('Brivany · Audio',entry('/spotify-player'),js_api=host,
        width=320,height=180,x=off_x,y=off_y,hidden=True,frameless=True,resizable=False,on_top=False,focus=False)
    session=getattr(owner,'_desktop_ui_session',None)
    if session:session.bind_window(host._window,owner._base)
    def loaded():
        try:
            from System import Action
            native=host._window.native
            def configure():
                native.ShowInTaskbar=False
                native.webview.CoreWebView2.IsMuted=False
                # A permanently hidden WebView2 can register Spotify and advance
                # its clock without producing audio. Keep its controller rendered
                # offscreen, without activation or a taskbar entry.
                import ctypes
                user=ctypes.WinDLL('user32',use_last_error=True)
                user.ShowWindow.argtypes=[ctypes.c_void_p,ctypes.c_int]
                user.ShowWindow(int(native.Handle.ToInt64()),4) # SW_SHOWNOACTIVATE
            if native.InvokeRequired:native.Invoke(Action(configure))
            else:configure()
        except (ImportError,AttributeError):
            host._window.show() # Other platform engines keep their offscreen host alive.
    host._window.events.loaded+=loaded
    return music.status()['local_player']
