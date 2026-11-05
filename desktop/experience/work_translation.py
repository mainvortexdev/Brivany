"""Native-only one-click translation commands; no microphone or navigation."""
import json
import threading
import time
from services.work.live_translation import WorkLiveTranslation
from .scripts import post_script

_SYNC_CREATION_LOCK=threading.RLock()

class WorkTranslationBridge:
    def _translation_preferences(self):
        with _SYNC_CREATION_LOCK:
            if not getattr(self,'_translation_preferences_store',None):
                from services.activity import ROOT
                from services.work.translation_preferences import TranslationPreferences
                self._translation_preferences_store=TranslationPreferences(ROOT/'.local/work/translation-ui.json')
            return self._translation_preferences_store
    def work_translation_preferences(self,show_transcript=None):
        self._trusted();store=self._translation_preferences()
        value=store.status() if show_transcript is None else store.configure(show_transcript)
        relay=getattr(self,'_sync_translation_relay',None)
        hub=getattr(self,'_selected_video_hub',None)
        if relay:relay.publish_video_preferences()
        elif hub:hub.publish_preferences()
        return value
    def work_voice_cloning(self,enabled,language='es',consent=False):
        self._trusted()
        if type(enabled) is not bool or language not in ('es','en','fr') or enabled and consent is not True:raise ValueError('La clonación requiere permiso de los hablantes y el idioma original.')
        translator=getattr(self,'_work_translation',None);relay=getattr(self,'_sync_translation_relay',None)
        if translator and translator.status()['active'] or relay and relay.status()['active_sessions']:raise ValueError('Detén la traducción antes de cambiar las voces.')
        self._translation_voice_settings={'enabled':enabled,'language':language}
        return dict(self._translation_voice_settings)
    def _sync_translation(self):
        with _SYNC_CREATION_LOCK:
            if not getattr(self,'_sync_translation_relay',None):
                self._sync_translation_relay=self._sync_translation_factory().start()
            return self._sync_translation_relay
    def work_sync_translation_status(self):
        self._trusted();relay=getattr(self,'_sync_translation_relay',None)
        if not relay:return {'available':False,'paired_browsers':0,'active_sessions':0,'preferred_mode':'synchronized'}
        value=relay.status()
        if value.get('inline_video_active'):self._browser_translation_pending_until=0
        return value
    def work_sync_translation_prepare(self,mode='synchronized'):
        self._trusted()
        if mode not in ('synchronized','preproduction'):raise ValueError('Modo de traducción no válido.')
        self._close_work_translation()
        relay=self._sync_translation();relay.set_mode(mode)
        if getattr(relay,'automatic_origin',None):relay.automatic_enabled=True
        return relay.status()
    def work_audio_translation_mode(self,mode):
        self._trusted()
        if mode not in ('direct','synchronized','preproduction'):raise ValueError('Modo de traducción no válido.')
        translator=getattr(self,'_work_translation',None);relay=getattr(self,'_sync_translation_relay',None)
        if translator and translator.status()['active'] or relay and relay.status()['active_sessions']:raise ValueError('Detén la traducción antes de cambiar de modo.')
        if mode!='direct':self.work_sync_translation_prepare(mode)
        self._auditory_mode=mode;self._publish_audio_translation({'mode':mode})
        return {'mode':mode}
    def work_sync_translation_pair(self):
        self._trusted();return self._sync_translation().issue_pairing()
    def work_video_transcription(self):
        self._trusted();hub=getattr(self,'_selected_video_hub',None);selected=hub.selected() if hub else None
        return selected.snapshot() if selected else {'selected':False}
    def work_sync_translation_revoke(self):
        self._trusted();relay=getattr(self,'_sync_translation_relay',None)
        if relay:relay.revoke_all()
        return self.work_sync_translation_status()
    def work_sync_translation_stop(self):
        self._trusted();self._browser_translation_pending_until=0;relay=getattr(self,'_sync_translation_relay',None)
        if relay:
            with relay.lock:
                inline=list(getattr(relay,'inline_video_clients',()))
                connections=inline or list(relay.connections)
            for socket in connections:
                if inline:socket.close(code=1000,reason='workspace-stop')
                else:socket.close()
        return self.work_sync_translation_status()
    def work_sync_translation_extension(self):
        self._trusted()
        import os,subprocess,sys
        from pathlib import Path
        path=Path(__file__).resolve().parents[2]/'browser-extension'
        if not (path/'manifest.json').is_file():raise ValueError('La extensión no está disponible.')
        if os.name=='nt':os.startfile(str(path))
        else:subprocess.Popen(['open' if sys.platform=='darwin' else 'xdg-open',str(path)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return {'opened':True}
    def _close_sync_translation(self):
        relay=getattr(self,'_sync_translation_relay',None)
        if relay:relay.close()
    def _publish_audio_translation(self,value):
        script='window.BrivanyTranslation?.receive('+json.dumps(value,ensure_ascii=True)+')'
        for window in (getattr(self,'_bar_window',None),getattr(self,'_work_window',None)):
            if window:
                try:post_script(window,script,'translation')
                except Exception:pass
    def _audio_translation(self):
        if not getattr(self,'_work_translation',None):
            factory=getattr(self,'_work_translation_factory',WorkLiveTranslation)
            self._work_translation=factory()
        return self._work_translation
    def work_browser_translation_start(self,target='en',voice='auto'):
        self._trusted()
        if target not in ('en','es','fr') or voice not in ('auto','masculine','feminine'):raise ValueError('Idioma o voz no válidos.')
        owner=self._audio_translation()
        if owner.status()['active']:return owner.status()
        owner.set_target(target);owner.set_voice(voice);self._auditory_mode='direct'
        relay=self._sync_translation()
        if relay.status().get('active_sessions'):return {'active':False,'state':'idle','mode':'direct'}
        relay.request_video()
        value={**owner.status(),'mode':'direct'}
        if not value['active']:
            self._browser_translation_pending_until=time.monotonic()+30
            value.update(state='selecting',awaiting_browser=True,error='')
        self._publish_audio_translation(value)
        return value
    def work_audio_translation_start(self,target='en',voice='auto'):
        self._trusted()
        hub=getattr(self,'_selected_video_hub',None)
        if hub and hub.selected():self._auditory_mode='direct'
        post_script(self._window,"document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.stopLive?.()",'stop-live')
        value=self._audio_translation().start(target,voice)
        ducker=getattr(self,'_audio_ducker',None)
        if ducker:ducker.set_internal('work-translation',True)
        self._publish_audio_translation(value)
        return value
    def work_audio_translation_stop(self):
        self._trusted();self._browser_translation_pending_until=0;translator=self._audio_translation();value=getattr(translator,'stop',translator.close)()
        selected=getattr(translator,'source_video',None) or getattr(getattr(translator,'route',None),'video',None)
        if selected and selected.translation_requested and not selected.stopped.is_set():
            try:selected.send({'type':'translation-state','state':'stopped'})
            except Exception:pass
            selected.close()
            threading.Thread(target=selected.socket.close,daemon=True,name='brivany-video-stop').start()
        ducker=getattr(self,'_audio_ducker',None)
        if ducker:ducker.set_internal('work-translation',False)
        self._publish_audio_translation(value)
        return value
    def work_audio_translation_target(self,target):
        self._trusted();value=self._audio_translation().set_target(target);self._publish_audio_translation(value);return value
    def work_audio_translation_voice(self,mode):
        self._trusted();value=self._audio_translation().set_voice(mode);self._publish_audio_translation(value);return value
    def _close_work_translation(self):
        if getattr(self,'_work_translation',None):self._work_translation.close()
        ducker=getattr(self,'_audio_ducker',None)
        if ducker:ducker.set_internal('work-translation',False)
