/* Audio leaves the captured tab through one private, same-origin MessagePort. */
(function(root){
  'use strict';
  const limits={original:2,translation:3},caps={original:1,translation:1};
  const abortError=()=>new DOMException('Escucha cancelada.','AbortError');
  const checkedKind=kind=>{if(!Object.hasOwn(limits,kind))throw Error('Canal de audio no admitido.');return kind;};
  const gainValue=(kind,value)=>{checkedKind(kind);if(!Number.isFinite(value) || value<0 || value>1)throw Error('Volumen no válido.');return Math.min(caps[kind],value);};

  class Sink {
    constructor(popup,port,onEvent){
      this.popup=popup;this.port=port;this.onEvent=onEvent;this.closed=false;this.generation=0;this.sequence=0;this.pending=new Map();this.pendingSeconds={original:0,translation:0};
      this.gains={original:0,translation:.85};this.ready=false;
      port.onmessage=event=>{
        const data=event.data;if(!data || typeof data!=='object')return;
        if(data.type==='ready'){this.ready=true;this.onReady?.();this.onEvent(data);return;}
        if(data.type==='closed'){this.close(Error('La ventana de escucha se cerró.'));return;}
        if(data.type==='activation-required'){this.onEvent(data);return;}
        const pending=this.pending.get(data.id);
        if(pending && data.generation===pending.generation){
          this.pending.delete(data.id);this.pendingSeconds[pending.kind]-=pending.duration;clearTimeout(pending.timer);
          if(data.type==='scheduled')pending.resolve(data);
          else if(data.type==='error')pending.reject(Error(data.message || 'No se pudo reproducir el audio.'));
        }
        if(data.type==='error')this.onEvent(data);
      };
      port.onmessageerror=()=>this.close(Error('Se perdió el canal de escucha.'));port.start?.();
      this.monitor=setInterval(()=>{if(popup.closed)this.close(Error('La ventana de escucha se cerró.'));},500);
    }
    playPcm(kind,samples,{sampleRate=24000,gain,requestId}={}){
      try{
        checkedKind(kind);if(this.closed || !this.ready)throw Error('La ventana de escucha no está lista.');
        if(!Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>48000 || !(samples instanceof Int16Array || samples instanceof Float32Array) || !samples.length)throw Error('Formato de audio no válido.');
        const duration=samples.length/sampleRate;
        if(duration>limits[kind] || this.pendingSeconds[kind]+duration>limits[kind]+1e-6)throw Error('La escucha acumuló demasiado audio. Detén y vuelve a iniciar.');
        const level=gain===undefined?this.gains[kind]:gainValue(kind,gain);
        const pcm=samples.slice();if(pcm instanceof Float32Array)for(const value of pcm)if(!Number.isFinite(value) || value < -1 || value > 1)throw Error('Muestras de audio no válidas.');
        const id=++this.sequence,generation=this.generation;this.pendingSeconds[kind]+=duration;
        return new Promise((resolve,reject)=>{
          const pending={kind,duration,generation,resolve,reject,timer:setTimeout(()=>this.close(Error('La ventana de escucha dejó de responder.')),5000)};
          this.pending.set(id,pending);
          try{this.port.postMessage({type:'pcm',id,generation,kind,sampleRate,gain:level,format:pcm instanceof Int16Array?'s16':'f32',buffer:pcm.buffer,requestId},[pcm.buffer]);}
          catch(error){this.pending.delete(id);this.pendingSeconds[kind]-=duration;clearTimeout(pending.timer);reject(error);}
        });
      }catch(error){return Promise.reject(error);}
    }
    setGain(kind,value){const gain=gainValue(kind,value);this.gains[kind]=gain;if(!this.closed)this.port.postMessage({type:'gain',kind,gain,generation:this.generation});return gain;}
    stop(kind){
      if(kind!==undefined)checkedKind(kind);if(this.closed)return;this.generation++;
      for(const [id,pending] of this.pending){if(kind===undefined || pending.kind===kind){clearTimeout(pending.timer);pending.reject(abortError());this.pending.delete(id);this.pendingSeconds[pending.kind]-=pending.duration;}}
      this.port.postMessage({type:'stop',generation:this.generation,kind});
    }
    close(reason=abortError()){
      if(this.closed)return;this.closed=true;clearInterval(this.monitor);
      this.signal?.removeEventListener('abort',this.abortListener);
      for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(reason);}this.pending.clear();
      try{this.port.postMessage({type:'close'});}catch{}this.port.close();
      try{if(!this.popup.closed)this.popup.close();}catch{}
      this.onClosed?.(reason);this.onEvent({type:'closed',message:reason.message});
    }
  }

  function openSink({signal,onEvent=()=>{},timeoutMs=20000}={}){
    if(signal?.aborted)return Promise.reject(abortError());
    if(!Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>60000)return Promise.reject(Error('Tiempo de escucha no válido.'));
    const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
    let popup,sink,done=false,timer,closeMonitor;
    const result=new Promise((resolve,reject)=>{
      const cleanup=()=>{root.removeEventListener('message',hello);signal?.removeEventListener('abort',abort);clearTimeout(timer);clearInterval(closeMonitor);};
      const fail=error=>{if(done)return;done=true;cleanup();sink?.close(error);try{popup?.close();}catch{}reject(error);};
      const abort=()=>{if(done){sink?.close(abortError());return;}fail(abortError());};
      const hello=event=>{
        if(event.origin!==location.origin || event.source!==popup || event.data?.type!=='brivany-dub-sink-hello' || event.data.nonce!==nonce || sink)return;
        const channel=new MessageChannel();sink=new Sink(popup,channel.port1,onEvent);
        sink.onClosed=error=>{if(!done)fail(error);};
        sink.onReady=()=>{if(done)return;done=true;cleanup();sink.signal=signal;sink.abortListener=()=>sink.close(abortError());signal?.addEventListener('abort',sink.abortListener,{once:true});resolve(sink);};
        try{popup.postMessage({type:'brivany-dub-sink-connect',nonce},location.origin,[channel.port2]);}catch(error){channel.port2.close();fail(error);}
      };
      root.addEventListener('message',hello);signal?.addEventListener('abort',abort,{once:true});
      // This call is synchronous inside the original click, before capture awaits.
      popup=root.open('/dubbing/listen?nonce='+nonce,'brivany-listen-'+nonce,'popup,width=460,height=460');
      if(!popup){fail(Error('Permite la ventana de escucha para separar el audio traducido.'));return;}
      timer=setTimeout(()=>fail(Error('Activa el audio en la ventana de escucha y vuelve a iniciar.')),timeoutMs);
      closeMonitor=setInterval(()=>{if(popup.closed)fail(Error('La ventana de escucha se cerró.'));},500);
    });
    result.popup=popup;return result;
  }
  root.BrivanyDubSink={openSink};
})(window);
