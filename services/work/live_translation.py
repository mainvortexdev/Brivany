"""Explicit WorkSpace translation. Bounded temporary PCM, no chat/GUI owner."""
import json
import queue
import threading
import time
from collections import deque
from packages.providers.river_translation import RiverBridge,river_status
from packages.providers.native_audio import open_native_audio
from packages.providers.pcm_pacing import PCMFrameClock
from .system_translation_audio import SystemAudioRoute


# Errors that a reconnect cannot fix (configuration, access, quota, device).
FATAL_CODES=frozenset({'configuration','access_blocked','options','language','voice_mode','volume','muse_rejected',
    'cartesia_quota','cartesia_limit','cartesia_rejected','mt_configuration_changed','pcm'})
RECOVERY_LIMIT=6
RECOVERY_WINDOW=300


class CapturePeer:
    """One provider session. Ending it (error) never stops the capture owner."""
    def __init__(self,owner):self.owner=owner;self.initial=True;self.ready=threading.Event();self.paused=False;self.pacing=PCMFrameClock();self.pending=None;self.flow_lock=threading.RLock();self.input_capacity=lambda:True;self.ended=threading.Event();self.error=None;self.done=False
    def set_input_capacity(self,check):self.input_capacity=check
    def recv(self,timeout=8):
        o=self.owner
        if self.initial:
            self.initial=False;return json.dumps({'type':'start','consent':True,'target_language':o.target,'voice_mode':o.voice,'original_gain':0,'continuous_input':True,'diarization':True})
        if o.stopped.is_set() or self.ended.is_set():return json.dumps({'type':'stop'})
        try:return json.dumps(o.controls.get_nowait())
        except queue.Empty:pass
        if not self.ready.is_set() or self.paused:time.sleep(min(timeout,.05));raise TimeoutError()
        if not self.input_capacity():
            with o.lock:o.input_waits=getattr(o,'input_waits',0)+1
            o.stopped.wait(min(timeout,.025));raise TimeoutError()
        if self.pending is None:
            try:self.pending=o.pcm.get(timeout=min(timeout,.1))
            except queue.Empty:raise TimeoutError()
        with self.flow_lock:delay=self.pacing.delay(time.monotonic())
        if o.stopped.wait(delay) or self.ended.is_set():return json.dumps({'type':'stop'})
        with self.flow_lock:
            if self.paused:raise TimeoutError()
            self.pacing.sent(time.monotonic())
            raw=self.pending;self.pending=None
        with o.lock:o.submitted+=len(raw)
        return raw
    def send(self,raw):
        event=json.loads(raw);kind=event.get('type');o=self.owner
        if o.stopped.is_set() or self.ended.is_set():return
        selected=getattr(o,'source_video',None) or getattr(getattr(o,'route',None),'video',None)
        if selected and kind=='transcript':selected.observe_translation(event)
        if kind=='ready':self.ready.set();o._update(state='listening')
        elif kind=='flow-control':
            with self.flow_lock:
                self.paused=event.get('paused') is True;self.pacing.reset()
        elif kind=='transcript' and event.get('source')=='translation':o._update(caption=str(event.get('text',''))[-600:],state='translating')
        elif kind=='voice-style':o._update(voice_category=event.get('voice_category'),voice_method=event.get('method'),speaker_label=event.get('speaker_label'),speaker_index=event.get('speaker_index'))
        elif kind=='content-filter':
            if event.get('filtered'):o._update(state='music',caption='',content=event.get('content'),song_filter_active=True)
            else:o._update(state='listening',content=event.get('content'),song_filter_active=True)
        elif kind=='metrics':o._update(first_audio_ms=event.get('first_audio_ms'))
        elif kind=='usage':o._update(segments=event.get('segments',0))
        elif kind=='error':
            # The owner decides between reconnecting and a final error.
            self.error=(str(event.get('code','translation_interrupted'))[:60],str(event.get('message','No se pudo traducir el audio.'))[:300]);self.ended.set()
        elif kind=='done':self.done=True;self.ended.set();o._update(state='stopped');o.stopped.set()
    def close(self):self.ended.set()


