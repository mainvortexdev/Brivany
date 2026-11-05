/* Local media decoding only. No upload, microphone, screen capture or storage. */
'use strict';
(()=>{
  class VideoFileSource{
    constructor(video,{onReady=()=>{},onStateChange=()=>{},onError=()=>{}}={}){
      this.video=video;this.onReady=onReady;this.onStateChange=onStateChange;this.onError=onError;
      this.ready=false;this.state='unstarted';this.url=null;this.graph=null;this.opening=null;this.epoch=0;this.pendingLoad=null;
      for(const [event,state] of [['playing','playing'],['pause','paused'],['ended','ended']])video.addEventListener(event,()=>{this.state=video.ended?'ended':state;this.onStateChange({state:this.state});});
    }
    async load(file){
      if(!(file instanceof File) || !file.size)throw Error('Elige un archivo de video válido.');
      const epoch=++this.epoch;this.ready=false;this.pause();this.pendingLoad?.();if(this.url)URL.revokeObjectURL(this.url);
      this.url=URL.createObjectURL(file);this.video.src=this.url;
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);this.video.removeEventListener('loadedmetadata',ready);this.video.removeEventListener('error',failed);this.pendingLoad=null;};
        const ready=()=>{if(epoch!==this.epoch)return;cleanup();this.ready=true;this.state='cued';this.onReady();resolve();};
        const failed=()=>{cleanup();const error=Error('El navegador no pudo decodificar este video. Prueba un MP4 compatible.');this.onError(error);reject(error);};
        const timer=setTimeout(failed,15000);this.pendingLoad=()=>{cleanup();resolve({cancelled:true});};
        this.video.addEventListener('loadedmetadata',ready,{once:true});this.video.addEventListener('error',failed,{once:true});this.video.load();
      });
    }
    async playConfirmed(){if(!this.ready)throw Error('Abre primero un video de este equipo.');await this.video.play();}
    play(){this.playConfirmed().catch(error=>this.onError(error));}
    pause(){this.video.pause();}
    setVolume(value){this.video.volume=value/100;}
    async openAudio({signal,onPcm}={}){
      if(signal?.aborted)throw new DOMException('Cancelado','AbortError');
      const Audio=window.AudioContext || window.webkitAudioContext;
      if(!Audio || !window.AudioWorkletNode)throw Error('Este navegador no admite audio de video en directo.');
      if(!this.graph){
        // The element can belong to only one MediaElementAudioSourceNode.
        // Reuse its graph between explicit starts instead of rebinding it.
        if(!this.opening)this.opening=(async()=>{
          const audio=new Audio({sampleRate:24000}),resume=audio.resume();resume.catch(()=>{});
          try{
            await audio.audioWorklet.addModule('/dub-capture.js');
            const source=audio.createMediaElementSource(this.video),capture=new AudioWorkletNode(audio,'brivany-dub-capture'),silent=audio.createGain();silent.gain.value=0;
            source.connect(capture);capture.connect(silent);silent.connect(audio.destination);
            this.graph={audio,capture,source,silent};await resume;return this.graph;
          }catch(error){await audio.close();throw error;}
        })().finally(()=>{this.opening=null;});
        await this.opening;
      }
      const graph=this.graph;let stopped=false;
      const stop=()=>{if(stopped)return;stopped=true;signal?.removeEventListener('abort',stop);graph.capture.port.onmessage=null;graph.capture.port.postMessage({active:false});graph.audio.suspend().catch(()=>{});};
      signal?.addEventListener('abort',stop,{once:true});
      if(signal?.aborted){stop();throw new DOMException('Cancelado','AbortError');}
      graph.capture.port.onmessage=event=>{if(!stopped)onPcm(event.data);};
      try{await graph.audio.resume();if(signal?.aborted){stop();throw new DOMException('Cancelado','AbortError');}}
      catch(error){stop();throw error;}
      return {audio:graph.audio,capture:graph.capture,stop,configureOriginal:gain=>({playerVolume:100,nativeOriginalGain:gain})};
    }
    destroy(){this.pendingLoad?.();this.pause();if(this.url)URL.revokeObjectURL(this.url);this.graph?.audio.close().catch(()=>{});}
  }
  window.BrivanyVideoFileSource=VideoFileSource;
})();
