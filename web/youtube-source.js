/* Official IFrame API only. No downloads, transcript scraping or audio access. */
'use strict';
(() => {
  const API_URL='https://www.youtube.com/iframe_api';
  const states=new Map([[-1,'unstarted'],[0,'ended'],[1,'playing'],[2,'paused'],[3,'buffering'],[5,'cued']]);
  let apiPromise=null;
  const playerError=(code,message,providerCode=null)=>Object.assign(Error(message),{code,providerCode});
  const playbackError=code=>{
    if(code===101 || code===150)return playerError('youtube_embed_forbidden','Este video no permite reproducirse dentro de Brivany. Prueba otro enlace.',code);
    if(code===153)return playerError('youtube_origin_rejected','YouTube no pudo verificar el origen del reproductor. Revisa la conexión local.',code);
    if(code===100)return playerError('youtube_video_unavailable','Este video ya no está disponible o es privado.',code);
    if(code===5)return playerError('youtube_playback_failed','YouTube no pudo reproducir este video. Intenta reproducirlo desde sus controles.',code);
    if(code===2)return playerError('youtube_invalid_video','YouTube no reconoció el video solicitado.',code);
    return playerError('youtube_player_error','YouTube no pudo abrir este video.',Number.isInteger(code)?code:null);
  };

  function parseYouTubeUrl(value) {
    if(typeof value!=='string' || value.length>2048 || /[\u0000-\u0020\u007f]/.test(value.trim()))throw Error('Pega un enlace válido de YouTube.');
    let url;try{url=new URL(value.trim());}catch{throw Error('Pega un enlace válido de YouTube.');}
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port)throw Error('Usa un enlace de youtube.com o youtu.be.');
    const parts=url.pathname.split('/').filter(Boolean);let id;
    if(['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) {
      if(parts.length===1 && parts[0]==='watch' && url.searchParams.getAll('v').length===1)id=url.searchParams.get('v');
      else if(parts.length===2 && ['v','shorts','live'].includes(parts[0]))id=parts[1];
    } else if(['youtu.be','www.youtu.be'].includes(url.hostname) && parts.length===1)id=parts[0];
    if(!/^[A-Za-z0-9_-]{11}$/.test(id || ''))throw Error('El enlace debe identificar un video de YouTube.');
    return {videoId:id,url:'https://www.youtube.com/watch?v='+id};
  }

  function loadApi() {
    if(typeof window.YT?.Player==='function')return Promise.resolve(window.YT);
    if(apiPromise)return apiPromise;
    apiPromise=new Promise((resolve,reject)=>{
      const previous=window.onYouTubeIframeAPIReady;
      const script=document.createElement('script');script.src=API_URL;script.async=true;script.dataset.brivanyYoutubeApi='true';
      let settled=false;
      const finish=error=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(error){script.remove();reject(error);}else resolve(window.YT);
      };
      window.onYouTubeIframeAPIReady=()=>{
        try{if(typeof previous==='function')previous();}catch{}
        finish(typeof window.YT?.Player==='function'?null:playerError('youtube_api_unavailable','YouTube no pudo preparar el reproductor.'));
      };
      const timer=setTimeout(()=>finish(playerError('youtube_api_timeout','YouTube tardó demasiado. Vuelve a abrir el enlace cuando tengas conexión.')),20000);
      script.onerror=()=>finish(playerError('youtube_api_unavailable','No se pudo cargar el reproductor de YouTube.'));
      document.head.append(script);
    }).catch(error=>{apiPromise=null;throw error;});
    return apiPromise;
  }

  class YouTubeSource {
    constructor(container,{onReady=()=>{},onStateChange=()=>{},onError=()=>{},onAutoplayBlocked=()=>{}}={}) {
      if(!container || typeof container.replaceChildren!=='function')throw Error('Falta el contenedor de YouTube.');
      this.container=container;this.onReady=onReady;this.onStateChange=onStateChange;this.onError=onError;this.onAutoplayBlocked=onAutoplayBlocked;
      this.player=null;this.videoId=null;this.ready=false;this.state='unstarted';this.generation=0;this.volume=100;this.pending=null;this.pendingPlayback=null;this.lastError=null;
    }
    async loadUrl(value) {
      const parsed=parseYouTubeUrl(value);this.reset();const generation=this.generation;
      this.videoId=parsed.videoId;this.state='unstarted';this.container.dataset.ready='false';
      let YT;
      try{YT=await loadApi();}catch(error){if(generation!==this.generation)return {cancelled:true};this.lastError=error;this.onError(error);throw error;}
      if(generation!==this.generation)return {cancelled:true};
      const frame=document.createElement('iframe'),url=new URL('https://www.youtube.com/embed/'+parsed.videoId);
      for(const [key,value] of Object.entries({enablejsapi:'1',origin:location.origin,autoplay:'0',playsinline:'1',controls:'1'}))url.searchParams.set(key,value);
      frame.src=url.href;frame.title='Video de YouTube';frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;
      frame.referrerPolicy='strict-origin-when-cross-origin';frame.width='640';frame.height='360';frame.style.border='0';
      this.container.replaceChildren(frame);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>failure(playerError('youtube_ready_timeout','YouTube no respondió. Revisa la conexión o prueba otro video.')),20000);
        const success=()=>{if(generation!==this.generation)return;clearTimeout(timer);this.pending=null;this.ready=true;this.state='cued';this.lastError=null;this.container.dataset.ready='true';this.player.setVolume(this.volume);const event=this.snapshot();this.onReady(event);resolve(event);};
        const failure=error=>{if(generation!==this.generation)return;clearTimeout(timer);this.pending=null;this.ready=false;this.lastError=error;this.rejectPlayback(error);this.container.dataset.ready='false';this.onError(error);reject(error);};
        this.pending=()=>{clearTimeout(timer);resolve({cancelled:true});};
        try{
          this.player=new YT.Player(frame,{events:{
            onReady:success,
            onStateChange:event=>{if(generation!==this.generation)return;this.state=states.get(event.data) || 'unstarted';if(this.state==='playing'){this.lastError=null;this.confirmPlayback();}this.onStateChange(this.snapshot());},
            onError:event=>failure(playbackError(event.data)),
            onAutoplayBlocked:()=>{if(generation!==this.generation)return;const error=playerError('youtube_autoplay_blocked','El navegador bloqueó la reproducción. Pulsa Reproducir en el video de YouTube y vuelve a iniciar.');this.lastError=error;this.rejectPlayback(error);this.onAutoplayBlocked(this.snapshot());}
          }});
        }catch(error){failure(error);}
      });
    }
    snapshot(){return {videoId:this.videoId,ready:this.ready,state:this.state,currentTime:this.currentTime,duration:this.duration,errorCode:this.lastError?.code || null};}
    get error(){return this.lastError;}
    get currentTime(){const value=this.ready?this.player?.getCurrentTime?.():0;return Number.isFinite(value)?value:0;}
    get duration(){const value=this.ready?this.player?.getDuration?.():0;return Number.isFinite(value)?value:0;}
    play(){if(!this.ready)throw this.lastError || playerError('youtube_not_ready','Abre primero un video de YouTube.');this.player.unMute?.();this.player.playVideo();}
    playConfirmed(timeout=5000){
      if(!this.ready)return Promise.reject(this.lastError || playerError('youtube_not_ready','Abre primero un video de YouTube.'));
      if(!Number.isFinite(timeout) || timeout<=0 || timeout>30000)return Promise.reject(playerError('youtube_playback_timeout_option','El límite para iniciar la reproducción no es válido.'));
      if(this.state==='playing')return Promise.resolve(this.snapshot());
      if(this.pendingPlayback)return this.pendingPlayback.promise;
      this.lastError=null;
      const pending={};pending.promise=new Promise((resolve,reject)=>{pending.resolve=resolve;pending.reject=reject;});
      pending.timer=setTimeout(()=>{const error=playerError('youtube_playback_timeout','El video no empezó a reproducirse. Pulsa Reproducir en YouTube o prueba otro enlace.');this.lastError=error;this.rejectPlayback(error);},timeout);
      this.pendingPlayback=pending;
      // Keep the native play command in the user's click stack. A ready iframe
      // alone does not prove that YouTube has started or can deliver audio.
      try{this.play();}catch(error){this.lastError=error;this.rejectPlayback(error);}
      return pending.promise;
    }
    confirmPlayback(){const pending=this.pendingPlayback;if(!pending)return;this.pendingPlayback=null;clearTimeout(pending.timer);pending.resolve(this.snapshot());}
    rejectPlayback(error){const pending=this.pendingPlayback;if(!pending)return;this.pendingPlayback=null;clearTimeout(pending.timer);pending.reject(error);}
    pause(){this.rejectPlayback(playerError('youtube_playback_paused','La reproducción se pausó antes de comenzar.'));if(this.ready)this.player?.pauseVideo?.();}
    setVolume(value){if(!Number.isFinite(value) || value<0 || value>100)throw Error('El volumen debe estar entre 0 y 100.');this.volume=value;if(this.ready)this.player.setVolume(value);}
    reset(){++this.generation;this.pending?.();this.pending=null;this.rejectPlayback(playerError('youtube_cancelled','La reproducción cambió o se cerró.'));try{this.player?.destroy?.();}catch{}this.player=null;this.ready=false;this.state='unstarted';this.lastError=null;this.videoId=null;this.container.replaceChildren();this.container.dataset.ready='false';}
    destroy(){this.reset();}
  }
  window.BrivanyYouTubeSource=Object.freeze({YouTubeSource,parseYouTubeUrl});
})();