class WorkLiveTranslation:
    def __init__(self,*,route_factory=SystemAudioRoute,bridge_factory=RiverBridge,output_factory=open_native_audio,configuration=river_status,voice_agents_factory=None,cloning_settings=None,recovery_delay=.4,timeline_source=None,caption_translator_factory=None,synthesizer_factory=None):
        self.route_factory=route_factory;self.bridge_factory=bridge_factory;self.output_factory=output_factory;self.configuration=configuration
        # voice_agents_factory(language) -> agents; owned here so clones survive
        # provider reconnects and cloning can start without a restart.
        # Caption-scheduled dubbing (silent Brave extension): optional.
        self.timeline_source=timeline_source;self.caption_translator_factory=caption_translator_factory;self.synthesizer_factory=synthesizer_factory;self.caption_dubbing=None
        self.voice_agents_factory=voice_agents_factory;self.cloning_settings=cloning_settings;self.voice_agents=None;self.cloning_language=None;self.recovery_delay=recovery_delay;self.recoveries=0
        self.lock=threading.RLock();self.stopped=threading.Event();self.stopped.set();self.worker=None;self.capture=None;self.pcm=queue.Queue(maxsize=1500);self.controls=queue.Queue(maxsize=4);self.target='en';self.voice='auto';self.submitted=0;self.captured=0;self.state={'state':'idle','caption':'','error':'','segments':0};self.bridge=None;self.started=0;self.route_ready=threading.Event();self.route=None;self.output=None;self.control_generation=0;self.restarting=False
    def _update(self,**value):
        with self.lock:
            previous=self.state.get('state');self.state.update(value)
            selected=getattr(self,'source_video',None) or getattr(self.route,'video',None)
        if selected and value.get('state') and value['state']!=previous:
            selected.state=value['state']
            try:selected.send({'type':'error','message':value.get('error','La traducción se interrumpió.')} if value['state']=='error' else {'type':'translation-state','state':value['state']})
            except Exception:pass
    def start(self,target='en',voice='auto',*,route_factory=None):
        if target not in ('en','es','fr') or voice not in ('auto','masculine','feminine'):raise ValueError('Idioma o voz no válidos.')
        with self.lock:
            if self.worker and self.worker.is_alive() or self.capture and self.capture.is_alive():raise ValueError('La traducción ya está activa o terminando.')
            config=self.configuration()
            if not config.get('configured') or config.get('access_blocked'):
                self.control_generation+=1
                self._update(state='error',caption='',error='Revisa Muse, Meta y Cartesia en Ajustes → Servicios.')
                raise ValueError(self.state['error'])
            self.control_generation+=1;self.stopped=threading.Event();self.recoveries=0;self.target=target;self.voice=voice;self.pcm=queue.Queue(maxsize=1500);self.controls=queue.Queue(maxsize=4);self.submitted=0;self.captured=0;self.input_waits=0;self.started=time.monotonic();self.route_ready=threading.Event();self.route=None
            self.active_route_factory=route_factory or self.route_factory
            self.source_video=getattr(route_factory,'__self__',None) if route_factory else None
            self.state={'state':'starting','caption':'','error':'','segments':0,'voice_category':None,'voice_method':None,'first_audio_ms':None}
            self.worker=threading.Thread(target=self._run,daemon=True,name='melodi-work-translation');self.worker.start()
        return self.status()
    def _capture(self):
        route=None
        try:
            route=self.active_route_factory();self.route=route;route.reduce_original(.12);self.route_ready.set()
            for _,raw in route.packets(self.stopped):
                if self.stopped.is_set():break
                if not isinstance(raw,bytes) or len(raw)!=3840:raise ValueError('El dispositivo entregó un bloque de audio incompleto.')
                try:self.pcm.put_nowait(raw)
                except queue.Full:raise ValueError('La traducción acumula más de dos minutos de retraso. Se detuvo sin omitir audio silenciosamente.')
                with self.lock:self.captured+=len(raw)
        except Exception as error:
            self._update(state='error',error=str(error)[:300] if isinstance(error,ValueError) else 'No se pudo capturar el audio de salida.');self.stopped.set();self.route_ready.set()
        finally:
            if route:route.close()
    def _run(self):
        self.capture=threading.Thread(target=self._capture,daemon=True,name='melodi-render-only-capture');self.capture.start()
        try:
            if not self.route_ready.wait(6):self._update(state='error',error='El dispositivo no confirmó la captura. Vuelve a iniciar.');return
            if self.stopped.is_set():return
            route=self.route
            def output():
                device=self.output_factory(endpoint_id=route.output)
                with self.lock:self.output=device
                if self.stopped.is_set() and hasattr(device,'close'):device.close()
                return device
            settings=self.cloning_settings() if self.cloning_settings else {}
            if settings.get('enabled') and self.voice_agents_factory and not self.stopped.is_set():
                try:
                    with self.lock:self.voice_agents=self.voice_agents_factory(settings['language']);self.cloning_language=settings['language']
                except Exception:pass # Cloning is optional; translation continues with catalog voices.
            # One set of local speaker clusters for the whole translation:
            # reconnects keep "Hablante N" and its clone bound to the same voice.
            try:
                from packages.providers.acoustic_speakers import SessionSpeakers
                clusters=SessionSpeakers()
            except Exception:clusters=None
            dubbing=self._start_caption_dubbing()
            recent=deque()
            while not self.stopped.is_set():
                peer=CapturePeer(self)
                bridge=self.bridge_factory(0,mixer_factory=output)
                with self.lock:
                    self.bridge=bridge
                    if self.voice_agents:bridge.voice_agents=self.voice_agents
                    if clusters is not None:bridge.acoustic_session=clusters
                    if dubbing is not None:bridge.live_voice_suppressed=dubbing.active
                try:bridge.handle(peer)
                except Exception:peer.error=peer.error or ('translation_interrupted','La traducción se interrumpió.')
                finally:
                    try:bridge.close()
                    except Exception:pass
                    with self.lock:
                        if self.bridge is bridge:self.bridge=None
                    self.output=None
                if self.stopped.is_set() or peer.done:break
                # The provider session ended without a user stop. Capture keeps
                # running and queued PCM is kept; reconnect unless the cause
                # cannot be fixed by a new session or keeps repeating.
                code,message=peer.error or ('translation_interrupted','La traducción se interrumpió.')
                now=time.monotonic()
                while recent and now-recent[0]>RECOVERY_WINDOW:recent.popleft()
                if code in FATAL_CODES or code.startswith('native_audio') or len(recent)>=RECOVERY_LIMIT:
                    self._update(state='error',error=message,error_code=code);break
                recent.append(now)
                with self.lock:self.recoveries+=1
                self._update(state='reconnecting',error='',last_recovered_code=code)
                if self.stopped.wait(self.recovery_delay):break
        except Exception:
            if not self.stopped.is_set():self._update(state='error',error='La traducción se interrumpió.')
        finally:
            self.stopped.set()
            if self.capture:self.capture.join(timeout=3)
            with self.lock:dubbing_done=self.caption_dubbing;self.caption_dubbing=None
            if dubbing_done:dubbing_done.close()
            with self.lock:agents=self.voice_agents;self.voice_agents=None;self.cloning_language=None;self.last_voice_agents=agents
            # Session end: unkept clones are deleted, kept ones are saved.
            if agents:agents.close()
            self.output=None
            while True:
                try:self.pcm.get_nowait()
                except queue.Empty:break
            with self.lock:
                if self.state['state']!='error' and not self.restarting:self.state['state']='stopped'
    def status(self):
        with self.lock:
            running=self.restarting or bool(self.worker and self.worker.is_alive() and not self.stopped.is_set())
            agents=self.voice_agents or (getattr(self.bridge,'voice_agents',None) if self.bridge else None) or getattr(self,'last_voice_agents',None)
            return {**self.state,'voice_agents':agents.status() if agents else {},'control_revision':self.control_generation,'active':running,'target':self.target,'voice':self.voice,'elapsed_seconds':round(time.monotonic()-self.started,1) if self.started else 0,'buffered_seconds':round(self.pcm.qsize()*.08,2),'captured_seconds':round(self.captured/48000,2),'submitted_seconds':round(self.submitted/48000,2),'original_gain':.12,'microphone_captured':False,'source':'selected_video' if self.route and self.route.source=='selected-video' else 'system_output','feedback_isolated':bool(self.route and self.route.source!=self.route.output),'audio_persisted':False,'billing_amount':None,'recoveries':self.recoveries,'voice_cloning_active':bool(self.voice_agents),'caption_dubbing':self.caption_dubbing.status() if self.caption_dubbing else None}
    def audio_diagnostics(self):
        """Counters only, on demand; never PCM, text, device IDs or credentials."""
        with self.lock:output=self.output
        if not output or not hasattr(output,'stats'):return {'available':False,'physical_listening_verified':False,'input_waits':getattr(self,'input_waits',0)}
        value=output.stats();device=value.get('device',{})
        return {'available':True,'translation_bytes':value.get('accepted_bytes',{}).get('translation',0),
                'output_bytes':value.get('output_bytes',0),'device_position_bytes':device.get('position_bytes',0),
                'error_code':value.get('error_code'),'physical_listening_verified':False,'input_waits':getattr(self,'input_waits',0)}
    def set_voice(self,mode):
        if mode not in ('auto','masculine','feminine'):raise ValueError('Voz no válida.')
        with self.lock:
            if self.status()['active']:
                try:self.controls.put_nowait({'type':'voice_mode','mode':mode})
                except queue.Full:raise ValueError('Espera un momento antes de volver a cambiar la voz.')
            self.voice=mode
        return self.status()
    def _start_caption_dubbing(self):
        def _dub_event(name,**values):
            from services.work import selected_video
            selected_video.selection_event(name,**{k:v for k,v in values.items() if k in ('ms','audio_ms','late_ms','reason','speed','start','state')})
        """Start the scheduler only when a timeline source and its providers exist."""
        if not (self.timeline_source and self.caption_translator_factory and self.synthesizer_factory):return None
        try:
            from packages.providers.caption_dubbing import CaptionDubbing
            dubbing=CaptionDubbing(self.timeline_source,target=self.target,translator_factory=self.caption_translator_factory,
                synthesizer=self.synthesizer_factory(),output_getter=lambda:self.output,
                voice_hint=lambda:getattr(self.bridge,'voice_hint_value',None),on_stage=_dub_event)
        except Exception as error:
            _dub_event('caption_dub_unavailable',reason=type(error).__name__);return None  # Optional: Directa continues with live voice.
        with self.lock:self.caption_dubbing=dubbing
        _dub_event('caption_dub_started',state='timeline' if self.timeline_source() else 'waiting')
        return dubbing.start()
    def set_voice_cloning(self,enabled,language='es'):
        """Start or stop background cloning without restarting translation.

        Enabling attaches new agents to the running provider session: speech
        keeps playing with catalog voices until each clone is ready, then the
        speaker's next clause uses it. Disabling closes the agents (unkept
        clones are deleted) and the next clause returns to catalog voices.
        """
        if type(enabled) is not bool or language not in ('es','en','fr'):raise ValueError('Datos de clonación no válidos.')
        with self.lock:
            current=self.voice_agents
            if enabled and current and self.cloning_language==language:return self.status()
            created=None
            if enabled and self.status()['active']:
                if not self.voice_agents_factory:raise ValueError('La clonación no está disponible en esta traducción.')
                created=self.voice_agents_factory(language)
            self.voice_agents=created;self.cloning_language=language if created else None
            if self.bridge:self.bridge.voice_agents=created
        if current:current.close()
        return self.status()
    def close(self):
        self.stop()
        # CapturePeer sees stop in <=100 ms; River closes native output first.
        if self.worker and self.worker is not threading.current_thread():self.worker.join(timeout=4)
        return self.status()
    def stop(self):
        with self.lock:
            self.control_generation+=1;self.restarting=False;self.stopped.set();output=self.output;self.state['state']='stopped'
        # Silence the device before any network or worker cleanup. A blocked
        # provider must not keep playing its old queued translation.
        if output and hasattr(output,'close'):
            try:output.close()
            except Exception:self._update(state='error',error='No se confirmó la parada de la salida de audio.')
        if self.state['state']!='error':self._update(state='stopped')
        return self.status()
    def set_target(self,target):
        if target not in ('en','es','fr'):raise ValueError('Idioma no válido.')
        if target==self.target:return self.status()
        active=self.status()['active'];voice=self.voice;self.stop()
        with self.lock:
            self.target=target;generation=self.control_generation;self.restarting=active;worker=self.worker;capture=self.capture
            if active:self.state.update(state='starting',caption='',error='')
        if active:
            def restart():
                for thread in (worker,capture):
                    if thread and thread is not threading.current_thread():thread.join(timeout=4)
                with self.lock:
                    if generation!=self.control_generation:return
                    if any(thread and thread.is_alive() for thread in (worker,capture)):
                        self.restarting=False;self.state.update(state='error',error='La sesión anterior sigue cerrándose. Vuelve a iniciar.');return
                    self.restarting=False
                    try:self.start(target,voice)
                    except ValueError as error:self.state.update(state='error',error=str(error))
            threading.Thread(target=restart,daemon=True,name='melodi-change-language').start()
        return self.status()
