(async() => {
 const $=selector=>document.querySelector(selector),owner=parent.location.origin===location.origin?parent:window;
 await owner.BrivanyConversations?.ready;
 const session=owner.BrivanyChatSession ||= {messages:[],history:[]},control=owner.BrivanyComputerSession ||= {token:null};
 for(const message of session.messages){message.shown=true;message.streaming=false;}
 session.id ||= crypto.randomUUID();
 session.tasks ||= [];
 document.querySelectorAll('[data-icon]').forEach(el=>window.BrivanyIcons.set(el,el.dataset.icon));
 const list=$('#chat-messages'),input=$('#chat-message'),prefs=()=>window.BrivanyPreferences.get();
 let config=null,controller=null,generation=0,pending=false,thinking=false,thinkingMessageId=null,listening=false,starting=false,micGeneration=0,lastSpeech=performance.now(),recentSpeech='',lastBarge=0,notices=[],partial='',partialId=null,waitingThought=false;
 let dictationPhase='idle',dictationBase='',dictationText='',dictationPartial='',dictationDraft='',dictationRevision=0,dictationGeneration=0;const dictationSeen=new Set();
 let liveOpen=false,liveFailure='',liveStartController=null;
 let cuePlayer=null,cueController=null,cueSpeaking=false,cueEchoUntil=0,lastCue=null;const cueCache=new Map();
 const seen=new Set(),animatedMessages=new Set(),channel=typeof BroadcastChannel==='function'?new BroadcastChannel('brivany-live-owner'):null,voiceOwner=crypto.randomUUID();
 let publishTimer=null,lastSignal=0;const workspaceRequests=new Set();
 function flushWorkspace(){clearTimeout(publishTimer);publishTimer=null;owner.pywebview?.api?.workspace_chat_publish?.({messages:session.messages.slice(-80).map(m=>({role:m.role,text:m.text,continuation:m.continuation,sources:m.showSources?m.sources:undefined,showSources:m.showSources===true})),pending:pending||voice.speaking&&!voice.playing&&!cueSpeaking,starting,listening,speaking:voice.playing||cueSpeaking,dictation:{phase:dictationPhase,draft:dictationDraft,revision:dictationRevision},error:$('#chat-state')?.dataset.error==='true'?$('#chat-state').textContent:''}).catch(()=>{});}
 function publishWorkspace(){if(!publishTimer)publishTimer=setTimeout(flushWorkspace,70);}
 const status=(text='',error=false)=>{$('#chat-state').textContent=text;$('#chat-state').dataset.error=String(error);publishWorkspace();};
 const scroll=()=>window.BrivanyChatScroll?.changed();
 function syncThinking(){
  const indicators=[...list.querySelectorAll('#chat-working')];let indicator=indicators.shift();for(const duplicate of indicators)duplicate.remove();
  if(!pending||!thinking){indicator?.remove();return;}
  const target=[...list.querySelectorAll('[data-message-id]')].find(row=>row.dataset.messageId===thinkingMessageId);if(!target){indicator?.remove();return;}
  if(!indicator){indicator=document.createElement('div');indicator.id='chat-working';indicator.className='chat-working';indicator.setAttribute('role','status');const label=document.createElement('span');label.textContent='Pensando';const dots=document.createElement('span');dots.className='chat-thinking-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(document.createElement('i'));indicator.append(label,dots);}
  if(indicator.parentNode!==target)target.append(indicator);
 }
 function reconcile(parent,children){
  children.forEach((child,index)=>{if(parent.children[index]!==child)parent.insertBefore(child,parent.children[index]||null)});
  for(const child of [...parent.children])if(!children.includes(child))child.remove();
 }
 function render(){
  publishWorkspace();owner.BrivanyConversations?.touch();
  if(!session.messages.length){if(!list.querySelector('.chat-welcome'))list.innerHTML='<div class="chat-welcome"><h1>¿Qué creamos hoy?</h1></div>';return;}
  const messages=session.messages.filter((message,index)=>{if(message.role!=='assistant'||message.text!=='He terminado la tarea. Puedes revisar el resultado.')return true;const task=session.tasks.find(t=>t.id===session.messages[index-1]?.taskId);return !task||!['image','motion'].includes(task.kind)||!task.output?.path});
  const previous=new Map([...list.children].filter(row=>row.dataset.messageId).map(row=>[row.dataset.messageId,row])),rows=[];
  if(messages.length>(session.visibleMessages||120)){const older=document.createElement('button');older.type='button';older.className='chat-load-older';older.textContent='Cargar mensajes anteriores';older.onclick=()=>{session.visibleMessages=(session.visibleMessages||120)+120;render()};rows.push(older)}
  for(const message of messages.slice(-(session.visibleMessages||120))){
   message.id||=crypto.randomUUID();const row=previous.get(message.id)||document.createElement('article');row.className='chat-message';row.dataset.role=message.role;row.dataset.messageId=message.id;
   if(!message.shown){row.classList.add('chat-message-enter');message.shown=true}
   const animate=message.role==='assistant'&&animatedMessages.has(message.id),text=animate&&window.BrivanyChatText?.target(message.id)||row.querySelector(':scope > .message-text')||document.createElement('div');text.className='message-text';
   if(animate&&window.BrivanyChatText)BrivanyChatText.write(text,message.text,message.id);else if(text.textContent!==message.text)text.textContent=message.text;
   if(message.references){text.querySelector('.message-reference-count')?.remove();const label=document.createElement('small');label.className='message-reference-count';label.textContent=message.references+' imagen'+(message.references===1?'':'es');text.prepend(label)}
   const children=[];
   if(message.attachments?.length){const signature=JSON.stringify(message.attachments);if(row._attachmentSignature!==signature){const mount=document.createElement('div');window.BrivanyChatMedia?.renderSent(mount,message.attachments);row._attachments=mount.firstElementChild;row._attachmentSignature=signature}if(row._attachments)children.push(row._attachments)}
   children.push(text);
   if(message.continuation){
    const button=row.querySelector('.chat-continuation')||document.createElement('button');button.className='chat-continuation';button.type='button';button.textContent='Continuar';
    button.onclick=async()=>{button.disabled=true;try{await owner.pywebview.api.continue_assistant_job(message.continuation);delete message.continuation;render()}catch{status('La tarea todavía no está disponible para continuar.',true);button.disabled=false}};children.push(button);
   }
   if(message.showSources){const signature=JSON.stringify(message.sources);if(row._sourceSignature!==signature){const mount=document.createElement('div');window.BrivanyCitations?.(mount,message.sources,owner.pywebview?.api);row._sources=mount.firstElementChild;row._sourceSignature=signature}if(row._sources)children.push(row._sources)}
   const task=session.tasks.find(item=>item.id===message.taskId);if(task&&window.BrivanyChatActivity)children.push(BrivanyChatActivity.card(task,owner));
   const indicator=row.querySelector('#chat-working');if(indicator&&pending&&thinking&&message.id===thinkingMessageId)children.push(indicator);
   reconcile(row,children);rows.push(row);
  }
  reconcile(list,rows);syncThinking();scroll();
 }
 function add(role,text,references=0,sources){const item={id:crypto.randomUUID(),role,text,references,sources};if(role==='assistant')animatedMessages.add(item.id);session.messages.push(item);render();return {item,node:list.lastElementChild.querySelector('.message-text')};}
 function state(){
  publishWorkspace();
  const stage=$('#chat-voice-stage');stage.hidden=!liveOpen;list.hidden=liveOpen;list.inert=liveOpen;document.body.dataset.voiceOpen=String(liveOpen);document.body.dataset.voiceError=String(!!liveFailure);
  stage.dataset.phase=liveFailure?'error':starting?'connecting':voice.playing||cueSpeaking?'speaking':pending||voice.speaking?'thinking':'listening';
  $('#chat-voice-label').textContent=liveFailure?'No pude activar la voz':starting?'Conectando…':voice.playing?'Estoy hablando':pending||voice.speaking?'Estoy pensando…':'Te escucho';
  $('#chat-voice-hint').textContent=liveFailure|| (starting?'Un momento, estoy preparando la voz.':voice.playing?'Puedes interrumpirme para seguir la conversación.':pending||voice.speaking?'Estoy preparando mi respuesta.':'Habla con naturalidad. Estoy aquí.');
  $('#chat-voice-retry').hidden=!liveFailure;$('#chat-voice-close').textContent=liveFailure?'Volver al chat':starting?'Cancelar conexión':'Terminar voz';
  const live=listening||starting,hasText=!!input.value.trim();$('#mic-toggle').setAttribute('aria-pressed',String(listening));$('#mic-toggle').setAttribute('aria-label',listening?'Terminar voz live':starting?'Cancelar conexión de voz':'Iniciar voz live');$('#mic-toggle').hidden=hasText&&!live;$('#mic-toggle').dataset.connecting=String(starting);$('#chat-send').hidden=!hasText||live;
  $('#dictation-toggle').hidden=live;$('#dictation-toggle').setAttribute('aria-pressed',String(dictationPhase!=='idle'));$('#dictation-toggle').setAttribute('aria-label',dictationPhase==='idle'?'Dictar mensaje':dictationPhase==='finishing'?'Terminando dictado':'Terminar dictado');$('#dictation-toggle').disabled=dictationPhase==='finishing';
  $('#interrupt').hidden=!pending&&!voice.speaking;$('#chat-send').disabled=pending||window.BrivanyChatMedia?.busy;
  syncThinking();
 }
 const taskTimers=new Map();let closedPage=false;
 function taskText(command){
  const result=command.result||{},output=result.output||{};
  if(['succeeded','awaiting_user'].includes(command.state)){
   if(output.partial&&output.message)return output.message;
   if(output.verified&&typeof output.path==='string'&&/\.(?:png|jpg|jpeg|webp|mp4|webm|mov)$/i.test(output.path))return '';
   if(output.verified===true&&typeof output.message==='string')return output.message.replace('Video creado por Melodi; listo para revisar.','He creado el video; ya puedes revisarlo.').replace('Ilustración creada por Melodi; lista para revisar.','He creado la ilustración; ya puedes revisarla.').slice(0,2200);
   if(output.direct_application_open){const name=output.receipts?.find(r=>r.action==='launch_app')?.result?.launched;return name?`${name} está abierto.`:'La aplicación está abierta.';}
   return (output.message||output.title||result.summary||result.phase||'El ejecutor no devolvió una descripción del resultado.').slice(0,2200);
  }
  if(command.state==='awaiting_approval')return 'Necesito tu aprobación en Brivany para continuar.';
  if(command.state==='cancelled')return 'La tarea se ha detenido.';
  return typeof result.summary==='string'?result.summary.slice(0,800):'No pude completar la tarea. Puedes revisar el resultado en la app.';
 }
 function watchTask(id,remote=true){
  if(!id||taskTimers.has(id))return;
  let entry=session.tasks.find(t=>t.id===id);if(!entry){entry={id,remote,conversation:session.id,started:Date.now(),state:'queued'};session.tasks.push(entry);const anchor=[...session.messages].reverse().find(m=>m.role==='assistant');if(anchor)anchor.taskId=id;render();}
  let failures=0;
  const finish=(text,sources,provenance)=>{
   entry.finalized=true;entry.finished=Date.now();taskTimers.delete(id);
   if(!['succeeded','failed','cancelled','interrupted','awaiting_user'].includes(entry.state)){entry.state='uncertain';entry.phase=text;}
   if(entry.conversation!==session.id||closedPage)return;
   if(text){const response=add('assistant',text,0,sources);if(provenance)response.item.searchProvenance=provenance;session.history.push({role:'assistant',content:text.slice(0,2400)});session.history=session.history.slice(-12);}render();publishWorkspace();
   if(text&&listening&&prefs().voiceNotices)notices.push(text);
  };
  const poll=async()=>{
   if(closedPage||entry.conversation!==session.id){taskTimers.delete(id);return;}
   try{
    const api=owner.pywebview?.api;let command;
    if(entry.remote)command=(await api.account_command_status(id)).command;
    else{const snapshot=await api.assistant_status(),job=snapshot.jobs.find(j=>j.id===id);if(job){const before=JSON.stringify([entry.state,entry.phase,entry.children,entry.progress]);window.BrivanyChatActivity?.update(entry,job,snapshot.jobs);if(before!==JSON.stringify([entry.state,entry.phase,entry.children,entry.progress]))render();command={state:job.state==='interrupted'?'failed':job.state,result:{output:job.result,summary:job.error||job.phase,phase:job.phase,continuation_id:job.state==='waiting_for_user'?job.id:job.continuation_id,intervention_revision:job.intervention_revision}};}}
    if(entry.remote&&command){entry.state=command.state;entry.phase=command.phase||command.result?.phase;entry.output=command.result?.output;render();}
    failures=0;
    window.BrivanyChatActivity?.tick(entry);
    const continuation=command?.result?.continuation_id;
    const revision=continuation?command.result.intervention_revision:null;
    if(continuation!==entry.continuation||revision!==entry.interventionRevision){
     for(const message of session.messages)if(message.continuation===entry.continuation&&entry.continuation)delete message.continuation;
     entry.continuation=continuation;
     entry.interventionRevision=revision;
     if(continuation){add('assistant',command.result.phase||'Esta tarea espera tu intervención.').item.continuation=continuation;render();}
     else render();
    }
    if(command?.state==='awaiting_approval'&&entry.lastState!=='awaiting_approval')add('assistant',taskText(command));
    entry.lastState=command?.state;
    if(command&&['succeeded','awaiting_user','failed','cancelled','uncertain'].includes(command.state)){
     const output=command.result?.output;
     const searched=command.state==='succeeded'&&output?.verified===true&&output?.web_search_verified===true;
     finish(taskText(command),searched?output.sources:undefined,searched?{provider:output.provider||'Meta web search',observed_at:output.observed_at}:undefined);if(output?.path&&entry.kind==='image')owner.dispatchEvent(new CustomEvent('brivany-image-result',{detail:{id:entry.id,output}}));return;
    }
   }catch{failures++;}
   if(Date.now()-entry.started>1800000||failures>=8){finish('No pude confirmar el resultado de la tarea. No la repetiré automáticamente.');return;}
   taskTimers.set(id,setTimeout(poll,Math.max(Date.now()-entry.started<5000?650:2000,session.tasks.length*700)));
  };
  taskTimers.set(id,setTimeout(poll,350));
 }
 const listeningCues=new BrivanyLiveTurns.ListeningCues({onCue:playListeningCue,now:()=>performance.now()});
 function stopListeningCues(){listeningCues.stop();cueController?.abort();cueController=null;cuePlayer?.cancel();cueSpeaking=false;}
 function cueSample(key){const language=prefs().language.startsWith('en')?'en':'es',cacheKey=language+key;if(!cueCache.has(cacheKey))cueCache.set(cacheKey,fetch('/api/voice/cue/'+language+'/'+key,{cache:'force-cache'}).then(async response=>{if(!response.ok)return null;const bytes=await response.arrayBuffer();return bytes.byteLength>0&&bytes.byteLength<=240000?bytes:null;}).catch(()=>null));return cueCache.get(cacheKey);}
 async function playListeningCue(key){
  if(!listening||pending||voice.speaking||owner.BrivanyWorkState?.recording)return;
  const controller=new AbortController();cueController?.abort();cueController=controller;
  const bytes=await cueSample(key);if(!bytes||controller.signal.aborted||!listening||pending||voice.speaking)return;
  cuePlayer ||= new BrivanyLive.PCMPlayer(value=>{cueSpeaking=value;state();});cuePlayer.audio=voice.remote?.player.audio;
  lastCue=key;cueEchoUntil=performance.now()+1800;
  try{await cuePlayer.prepare({rate:1,quiet:true});await cuePlayer.stream(new Response(bytes,{headers:{'Content-Type':'audio/pcm'}}),controller.signal);}catch{/* Optional listening cue; the user's microphone stays active. */}
 }
 const turns=new BrivanyLiveTurns.SpeechTurnAssembler({onPartial:text=>{partial=text;$('#interim').textContent=text;if(text)listeningCues.update(text);publishWorkspace();},onCommit:text=>{stopListeningCues();if(!listening)return;if(prefs().autoReply)send(text,true);else{input.value=(input.value+' '+text).trim().slice(-1200);resize();}}});
 const voice=new BrivanyVoice.VoiceOutput(()=>state(),message=>{controller?.abort();status(message,true);},playing=>{microphone.suspend(playing);owner.pywebview?.api?.music_voice_active?.(playing).catch(()=>{});state();});
 const microphone=new BrivanyVoice.Microphone({
  onLevel:value=>{if(value.active)lastSpeech=performance.now();if(performance.now()-lastSignal>=100){lastSignal=performance.now();owner.pywebview?.api?.workspace_live_signal?.({level:Math.min(1,value.rms||0),samples:value.samples||[]}).catch(()=>{});}},onStatus:()=>{},onError:message=>{if(dictationPhase!=='idle')cancelDictation(false);else{const keepOpen=liveOpen;stopLive({keepOpen});if(keepOpen)liveFailure=message;}status(message,true);state();},
  onSpeechStart:()=>{lastSpeech=performance.now();if(listening){turns.speechStart();if(pending||voice.speaking)cancel();}},
  onBargeIn:()=>{lastBarge=performance.now();cancel();status();},
  onTranscript:result=>{
   if(dictationPhase!=='idle'){
    if(!result.text?.trim())return;
    if(result.final){if(dictationSeen.has(result.id))return;dictationSeen.add(result.id);dictationText=(dictationText+' '+result.text).trim().slice(0,1200);dictationPartial='';}
    else dictationPartial=result.text.slice(0,1200);
    return;
   }
   if(!listening||!result.text?.trim())return;lastSpeech=performance.now();
   if(performance.now()<cueEchoUntil){result={...result,text:BrivanyLiveTurns.stripCueEcho(result.text,lastCue)};if(!result.text)return;}
   if(performance.now()-lastBarge<1400&&BrivanyLive.isPlaybackEcho(result.text,recentSpeech))return;
   if(turns.push(result)&&(pending||voice.speaking))cancel();
  }
 });
 function cancel(){generation++;controller?.abort();controller=null;pending=false;thinking=false;thinkingMessageId=null;voice.cancel();state();}
 function stopLive({keepOpen=false}={}){micGeneration++;liveStartController?.abort();liveStartController=null;starting=false;listening=false;liveOpen=keepOpen;liveFailure='';waitingThought=false;stopListeningCues();turns.reset();microphone.stop();cancel();partial='';partialId=null;$('#interim').textContent='';state();}
 const speechOptions=()=>({voiceURI:config?.voice?.tts?.configured?'melodi-cartesia':undefined,language:prefs().language.startsWith('en')?'en':'es',rate:prefs().rate,quiet:prefs().quiet,live:listening});
 const dictationValue=()=>[dictationBase,dictationText,dictationPartial].filter(Boolean).join(' ').trim().slice(0,1200);
 function cancelDictation(discard=true){
  if(dictationPhase==='idle')return;
  dictationGeneration++;micGeneration++;dictationDraft=discard?dictationBase:dictationValue();dictationRevision++;dictationPhase='idle';microphone.stop();dictationPartial='';dictationSeen.clear();input.value=dictationDraft;resize();state();
 }
 async function startDictation(base=''){
  if(dictationPhase!=='idle')return;
  cancel();stopLive();dictationBase=base.slice(0,1200);dictationText='';dictationPartial='';dictationSeen.clear();dictationPhase='starting';const token=++dictationGeneration;state();status();
  try{
   if(!config)config=await (await fetch('/api/status',{cache:'no-store'})).json();
   if(token!==dictationGeneration)return;
   if(!config.voice?.asr.available)throw Error('Configura la escucha de voz en Ajustes → Servicios.');
   channel?.postMessage({type:'claim',owner:voiceOwner});
   let timer;const ready=await Promise.race([microphone.start({transcribe:true,provider:'muse',language:prefs().language,threshold:prefs().threshold,live:{url:config.voice.websocket_url,mode:'practice',bargeIn:false}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('El micrófono tardó demasiado en conectar. Vuelve a intentarlo.')),12000);})]).finally(()=>clearTimeout(timer));
   if(token!==dictationGeneration)return;
   if(!ready)throw Error('No se pudo iniciar el micrófono.');dictationPhase='recording';state();
  }catch(error){if(token!==dictationGeneration)return;cancelDictation(false);status(error.name==='NotAllowedError'?'Permite el acceso al micrófono para dictar.':error.name==='NotFoundError'?'No se encontró un micrófono conectado.':error.name==='NotReadableError'?'No se pudo abrir el micrófono. Revisa si otra aplicación lo está usando.':error.message,true);}
 }
 async function finishDictation(submit=false){
  if(dictationPhase==='starting'){cancelDictation();return;}
  if(dictationPhase!=='recording')return;
  dictationPhase='finishing';const token=dictationGeneration;state();let timer,incomplete=false;
  try{incomplete=!(await Promise.race([microphone.finish().then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),3500);})]));}
  catch{incomplete=true;}
  finally{clearTimeout(timer);}
  if(token!==dictationGeneration)return;
  const draft=dictationValue();dictationGeneration++;dictationPhase='idle';microphone.stop();dictationDraft=submit&&!incomplete?'':draft;dictationRevision++;dictationPartial='';dictationSeen.clear();input.value=dictationDraft;resize();state();
  if(incomplete)status('La transcripción no terminó. Revisa el texto antes de enviarlo.',true);
  else if(submit&&draft)send(draft,false);
  else if(submit)status('No se detectó voz. Puedes volver a dictar.',true);
 }
 async function activateLive(){
  if(starting||listening){stopLive();return;}
  if(dictationPhase!=='idle')cancelDictation(false);
  cancel();const id=++micGeneration,attempt=new AbortController();liveStartController=attempt;liveOpen=true;liveFailure='';starting=true;state();status();let startDeadline;
  try{
   // Unlock output during the actual click, then refresh server readiness.
   const ready=voice.remote?.player.prepare({rate:1,quiet:prefs().quiet})||Promise.resolve();ready.catch(()=>{});
   const connect=(async()=>{
    const response=await fetch('/api/status',{cache:'no-store',signal:attempt.signal});
    if(!response.ok)throw Error('No pude comprobar la conexión de voz. Vuelve a intentarlo.');
    const current=await response.json();if(id!==micGeneration)return false;config=current;
    if(!config.voice?.asr.available)throw Error('Configura la escucha de voz en Ajustes → Servicios.');
    channel?.postMessage({type:'claim',owner:voiceOwner});
    const capture=microphone.start({transcribe:true,provider:'muse',language:prefs().language,threshold:prefs().threshold,live:{url:config.voice.websocket_url,mode:'practice',bargeIn:true}});
    return (await Promise.all([capture,ready]))[0];
   })();
   const result=await Promise.race([connect,new Promise((_,reject)=>{startDeadline=setTimeout(()=>reject(Error('La conexión de voz tardó demasiado. Vuelve a intentarlo.')),35000);})]);
   if(id!==micGeneration)return;if(result!==true)throw Error('No se pudo iniciar el micrófono. Vuelve a intentarlo.');listening=true;starting=false;for(const key of ['aja','entiendo','bien'])cueSample(key);state();
  }catch(error){
   if(id!==micGeneration)return;stopLive({keepOpen:true});
   liveFailure=error.name==='NotAllowedError'?'Permite el acceso al micrófono para hablar con Melodi.':error.name==='NotFoundError'||error.name==='OverconstrainedError'?'No se encontró un micrófono. Conecta o enciende uno y vuelve a intentarlo.':error.name==='NotReadableError'?'No pude abrir el micrófono. Revisa si otra aplicación lo está usando.':error.message;
   status(liveFailure,true);state();
  }finally{clearTimeout(startDeadline);if(liveStartController===attempt)liveStartController=null;}
 }
 async function executePrepared(event,signal){
  signal.throwIfAborted();const api=owner.pywebview?.api;if(!api?.authorize_computer)throw Error('Esta acción requiere la ventana de Brivany Desktop.');const grant=await api.authorize_computer();if(!grant.ok||!grant.token)throw Error('No se pudo habilitar la tarea.');control.token=grant.token;owner.BrivanyAgents?.observe(grant.jobs||[]);
  signal.throwIfAborted();const response=await fetch('/api/computer/execute-prepared',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Brivany-Control':control.token},body:JSON.stringify({ticket:event.ticket})});if(!response.ok){const failure=await response.json().catch(()=>null);throw Error(failure?.error?.message||'La tarea no se inició. No la repetiré automáticamente.');}
  return (await response.json()).job;
 }
 async function send(raw,speak=listening,imageReference=null){
  if(window.BrivanyChatMedia?.busy){input.value=raw;resize();status('Espera a que termine de adjuntarse el archivo.',true);return;}
  stopListeningCues();
  speak=speak&&!owner.BrivanyWorkState?.recording;
  if(!imageReference&&owner.BrivanyReferences?.busy){input.value=raw.slice(0,1200);resize();status('La imagen se está preparando. Envía el mensaje cuando esté lista.');return;}
  const text=raw.trim().slice(0,1200);if(!text&&!window.BrivanyImageRequest?.hasImages())return;
  const sourceQuestion=/^(?:(?:puedes |podrias |por favor )?(?:decirme |mostrarme )?)?(?:de donde (?:sacaste|obtuviste|has sacado|sale|viene)(?: .*)?|(?:cuales son|que|muestrame|dame|ver) (?:tus |las |los )?(?:fuentes|enlaces|referencias)(?: de (?:eso|esa informacion|la respuesta))?|fuentes|enlaces)[?!. ]*$/.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿¡ ]+/,''));
  const previousSearch=sourceQuestion&&!window.BrivanyImageRequest?.hasImages()&&!owner.BrivanyMediaDraft?.length?[...session.messages].reverse().find(m=>m.role==='assistant'&&m.searchProvenance):null;
  cancel();status();waitingThought=false;const current=generation,request=controller=new AbortController(),history=session.history.slice(-12),question=text||'¿Qué ves en esta imagen?';
  const attachments=window.BrivanyChatMedia?.take()||[];let mediaAccepted=false;
  const references=imageReference?1:owner.BrivanyReferences?.items.length||0;window.BrivanyChatScroll?.toLatest(false);const user=add('user',question,references);user.item.attachments=attachments.map(({id,...item})=>item);if(attachments.length)render();session.history.push({role:'user',content:question});owner.BrivanyConversations?.messageSent?.();
  if(previousSearch){
   const sources=previousSearch.sources||[],answer=sources.length?'Lo consulté mediante la búsqueda web de Meta. Estas son las páginas que devolvió la búsqueda.':'Lo consulté mediante la búsqueda web de Meta, pero esta consulta no devolvió los enlaces de las páginas.';
   const response=add('assistant',answer,0,sources);response.item.showSources=true;session.history.push({role:'assistant',content:answer});session.history=session.history.slice(-12);controller=null;render();state();
   if(speak)voice.speak([{text:answer,pauseAfter:0}],speechOptions());return;
  }
  const assistant=add('assistant','');assistant.item.streaming=true;let reply='',receivedDone=false;pending=true;thinking=true;thinkingMessageId=assistant.item.id;state();
  let historyEntry=null;const update=part=>{if(!reply&&part?.trim())status();reply+=part;assistant.item.text=reply.replace(/\[laughter\]/g,'').trim();const target=list.querySelector('[data-message-id="'+assistant.item.id+'"] .message-text');if(target){if(window.BrivanyChatText)BrivanyChatText.write(target,assistant.item.text,assistant.item.id);else target.textContent=assistant.item.text;}if(!historyEntry){historyEntry={role:'assistant',content:''};session.history.push(historyEntry);}historyEntry.content=assistant.item.text.slice(0,2400);scroll();publishWorkspace();owner.BrivanyConversations?.touch();};
  const budget=new BrivanyLive.TurnBudget(request,{firstTextMs:speak?75000:90000,completionMs:speak?150000:180000,onSlow:()=>syncThinking(),onExpire:()=>status('No recibí una respuesta completa dentro del plazo. Tu mensaje se conserva; puedes volver a enviarlo.',true)});
  async function* sentences(){
   let reader;
   try{
    const context=[];let contextSize=0,clipped=false;const all=session.messages.filter(m=>['user','assistant'].includes(m.role)&&m.text);
    for(const m of all.slice().reverse()){const content=m.text.slice(0,2400);if(context.length>=64||contextSize+content.length>24000)break;context.unshift({role:m.role,content});contextSize+=content.length;if(content.length<m.text.length)clipped=true;}
    const retryAnchor=[...session.messages].reverse().find(message=>message.role==='assistant'&&message.taskId);
    const body={text:question,history,retry_job_id:retryAnchor?.taskId||null,media_ids:attachments.map(item=>item.id),conversation_context:context,context_truncated:clipped||context.length<all.length,consent:true,source:speak?'voice':'chat',conversation_id:session.id,language:prefs().language.startsWith('en')?'en':'es'};if(imageReference){body.reference_ids=[imageReference.id];body.active_reference_id=imageReference.id}
    while(new TextEncoder().encode(JSON.stringify(body)).length>60000&&(context.length||body.history.length)){if(context.length)context.shift();else body.history.shift();body.context_truncated=true;}
    const response=await fetch(imageReference?'/api/computer/image-turn':'/api/voice/turn',{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json','X-Brivany-Control':control.token||''},body:JSON.stringify(body)});
    if(!response.ok)throw Error('No se pudo conectar con Melodi. Revisa Ajustes → Servicios.');
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
    while(!request.signal.aborted&&current===generation){
     const {value,done}=await reader.read();if(request.signal.aborted||current!==generation)break;buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;
     while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const event=JSON.parse(line);
      if(event.type==='error')throw Error(event.message);
      if(event.type==='reference_action'){const job=await executePrepared(event,request.signal);mediaAccepted=true;thinking=false;state();watchTask(job.id,false);const ack=job.acknowledgement||`Voy a preparar tu pedido: «${question.slice(0,180)}».`;budget.firstText();update(ack);pending=false;state();yield {text:ack,pauseAfter:0};receivedDone=true;window.BrivanyComputerUI?.refresh();owner.BrivanyAgents?.refresh();}
      if(event.type==='delta'){if(event.text?.trim()){budget.firstText();thinking=false;state();}update(event.text);}
      if(event.type==='sentence'){thinking=false;pending=false;state();recentSpeech=(recentSpeech+' '+event.text).slice(-800);yield {text:event.speech_text||event.text,pauseAfter:60};}
      if(event.type==='computer_task'){mediaAccepted=true;thinking=false;budget.firstText();state();watchTask(event.job?.id,false);window.BrivanyComputerUI?.refresh();owner.BrivanyAgents?.refresh();}
      if(event.type==='computer_job'){thinking=false;budget.firstText();state();watchTask(event.command?.id,true);}
      if(event.type==='done'){mediaAccepted=true;receivedDone=true;thinking=false;state();if(event.await_user===true&&!reply.trim())waitingThought=true;}
     }if(done)break;
    }
    if(!receivedDone&&!request.signal.aborted)throw Error('La respuesta quedó incompleta.');
   }finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  }
  try{
   if(speak&&config?.voice?.tts?.configured){await voice.speak(sentences(),{...speechOptions(),signal:request.signal});}
   else if(speak){const pieces=[];for await(const part of sentences())pieces.push(part);if(pieces.length)voice.speak(pieces,{...speechOptions(),signal:request.signal});}
   else for await(const part of sentences()){}
  }catch(error){if(!request.signal.aborted&&current===generation)status(error.message,true);}
  finally{
   if(attachments.length&&!mediaAccepted&&current===generation)window.BrivanyChatMedia?.restore(attachments);
   if(imageReference)fetch('/api/computer/references/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:imageReference.id})}).catch(()=>{});budget.finish();assistant.item.streaming=false;session.history=session.history.slice(-12);
   if(current===generation){pending=false;thinking=false;thinkingMessageId=null;controller=null;if(!assistant.item.text&&!assistant.item.taskId){session.messages=session.messages.filter(item=>item!==assistant.item);render();}state();owner.BrivanyConversations?.touch();}
  }
  return {text:assistant.item.text,taskId:assistant.item.taskId};
 }
 function resize(){input.style.height='auto';input.style.height=Math.min(140,input.scrollHeight)+'px';session.draft=input.value;owner.BrivanyConversations?.touch();state();}
 $('#chat-composer').onsubmit=event=>{event.preventDefault();const text=input.value;input.value='';resize();send(text);};input.oninput=resize;input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#chat-composer').requestSubmit();}};
 $('#dictation-toggle').onclick=()=>dictationPhase==='idle'?startDictation(input.value):finishDictation();$('#mic-toggle').onclick=activateLive;$('#interrupt').onclick=()=>{cancel();status();};$('#stop-tasks').onclick=async()=>{cancel();if(owner.pywebview?.api?.stop_assistant_tasks)await owner.pywebview.api.stop_assistant_tasks();else await fetch('/api/computer/disarm',{method:'POST',headers:{'Content-Type':'application/json','X-Brivany-Control':control.token||''},body:'{}'});control.token=null;status('Tareas detenidas.');};
 $('#chat-voice-retry').onclick=activateLive;$('#chat-voice-close').onclick=()=>{stopLive();status();};
 const syncVisibility=()=>{document.body.dataset.pageHidden=String(document.hidden);};document.addEventListener('visibilitychange',syncVisibility);syncVisibility();
 if(channel)channel.onmessage=({data})=>{if(data?.type==='claim'&&data.owner!==voiceOwner&&(listening||starting||voice.speaking||dictationPhase!=='idle')){cancelDictation(false);cancel();stopLive();status('La voz se abrió en otra ventana.');}};
 const images=$('#chat-images'),observer=new MutationObserver(()=>{const attach=images.querySelector('.reference-attach');if(attach)$('#chat-attach-anchor').append(attach);});observer.observe(images,{childList:true,subtree:true});
 const attachToggle=$('#chat-attach-toggle'),attachMenu=$('#chat-attach-anchor');const closeAttachments=()=>{attachMenu.hidden=true;attachToggle.setAttribute('aria-expanded','false')};attachToggle.onclick=()=>{attachMenu.hidden=!attachMenu.hidden;attachToggle.setAttribute('aria-expanded',String(!attachMenu.hidden))};attachMenu.addEventListener('click',closeAttachments);document.addEventListener('click',event=>{if(!event.target.closest('.chat-attachments'))closeAttachments()});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeAttachments()});
 const mount=$('#computer-mount'),drawer=$('#agent-drawer'),previewObserver=new MutationObserver(()=>{const preview=mount.classList.contains('computer-has-preview'),options=mount.querySelector('.computer-options')?.open;mount.classList.toggle('show-options',!preview&&!!options);drawer.hidden=!preview&&!options;document.body.dataset.hasPreview=String(!drawer.hidden);});previewObserver.observe(mount,{childList:true,subtree:true,attributes:true,attributeFilter:['class','open']});
 const notificationTimer=setInterval(()=>{if(!notices.length||!listening||pending||voice.speaking||partial||waitingThought||owner.BrivanyWorkState?.recording||performance.now()-lastSpeech<2200||document.hidden&&!owner.BrivanyWorkActive||!prefs().voiceNotices)return;const text=notices.splice(0).join(' ');recentSpeech=text;voice.speak([{text,pauseAfter:0}],speechOptions());},750);
 window.BrivanyLiveNotice={queue:message=>{if(prefs().voiceNotices){notices.push(message);notices=notices.slice(-3);}}};
 window.addEventListener('brivany-reference-error',event=>status(event.detail,true));
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='brivany-navigate'&&[...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===event.source))window.BrivanyComputerUI?.openModule(event.data.route);});
 window.BrivanyChatMedia?.init({owner,report:status,changed:state});
 window.BrivanyChat={send,sendWithImage:(text,reference)=>send(text,false,reference),observeImageJob:(job,text)=>{add('assistant',text);watchTask(job.id,false);return job.id},workspaceCommand:request=>{
  if(!request?.id||workspaceRequests.has(request.id))return;workspaceRequests.add(request.id);if(workspaceRequests.size>50)workspaceRequests.delete(workspaceRequests.values().next().value);
  if(request.action==='send')send(request.text,false);
  if(request.action==='start'&&!listening&&!starting)activateLive();
  if(request.action==='stop'){cancelDictation(false);cancel();stopLive();}
  if(request.action==='dictate_start')startDictation(request.text);
  if(request.action==='dictate_cancel'){cancelDictation();status();}
  if(request.action==='dictate_stop')finishDictation();
  if(request.action==='dictate_send')finishDictation(true);
  publishWorkspace();
 },persist:()=>{session.draft=input.value;return owner.BrivanyConversations?.flush()},clear:()=>{window.BrivanyChatMedia?.clear();if(owner.BrivanyConversations)return owner.BrivanyConversations.create();taskTimers.forEach(clearTimeout);taskTimers.clear();session.tasks=[];cancelDictation();cancel();stopLive();session.id=crypto.randomUUID();session.messages=[];session.history=[];render();status();input.value='';resize();},stopLive:()=>{cancelDictation(false);stopLive();},liveState:()=>({listening,speaking:voice.speaking,pending}),taskStatus:jobs=>{$('#stop-tasks').hidden=!jobs.some(job=>['queued','planning','running','reviewing'].includes(job.state));}};
 const accountChanged=()=>{taskTimers.forEach(clearTimeout);taskTimers.clear();session.tasks=[];window.BrivanyChat.clear();};owner.addEventListener('brivany-account-change',accountChanged);
 fetch('/api/status',{cache:'no-store'}).then(response=>response.json()).then(value=>{if(!config)config=value;}).catch(()=>{});render();window.BrivanyChatScroll?.toLatest(false);
 $('#chat-composer').inert=false;input.value=session.draft||'';resize();
 session.tasks.filter(t=>t.conversation===session.id&&!t.finalized).forEach(t=>watchTask(t.id,t.remote));
 window.addEventListener('pagehide',()=>{closedPage=true;session.draft=input.value;owner.BrivanyConversations?.flush().catch(()=>{});taskTimers.forEach(clearTimeout);taskTimers.clear();owner.removeEventListener('brivany-account-change',accountChanged);document.removeEventListener('visibilitychange',syncVisibility);cancelDictation(false);cancel();stopLive();flushWorkspace();channel?.close();observer.disconnect();previewObserver.disconnect();clearInterval(notificationTimer);},{once:true});
})();
