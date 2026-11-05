/* No microphone, provider key, storage or network. Audio belongs to this tab. */
(function(root){
  'use strict';
  const nonce=new URLSearchParams(location.search).get('nonce'),opener=root.opener;
  const state=document.getElementById('listen-state'),error=document.getElementById('listen-error'),activate=document.getElementById('activate-audio');
  let port=null,audio=null,ready=false,closed=false,generation=0,openerMonitor;
  const kinds={original:{limit:2,cap:1,gain:0,next:0,sources:new Set()},translation:{limit:3,cap:1,gain:.85,next:0,sources:new Set()}};
  const send=value=>{try{port?.postMessage(value);}catch{}};
  const notice=message=>{state.textContent=message;};
  function stop(kind){for(const [name,item] of Object.entries(kinds)){if(kind!==undefined && name!==kind)continue;for(const source of item.sources){try{source.stop();}catch{}source.disconnect();}item.sources.clear();item.next=0;}}
  function close(){if(closed)return;closed=true;clearInterval(openerMonitor);root.removeEventListener('message',connect);stop();for(const item of Object.values(kinds))item.output?.disconnect();send({type:'closed'});port?.close();audio?.close().catch(()=>{});notice('Escucha cerrada.');activate.disabled=true;}
  function failed(message){error.textContent=message;error.hidden=false;}
  async function startAudio(){
    if(closed || !port)return;
    try{
      if(!audio){const Audio=root.AudioContext || root.webkitAudioContext;if(!Audio)throw Error('El navegador no admite esta salida de audio.');audio=new Audio({latencyHint:'interactive'});
        for(const item of Object.values(kinds)){item.output=audio.createGain();item.output.gain.value=item.gain;item.output.connect(audio.destination);}
      }
      await audio.resume();if(closed)return;
      if(audio.state!=='running')throw Error('Pulsa Activar audio para escuchar la traducción.');
      ready=true;activate.hidden=true;error.hidden=true;notice('Lista. El video permanece en la otra ventana.');send({type:'ready'});
    }catch(failure){activate.hidden=false;notice('Pulsa Activar audio para continuar.');send({type:'activation-required'});if(failure.name!=='NotAllowedError')failed(failure.message);}
  }
  function schedule(data){
    if(!ready || closed || !audio || audio.state!=='running')throw Error('Activa de nuevo el audio en la ventana de escucha.');
    const item=Object.hasOwn(kinds,data.kind)?kinds[data.kind]:null;if(!item || data.generation!==generation || !Number.isInteger(data.id) || !(data.buffer instanceof ArrayBuffer) || !['s16','f32'].includes(data.format) || !Number.isInteger(data.sampleRate) || data.sampleRate<8000 || data.sampleRate>48000 || !Number.isFinite(data.gain) || data.gain<0 || data.gain>item.cap)throw Error('Bloque de audio no válido.');
    const width=data.format==='s16'?2:4;
    if(!data.buffer.byteLength || data.buffer.byteLength%width || data.buffer.byteLength/width/data.sampleRate>item.limit)throw Error('Bloque de audio fuera de límites.');
    const input=data.format==='s16'?new Int16Array(data.buffer):new Float32Array(data.buffer),duration=input.length/data.sampleRate;
    if(data.format==='f32')for(const value of input)if(!Number.isFinite(value) || value < -1 || value > 1)throw Error('Muestras de audio no válidas.');
    const now=audio.currentTime,when=Math.max(item.next,now+.025);
    if(when+duration-now>item.limit+.025+1e-6 || item.sources.size>=256)throw Error('La escucha acumuló demasiado audio. Detén y vuelve a iniciar.');
    const buffer=audio.createBuffer(1,input.length,data.sampleRate),samples=buffer.getChannelData(0);
    if(data.format==='f32')samples.set(input);else for(let index=0;index<input.length;index++)samples[index]=input[index]/32768;
    item.gain=data.gain;item.output.gain.value=item.gain;
    const source=audio.createBufferSource();source.buffer=buffer;source.connect(item.output);item.sources.add(source);
    source.onended=()=>{item.sources.delete(source);source.disconnect();};
    try{source.start(when);}catch(failure){item.sources.delete(source);source.disconnect();throw failure;}
    item.next=when+duration;
    send({type:'scheduled',id:data.id,generation,kind:data.kind,requestId:data.requestId,
      scheduledAtEpochMs:performance.timeOrigin+performance.now()+(when-now)*1000,queueMs:(when-now)*1000,durationMs:duration*1000,
      contextState:audio.state,timingScope:'browser_audio_context_schedule_not_physical_output'});
  }
  function receive(event){
    const data=event.data;if(!data || typeof data!=='object')return;
    try{
      if(data.type==='pcm')schedule(data);
      else if(data.type==='gain'){
        const item=Object.hasOwn(kinds,data.kind)?kinds[data.kind]:null;if(!item || data.generation!==generation || !Number.isFinite(data.gain) || data.gain<0 || data.gain>item.cap)throw Error('Volumen no válido.');
        item.gain=data.gain;if(item.output)item.output.gain.value=data.gain;
      }else if(data.type==='stop'){
        if(!Number.isSafeInteger(data.generation) || data.generation<=generation || data.kind!==undefined && !Object.hasOwn(kinds,data.kind))return;
        generation=data.generation;stop(data.kind);send({type:'stopped',generation,kind:data.kind});
      }else if(data.type==='close')close();
    }catch(failure){send({type:'error',id:data.id,generation:data.generation,message:failure.message});failed(failure.message);}
  }
  function connect(event){
    if(closed || port || event.source!==opener || event.origin!==location.origin || event.data?.type!=='brivany-dub-sink-connect' || event.data.nonce!==nonce || event.ports?.length!==1)return;
    port=event.ports[0];port.onmessage=receive;port.onmessageerror=()=>{failed('Se perdió el canal de escucha.');close();};port.start?.();root.removeEventListener('message',connect);startAudio();
  }
  activate.addEventListener('click',startAudio);document.getElementById('close-listener').addEventListener('click',()=>{close();root.close();});
  root.addEventListener('pagehide',close,{once:true});
  if(!opener || !/^[a-f0-9]{32}$/.test(nonce || '')){failed('Abre la escucha desde Live Traductor.');activate.disabled=true;notice('Sin conexión.');return;}
  openerMonitor=setInterval(()=>{if(opener.closed){close();root.close();}},500);
  root.addEventListener('message',connect);opener.postMessage({type:'brivany-dub-sink-hello',nonce},location.origin);
})(window);
