import './live-voice.js';

/** Reuses MuseCapture and MelodiOutput. Scene contents are resolved on the server. */
export function mountSpatialAssistant(container,{request,post,getScene,onAction=()=>{}}={}){
  if(!container)return null;
  container.innerHTML=`<div class="spatial-assistant-heading"><strong>Melodi</strong><span data-assistant-origin>Contexto del espacio</span></div>
    <p data-assistant-status role="status">Selecciona un objeto o escribe una pregunta.</p>
    <form data-assistant-form><label>Mensaje<input data-assistant-message maxlength="1200" placeholder="Enfoca la mesa" autocomplete="off"></label><button type="submit">Enviar</button></form>
    <label class="assistant-consent"><input type="checkbox" data-assistant-consent>Permitir enviar mensajes y contexto del espacio a Meta.</label>
    <label class="assistant-consent"><input type="checkbox" data-assistant-voice-consent>Permitir micrófono a Muse y voz de Melodi por Cartesia.</label>
    <div class="assistant-buttons"><button type="button" data-assistant-mic aria-pressed="false">Hablar</button><button type="button" data-assistant-stop disabled>Interrumpir</button></div>
    <p data-assistant-interim></p><p data-assistant-question></p><p data-assistant-reply aria-live="polite"></p>
    <section data-assistant-review hidden aria-label="Revisar movimiento"><strong>Revisar movimiento</strong><p data-assistant-preview></p><p>Posición absoluta. Las colisiones y la precisión métrica no están verificadas.</p><button type="button" data-assistant-apply>Aplicar movimiento</button><button type="button" data-assistant-discard>Descartar</button></section>
    <p data-assistant-error role="alert"></p>`;
  const $=name=>container.querySelector(`[data-assistant-${name}]`),set=(name,text)=>{$(name).textContent=text || '';};
  let disposed=false,config=null,voice=null,revisionKey='',history=[],pending=null,turns=0,generation=0,turnAbort=null;
  let listening=false,starting=false,answering=false,speaking=false,microphone=null,audio=null,capture=null,startId=0,timer=null,settle=null,transcript='';
  const seen=new Set();
  const output=new window.BrivanyLive.MelodiOutput(active=>{speaking=active;capture?.suspend(active);render();},message=>{set('error',message);cancelReply();});
  function identity(){const value=getScene?.();if(!value?.scene_id || !Number.isInteger(value.revision) || value.portable)return null;return {scene_id:value.scene_id,expected_revision:value.revision,object_id:value.object_id || null};}
  function render(){
    container.dataset.state=speaking?'speaking':answering?'thinking':listening?'listening':'idle';
    $('mic').textContent=starting?'Cancelar':listening?'Terminar':'Hablar';$('mic').setAttribute('aria-pressed',String(starting || listening));
    $('stop').disabled=!answering && !speaking;$('apply').disabled=answering;
    $('form').querySelector('button').disabled=answering;
    set('status',speaking?'Melodi está hablando. Puedes interrumpirla.':answering?'Preparando respuesta…':listening?'Te escucho · Muse':identity()?'Comandos locales listos. Conversación sólo cuando la solicites.':getScene?.()?.portable?'El contexto de proyectos portátiles aún no está conectado.':'Abre un espacio 3D para hablar con Melodi.');
  }
  function cancelReply(){++generation;turnAbort?.abort();turnAbort=null;answering=false;output.cancel();capture?.suspend(false);render();}
  function discard(){pending=null;$('review').hidden=true;set('preview','');}
  function stop(){
    ++startId;starting=false;listening=false;clearTimeout(timer);clearTimeout(settle);timer=settle=null;transcript='';
    cancelReply();capture?.stop();capture=null;microphone?.getTracks().forEach(track=>track.stop());microphone=null;
    audio?.close().catch(()=>{});audio=null;output.player.audio?.close().catch(()=>{});set('interim','');render();
  }
  function contextChanged(){const id=identity(),key=id?JSON.stringify(id):'';if(key!==revisionKey){revisionKey=key;history=[];discard();cancelReply();}render();}
  async function load(){
    try{const [status,ready]=await Promise.all([request('/api/spatial/assistant/status'),request('/api/status')]);if(disposed)return;config=status;voice=ready.voice;set('origin',config.provider_simulated?'Proveedor simulado · contexto local':'Meta · contexto del espacio');}
    catch(error){if(!disposed)set('error',error.message);}render();
  }
  function showProposal(value){
    pending=value;const item=value.preview;
    set('preview',`${item.label}: ${item.before.position.join(', ')} → ${item.after.position.join(', ')} · ${item.units==='meters'?'metros declarados':'unidades relativas'} · revisión ${item.expected_revision}`);
    $('review').hidden=false;
  }
  async function ask(text,spoken=false){
    text=text.trim();if(!text || disposed)return;contextChanged();const scene=identity();
    if(!scene){set('error','Elige un espacio guardado de la biblioteca.');return;}
    if(text.length>1200){set('error','Usa un mensaje de hasta 1200 caracteres.');return;}
    cancelReply();discard();set('error','');set('question',text);set('reply','');answering=true;render();
    const current=generation;
    try{
      const local=await post('/api/spatial/assistant/command',{...scene,text});if(current!==generation || disposed)return;
      if(local.handled){
        if(local.action)await onAction({action:local.action});
        if(disposed)return;set('reply',local.reply);if(local.proposal)showProposal(local.proposal);answering=false;render();return;
      }
      if(!$('consent').checked)throw Error('Activa el permiso de conversación para enviar esta pregunta y el contexto a Meta. Los comandos locales no lo necesitan.');
      if(!config?.configured)throw Error('La conversación Meta aún no está configurada. Los comandos locales siguen disponibles.');
      if(turns>=30){stop();throw Error('Se alcanzaron treinta turnos en esta página. No se repetirán consultas.');}
      turns++;const abort=turnAbort=new AbortController(),previous=history.slice(-8);let reply='',complete=false;
      const budget=new window.BrivanyLive.TurnBudget(abort,{onSlow:()=>{if(current===generation)set('status','La respuesta está tardando más de lo habitual…');},onExpire:({phase})=>{if(current===generation){answering=false;set('error',phase==='first_text'?'Meta no empezó a responder en 10 s. Se detuvo la espera sin reintentar.':'La respuesta no terminó en 20 s. Se detuvo la espera; el texto parcial está incompleto.');render();}}});
      async function* sentences(){
        let reader;
        try{
          const response=await fetch('/api/spatial/assistant/turn',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...scene,text,history:previous,consent:true})});
          if(!response.ok){const value=await response.json().catch(()=>({}));throw Error(value.error?.message || 'No se pudo conversar con Melodi.');}
          reader=response.body.getReader();const decoder=new TextDecoder();let pending='',bytes=0;
          while(!abort.signal.aborted && current===generation){
            const {value,done}=await reader.read();bytes+=value?.byteLength || 0;if(bytes>128000)throw Error('La respuesta superó el límite.');
            pending+=decoder.decode(value || new Uint8Array(),{stream:!done});let newline;
            while((newline=pending.indexOf('\n'))>=0){
              const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line)continue;const event=JSON.parse(line);
              if(event.type==='error')throw Error(event.message || 'La respuesta se interrumpió.');
              if(event.type==='context')set('origin',(event.simulation?'Proveedor simulado · ':'')+'Contexto del servidor · revisión '+event.scene_revision);
              if(event.type==='delta'){if(typeof event.text!=='string' || reply.length+event.text.length>2400)throw Error('La respuesta superó el límite.');reply+=event.text;container.dataset.firstTextMs=String(Math.round(budget.firstText()));set('reply',reply);}
              if(event.type==='sentence'){if(typeof event.text!=='string' || event.text.length>1800)throw Error('El fragmento de voz superó el límite.');yield {text:event.text,pauseAfter:90};}
              if(event.type==='done')complete=true;
            }
            if(done)break;
          }
          if(!complete && !abort.signal.aborted)throw Error('La respuesta llegó incompleta.');
        }catch(error){if(!abort.signal.aborted && current===generation)set('error',error.message);}
        finally{
          budget.finish();await reader?.cancel().catch(()=>{});reader?.releaseLock();
          if(current===generation){if(complete && !abort.signal.aborted){history.push({role:'user',content:text},{role:'assistant',content:reply});history=history.slice(-8);}answering=false;render();}
        }
      }
      if(spoken && voice?.tts?.configured)output.speak(sentences(),{rate:1,quiet:false,signal:abort.signal});
      else for await(const _sentence of sentences()){};
    }catch(error){if(current===generation && !disposed){set('error',error.message);answering=false;render();}}
  }
  async function start(){
    if(starting || listening){stop();return;}
    if(!$('consent').checked || !$('voice-consent').checked){set('error','Autoriza conversación y voz antes de activar el micrófono.');return;}
    if(!identity()){set('error','Abre primero un espacio guardado.');return;}
    if(!voice?.asr?.available){set('error','Muse aún no está disponible. Puedes escribir comandos locales.');return;}
    const current=++startId;starting=true;set('error','');render();
    try{
      const endpoint=new URL(voice.websocket_url);
      if(endpoint.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(endpoint.hostname) || endpoint.pathname!=='/live' || endpoint.search || endpoint.username || endpoint.password)throw Error('La escucha requiere el puente local de Brivany.');
      if(!navigator.mediaDevices?.getUserMedia)throw Error('El micrófono no está disponible en este navegador.');
      if(voice.tts?.configured)await output.player.prepare({rate:1,quiet:false});
      const opened=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(current!==startId || disposed){opened.getTracks().forEach(track=>track.stop());return;}
      microphone=opened;const Audio=window.AudioContext || window.webkitAudioContext;audio=new Audio();await audio.resume();
      capture=new window.BrivanyLive.MuseCapture({onTranscript:result=>{
        if(current!==startId || !listening || !result.text?.trim())return;set('interim',result.text);
        if(!result.final || seen.has(result.id))return;seen.add(result.id);if(seen.size>100)seen.delete(seen.values().next().value);
        transcript=(transcript+' '+result.text).trim().slice(-1200);clearTimeout(settle);
        settle=setTimeout(()=>{const text=transcript;transcript='';set('interim','');if(text && listening)ask(text,true);},180);
      },onSpeechStart:()=>{if(!speaking){clearTimeout(settle);cancelReply();}},onStatus:()=>{},onError:message=>{stop();set('error',message);}});
      const accepted=await capture.start(audio,audio.createMediaStreamSource(opened),{url:endpoint.href,mode:'practice',language:'es',meetingConsent:false});
      if(current!==startId || disposed)return;starting=false;listening=accepted;
      for(const track of opened.getTracks())track.addEventListener('ended',()=>{if(listening){stop();set('error','El micrófono se desconectó.');}},{once:true});
      timer=setTimeout(()=>{stop();set('status','Conversación detenida tras diez minutos.');},600000);render();
    }catch(error){if(current===startId){stop();set('error',['NotAllowedError','SecurityError'].includes(error.name)?'El micrófono no obtuvo permiso. Puedes escribir.':error.message);}}
  }
  $('form').addEventListener('submit',event=>{event.preventDefault();const text=$('message').value;if(text.trim()){ask(text);$('message').value='';}});
  $('mic').addEventListener('click',start);$('stop').addEventListener('click',()=>{clearTimeout(settle);transcript='';cancelReply();});
  for(const name of ['consent','voice-consent'])$(name).addEventListener('change',()=>{if(!$(name).checked)stop();});
  $('discard').addEventListener('click',discard);
  $('apply').addEventListener('click',async()=>{
    if(!pending || answering)return;const value=pending,current=generation;answering=true;render();
    try{const result=await post('/api/spatial/assistant/execute',{proposal_id:value.id,action_sha256:value.action_sha256,explicit:true});
      if(disposed)return;discard();await onAction(result);if(current===generation)set('reply','Movimiento guardado. Puedes usar Deshacer.');
    }catch(error){if(!disposed){discard();set('error',error.message);}}
    finally{answering=false;render();}
  });
  const dispose=()=>{disposed=true;stop();discard();history=[];window.removeEventListener('pagehide',dispose);};
  window.addEventListener('pagehide',dispose,{once:true});load();contextChanged();render();
  return {ask,stop,contextChanged,dispose};
}
