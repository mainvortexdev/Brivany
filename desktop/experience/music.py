"""Native Spotify actions; credentials never cross into the renderer."""
import webbrowser
from services.spotify import SpotifyError
from .scripts import post_script


class MusicBridge:
    def _configure_music_expansion(self,enabled):
        from .music_expansion import IdleMusicController,ExpansionWindow
        if not hasattr(self,'_music_idle'):
            if not enabled:return
            host=ExpansionWindow(self._base,getattr(self,'_desktop_ui_session',None),self._expansion_lyrics)
            def suppressed():
                # Do not cover a call, microphone session, recording or a transfer.
                phone=getattr(self,'_workspace_file_transfer',None);recording=getattr(self,'_workspace_recorder',None)
                return bool(getattr(self,'_exit_requested',False) or getattr(self,'_workspace_voice_active',False) or phone and phone.snapshot().get('state') in {'sending','receiving'} or recording and recording.snapshot().get('active'))
            idle=IdleMusicController(self._expansion_song,host.show,host.hide,suppressed=suppressed);host.controller=idle
            self._music_idle=idle;self._music_expansion_window=host
        self._music_idle.configure(enabled)
    def _expansion_song(self):
        import time
        presence=getattr(self,'_youtube_music_presence',None);youtube=presence.current() if presence else None
        if youtube:return youtube
        music=self._spotify_factory()
        if not music.status().get('connected'):return None
        value=music.playback();track=value.get('playback')
        if not track or not track.get('playing'):return None
        track=dict(track);track['source']='spotify'
        if isinstance(value.get('observed_at'),(int,float)):track['progress_ms']=min(track.get('duration_ms',0),track.get('progress_ms',0)+max(0,round((time.time()-value['observed_at'])*1000)))
        return track
    def _expansion_lyrics(self,track):
        result=self._spotify_factory().lyrics_provider.lookup_synced(track)
        if track.get('source')=='youtube' and result.get('status')!='ready':
            hub=getattr(self,'_selected_video_hub',None);selected=hub.selected() if hub else None;read_timeline=getattr(selected,'timeline',None);timeline=read_timeline() if read_timeline else None
            if timeline and timeline.get('source')==track.get('id') and timeline.get('cues'):
                return {'track_id':track['id'],'status':'ready','synced':True,'provider':'Subtítulos de YouTube','lines':[{'ms':round(cue['start']*1000),'text':cue['text']} for cue in timeline['cues'][:800]]}
        return result
    def workspace_music_expansion_preview(self):
        self._trusted()
        idle=getattr(self,'_music_idle',None)
        if idle is None:raise ValueError('Marca primero Expansión musical en Ajustes.')
        return idle.preview()
    def _close_music_expansion(self):
        idle=getattr(self,'_music_idle',None);host=getattr(self,'_music_expansion_window',None)
        if idle:idle.close()
        if host:host.close()
    def _music_ui_diagnostics(self):
        result={}
        for name in ('bar','work','voice'):
            window=getattr(self,'_'+name+'_window',None)
            if window:
                try:result[name]=window.evaluate_js("(()=>{const b=document.body,w=document.querySelector('.workspace-waves'),v=document.querySelector('#voice-wave');return {playing:b.dataset.musicPlaying,ambience:b.dataset.musicAmbience,motion:b.dataset.motion,listening:b.dataset.liveListening,speaking:b.dataset.liveSpeaking,waveOpacity:w?getComputedStyle(w).opacity:null,voiceCanvas:v?{width:v.width,height:v.height}:null};})()")
                except Exception:result[name]={'unavailable':True}
        return result
    def music_voice_active(self,active):
        self._trusted()
        if type(active) is not bool:raise ValueError('Estado de voz no válido.')
        ducker=getattr(self,'_audio_ducker',None)
        if ducker:ducker.set_internal('voice',active)
        return {'ok':True}
    def music_media_active(self,active):
        self._trusted()
        if type(active) is not bool:raise ValueError('Estado de reproducción no válido.')
        ducker=getattr(self,'_audio_ducker',None)
        if ducker:ducker.set_internal('media',active)
        return {'ok':True}
    def music_ducking_status(self):
        self._trusted()
        ducker=getattr(self,'_audio_ducker',None)
        return ducker.status() if ducker else {'supported':False,'enabled':False,'ducked':False,'excluded':[],'error':''}
    def music_ducking_configure(self,enabled=None,remove=None):
        self._trusted();return self._audio_ducker.configure(enabled=enabled,remove=remove)
    def music_ducking_add_game(self):
        self._trusted()
        import webview
        chosen=self._window.create_file_dialog(webview.FileDialog.OPEN,allow_multiple=False,file_types=('Programas (*.exe)',))
        if chosen:self._audio_ducker.configure(exclude=str(chosen[0]))
        return self.music_ducking_status()
    def _music(self):self._trusted();return self._spotify_factory()
    def spotify_status(self):return self._music().status()
    def spotify_connect(self):
        self._trusted();self._close_spotify_player()
        url=self._music().begin()
        if not webbrowser.open(url):
            self._music().cancel_link();raise SpotifyError('No se pudo abrir el navegador para vincular Spotify.')
        return {'ok':True}
    def spotify_cancel_link(self):
        music=self._music();music.cancel_link();return music.status()
    def _close_spotify_player(self):
        host=getattr(self,'_spotify_player_host',None)
        if host:host.close()
    def spotify_disconnect(self):
        self._trusted();self._close_spotify_player();return self._music().disconnect()
    def spotify_start_player(self):
        from desktop.experience.spotify_player import start_player
        return start_player(self)
    def spotify_refresh(self):
        music=self._music()
        with music.lock:music.cache=None;music.devices_at=0;music.current_fallback_at=-999
        return music.playback()
    def spotify_playback(self):return self._music().playback()
    def _broadcast_spotify(self,state):
        import json
        for window in (getattr(self,'_bar_window',None),getattr(self,'_work_window',None)):
            if window:
                try:post_script(window,'window.BrivanyIsland?.receivePlayback('+json.dumps(state)+')','spotify-state')
                except Exception:pass
    def spotify_command(self,action,value=None):
        music=self._music();host=getattr(self,'_spotify_player_host',None);state=music.sdk_current() or music.playback();p=(state.get('playback') or {})
        if action=='play' and state.get('recovery_available'):
            restored=music.restore_playback()
            if restored:return restored
        if host and host._window and action in ('play','pause','next','previous','seek','volume') and p.get('device') and p.get('device')==music.local_player.get('id'):
            disallow={'play':'resuming','pause':'pausing','next':'skipping_next','previous':'skipping_prev','seek':'seeking'}
            if (p.get('disallows') or {}).get(disallow.get(action)):raise SpotifyError('Spotify restringe este control.')
            if action=='seek' and (type(value) is not int or not 0<=value<=p.get('duration_ms',0)):raise SpotifyError('Posición inválida.')
            return host.command(action,value)
        return music.command(action,value)
    def spotify_open(self):
        state=self._music().playback();url=(state.get('playback') or state.get('last_listened') or {}).get('url')
        if not url:url='https://open.spotify.com'
        return {'ok':bool(webbrowser.open(url))}
    def spotify_dashboard(self):
        self._trusted();return {'ok':bool(webbrowser.open('https://developer.spotify.com/dashboard'))}
    def spotify_library(self,kind='playlists',page=0):return self._music().library(kind,page)
    def spotify_play_item(self,uri,device_id=None):return self._music().play_item(uri,device_id)
    def spotify_palette(self,track_id=None):return self._music().current_palette(track_id)
    def spotify_lyrics(self,track_id=None):return self._music().current_lyrics(track_id)
    def spotify_lyrics_source(self,provider='LRCLIB'):
        self._trusted();return {'ok':bool(webbrowser.open({'Lyrics.ovh':'https://lyrics.ovh','SyncLRC':'https://synclrc.dev'}.get(provider,'https://lrclib.net')))}
