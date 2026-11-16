/* A view of real job snapshots. Hiding it never changes execution or permissions. */
(() => {
 'use strict';
 const surface=document.querySelector('#module-view'),frame=document.querySelector('#module-frame');
 if(!surface||!frame)return;
 const create=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el};
 const functions={research:['Investigación','Busca fuentes y contrasta información.'],image:['Diseño','Crea imágenes e ilustraciones.'],motion:['Video','Compone y exporta videos y animaciones.'],document:['Redacción','Redacta y organiza documentos.'],terminal:['Terminal','Ejecuta las tareas locales autorizadas.'],desktop:['Ordenador','Trabaja en las aplicaciones del ordenador.'],model:['Espacial','Construye y revisa modelos 3D.'],personal:['Agenda y conexiones','Consulta tus servicios y tu agenda.'],edits:['Edición de video','Edita y prepara material audiovisual.'],media:['Medios','Procesa archivos de audio y video.'],support:['Documentación','Busca documentación y controladores.'],skill:['Human-skills','Aplica las habilidades de Melodi a la tarea.'],schedule:['Programación','Coordina tareas y esperas programadas.'],discovery:['Aplicaciones','Identifica las aplicaciones disponibles.']};
 const states={queued:'En cola',planning:'Preparando',running:'Trabajando',reviewing:'Revisando',awaiting_approval:'Espera aprobación',awaiting_user:'Requiere tu revisión',waiting_for_user:'Espera tu respuesta'};
 const key='brivany.agents.hidden.v1',visible=new Map(),all=new Map(),retained=new Map();let jobs=[],silent=false,anchor=null,tipTimer,lifetimeTimer;
 const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
 Object.assign(states,{succeeded:'Completado',failed:'No se pudo completar',cancelled:'Detenido',interrupted:'Interrumpido'});
 try{silent=localStorage.getItem(key)==='true'}catch{}
 const dock=create('section','chat-agent-dock');dock.setAttribute('aria-label','Agentes de Melodi');dock.hidden=true;
 const strip=create('div','chat-agent-strip'),more=create('button','chat-agent-more','Mostrar todos los agentes'),toggle=create('button','chat-agent-toggle');
 more.type=toggle.type='button';more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-controls','chat-agents-dialog');
 const eye=create('span','chat-agent-eye');eye.setAttribute('aria-hidden','true');toggle.append(eye,create('span','chat-agent-toggle-label'));dock.append(strip,more,toggle);surface.append(dock);
 const dialog=create('dialog','chat-agents-dialog');dialog.id='chat-agents-dialog';dialog.setAttribute('aria-labelledby','chat-agents-title');
 const heading=create('header','chat-agents-heading'),title=create('h2',null,'Agentes de Melodi');title.id='chat-agents-title';
 const dismiss=create('button','chat-agents-dismiss','×');dismiss.type='button';dismiss.setAttribute('aria-label','Cerrar agentes');heading.append(title,dismiss);
 const description=create('p','chat-agents-description','Cada agente se ocupa de una parte de tus tareas.'),grid=create('div','chat-agents-grid');dialog.append(heading,description,grid);document.body.append(dialog);
 const tip=create('div','chat-agent-tooltip');tip.id='chat-agent-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;
 const tipName=create('strong'),tipPurpose=create('p'),tipTask=create('p'),tipPhase=create('span');tip.append(tipName,tipPurpose,tipTask,tipPhase);document.body.append(tip);
 const role=job=>functions[job.kind]||[job.agent||'Agente','Trabaja en la tarea que Melodi le ha asignado.'];
 function hideTip(){clearTimeout(tipTimer);anchor?.removeAttribute('aria-describedby');tip.hidden=true;anchor=null}
 function showTip(button){
  clearTimeout(tipTimer);if(anchor!==button){anchor?.removeAttribute('aria-describedby');anchor=button;button.setAttribute('aria-describedby',tip.id)}
  const job=button._job,[name,purpose]=role(job);for(const [target,text]of [[tipName,name],[tipPurpose,purpose],[tipTask,job.title||''],[tipPhase,job.phase||states[job.state]||'']])if(target.textContent!==text)target.textContent=text;
  // A modal lives in the top layer; keep its tooltip in the same layer.
  const layer=button.closest('dialog')||document.body;if(tip.parentNode!==layer)layer.append(tip);tip.hidden=false;
  const box=button.getBoundingClientRect(),rect=tip.getBoundingClientRect();
  tip.style.left=Math.max(12,Math.min(innerWidth-rect.width-12,box.right-rect.width))+'px';
  tip.style.top=Math.max(12,Math.min(innerHeight-rect.height-12,box.bottom+9))+'px';
 }
 function removeButton(button){if(anchor===button)hideTip();window.BrivanyAgentAvatars?.dispose(button.querySelector('.chat-agent-avatar'));button.remove()}
 function paint(container,cache,items,expanded){
  const ids=new Set(items.map(job=>job.id));for(const [id,button]of cache)if(!ids.has(id)){removeButton(button);cache.delete(id)}
  items.forEach((job,index)=>{let button=cache.get(job.id);if(!button){
   button=create('button',expanded?'chat-agent-card':'chat-agent-button');button.type='button';const face=create('span','chat-agent-avatar');face.setAttribute('aria-hidden','true');button.append(face);
   if(expanded){const copy=create('span','chat-agent-copy');copy.append(create('strong'),create('small'));button.append(copy)}
   button.addEventListener('mouseenter',()=>showTip(button));button.addEventListener('mouseleave',()=>{tipTimer=setTimeout(hideTip,90)});button.addEventListener('focus',()=>showTip(button));button.addEventListener('blur',hideTip);button.addEventListener('click',()=>showTip(button));cache.set(job.id,button);
  }
  button._job=job;button.dataset.state=job.state;button.dataset.leaving=String(!!job._finishedAt&&performance.now()-job._finishedAt>=4000);const [name]=role(job);button.setAttribute('aria-label',name+' · '+(states[job.state]||job.state));
  if(expanded){button.querySelector('strong').textContent=name;button.querySelector('small').textContent=job.phase||states[job.state]||''}
  if(container.children[index]!==button)container.insertBefore(button,container.children[index]||null);
  window.BrivanyAgentAvatars?.render(button.querySelector('.chat-agent-avatar'),job);
  });
 }
 function isChat(){try{return new URL(frame.src,location.href).pathname==='/app'}catch{return false}}
 function paintAll(){
  clearTimeout(lifetimeTimer);const now=performance.now();let next=Infinity;for(const [id,job]of retained){if(job._finishedAt){const age=now-job._finishedAt;if(age>=5200){retained.delete(id);continue}next=Math.min(next,(age<4000?4000:5200)-age)}}jobs=[...retained.values()];if(next<Infinity)lifetimeTimer=setTimeout(paintAll,Math.max(10,next));
  const shown=jobs.length>0&&isChat();dock.hidden=!shown;surface.dataset.agentsVisible=String(shown&&!silent);strip.hidden=silent;more.hidden=silent||jobs.length<=4;
  toggle.setAttribute('aria-label',silent?'Mostrar agentes':'Ocultar agentes');toggle.title=silent?'Mostrar agentes':'Ocultar agentes sin detener sus tareas';toggle.dataset.silent=String(silent);toggle.setAttribute('aria-pressed',String(silent));toggle.querySelector('.chat-agent-toggle-label').textContent=silent?'Mostrar agentes':'';
  paint(strip,visible,silent?[]:jobs.slice(0,4),false);if(dialog.open)paint(grid,all,jobs,true);
  if(anchor?.isConnected)showTip(anchor);
  if(!shown&&dialog.open)dialog.close();
 }
 function receive(snapshot){const present=new Set();for(const job of Array.isArray(snapshot)?snapshot:[]){if(!job||job.kind==='orchestrator'||!Object.hasOwn(states,job.state))continue;present.add(job.id);const previous=retained.get(job.id);if(terminal.has(job.state)){if(previous)retained.set(job.id,{...job,_finishedAt:previous._finishedAt||performance.now()})}else retained.set(job.id,{...job,_finishedAt:null})}for(const [id,job]of retained)if(!present.has(id)&&!job._finishedAt)retained.delete(id);paintAll()}
 more.onclick=()=>{hideTip();dialog.showModal();paint(grid,all,jobs,true);dismiss.focus()};dismiss.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
 dialog.addEventListener('close',()=>{hideTip();for(const button of all.values())removeButton(button);all.clear();more.focus()});
 toggle.onclick=()=>{silent=!silent;try{localStorage.setItem(key,String(silent))}catch{}hideTip();if(dialog.open)dialog.close();if(silent)document.querySelector('.agent-alert')?.setAttribute('hidden','');paintAll()};
 const navigate=new MutationObserver(paintAll);navigate.observe(frame,{attributes:true,attributeFilter:['src']});frame.addEventListener('load',paintAll);
 const reset=()=>{retained.clear();receive([])};window.addEventListener('brivany-account-change',reset);window.addEventListener('resize',hideTip);window.addEventListener('scroll',hideTip,true);
 window.BrivanyChatAgents={receive,hidden:()=>silent,snapshot:()=>jobs.slice()};
 window.addEventListener('pagehide',()=>{clearTimeout(lifetimeTimer);retained.clear();hideTip();navigate.disconnect();for(const button of [...visible.values(),...all.values()])removeButton(button);window.removeEventListener('brivany-account-change',reset);window.removeEventListener('resize',hideTip);window.removeEventListener('scroll',hideTip,true);dock.remove();dialog.remove();tip.remove()},{once:true});
})();
