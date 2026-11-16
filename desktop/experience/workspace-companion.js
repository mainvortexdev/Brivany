/* WorkSpace views the existing chat and Live; it never owns a second microphone. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s),body=document.body;
 let state={messages:[],pending:false,listening:false,speaking:false,starting:false,level:0,samples:[]},signature='',gone=false,wantedLive=false,thoughtTimer=0,thinking=false,wasBottom=true;
 const api=()=>window.pywebview?.api,t=source=>window.BrivanyWorkspaceLocale?.text(source)??source;
 let fitFrame=0,dictationRevision=0;
 function fit(){if(gone||fitFrame)return;fitFrame=requestAnimationFrame(()=>{fitFrame=0;if(body.dataset.surface!=='bar'&&body.dataset.panel==='chat'&&body.dataset.expanded==='true')window.BrivanyIsland?.resizeChat();});}
 function chatHeight(){
  const panel=$('#island-content'),section=$('[data-view=chat]'),header=panel?.querySelector('.panel-top'),list=$('#workspace-chat-messages');
  if(!panel||!section||!header||!section.getBoundingClientRect().width)return 148;
  const number=value=>parseFloat(value)||0,edges=style=>number(style.paddingTop)+number(style.paddingBottom)+number(style.borderTopWidth)+number(style.borderBottomWidth),margins=style=>number(style.marginTop)+number(style.marginBottom);
  const visible=[...section.children].filter(item=>getComputedStyle(item).display!=='none');
  const height=item=>{const style=getComputedStyle(item);if(item!==list)return item.getBoundingClientRect().height+margins(style);const bubbles=[...list.children];return edges(style)+bubbles.reduce((sum,bubble)=>sum+bubble.getBoundingClientRect().height,0)+Math.max(0,bubbles.length-1)*number(style.rowGap);};
  const total=edges(getComputedStyle(panel))+header.getBoundingClientRect().height+margins(getComputedStyle(header))+visible.reduce((sum,item)=>sum+height(item),0)+Math.max(0,visible.length-1)*number(getComputedStyle(section).rowGap);
  return Math.max(148,Math.min(404,Math.ceil(total)));
 }
 function sizeInput(){const input=$('#workspace-chat-input');if(!input)return;const previous=input.style.height;input.style.height='0px';input.style.height=Math.max(34,Math.min(136,Math.max(34,innerHeight-90),input.scrollHeight+2))+'px';if(input.style.height!==previous)fit();}
 function paintLabels(){
  const phase=state.dictation?.phase,talk=$('#companion-talk'),dictation=$('#workspace-dictation-state');
  if(dictation)dictation.textContent=t(phase==='starting'?'Activando micrófono':phase==='finishing'?'Terminando dictado':phase==='recording'?'Grabando':'');
  if(talk)talk.textContent=t(state.starting?'Conectando…':state.listening?'Terminar Live':'Hablar con Melodi');
  $('#workspace-chat-mic')?.setAttribute('aria-label',t('Dictar mensaje'));
 }
 function localize(){
  if(gone)return;
  paintLabels();
  for(const [selector,source] of [['.workspace-continue','Continuar'],['.workspace-thinking','Pensando…']])
   for(const node of document.querySelectorAll(selector))node.textContent=t(source);
  if(state.error)for(const id of ['companion-error','workspace-chat-status'])if($('#'+id))$('#'+id).textContent=t(state.error);
  fit();
 }
 function render(){
  body.dataset.replyVisible=String(state.reply_visible===true);
  const reply=$('#workspace-reply-text'),preview=state.reply_text||'';if(reply&&reply.textContent!==preview)reply.textContent=preview;
  body.dataset.liveListening=String(state.listening);body.dataset.liveSpeaking=String(state.speaking);body.dataset.liveStarting=String(state.starting);
  body.dataset.livePending=String(state.pending);
  const dictation=state.dictation||{phase:'idle',revision:0},dictating=dictation.phase!=='idle';body.dataset.dictationPhase=dictation.phase;body.dataset.dictating=String(dictating);
  const recorder=$('#workspace-dictation');if(recorder)recorder.hidden=!dictating;
  paintLabels();
  for(const id of ['workspace-dictation-stop','workspace-dictation-send'])if($('#'+id))$('#'+id).disabled=dictation.phase!=='recording';
  if(!dictating&&dictation.revision!==dictationRevision){dictationRevision=dictation.revision;const input=$('#workspace-chat-input');if(input){input.value=dictation.draft||'';sizeInput();}}
  if(state.listening||state.speaking||state.starting||state.pending||state.reply_visible||dictating){window.BrivanyIsland?.wake();body.dataset.sleeping='false';body.dataset.characterState='attentive';}
  const talk=$('#companion-talk');if(talk)talk.disabled=state.starting;
  if($('#workspace-chat-send'))$('#workspace-chat-send').disabled=state.pending;
  for(const id of ['companion-error','workspace-chat-status'])if($('#'+id))$('#'+id).textContent=t(state.error||'');
  const messages=state.messages.filter(m=>m.text?.trim()),waiting=state.pending&&state.messages.at(-1)?.role==='assistant'&&!state.messages.at(-1)?.text?.trim();
  if(waiting&&!thinking&&!thoughtTimer)thoughtTimer=setTimeout(()=>{thoughtTimer=0;thinking=true;render()},300);
  if(!waiting){clearTimeout(thoughtTimer);thoughtTimer=0;thinking=false;}
  body.dataset.chatEmpty=String(!messages.length&&!thinking);fit();
  const list=$('#workspace-chat-messages');if(!list)return;
  const next=JSON.stringify([messages,thinking]);if(next===signature)return;signature=next;
  wasBottom=list.scrollHeight-list.scrollTop-list.clientHeight<70;const nodes=[...list.children];
  messages.forEach((message,i)=>{
   let bubble=nodes[i];if(!bubble||bubble.classList.contains('workspace-thinking')){bubble=document.createElement('div');list.insertBefore(bubble,nodes[i]||null);}
   bubble.className='workspace-bubble';bubble.dataset.role=message.role;bubble.textContent=message.text;
   if(message.showSources)window.BrivanyCitations?.(bubble,message.sources,api());
   if(message.continuation){
    const button=document.createElement('button');button.type='button';button.className='workspace-continue';button.textContent=t('Continuar');
    button.onclick=async()=>{button.disabled=true;try{await api().continue_assistant_job(message.continuation);button.remove();fit();}catch{button.disabled=false;receive({error:'La tarea todavía no está disponible para continuar.'});}};
    bubble.append(button);
   }
  });
  while(list.children.length>messages.length)list.lastElementChild.remove();
  if(thinking){const indicator=document.createElement('div');indicator.className='workspace-thinking';indicator.setAttribute('role','status');indicator.textContent=t('Pensando…');list.append(indicator);}
  if(wasBottom)list.scrollTop=list.scrollHeight;
 }
 function receive(value){if(!value||gone)return;state={...state,...value};render();syncWave();syncAnchor();if(wantedLive&&state.error){wantedLive=false;window.BrivanyIsland?.showNotice(state.error);}if(state.listening&&wantedLive){wantedLive=false;if(body.dataset.panel==='melodi')window.BrivanyIsland?.reopen();}}
 async function command(action,text=''){
  try{if(!api()?.workspace_chat_command)throw Error('Abre Melodi desde Brivany Desktop.');receive({error:''});if(action==='send')receive({pending:true});if(action==='start'){wantedLive=true;receive({starting:true});}if(action==='dictate_start')receive({dictation:{...(state.dictation||{}),phase:'starting'}});await api().workspace_chat_command(action,text);}
  catch(error){receive({pending:false,starting:false,dictation:{...(state.dictation||{}),phase:'idle'},error:error.message||'No se pudo conectar con Melodi.'});}
 }
 if($('#companion-write'))$('#companion-write').onclick=()=>{window.BrivanyIsland?.expand('chat');setTimeout(()=>$('#workspace-chat-input')?.focus(),100);};
 if($('#companion-talk'))$('#companion-talk').onclick=()=>command(state.listening?'stop':'start');
 if($('#workspace-chat-mic'))$('#workspace-chat-mic').onclick=()=>command('dictate_start',$('#workspace-chat-input').value);
 if($('#workspace-dictation-cancel'))$('#workspace-dictation-cancel').onclick=()=>command('dictate_cancel');
 if($('#workspace-dictation-stop'))$('#workspace-dictation-stop').onclick=()=>command('dictate_stop');
 if($('#workspace-dictation-send'))$('#workspace-dictation-send').onclick=()=>command('dictate_send');
 if($('#workspace-chat-form'))$('#workspace-chat-form').onsubmit=event=>{event.preventDefault();const input=$('#workspace-chat-input'),text=input.value.trim();if(!text||state.pending)return;input.value='';sizeInput();if(!window.BrivanyTelephone?.fromText(text))command('send',text);};
 if($('#workspace-chat-input'))$('#workspace-chat-input').oninput=sizeInput;
 if($('#workspace-chat-input'))$('#workspace-chat-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#workspace-chat-form').requestSubmit();}};
 function pull(){if(api()?.workspace_chat_state)api().workspace_chat_state().then(receive).catch(()=>{});}
 const canvas=$('#voice-wave'),ctx=canvas?.getContext('2d'),dictationCanvas=$('#workspace-dictation-wave'),dictationContext=dictationCanvas?.getContext('2d');let frame=0,amplitude=0,lastFrame=0;const reduced=matchMedia('(prefers-reduced-motion:reduce)');const easedSamples=Array(48).fill(0);
 function paint(canvas,ctx,inline=false){if(!ctx||!canvas.clientWidth)return;const dpr=Math.min(2,devicePixelRatio||1),w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const samples=easedSamples,count=inline?Math.max(12,Math.floor(w/3.5)):150,step=(w-(inline?8:32))/count;
  if(inline){
   for(let i=0;i<count;i++){const p=i/(count-1),edge=Math.pow(Math.sin(Math.PI*p),.65),sample=samples[Math.min(samples.length-1,Math.floor(p*samples.length))]||0,height=Math.min(h-6,1.4+sample*(h-6)*3*edge);ctx.fillStyle=`rgba(239,243,247,${.23+Math.min(.65,sample*3)})`;ctx.beginPath();ctx.roundRect(4+(i+.5)*step,h/2-height/2,1.4,height,.7);ctx.fill();}return;
  }
  if(state.listening&&!state.reply_visible&&Math.max(amplitude,...samples)>.015){
   for(let i=0;i<count;i++){const x=16+(i+.5)*step,p=i/(count-1),edge=Math.pow(Math.sin(Math.PI*p),1.5),sample=samples[Math.min(samples.length-1,Math.floor(p*samples.length))]||0,height=1+edge*Math.min(h-10,amplitude*28+sample*130);ctx.fillStyle=`rgba(230,241,243,${.12+edge*.76})`;ctx.beginPath();ctx.roundRect(x,h/2-height/2,Math.max(1,step*.46),height,1);ctx.fill();}
  }
 }
 // Voice canvases have no animation loop until their actual surface is visible.
 function waveVisible(){return !gone&&!document.hidden&&((state.listening&&!state.reply_visible&&canvas?.clientWidth>0)||(body.dataset.dictating==='true'&&dictationCanvas?.clientWidth>0));}
 function draw(now=0){frame=0;if(!waveVisible())return;const interval=body.dataset.economy==='false'?16:32;if(now-lastFrame>=interval){lastFrame=now;amplitude+=(Math.min(1,state.level*9)-amplitude)*.18;for(let i=0;i<48;i++)easedSamples[i]+=((state.samples?.[i]||0)-easedSamples[i])*.3;paint(canvas,ctx);if(body.dataset.dictating==='true')paint(dictationCanvas,dictationContext,true);}if(!reduced.matches&&body.dataset.motion!=='false')frame=requestAnimationFrame(draw);}
 function syncWave(){if(!waveVisible()){cancelAnimationFrame(frame);frame=0;return;}if(!frame){lastFrame=0;frame=requestAnimationFrame(draw);}}
 let anchor=NaN,anchorTimer=0;
 function syncAnchor(){clearTimeout(anchorTimer);anchorTimer=0;if(gone||document.hidden||body.dataset.surface!=='bar'||!api()?.workspace_companion_anchor||!(state.listening||state.pending||state.starting||state.reply_visible||body.dataset.dictating==='true'))return;const face=document.querySelector('.eye-wander');if(face){const rect=face.getBoundingClientRect(),next=rect.x+rect.width/2;if(Math.abs(next-anchor)>1||!Number.isFinite(anchor)){anchor=next;api().workspace_companion_anchor(next).catch(()=>{});}}anchorTimer=setTimeout(syncAnchor,body.dataset.economy==='false'?250:500);}
 // The lazy voice view does not load the widget UI. Read only its validated
 // appearance flags so it inherits the same economy/motion choices as the bar.
 const preferenceKey='brivany.workspace.widgets.v1';
 function voicePreferences(serialized){if(body.dataset.waveSurface!=='true')return;let value={};try{const saved=JSON.parse(serialized??localStorage.getItem(preferenceKey)??'{}');value=saved?.preferences||{};}catch{}body.dataset.motion=String(value.motion!==false);body.dataset.economy=String(value.economy!==false);body.dataset.theme=['dark','soft'].includes(value.theme)?value.theme:'dark';body.dataset.accent=['blue','mint','amber','rose'].includes(value.accent)?value.accent:'blue';syncWave();syncAnchor();}
 const storagePreferences=event=>{if(event.key===preferenceKey)voicePreferences(event.newValue);};
 window.addEventListener('storage',storagePreferences);
 window.addEventListener('brivany-workspace-locale',localize);
 document.addEventListener('visibilitychange',()=>{syncWave();syncAnchor();});reduced.addEventListener('change',syncWave);window.addEventListener('brivany-workspace-preferences',syncWave);
 function overlayLayout(value){if(!value)return;document.documentElement.style.setProperty('--overlay-left',(value.clip_left||0)+'px');document.documentElement.style.setProperty('--overlay-width',value.width+'px');}
 window.BrivanyWorkspace={receive,command,chatHeight,overlayLayout,dispose:()=>{gone=true;cancelAnimationFrame(frame);cancelAnimationFrame(fitFrame);clearTimeout(thoughtTimer);clearTimeout(anchorTimer);window.removeEventListener('storage',storagePreferences);window.removeEventListener('brivany-workspace-locale',localize);}};
 const resizeObserver=new ResizeObserver(()=>{if(wasBottom&&$('#workspace-chat-messages'))$('#workspace-chat-messages').scrollTop=$('#workspace-chat-messages').scrollHeight});if($('#island-content'))resizeObserver.observe($('#island-content'));window.addEventListener('pagehide',()=>resizeObserver.disconnect(),{once:true});
 window.addEventListener('brivany-island-layout',()=>{sizeInput();fit();syncWave();if(body.dataset.surface==='panel'&&(body.dataset.panel!=='chat'||body.dataset.expanded!=='true')&&['starting','recording'].includes(state.dictation?.phase))command('dictate_stop');});window.addEventListener('resize',()=>{sizeInput();fit();});sizeInput();
 window.addEventListener('pywebviewready',pull);window.addEventListener('pagehide',()=>window.BrivanyWorkspace.dispose(),{once:true});voicePreferences();render();pull();syncWave();
})();
