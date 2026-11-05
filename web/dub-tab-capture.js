/* User-approved tab audio only. Video frames never leave the browser. */
(()=>{
  function originalMix(suppressed,gain){
    if(!Number.isFinite(gain) || gain<0 || gain>1)throw Error('Volumen original no válido.');
    if(suppressed===true)return {playerVolume:100,inputGain:1,nativeOriginalGain:gain};
    // Keep the source quiet when the host does not confirm suppression.
    // Split the unknown case between browser/device; both remain quiet.
    const effective=Math.max(.02,gain),share=suppressed===false?1:.5;
    const playerVolume=Math.max(1,Math.round(effective*share*100));
    return {playerVolume,inputGain:100/playerVolume,nativeOriginalGain:suppressed===false?0:effective/2};
  }
  async function openTabAudio({signal,onPcm=()=>{},onEnded=()=>{}}={}){
    const media=navigator.mediaDevices,Audio=window.AudioContext || window.webkitAudioContext;
    if(!media?.getDisplayMedia || !Audio || !window.AudioWorkletNode)throw Error('Este navegador no permite captar audio de una pestaña. Abre Brivany en Chrome o Edge de escritorio.');
    if(signal?.aborted)throw new DOMException('Captura cancelada.','AbortError');
    const handle=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    let configured=false,audio,stream,source,input,capture,silent,closed=false;
    const stop=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',stop);for(const track of stream?.getTracks() || [])track.stop();source?.disconnect();input?.disconnect();capture?.disconnect();silent?.disconnect();audio?.close().catch(()=>{});if(configured)try{media.setCaptureHandleConfig({exposeOrigin:false,handle:'',permittedOrigins:[]});}catch{}};
    signal?.addEventListener('abort',stop,{once:true});
    try{
      // Capture Handle is an optional enhancement, absent in some webviews.
      try{if(media.setCaptureHandleConfig){media.setCaptureHandleConfig({exposeOrigin:true,handle,permittedOrigins:[location.origin]});configured=true;}}catch{}
      audio=new Audio({sampleRate:24000});
      // Resume in the user's click, not after time spent in the permission UI.
      const resume=audio.resume();resume.catch(()=>{});
      stream=await media.getDisplayMedia({
        video:{displaySurface:'browser'},audio:{suppressLocalAudioPlayback:true,restrictOwnAudio:false},
        preferCurrentTab:true,selfBrowserSurface:'include',systemAudio:'exclude',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});
      if(closed || signal?.aborted){for(const track of stream.getTracks())track.stop();throw new DOMException('Captura cancelada.','AbortError');}
      const video=stream.getVideoTracks()[0],track=stream.getAudioTracks()[0],settings=video?.getSettings?.() || {},audioSettings=track?.getSettings?.() || {};
      let identity=null;try{identity=video?.getCaptureHandle?.() || null;}catch{}
      if(!track || track.readyState==='ended')throw Error('No llegó audio compartido. Activa «Permitir también audio de las pestañas» y vuelve a iniciar.');
      if(['monitor','window'].includes(settings.displaySurface))throw Error('Elige esta pestaña de Brivany con su audio; la captura del escritorio no sirve para este modo.');
      if(identity && configured && (identity.origin!==location.origin || identity.handle!==handle))throw Error('Selecciona esta pestaña de Brivany para escuchar el video que estás viendo.');
      if(audioSettings.restrictOwnAudio===true)throw Error('El navegador excluyó el audio de esta pestaña. Revisa el permiso de audio compartido.');
      const suppression=typeof audioSettings.suppressLocalAudioPlayback==='boolean'?audioSettings.suppressLocalAudioPlayback:typeof settings.suppressLocalAudioPlayback==='boolean'?settings.suppressLocalAudioPlayback:null;
      await audio.audioWorklet.addModule('/dub-capture.js');if(closed)throw new DOMException('Captura cancelada.','AbortError');
      source=audio.createMediaStreamSource(new MediaStream([track]));input=audio.createGain();capture=new AudioWorkletNode(audio,'brivany-dub-capture');silent=audio.createGain();silent.gain.value=0;
      source.connect(input);input.connect(capture);capture.connect(silent);silent.connect(audio.destination);capture.port.onmessage=event=>{if(!closed)onPcm(event.data);};
      if(identity && configured)video?.addEventListener('capturehandlechange',()=>{let current;try{current=video.getCaptureHandle?.();}catch{}if(!closed && (!current || current.origin!==location.origin || current.handle!==handle)){stop();onEnded();}});
      for(const item of stream.getTracks())item.addEventListener('ended',()=>{if(!closed){stop();onEnded();}},{once:true});
      // Some hosts suspend while the permission dialog owns focus.
      if(audio.state!=='running')await audio.resume();else await resume;
      if(audio.state!=='running' || closed)throw Error('El navegador no pudo activar la captura de audio.');
      return {audio,capture,stream,stop,source:identity && configured?'own_browser_tab':'user_selected_surface',originalPlaybackSuppressed:suppression,videoFramesTransmitted:false,
        configureOriginal(gain){const mix=originalMix(suppression,gain);input.gain.value=mix.inputGain;return mix;}};
    }catch(error){stop();if(error.name==='NotAllowedError')throw Error('No se concedió compartir el audio. Vuelve a iniciar y permite el audio de esta pestaña.');throw error;}
  }
  window.BrivanyTabAudio={openTabAudio,originalMix};
})();
