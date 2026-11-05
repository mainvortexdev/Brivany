'use strict';
(() => {
  const $=id=>document.getElementById(id), video=$('dub-video');
  const pageOptions=new URLSearchParams(location.search),simpleMode=pageOptions.get('view')==='simple' || (pageOptions.get('view')!=='advanced' && pageOptions.get('source')==='youtube');
  let status=null, file=null, fileURL=null, session=null, generation=0, graph=null, graphPromise=null, statusSequence=0, statusController=null;
  let sourceMode='local',youtube=null,listeningOriginal=false;
  const sourcePaused=()=>sourceMode==='youtube'?youtube?.state!=='playing':video.paused;
  const pauseSource=()=>{if(sourceMode==='youtube')youtube?.pause();else video.pause();};
  const captureFor=current=>current.tabCapture || graph;
  function nativeOriginalGain(current){
    const gain=listeningOriginal || current.sameLanguage?1:originalVolume();
    if(!current.tabCapture)return gain;
    const mix=current.tabCapture.configureOriginal(gain);youtube.setVolume(mix.playerVolume);return mix.nativeOriginalGain;
  }
  function updateListening(){
    $('toggle-translation').setAttribute('aria-pressed',String(!listeningOriginal));$('toggle-translation').textContent=listeningOriginal?'Escuchar traducción':'Escuchar original';
    if(session?.nativeOutput){const originalGain=nativeOriginalGain(session);if(session.socket?.readyState===WebSocket.OPEN)session.socket.send(JSON.stringify({type:'audio_levels',original_gain:originalGain,translation_gain:listeningOriginal || session.sameLanguage?0:$('dub-volume').value/100}));}
    else{if(graph)graph.original.gain.value=listeningOriginal?1:originalVolume();if(session?.output)session.output.gain.value=listeningOriginal?0:$('dub-volume').value/100;}
    syncSimple();
  }
  async function loadYouTube(){
    stop();error('');$('youtube-status').textContent='Preparando reproductor…';
    try{if(!youtube)youtube=new BrivanyYouTubeSource.YouTubeSource($('youtube-player'),{
      onReady:()=>{controls();$('youtube-status').textContent='Video preparado. Inicia para compartir su audio en vivo.';if(simpleMode)notice('Listo para reproducir.');},
      onStateChange:event=>{syncSimple();if(!session || sourceMode!=='youtube')return;if(event.state==='paused' && session.state==='streaming')stop('Video pausado. Audio pendiente descartado.');else if(event.state==='ended')finish();},
      onError:message=>{const detail=typeof message==='string'?message:message?.message || 'YouTube no pudo reproducir este video. Prueba otro enlace.';if(session)stop(detail,true);else error(detail);controls();},
      onAutoplayBlocked:()=>notice('Pulsa reproducir en YouTube para comenzar. La traducción espera su audio.')});
      await youtube.loadUrl($('youtube-url').value);controls();
    }catch(exception){error(exception.message);$('youtube-status').textContent='Revisa el enlace o la conexión.';controls();}
  }
  function selectSource(mode,load=false){
    stop();sourceMode=mode;video.pause();if(mode==='local')youtube?.pause();
    $('source-local').setAttribute('aria-pressed',String(mode==='local'));$('source-youtube').setAttribute('aria-pressed',String(mode==='youtube'));
    $('local-source-panel').hidden=mode!=='local';$('youtube-source-panel').hidden=mode!=='youtube';
    if(mode==='youtube'){if($('original-volume').value==='0'){$('original-volume').value='12';$('original-volume-label').textContent='12 %';}$('dubbing-provider').value='palabra';providerChanged();if(load)loadYouTube();}
    controls();
  }
  const maxFileBytes=25*1024*1024;
  const originalVolume=()=>$('original-volume').value/100;
  const providerNames={palabra:'Palabra',elevenlabs:'ElevenLabs',meta:'Meta modular',gemini:'Google Gemini',openai:'OpenAI'};
  const selectedProvider=()=>$('dubbing-provider').value;
  const matchingStatus=()=>Boolean(status && status.provider===providerNames[selectedProvider()]);
  const languageLabels={es:'Español',fr:'Français',en:'English'};
  function syncSimple(){
    if(!simpleMode)return;
    const original=$('target-language').value===$('source-language').value;
    $('simple-play').textContent=session?'Pausar':'Reproducir con doblaje';
    $('simple-play').disabled=!session && (!youtube?.ready || (!original && (!matchingStatus() || !status.configured || status.available!==true || !voiceReady())));
    $('simple-language').textContent='Idioma · '+(languageLabels[$('target-language').value] || 'Español')+(original?' · original':'')+' ↻';
    $('simple-language').disabled=Boolean(session && (session.state!=='streaming' || session.switchPending));
  }
  const voiceReady=()=>selectedProvider()!=='elevenlabs' || status?.voice_configured===true;
  function contextualProfile(profile=null) {
    const node=$('translation-profile'),palabra=selectedProvider()==='palabra';node.hidden=!palabra;
    if(!palabra)return;
    const confirmed=(profile?.requested==='contextual_live' && profile?.effective==='contextual_live' && profile?.effective_verified===true) ||
      (profile?.quality_mode_requested==='contextual_live' && profile?.quality_mode_effective==='contextual_live' && profile?.quality_mode_verified_by==='observed_current_task_fields');
    node.dataset.requested='contextual_live';node.dataset.effective=confirmed?'contextual_live':'unknown';
    node.textContent='Contexto continuo · Palabra';
    node.title=confirmed?'Configuración contextual confirmada por Palabra. Latencia y calidad pendientes de medir.':'Perfil contextual solicitado. Confirmación del proveedor pendiente.';
  }
  function drainWaitMs(seconds) {
    if(!Number.isFinite(seconds)) return 10000;
    if(selectedProvider()==='palabra')return Math.min(35000,Math.max(10,seconds)*1000+500);
    // Allow a short scheduling margin while keeping the wait within 15 seconds.
    return Math.min(15000,Math.max(10,Math.min(15,seconds))*1000+250);
  }
  const directionValid=()=>selectedProvider()==='meta'?$('source-language').value==='en' && $('target-language').value==='es':(selectedProvider()==='palabra'?['auto','en','es','fr']:['en','es']).includes($('source-language').value) && (selectedProvider()==='palabra'?['en','es','fr']:['en','es']).includes($('target-language').value) && $('source-language').value!==$('target-language').value;
  function notice(message) { $('dub-notice').textContent=message;if(simpleMode){$('simple-status').textContent=message;$('simple-status').dataset.error='false';} }
  function error(message) { $('dub-error').hidden=!message; $('dub-error').textContent=message || '';if(simpleMode && message){$('simple-status').textContent=message;$('simple-status').dataset.error='true';} }
  function controls() {
    $('start-dubbing').disabled=Boolean(session) || (sourceMode==='youtube'?!youtube?.ready:!file) || !matchingStatus() || !status.configured || status.available!==true || !voiceReady() || !$('dub-consent').checked || !directionValid();
    $('start-dubbing').textContent=sourceMode==='youtube'?'Reproducir con doblaje':'Iniciar doblaje';
    $('stop-dubbing').disabled=!session;
    $('gemini-tail-silence').disabled=Boolean(session);
    $('dubbing-provider').disabled=Boolean(session);
    $('source-language').disabled=Boolean(session && session.state!=='streaming') || selectedProvider()==='meta';
    $('target-language').disabled=selectedProvider()==='meta' || Boolean(session && (session.provider!=='palabra' || session.state!=='streaming' || session.switchPending));
    $('toggle-translation').disabled=!session || session.state!=='streaming';$('load-youtube').disabled=Boolean(session);
    $('configure-dubbing').disabled=Boolean(session) || !matchingStatus() || selectedProvider()==='meta';
    $('session-state').dataset.active=String(Boolean(session));
    syncSimple();
  }
  async function loadStatus() {
    const selected=selectedProvider(), name=providerNames[selected], sequence=++statusSequence;
    statusController?.abort(); const controller=new AbortController(); statusController=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    status=null; $('provider-state').textContent=name+' · consultando conexión'; controls();
    try {
      const response=await fetch('/api/dubbing/status?provider='+encodeURIComponent(selected),{cache:'no-store',signal:controller.signal});
      if(!response.ok) throw Error('No se pudo comprobar la API.');
      const availableStatus=await response.json();
      if(sequence!==statusSequence || selected!==selectedProvider()) return;
      if(availableStatus.provider!==name) throw Error('provider_transition');
      status=availableStatus;
      contextualProfile(status.contextual_profile);
      $('provider-state').textContent=selected==='meta'?name+(status.configured?' · conexiones preparadas':' · revisar conexiones'):name+(status.configured?' · clave guardada':' · sin clave API');
      $('configure-dubbing').textContent=status.configured?'Cambiar clave':'Conectar API';
      $('session-limit').textContent=Math.min(60,status.max_seconds || 60);
      if(selected==='elevenlabs') $('provider-access-note').textContent='Traducción live: acceso Enterprise por comprobar.'+(status.voice_configured?' Voz de prueba configurada.':' Voz de prueba pendiente.');
      if(!session) notice(!status.configured?(selected==='meta'?'Revisa las conexiones existentes de Meta y Cloudflare en los ajustes de Melodi.':'Conecta una clave API para probar la traducción.'):status.available!==true?'La conexión local de doblaje no está disponible. Reinicia el servidor.':!voiceReady()?'Clave guardada. Falta elegir una voz de prueba antes de iniciar.':'Elige un video y activa el permiso de audio.');
    } catch(exception) {
      if(sequence!==statusSequence || selected!==selectedProvider()) return;
      status=null; $('provider-state').textContent=name+' · sin conexión'; notice(exception.message==='provider_transition'?'La integración de '+name+' se está preparando. Recarga cuando el servidor se actualice.':'No se pudo consultar el servidor local. Recarga para intentarlo de nuevo.');
    } finally { clearTimeout(timeout); if(sequence===statusSequence) controls(); }
  }
  function clearPlayer(current) {
    for(const source of current.sources) { try { source.stop(); source.disconnect(); } catch {} }
    current.sources.clear();
    current.output?.disconnect();
  }
  function stop(message='Doblaje detenido.', failure=false) {
    const current=session; session=null; generation++;
    if(current) {
      clearTimeout(current.connectTimer); clearTimeout(current.drainTimer); clearTimeout(current.endTimer);clearTimeout(current.voiceWaitTimer);clearInterval(current.clock);
      captureFor(current)?.capture.port.postMessage({active:false});clearPlayer(current);current.abort?.abort();current.tabCapture?.stop();
      if(current.socket?.readyState===WebSocket.OPEN)try{current.socket.send(JSON.stringify({type:'cancel'}));}catch{}
      if(current.socket && current.socket.readyState<2) current.socket.close();
    }
    pauseSource();if(sourceMode==='youtube')youtube?.setVolume(100);$('original-volume').min='0';$('session-state').textContent=failure?'Revisar':'En espera'; $('caption-state').textContent='Detenido';
    $('session-clock').textContent=current?`${(current.sentBytes/48000).toFixed(1)} s de audio enviados. Sin reenvío automático.`:'Sin sesión activa.';
    notice(message);error(failure?message:'');controls();
  }
  async function audioGraph() {
    const Audio=window.AudioContext || window.webkitAudioContext;
    if(!Audio || !window.AudioWorkletNode) throw Error('Este navegador no permite procesar el audio del video. Prueba con una versión actual compatible.');
    if(!graph && !graphPromise) graphPromise=(async()=>{
      const audio=new Audio({sampleRate:24000});
      try {
        await audio.audioWorklet.addModule('/dub-capture.js');
        const source=audio.createMediaElementSource(video), original=audio.createGain(), silent=audio.createGain();
        const capture=new AudioWorkletNode(audio,'brivany-dub-capture');
        original.gain.value=originalVolume(); silent.gain.value=0;
        source.connect(original); original.connect(audio.destination); source.connect(capture); capture.connect(silent); silent.connect(audio.destination);
        graph={audio,source,original,capture,silent}; video.volume=1;
        capture.port.onmessage=event=>sendAudio(event.data);
      } catch(error) { await audio.close(); throw error; }
      return graph;
    })().catch(exception=>{ graphPromise=null; throw exception; });
    if(!graph) await graphPromise;
    await graph.audio.resume();
    if(graph.audio.state!=='running') throw Error('Pulsa Iniciar doblaje para habilitar la salida de audio.');
    return graph;
  }
  function sendAudio(data) {
    const current=session;
    if(!current || data?.generation!==current.id || !['streaming','finishing'].includes(current.state) || current.socket?.readyState!==WebSocket.OPEN) return;
    if(data?.type==='flushed') {
      if(current.state==='finishing') current.socket.send(JSON.stringify({type:'finish'}));
      return;
    }
    const sourceContextEnd=data.source_context_end;
    data=data.buffer;
    if(!(data instanceof ArrayBuffer) || !data.byteLength || (current.state==='streaming' && sourcePaused())) return;
    if(current.socket.bufferedAmount>24000) { stop('La conexión no puede enviar el audio a tiempo. La sesión se detuvo para evitar acumular retraso.',true); return; }
    const remaining=current.maxSeconds*48000-current.sentBytes;
    if(remaining<=0) return;
    const bytes=data.byteLength>remaining?data.slice(0,remaining):data;
    if(Number.isFinite(sourceContextEnd) && !current.nativeOutput) {
      const samples=new Float32Array(bytes.byteLength/2),view=new DataView(bytes);
      for(let i=0;i<samples.length;i++) samples[i]=view.getInt16(i*2,true)/32768;
      current.sourceEnergy.observe(samples,24000,sourceContextEnd-data.byteLength/48000);
      current.segmentTiming.observeInput(samples.length,24000,sourceContextEnd-data.byteLength/48000);
      updateEnergyTiming(current);
    }
    if(current.firstInputAt===null) current.firstInputAt=performance.now();
    if(current.nativeOutput && !current.voiceWaitTimer && !current.playbackMeasured)current.voiceWaitTimer=setTimeout(()=>{if(session===current && !current.playbackMeasured)notice('El audio llega a Palabra. Aún no ha devuelto voz traducida.');},6000);
    current.socket.send(bytes); current.sentBytes+=bytes.byteLength;
    if(current.sentBytes>=current.maxSeconds*48000 && current.state==='streaming') finish();
  }
  function updateEnergyTiming(current) {
    const measured=BrivanyDubTiming.summarize(current.sourceEnergy.snapshot(),current.translatedEnergy.snapshot());
    if(Number.isFinite(measured.onset_to_onset_ms)) $('onset-delay-ms').textContent=Math.round(measured.onset_to_onset_ms)+' ms · estimación de energía';
    const segments=current.segmentTiming.snapshot();
    if(segments.correlated_segment_count) $('segment-delay-ms').textContent=Math.round(segments.max_observed_onset_delay_ms)+' ms máx. · '+segments.correlated_segment_count+(segments.correlated_segment_count===1?' fragmento':' fragmentos')+' · estimado'+
      (segments.uncorrelated_audio_segments || segments.silent_audio_segments || segments.pending_audio_segments || segments.unattributed_audio_chunks || segments.tracking_limited?' · cobertura parcial':'');
    else $('segment-delay-ms').textContent='Sin marcas correlacionadas';
  }
  function playAudio(current,event) {
    if(current.switchPending || (Number.isInteger(event.epoch) && event.epoch!==current.epoch))return;
    if(typeof event.audio!=='string' || event.audio.length>256000 || event.sample_rate!==24000) throw Error('La API devolvió un formato de audio no admitido.');
    const binary=atob(event.audio); let bytes=new Uint8Array(binary.length+(current.carry===null?0:1)), offset=0;
    if(current.carry!==null) { bytes[0]=current.carry; offset=1; current.carry=null; }
    for(let i=0;i<binary.length;i++) bytes[i+offset]=binary.charCodeAt(i);
    if(bytes.length%2) { current.carry=bytes.at(-1); bytes=bytes.subarray(0,bytes.length-1); }
    if(!bytes.length) return;
    const audio=graph.audio, now=audio.currentTime, duration=bytes.length/48000, when=Math.max(current.next,now+.035);
    if(when+duration-now>1) throw Error('La voz traducida acumuló más de un segundo de audio. Se detuvo para no reproducir contenido atrasado.');
    const buffer=audio.createBuffer(1,bytes.length/2,24000), samples=buffer.getChannelData(0), view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let i=0;i<samples.length;i++) samples[i]=view.getInt16(i*2,true)/32768;
    const source=audio.createBufferSource(); source.buffer=buffer; source.connect(current.output); current.sources.add(source);
    source.onended=()=>{ current.sources.delete(source); source.disconnect(); };
    source.start(when); current.next=when+duration;
    current.translatedEnergy.observe(samples,24000,when);
    current.segmentTiming.observeAudio(event,samples,24000,when); updateEnergyTiming(current);
    if(!current.playbackMeasured && current.firstInputAt!==null) {
      current.playbackMeasured=true; $('first-playback-ms').textContent=Math.round(performance.now()-current.firstInputAt+(when-now)*1000)+' ms · red y contexto';
    }
    $('caption-state').textContent='Voz traducida';
  }
  function finish() {
    const current=session;
    if(!current || current.state!=='streaming') return;
    current.state='finishing';pauseSource();$('session-state').textContent='Terminando'; notice('Recibiendo el último audio traducido…');
    captureFor(current).capture.port.postMessage({flush:true,generation:current.id});
    current.drainTimer=setTimeout(()=>{ if(session===current) stop('La API no terminó de entregar el audio. La sesión se cerró sin reintentar.',true); },current.drainWaitMs);
  }
  function transcript(current,event) {
    const source=event.source==='original'?'original':'translation', state=current.transcripts[source];
    const segmentId=typeof event.segment_id==='string'?event.segment_id:null;
    if(segmentId) {
      const turnId=typeof event.turn_id==='string'?event.turn_id:segmentId;
      let turn=state.turns.get(turnId);
      if(!turn) { turn={segments:new Map(),revision:null}; state.turns.set(turnId,turn); }
      const revision=Number.isInteger(event.revision)?event.revision:null;
      if(revision!==null && turn.revision!==null && revision<turn.revision) return;
      const previous=turn.segments.get(segmentId);
      if(revision!==null && previous?.revision!==null && previous?.revision!==undefined && revision<previous.revision) return;
      if(event.replaces_turn===true) { turn.segments.clear(); turn.revision=revision; }
      turn.segments.set(segmentId,{text:event.text.slice(-6000),revision});
      while(state.turns.size>100) state.turns.delete(state.turns.keys().next().value);
    } else state.legacy=(state.legacy+event.text).slice(-6000);
    const value=(state.legacy+Array.from(state.turns.values(),turn=>Array.from(turn.segments.values(),segment=>segment.text.trim()).join(' ')).join(' ')).slice(-6000);
    if(source==='original') { current.original=value; $('original-caption').textContent=value; $('source-caption-details').hidden=false; }
    else { current.translated=value; $('translation-caption').textContent=value; $('translation-caption').closest('.captions').dataset.hasText='true';if(simpleMode){$('simple-caption').hidden=false;$('simple-caption').lang=current.targetLanguage;$('simple-caption').textContent=value.slice(-300);} }
    if(event.correction===true) { $('caption-state').textContent='Texto corregido'; notice('El texto se corrigió. El audio ya emitido puede conservar la versión anterior.'); }
    else if(event.provisional===true) $('caption-state').textContent='Traducción provisional';
  }
  async function start() {
    if(session || (sourceMode==='youtube'?!youtube?.ready:!file) || !matchingStatus() || !status.configured || status.available!==true || !voiceReady() || !$('dub-consent').checked) return;
    if(!directionValid()) { error('Elige idiomas de origen y destino distintos.'); controls(); return; }
    if(sourceMode==='youtube' && status.native_audio?.available!==true){error('No se encontró una salida de audio local compatible. Esta versión sin ventanas usa el audio de Windows.');return;}
    const current={id:++generation,provider:selectedProvider(),sourceLanguage:$('source-language').value,targetLanguage:$('target-language').value,sourceMode,epoch:0,switchPending:false,abort:new AbortController(),state:'connecting',sources:new Set(),sentBytes:0,firstInputAt:null,next:0,carry:null,playbackMeasured:false,maxSeconds:Math.min(60,status.max_seconds || 60),drainWaitMs:drainWaitMs(status.drain_seconds)};
    current.sourceEnergy=new BrivanyDubTiming.PcmEnergyClock(); current.translatedEnergy=new BrivanyDubTiming.PcmEnergyClock();
    current.segmentTiming=new BrivanyDubTiming.SegmentLatencyTracker();
    session=current; error(''); contextualProfile();controls(); $('session-state').textContent='Conectando'; notice('Preparando traducción de voz a voz…');
    $('simple-caption').textContent='';$('simple-caption').hidden=true;
    $('translation-caption').textContent='Esperando traducción…'; $('translation-caption').closest('.captions').dataset.hasText='false';
    $('original-caption').textContent=''; $('source-caption-details').hidden=true;
    $('segment-delay-ms').textContent='Sin marcas correlacionadas'; $('onset-delay-ms').textContent='Sin medición'; $('first-audio-ms').textContent='Sin medición'; $('first-playback-ms').textContent='Sin medición'; $('inference-ms').textContent='Sin dato del proveedor'; $('tts-generation-ms').textContent='Sin dato del proveedor'; $('mt-request-ms').textContent='Sin medición'; $('tts-request-ms').textContent='Sin medición';
    for(const [row,value] of [['asr-partial-measurement','asr-partial-ms'],['segment-ready-measurement','segment-ready-ms'],['segment-to-audio-measurement','segment-to-audio-ms']]) { $(row).hidden=true; $(value).textContent='Sin medición'; }
    current.translated=''; current.original='';
    current.transcripts={original:{legacy:'',turns:new Map()},translation:{legacy:'',turns:new Map()}};
    try {
      if(sourceMode==='youtube'){
        notice('Elige esta pestaña de Brivany y activa Compartir audio de la pestaña.');
        current.nativeOutput=true;youtube.setVolume(12);youtube.play();
        current.tabCapture=await BrivanyTabAudio.openTabAudio({signal:current.abort.signal,onPcm:sendAudio,onEnded:()=>{if(session===current)stop('Dejaste de compartir el audio.');}});
        if(session!==current){current.tabCapture.stop();return;}
        if(current.tabCapture.originalPlaybackSuppressed!==true){$('original-volume').min='2';if(originalVolume()<.02){$('original-volume').value='2';$('original-volume-label').textContent='2 %';}}
        // Do not count time spent in the permission dialog as playback failure.
        await youtube.playConfirmed(15000);
      }else{
      video.pause();const {audio}=await audioGraph();
      if(session!==current) return;
      current.output=audio.createGain(); current.output.gain.value=$('dub-volume').value/100; current.output.connect(audio.destination);
      }
      if(session!==current)return;updateListening();
      const url=new URL(status.websocket_url);
      if(url.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.pathname!=='/dub') throw Error('No se encontró una conexión local de doblaje válida.');
      const socket=new WebSocket(url); current.socket=socket;
      current.connectTimer=setTimeout(()=>{ if(session===current) stop('La conexión tardó demasiado. No se reintentó automáticamente.',true); },15000);
      socket.onopen=()=>{ if(session===current) socket.send(JSON.stringify({type:'start',consent:true,source_language:current.sourceLanguage,target_language:current.targetLanguage,max_seconds:current.maxSeconds,
        ...(current.provider==='palabra'?{quality_mode:'contextual_live',...(current.nativeOutput?{audio_output:'local_device',original_gain:nativeOriginalGain(current),translation_gain:$('dub-volume').value/100}:{})}:{}),
        ...(current.provider==='gemini'?{tail_silence_seconds:$('gemini-tail-silence').checked?2:0}:{})})); };
      socket.onmessage=async message=>{
        if(session!==current) return;
        try {
          const event=JSON.parse(message.data);
          if(event.type==='ready') {
            if(current.state!=='connecting') return;
            clearTimeout(current.connectTimer); current.state='starting_playback'; current.started=performance.now();
            contextualProfile(event.contextual_profile || event);
            current.maxSeconds=Math.min(current.maxSeconds,event.max_seconds || 60);
            if(Number.isFinite(event.drain_seconds)) current.drainWaitMs=drainWaitMs(event.drain_seconds);
            current.epoch=event.epoch || 0;
            if(current.sourceMode==='youtube'){if(event.audio_output!=='local_device')throw Error('Reinicia Brivany para activar la salida de audio sin ventanas.');await youtube.playConfirmed(5000);$('onset-delay-ms').textContent='Salida de Windows · altavoz sin medir';$('segment-delay-ms').textContent='Alineación audiovisual pendiente';}else await video.play();if(session!==current)return;controls();
            current.state='streaming';captureFor(current).capture.port.postMessage({active:true,generation:current.id});controls();
            $('session-state').textContent='Traduciendo'; $('caption-state').textContent='Escuchando video'; notice('Solo se envía el audio del video. Pausar o buscar detiene esta sesión.');
            current.clock=setInterval(()=>{
              if(session!==current) return;
              if(current.sourceMode==='youtube' && youtube.state==='playing'){
                const now=performance.now(),time=youtube.currentTime;
                if(current.videoClock && Math.abs(time-current.videoClock.time-(now-current.videoClock.at)/1000)>2){stop('Cambiaste de momento. Inicia desde aquí para mantener el contexto correcto.');return;}
                current.videoClock={time,at:now};
              }else current.videoClock=null;
              const seconds=(performance.now()-current.started)/1000;
              $('session-clock').textContent=Math.max(0,Math.ceil(current.maxSeconds-seconds))+' s restantes · sesión de prueba';
              if(seconds>=current.maxSeconds) finish();
            },250);
          } else if(event.type==='language-switching'){
            current.epoch=event.epoch;current.switchPending=true;if(!current.nativeOutput)clearPlayer(current);current.carry=null;current.next=0;controls();notice('Cambiando el idioma. Se descarta la frase pendiente.');
          } else if(event.type==='language-changed'){
            current.epoch=event.epoch;current.targetLanguage=event.target_language;current.switchPending=false;
            current.sameLanguage=current.sourceDetectedLanguage===current.targetLanguage;
            if(!current.nativeOutput){current.output=graph.audio.createGain();current.output.connect(graph.audio.destination);}updateListening();
            current.transcripts.translation={legacy:'',turns:new Map()};$('translation-caption').textContent='Esperando traducción en el nuevo idioma…';$('simple-caption').textContent='';$('simple-caption').hidden=true;controls();notice('Idioma cambiado sin volver a enviar el audio anterior.');
          } else if(event.type==='provider-settings'){contextualProfile(event);
          } else if(event.type==='audio-playback'){if(Number.isInteger(event.epoch) && event.epoch!==current.epoch)return;clearTimeout(current.voiceWaitTimer);$('caption-state').textContent='Voz traducida';if(!current.playbackMeasured && current.firstInputAt!==null){current.playbackMeasured=true;$('first-playback-ms').textContent=Math.round(performance.now()-current.firstInputAt)+' ms · enviada a salida local; altavoz sin medir';}notice('Traduciendo · audio original al '+Math.round(originalVolume()*100)+' %.');
          } else if(event.type==='audio') playAudio(current,event);
          else if(event.type==='transcript' && typeof event.text==='string') {
            if(current.switchPending || (Number.isInteger(event.epoch) && event.epoch!==current.epoch))return;
            if(current.sourceMode==='youtube' && event.source==='original' && ['en','es','fr'].includes(event.language)){
              current.sourceDetectedLanguage=event.language;const same=event.language===current.targetLanguage;
              if(same!==current.sameLanguage){current.sameLanguage=same;updateListening();}
              if(same)notice('El video ya está en '+languageLabels[event.language]+'. Escuchando el original.');
            }
            transcript(current,event); current.segmentTiming.observeTranscript(event); updateEnergyTiming(current);
          } else if(event.type==='metrics') {
            if(event.contextual_profile)contextualProfile(event.contextual_profile);
            if(Number.isFinite(event.first_output_audio_ms)) $('first-audio-ms').textContent=Math.round(event.first_output_audio_ms)+' ms · red y contexto';
            // No provider inference duration is available: never infer it from a local timer.
            $('inference-ms').textContent='Sin dato del proveedor';
            if(Number.isFinite(event.tts_first_chunk_generation_ms) && event.tts_first_chunk_generation_ms>=0) $('tts-generation-ms').textContent=Math.round(event.tts_first_chunk_generation_ms)+' ms · solo TTS';
            if(Number.isFinite(event.mt_request_ms) && event.mt_request_ms>=0) $('mt-request-ms').textContent=Math.round(event.mt_request_ms)+' ms · red y servicio';
            if(Number.isFinite(event.tts_first_audio_ms) && event.tts_first_audio_ms>=0) $('tts-request-ms').textContent=Math.round(event.tts_first_audio_ms)+' ms · red y servicio';
            for(const [field,row,value,label] of [
              ['first_asr_partial_ms','asr-partial-measurement','asr-partial-ms','red y contexto'],
              ['first_segment_ready_ms','segment-ready-measurement','segment-ready-ms','red y estabilidad'],
              ['segment_ready_to_first_audio_ms','segment-to-audio-measurement','segment-to-audio-ms','red y servicio']
            ]) if(Number.isFinite(event[field]) && event[field]>=0) { $(row).hidden=false; $(value).textContent=Math.round(event[field])+' ms · '+label; }
          } else if(event.type==='input-ended') {
            current.state='finishing';captureFor(current).capture.port.postMessage({active:false});pauseSource();
            $('session-state').textContent='Terminando'; notice('Límite de la prueba alcanzado. Recibiendo la última voz traducida…');
            clearTimeout(current.drainTimer);
            current.drainTimer=setTimeout(()=>{ if(session===current) stop('La API no terminó de entregar el audio. La sesión se cerró sin reintentar.',true); },current.drainWaitMs);
          } else if(event.type==='done') {
            if(current.carry!==null) throw Error('El último bloque de audio quedó incompleto.');
            current.state='draining'; clearTimeout(current.drainTimer); clearInterval(current.clock);
            current.sourceEnergy.finish(); current.translatedEnergy.finish(); current.segmentTiming.finish(); updateEnergyTiming(current);
            document.dispatchEvent(new CustomEvent('brivany-dubbing-timing',{detail:current.segmentTiming.snapshot()}));
            const finishedMessage=event.finalization_verified===false?'Sesión cerrada. Revisa el final de la traducción.':'Traducción terminada. Puedes volver a iniciar desde otro momento.';
            current.endTimer=setTimeout(()=>{ if(session===current) stop(finishedMessage); },(current.nativeOutput?80:Math.max(0,current.next-graph.audio.currentTime)*1000)+30);
          } else if(event.type==='error') throw Error(event.message || 'La API interrumpió la traducción.');
        } catch(exception) { if(session===current) stop(exception.message || 'El audio traducido no pudo reproducirse.',true); }
      };
      socket.onerror=()=>{ if(session===current) stop('No se pudo conectar el doblaje. Comprueba la API y el servidor local.',true); };
      socket.onclose=()=>{ if(session===current && current.state!=='draining') stop('La conexión de doblaje terminó antes de completar el audio. No se reintentó.',true); };
    } catch(exception) { if(session===current) stop(exception.message || 'No se pudo preparar la reproducción.',true); }
  }
  $('video-file').addEventListener('change',()=>{
    stop(); const selected=$('video-file').files?.[0]; if(!selected) return;
    if(!selected.name.toLowerCase().endsWith('.mp4') || selected.size>maxFileBytes || !selected.size) { error('Elige un MP4 de hasta 25 MiB.'); return; }
    if(fileURL) URL.revokeObjectURL(fileURL);
    file=selected; fileURL=URL.createObjectURL(selected); video.src=fileURL; video.hidden=false;
    video.volume=graph?1:originalVolume(); $('player-shell').classList.add('has-video'); $('video-picker').hidden=true;
    $('change-video').hidden=false; $('file-name').textContent=selected.name; notice('Video local preparado. El audio se enviará solo al iniciar.'); controls();
  });
  video.addEventListener('error',()=>{ if(file) { stop('Este video no pudo reproducirse. Prueba un MP4 con un formato compatible con tu navegador.',true); } });
  video.addEventListener('pause',()=>{ if(session?.state==='streaming' && !video.ended) stop('Video pausado. La sesión se cerró y el audio pendiente se descartó.'); });
  video.addEventListener('seeking',()=>{ if(session) stop('Cambiaste de momento. Inicia otra sesión para traducir desde aquí.'); });
  video.addEventListener('ended',finish);
  $('change-video').addEventListener('click',()=>$('video-file').click());
  $('dub-consent').addEventListener('change',()=>{ if(!$('dub-consent').checked && session) stop('Permiso de envío retirado.'); controls(); });
  function languageChanged(changed) {
    if(session?.provider==='palabra' && session.state==='streaming' && changed==='target-language'){
      if($('target-language').value===session.sourceLanguage){listeningOriginal=true;updateListening();notice('Escuchando el idioma original. La traducción continúa en segundo plano.');return;}
      listeningOriginal=false;updateListening();session.switchPending=true;controls();session.socket.send(JSON.stringify({type:'switch_language',target_language:$('target-language').value}));return;
    }
    if(session) stop('Idioma cambiado. Inicia una nueva sesión para aplicarlo.');
    if(selectedProvider()==='meta') { $('source-language').value='en'; $('target-language').value='es'; controls(); return; }
    const other=changed==='source-language'?'target-language':'source-language';
    if($(changed).value===$(other).value) $(other).value=$(changed).value==='en'?'es':'en';
    controls();
  }
  $('target-language').addEventListener('change',()=>languageChanged('target-language'));
  $('source-language').addEventListener('change',()=>languageChanged('source-language'));
  async function providerChanged() {
    stop('Proveedor cambiado. Inicia una nueva sesión cuando esté conectado.');
    $('dub-consent').checked=false; $('dubbing-key-dialog').close(); $('dubbing-key').value='';
    const name=providerNames[selectedProvider()];
    contextualProfile();
    const modular=selectedProvider()==='meta';
    $('consent-provider-label').textContent=modular?'Enviar audio a Meta y texto a Cloudflare':selectedProvider()==='gemini'?'Enviar el audio a Google':'Enviar el audio a '+name;
    $('key-provider-description').textContent='Guarda tu clave de la API de '+name+' en este equipo. Se carga de nuevo al abrir Brivany.';
    $('key-provider-label').textContent='Clave API de '+name;
    $('provider-access-note').hidden=!modular && !['elevenlabs','gemini','openai'].includes(selectedProvider());
    if(modular) $('provider-access-note').textContent='Muse → traducción Meta en Cloudflare → voz Melodi. Inglés a español. Reutiliza las conexiones guardadas.';
    else if(selectedProvider()==='gemini') $('provider-access-note').textContent='Traducción continua · vista previa. Origen detectado por Google. Acceso por comprobar.';
    else if(selectedProvider()==='openai') $('provider-access-note').textContent='Traducción continua · idioma de origen detectado automáticamente. Acceso API y saldo propios.';
    $('configure-dubbing').hidden=modular; $('meta-settings-link').hidden=!modular;
    $('gemini-tail-option').hidden=selectedProvider()!=='gemini'; $('gemini-tail-silence').checked=false;
    $('source-language').disabled=modular; $('target-language').disabled=modular;
    if(modular) { $('source-language').value='en'; $('target-language').value='es'; }
    else if(selectedProvider()!=='palabra' && $('source-language').value==='auto')$('source-language').value=$('target-language').value==='es'?'en':'es';
    await loadStatus();
  }
  $('dubbing-provider').addEventListener('change',providerChanged);
  $('start-dubbing').addEventListener('click',start); $('stop-dubbing').addEventListener('click',()=>stop());
  $('original-volume').addEventListener('input',()=>{ $('original-volume-label').textContent=$('original-volume').value+' %';updateListening();if(!graph && sourceMode==='local')video.volume=originalVolume(); });
  $('dub-volume').addEventListener('input',()=>{ $('dub-volume-label').textContent=$('dub-volume').value+' %';updateListening(); });
  $('source-local').addEventListener('click',()=>selectSource('local'));
  $('source-youtube').addEventListener('click',()=>selectSource('youtube',true));
  $('youtube-panel').addEventListener('submit',event=>{event.preventDefault();loadYouTube();});
  $('toggle-translation').addEventListener('click',()=>{listeningOriginal=!listeningOriginal;updateListening();});
  $('simple-play').addEventListener('click',()=>{
    if(session){stop('Reproducción pausada.');return;}
    if($('target-language').value===$('source-language').value){listeningOriginal=true;youtube.setVolume(100);youtube.playConfirmed(8000).then(()=>notice('Escuchando el original.')).catch(exception=>stop(exception.message,true));return;}
    $('dub-consent').checked=true;listeningOriginal=false;start();
  });
  $('simple-language').addEventListener('click',()=>{
    const languages=['es','fr','en'],index=languages.indexOf($('target-language').value);$('target-language').value=languages[(index+1)%languages.length];
    listeningOriginal=$('target-language').value===$('source-language').value;
    if(session)languageChanged('target-language');else{updateListening();controls();}
  });
  function openKeyDialog() { if(selectedProvider()==='meta' || !matchingStatus()) return; $('key-notice').textContent=''; $('dubbing-key-dialog').showModal(); $('dubbing-key').focus(); }
  $('configure-dubbing').addEventListener('click',openKeyDialog);
  $('close-dubbing-key').addEventListener('click',()=>$('dubbing-key-dialog').close());
  $('dubbing-key-dialog').addEventListener('close',()=>{ $('dubbing-key').value=''; });
  $('dubbing-key-form').addEventListener('submit',async event=>{
    event.preventDefault(); const key=$('dubbing-key').value.trim(); $('dubbing-key').value=''; $('save-dubbing-key').disabled=true;
    if(!matchingStatus() || selectedProvider()==='meta') { $('key-notice').textContent='Esta conexión se configura en los ajustes de Melodi.'; $('save-dubbing-key').disabled=false; return; }
    const provider=selectedProvider(), name=providerNames[provider];
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('/api/config/dubbing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,provider}),signal:controller.signal});
      if(!response.ok) throw Error('No se pudo guardar. Revisa la clave y vuelve a pegarla.');
      if(provider===selectedProvider()) { $('dubbing-key-dialog').close(); await loadStatus(); notice('Clave de '+name+' guardada en este equipo.'+(!voiceReady()?' Falta elegir una voz de prueba.':' No hace falta volver a introducirla.')); }
    } catch(exception) { if(provider===selectedProvider()) $('key-notice').textContent=exception.name==='AbortError'?'La solicitud tardó demasiado; comprueba el servidor local.':exception.message; }
    finally { clearTimeout(timeout); $('save-dubbing-key').disabled=false; }
  });
  document.addEventListener('visibilitychange',()=>{ if(document.hidden && session && session.sourceMode!=='youtube') stop('La página quedó en segundo plano. La sesión se detuvo.'); });
  window.addEventListener('pagehide',()=>{ stop(); if(fileURL) URL.revokeObjectURL(fileURL); graph?.audio.close().catch(()=>{}); });
  controls();
  // Only provider selection and an empty configuration dialog may be linked.
  // Credentials are never read from URLs or submitted by opening this page.
  const initial=new URLSearchParams(location.search), initialProvider=initial.get('provider');
  if(simpleMode){
    $('source-language').value=['en','es','fr'].includes(initial.get('from'))?initial.get('from'):'auto';
    document.body.dataset.view='simple';$('simple-translator').hidden=false;
    $('simple-link-slot').append($('youtube-panel'));$('simple-video-slot').append($('youtube-player'));
    $('simple-settings-content').append(document.querySelector('.controls-column'),document.querySelector('.captions'));
    $('youtube-url').placeholder='Pega la URL del video';let linkTimer;
    $('youtube-url').addEventListener('input',()=>{clearTimeout(linkTimer);stop();if(youtube)youtube.destroy();controls();linkTimer=setTimeout(()=>{try{BrivanyYouTubeSource.parseYouTubeUrl($('youtube-url').value);loadYouTube();}catch{notice('Pega un enlace de YouTube.');}},600);});
  }
  if(initial.get('source')==='youtube' || simpleMode)selectSource('youtube',true);
  if(Object.hasOwn(providerNames,initialProvider)) {
    $('dubbing-provider').value=initialProvider;
    providerChanged().then(()=>{ if(initial.get('configure')==='1') openKeyDialog(); });
  } else loadStatus();
})();
