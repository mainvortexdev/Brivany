/* Observable execution summaries, never private model reasoning. */
(() => {
 const active=new Set(['queued','planning','running','reviewing']),urls=new Map(),previews=new Map(),pendingVideos=new Map(),cards=new Map();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function loaderMotion(preview){const spin=preview._loaderSpin;if(!spin)return;if(reduced.matches||document.body.dataset.motion==='false'){spin.pause();spin.currentTime=0}else if(document.hidden)spin.pause();else spin.play()}
 function clearPending(id){const preview=pendingVideos.get(id);preview?._loaderSpin?.cancel();cancelAnimationFrame(preview?._progressFrame);preview?.remove();pendingVideos.delete(id)}
 function progressMotion(preview){
  // The provider has no fractional counter. This elapsed-time estimate stays
  // below 90; received milestones and a verified result remain authoritative.
  const age=Math.max(0,performance.now()-preview._progressStarted),scale=preview.dataset.mediaKind==='image'?45000:180000;
  preview._progressTarget=Math.max(preview._progressTarget,Math.min(90,Math.floor(1+89*(1-Math.exp(-age/scale)))));
  if(document.hidden){cancelAnimationFrame(preview._progressFrame);preview._progressFrame=0;return}if(preview._progressFrame||preview._progressValue>=preview._progressTarget)return;
  const step=time=>{preview._progressFrame=0;if(!preview.isConnected||document.hidden)return;if(time>=(preview._progressTime||0)){preview._progressTime=time+35;preview._progressValue=Math.min(preview._progressTarget,preview._progressValue+(reduced.matches?100:2));const percent=preview.querySelector('.media-loading-percent');percent.textContent=preview._progressValue+'%';percent.setAttribute('aria-valuenow',String(preview._progressValue));percent.setAttribute('aria-valuetext',preview._progressValue+'% estimado')}if(preview._progressValue<preview._progressTarget)preview._progressFrame=requestAnimationFrame(step)};preview._progressFrame=requestAnimationFrame(step);
 }
 const syncLoaders=()=>{for(const preview of pendingVideos.values()){loaderMotion(preview);progressMotion(preview)}};
 const progressTimer=setInterval(()=>{if(!document.hidden)for(const preview of pendingVideos.values())progressMotion(preview)},500);
 document.addEventListener('visibilitychange',syncLoaders);reduced.addEventListener('change',syncLoaders);const motionObserver=new MutationObserver(syncLoaders);motionObserver.observe(document.body,{attributes:true,attributeFilter:['data-motion']});
 const labels={queued:'En cola',planning:'Preparando',running:'Trabajando',reviewing:'Revisando',succeeded:'Completado',failed:'No se pudo completar',cancelled:'Detenido',interrupted:'Interrumpido',awaiting_user:'Requiere revisión',waiting_for_user:'Espera tu respuesta',awaiting_approval:'Espera aprobación'};
 const tools={motion:'Creación audiovisual',image:'Ilustración',research:'Investigación',document:'Documentos',desktop:'Ordenador',terminal:'Tareas locales',media:'Procesamiento audiovisual',model:'Modelado 3D',personal:'Agenda y conexiones',orchestrator:'Coordinación de agentes'};
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el};
 function update(entry,job,all=[]){
  entry.kind=job.kind;entry.agent=job.agent;entry.title=job.title||entry.title;entry.state=job.state;entry.phase=job.error||job.phase;entry.output=job.result;entry.steps=job.steps;entry.updated=Date.now();
  if(job.progress){const reported=Number(job.progress.percent);if(Number.isFinite(reported))entry.progress={...job.progress,percent:Math.min(active.has(job.state)?99:100,Math.max(entry.progress?.percent||1,Math.round(reported)))};}
  entry.events||=[];if(Array.isArray(job.activity)&&job.activity.length)entry.events=job.activity.map(event=>({text:String(event.text).slice(0,800),kind:event.kind,at:event.at}));else{const last=entry.events.at(-1);if(entry.phase&&last?.text!==entry.phase)entry.events.push({text:String(entry.phase).slice(0,800),kind:'update',at:Date.now()})}entry.events=entry.events.slice(-80);
  entry.children=all.filter(item=>item.parent_id===job.id).map(item=>({id:item.id,agent:item.agent,title:item.title,kind:item.kind,state:item.state,phase:item.phase}));
 }
 function elapsed(entry){if(!Number.isFinite(entry.started))return '';const seconds=Math.max(0,Math.floor(((entry.finished||Date.now())-entry.started)/1000)),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?h+' h ':'')+(m?m+' min ':'')+s+' s'}
 function statusLine(entry){return active.has(entry.state)?'Trabajando':entry.state==='succeeded'?(elapsed(entry)?'He trabajado durante '+elapsed(entry):'He terminado'):labels[entry.state]||'Sin confirmar'}
 function tick(entry){for(const el of document.querySelectorAll('.execution-card'))if(el.dataset.taskId===entry.id){const target=el.querySelector('.execution-time');if(target)target.textContent=statusLine(entry)}}
 function playback(entry,owner){
  if(previews.has(entry.id))return previews.get(entry.id).element;
  const element=node('div',undefined,'execution-player'),loading=node('p','Preparando vista previa…','execution-loading'),abort=new AbortController();element.append(loading);previews.set(entry.id,{element,abort});
  const load=async()=>{try{
   if(!owner.pywebview?.api?.assistant_result_preview)await new Promise((resolve,reject)=>{const ready=()=>{clearTimeout(timer);owner.removeEventListener('pywebviewready',ready);resolve()};const timer=setTimeout(()=>{owner.removeEventListener('pywebviewready',ready);reject(Error('native-not-ready'))},12000);owner.addEventListener('pywebviewready',ready,{once:true});if(owner.pywebview?.api?.assistant_result_preview)ready()});
   if(abort.signal.aborted)return;
   const value=await owner.pywebview.api.assistant_result_preview(entry.id);if(abort.signal.aborted)return;
   if(value.type==='gallery'||value.type==='image'&&value.items?.length){
    const gallery=node('div',undefined,'execution-gallery'),main=node('button',undefined,'execution-image-open'),picture=node('img',undefined,'execution-media'),rail=node('div',undefined,'execution-thumbnails');main.type='button';main.setAttribute('aria-label','Ampliar imagen');main.append(picture);let selected=0;const items=value.items;
    const choose=index=>{selected=index;picture.src=items[index].src;picture.alt='Imagen '+(index+1)+' de '+items.length;for(const [i,button]of [...rail.children].entries())button.setAttribute('aria-pressed',String(i===index));element.dataset.selected=String(index)};
    for(const [index,item]of items.entries()){const button=node('button');button.type='button';button.setAttribute('aria-label','Ver imagen '+(index+1));const thumb=node('img');thumb.src=item.thumbnail||item.src;thumb.alt='';button.append(thumb);button.onclick=()=>choose(index);rail.append(button)}
    main.onclick=()=>owner.BrivanyImageViewer?.open(entry.id,selected,value);gallery.append(main);if(items.length>1)gallery.append(rail);choose(0);element.replaceChildren(gallery);return;
   }
   if(!['video','image'].includes(value.type))throw Error();const media=node(value.type==='video'?'video':'img');media.className='execution-media';media.setAttribute('aria-label',entry.output?.title||'Resultado de Melodi');
   const log=document.querySelector('#chat-messages'),followEnd=!!log&&log.scrollHeight-log.scrollTop-log.clientHeight<160;
   media.addEventListener(value.type==='video'?'loadedmetadata':'load',()=>{if(element.isConnected)window.BrivanyChatScroll?.changed()},{once:true});
   if(value.src&&/^data:image\/(?:jpeg|png|webp);base64,/.test(value.src))media.src=value.src;
   else{
    if(value.media_url!=='/api/computer/result-media/'+entry.id||typeof value.media_ticket!=='string')throw Error();
    const response=await fetch(value.media_url,{headers:{'X-Brivany-Result':value.media_ticket},signal:abort.signal,cache:'no-store'});if(!response.ok)throw Error();const blob=await response.blob();if(abort.signal.aborted)return;
    if(value.type==='video'&&blob.type!=='video/mp4'||value.type==='image'&&blob.type!=='image/png')throw Error();
    if(value.type==='image'){const reader=new FileReader();reader.onload=()=>{if(!abort.signal.aborted)media.src=reader.result};reader.readAsDataURL(blob)}
    else{const url=URL.createObjectURL(blob);urls.set(entry.id,url);media.src=url;media.controls=true;media.playsInline=true;media.preload='metadata'}
   }
   element.replaceChildren(media);
   if(value.type==='image'){media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label','Ampliar imagen');media.onclick=()=>owner.BrivanyImageViewer?.open(entry.id,0,value);media.onkeydown=event=>{if(event.key==='Enter')media.click()}}
  }catch{if(abort.signal.aborted)return;loading.className='execution-preview-error';loading.textContent='No se pudo cargar la vista previa.';const retry=node('button','Reintentar vista previa');retry.type='button';retry.onclick=()=>{retry.remove();loading.className='execution-loading';loading.textContent='Preparando vista previa…';load()};element.append(retry)}};
  queueMicrotask(load);return element;
 }
 function card(entry,owner){
  let wrap=cards.get(entry.id);if(!wrap){wrap=node('section',undefined,'execution-card');wrap.dataset.taskId=entry.id;wrap.setAttribute('aria-label','Actividad de Melodi');cards.set(entry.id,wrap)}wrap.dataset.state=entry.state||'queued';wrap.removeAttribute('aria-busy');
  const details=node('details',undefined,'execution-events'),summary=node('summary');details.open=entry.expanded===true;details.ontoggle=()=>entry.expanded=details.open;summary.append(node('span',statusLine(entry),'execution-time'+(active.has(entry.state)?' status-shimmer':'')),node('span','›','execution-chevron'));details.append(summary);
  const events=[...(entry.events||[])].filter(event=>active.has(entry.state)||event.text!==(entry.output?.message||'')&&!(event.text===entry.phase&&event.text.length>160));if(entry.phase&&(active.has(entry.state)||entry.phase.length<=160&&entry.phase!==entry.output?.message)&&events.at(-1)?.text!==entry.phase)events.push({text:entry.phase,kind:'update'});for(const [index,event]of events.entries()){const current=active.has(entry.state)&&index===events.length-1;const line=node('p',event.text,'execution-event execution-event-'+(event.kind||'update')+(current?' execution-phase status-shimmer':''));if(current)line.setAttribute('role','status');details.append(line)}
  if(entry.children?.length){const agents=node('div',undefined,'execution-agents');for(const child of entry.children){const row=node('div',undefined,'execution-agent');row.dataset.state=child.state;row.append(node('span',child.agent||child.kind),node('small',child.phase||labels[child.state]));agents.append(row)}details.append(agents)}const oldDetails=wrap.querySelector(':scope > .execution-events');if(oldDetails)oldDetails.replaceWith(details);else wrap.prepend(details);
  const output=entry.output||{};
  if(['motion','image'].includes(entry.kind)&&active.has(entry.state)){
   let preview=pendingVideos.get(entry.id);
   if(!preview){preview=node('div',undefined,'execution-video-loading');preview.dataset.mediaKind=entry.kind;preview.setAttribute('aria-label',entry.kind==='motion'?'Video en preparación':'Imagen en preparación');const art=node('div',undefined,'video-loading-art');art.setAttribute('aria-hidden','true');for(let i=0;i<4;i++)art.append(node('i'));const percent=node('span','1%','media-loading-percent');percent.setAttribute('role','progressbar');percent.setAttribute('aria-label','Progreso estimado');percent.setAttribute('aria-valuemin','1');percent.setAttribute('aria-valuemax','100');percent.title='Progreso estimado por tiempo y etapas; el proveedor no informa un porcentaje exacto';percent.setAttribute('aria-valuenow','1');preview._progressValue=1;preview._progressTarget=1;preview._progressStarted=performance.now();preview._progressTime=performance.now()+120;preview.append(art,percent);pendingVideos.set(entry.id,preview);}
   preview._progressTarget=Math.max(preview._progressTarget,Math.max(1,Math.min(99,entry.progress?.percent||1)));if(preview.parentNode!==wrap)wrap.append(preview);progressMotion(preview);
   if(!preview._loaderSpin){preview._loaderSpin=preview.querySelector('.video-loading-art').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:5000,iterations:Infinity,easing:'linear'});if(!reduced.matches&&document.body.dataset.motion!=='false')preview.animate([{opacity:0},{opacity:1}],{duration:170,easing:'ease-out'});}
   loaderMotion(preview);
  }else clearPending(entry.id);
  if(['succeeded','awaiting_user'].includes(entry.state)&&output.path){
   const signature=JSON.stringify([output.path,output.delivery_error]);if(wrap._resultSignature===signature)return wrap;wrap.querySelector(':scope > .execution-result')?.remove();wrap._resultSignature=signature;
   const result=node('div',undefined,'execution-result');
   if(['motion','image'].includes(entry.kind))result.append(playback(entry,owner));
   const label=/\.(?:mp4|webm|mov)$/i.test(output.path)?'Ruta del video':/\.(?:png|jpg|jpeg|webp)$/i.test(output.path)?'Ruta de la imagen':'Ruta del archivo';
   const path=node('button',label,'execution-path');path.type='button';path.title='Mostrar el archivo en el Explorador';path.onclick=async()=>{result.querySelector('.execution-path-error')?.remove();try{const index=result.querySelector('.execution-player')?.dataset.selected;await owner.pywebview.api.reveal_assistant_result(entry.id,index===undefined?null:Number(index))}catch{const error=node('p','No pude mostrar el archivo en el Explorador. El original se conserva.','execution-path-error');error.setAttribute('role','alert');result.append(error)}};result.append(path);if(output.delivery_error){const error=node('p',output.delivery_error,'execution-path-error');error.setAttribute('role','alert');result.append(error)}wrap.append(result);
  }else{wrap.querySelector(':scope > .execution-result')?.remove();delete wrap._resultSignature}
  if(active.has(entry.state))wrap.setAttribute('aria-busy','true');return wrap;
 }
 window.BrivanyChatActivity={update,card,tick,active:entry=>active.has(entry.state)};
 window.addEventListener('pagehide',()=>{clearInterval(progressTimer);document.removeEventListener('visibilitychange',syncLoaders);reduced.removeEventListener('change',syncLoaders);motionObserver.disconnect();for(const id of [...pendingVideos.keys()])clearPending(id);for(const entry of previews.values())entry.abort.abort();previews.clear();cards.clear();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear()},{once:true});
})();
