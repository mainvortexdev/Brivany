import './live-voice.js';

/** Sous context comes from the server; this client sends only session identity. */
export function mountSousVoice({getSessionId=()=>null}={}){
  const $=id=>document.getElementById(id),host=$('sous-conversation');
  if(!host)return null;
  let config=null,ready=null,microphone=null,audio=null,capture=null,startGeneration=0;
  let starting=false,listening=false,speaking=false,answering=false,controller=null,turnGeneration=0;
  let history=[],turns=0,sessionTimer=null,settleTimer=null,disposed=false,lastTranscript='',lastSession=null;
  const seen=new Set();
  const status=text=>{$('sous-voice-status').textContent=text;};
  const fail=text=>{$('sous-voice-error').textContent=text || '';};
  const output=new window.BrivanyLive.MelodiOutput(value=>{speaking=value;capture?.suspend(value);render();},message=>{
    fail(message);controller?.abort();answering=false;capture?.suspend(false);render();
  });
  function render(){
    host.dataset.state=speaking?'speaking':answering?'thinking':listening?'listening':'idle';
    $('sous-mic-toggle').textContent=starting?'Cancelar escucha':listening?'Terminar conversación':'Hablar con Melodi';
    $('sous-mic-toggle').setAttribute('aria-pressed',String(listening || starting));
    $('sous-interrupt').disabled=!answering && !speaking;
    $('sous-send-message').disabled=answering;
    if(speaking)status('Melodi está hablando. Puedes interrumpirla.');
    else if(answering)status('Melodi está preparando tu respuesta…');
    else if(listening)status('Te escucho · Muse · conversación de cocina');
    else if(!starting)status(config?.configured?'Melodi está preparada. Tú decides cuándo empezar.':'Puedes seguir con tu cocina. Conversación Meta pendiente de configuración.');
  }
  function cancelReply(){++turnGeneration;controller?.abort();controller=null;answering=false;output.cancel();capture?.suspend(false);render();}
  function stop(){
    ++startGeneration;starting=false;listening=false;clearTimeout(settleTimer);clearTimeout(sessionTimer);settleTimer=null;sessionTimer=null;lastTranscript='';
    cancelReply();capture?.stop();capture=null;
    microphone?.getTracks().forEach(track=>track.stop());microphone=null;
    if(audio){audio.close().catch(()=>{});audio=null;}
    output.player.audio?.close().catch(()=>{});
    $('sous-interim').textContent='';render();
  }
  async function loadConfig(){
    try{
      const [voice,context]=await Promise.all([fetch('/api/status',{cache:'no-store'}),fetch('/api/sous/voice/status',{cache:'no-store'})]);
      if(!voice.ok || !context.ok)throw Error('No se pudo consultar la configuración de voz.');
      ready=(await voice.json()).voice;config=await context.json();
      $('sous-voice-origin').textContent=config.provider_simulated?'Proveedor simulado · prueba local':'Meta · contexto de tu cocina';
    }catch(error){if(!disposed)fail(error.message);}
    if(!disposed)render();
  }
  async function start(){
    if(starting || listening){stop();return;}
    fail('');
    if(!$('sous-voice-consent').checked){fail('Autoriza la conversación por voz antes de activar el micrófono.');return;}
    if(!config?.configured || !ready?.asr?.available){fail('Muse o la conversación Meta no están disponibles. Puedes usar los controles de Sous o escribir a Melodi si está configurada.');return;}
    if(!navigator.mediaDevices?.getUserMedia){fail('Este navegador no permite micrófono aquí. Continúa con texto.');return;}
    const generation=++startGeneration;starting=true;render();status('Abriendo el micrófono…');
    try{
      const endpoint=new URL(ready.websocket_url);
      if(endpoint.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(endpoint.hostname) || endpoint.pathname!=='/live' || endpoint.search || endpoint.username || endpoint.password)throw Error('La escucha necesita el puente local de Brivany.');
      const Audio=window.AudioContext || window.webkitAudioContext;
      if(!Audio)throw Error('El audio no está disponible. Puedes escribir a Melodi.');
      // Unlock playback during the explicit click before asking for the mic.
      if(ready.tts?.configured)await output.player.prepare({rate:1,quiet:false});
      const opened=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==startGeneration || disposed){opened.getTracks().forEach(track=>track.stop());return;}
      microphone=opened;audio=new Audio();await audio.resume();
      capture=new window.BrivanyLive.MuseCapture({
        onTranscript:result=>{
          if(generation!==startGeneration || !listening || !result.text?.trim())return;
          $('sous-interim').textContent=result.text;
          if(!result.final || seen.has(result.id))return;
          seen.add(result.id);if(seen.size>100)seen.delete(seen.values().next().value);
          lastTranscript=(lastTranscript+' '+result.text).trim().slice(-1200);clearTimeout(settleTimer);
          settleTimer=setTimeout(()=>{const text=lastTranscript;lastTranscript='';if(text && listening)ask(text,true);},180);
        },
        onSpeechStart:()=>{if(!speaking){clearTimeout(settleTimer);cancelReply();}},
        onStatus:()=>{},onError:message=>{stop();fail(message);}
      });
      const accepted=await capture.start(audio,audio.createMediaStreamSource(opened),{url:endpoint.href,mode:'practice',language:'es',meetingConsent:false});
      if(generation!==startGeneration || disposed)return;
      starting=false;listening=accepted;for(const track of opened.getTracks())track.addEventListener('ended',()=>{if(listening){stop();fail('El micrófono se desconectó. Puedes continuar con texto.');}},{once:true});
      sessionTimer=setTimeout(()=>{stop();status('Conversación detenida tras diez minutos. Puedes iniciar otra cuando lo necesites.');},600000);render();
    }catch(error){if(generation===startGeneration){stop();fail(['NotAllowedError','SecurityError'].includes(error.name)?'El micrófono no obtuvo permiso. Puedes continuar con texto.':error.message);}}
  }
  function changeContext(){const session=getSessionId();if(session!==lastSession){lastSession=session;history=[];}cancelReply();}
  async function ask(text,spoken=false){
    text=text.trim();if(!text || disposed)return;
    if(!config?.configured){fail('La conversación Meta aún no está configurada.');return;}
    if(turns>=30){stop();fail('Se alcanzaron treinta turnos en esta página. No se enviarán más consultas automáticamente.');return;}
    if(text.length>1200){fail('Usa un mensaje de hasta 1200 caracteres.');return;}
    cancelReply();fail('');turns++;answering=true;render();
    $('sous-last-question').textContent=text;$('sous-reply').textContent='';$('sous-interim').textContent='';
    const generation=turnGeneration,abort=controller=new AbortController(),snapshot=history.slice(-8),session_id=getSessionId();
    let reply='',complete=false;const budget=new window.BrivanyLive.TurnBudget(abort,{onSlow:()=>{if(generation===turnGeneration)status('La respuesta está tardando más de lo habitual…');},onExpire:({phase})=>{if(generation===turnGeneration){answering=false;fail(phase==='first_text'?'Meta no empezó a responder en 10 s. Se detuvo la espera sin reintentar.':'La respuesta no terminó en 20 s. El texto parcial está incompleto.');render();}}});
    async function* sentences(){
      let reader;
      try{
        const response=await fetch('/api/sous/voice/turn',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({text,history:snapshot,session_id,consent:true})});
        if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error?.message || 'No se pudo conectar con Melodi.');}
        reader=response.body.getReader();const decoder=new TextDecoder();let pending='',bytes=0;
        while(!abort.signal.aborted && generation===turnGeneration){
          const {value,done}=await reader.read();bytes+=value?.byteLength || 0;if(bytes>128000)throw Error('La respuesta superó el límite.');
          pending+=decoder.decode(value || new Uint8Array(),{stream:!done});let newline;
          while((newline=pending.indexOf('\n'))>=0){
            const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line)continue;const event=JSON.parse(line);
            if(event.type==='error')throw Error(event.message || 'La respuesta se interrumpió.');
            if(event.type==='context')$('sous-voice-origin').textContent=(event.simulation?'Proveedor simulado · ':'')+'Contexto local de Sous'+(event.session_revision?' · revisión '+event.session_revision:'');
            if(event.type==='delta'){if(typeof event.text!=='string' || reply.length+event.text.length>2400)throw Error('La respuesta superó el límite.');reply+=event.text;host.dataset.firstTextMs=String(Math.round(budget.firstText()));$('sous-reply').textContent=reply;}
            if(event.type==='sentence'){if(typeof event.text!=='string' || event.text.length>1800)throw Error('El fragmento de voz superó el límite.');yield {text:event.text,pauseAfter:90};}
            if(event.type==='done')complete=true;
          }
          if(done)break;
        }
        if(!complete && !abort.signal.aborted)throw Error('La respuesta llegó incompleta. Puedes volver a preguntar.');
      }catch(error){if(!abort.signal.aborted && generation===turnGeneration)fail(error.message);}
      finally{
        budget.finish();await reader?.cancel().catch(()=>{});reader?.releaseLock();
        if(generation===turnGeneration){if(complete && !abort.signal.aborted){history.push({role:'user',content:text},{role:'assistant',content:reply});history=history.slice(-8);}answering=false;render();}
      }
    }
    if(spoken && ready?.tts?.configured)output.speak(sentences(),{rate:1,quiet:false,signal:abort.signal});
    else for await(const _sentence of sentences()){};
  }
  $('sous-mic-toggle').addEventListener('click',start);
  $('sous-interrupt').addEventListener('click',()=>{clearTimeout(settleTimer);lastTranscript='';cancelReply();status(listening?'Te escucho. Puedes continuar.':'Respuesta interrumpida.');});
  $('sous-voice-consent').addEventListener('change',()=>{if(!$('sous-voice-consent').checked)stop();});
  $('sous-message-form').addEventListener('submit',event=>{event.preventDefault();if(!$('sous-text-consent').checked){fail('Autoriza enviar tu mensaje y el contexto de cocina a Meta.');return;}const input=$('sous-message');if(input.value.trim()){ask(input.value,false);input.value='';}});
  window.addEventListener('sous-context-changed',changeContext);
  window.addEventListener('pagehide',()=>{disposed=true;stop();history=[];output.player.audio?.close().catch(()=>{});},{once:true});
  loadConfig();render();
  return {stop,contextChanged:changeContext};
}
