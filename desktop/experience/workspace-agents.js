(() => {
 const left=document.querySelector('#agents-left'),right=document.querySelector('#agents-right');if(!left||!right)return;
 const buttons=new Map(),seen=new Map(),finished=new Map(),removing=new Map(),running=new Set(['queued','planning','running','reviewing','awaiting_approval']);
 let selected=null,jobs=[],disposed=false,hoverTimer,initialized=false;
 const labels={queued:'En cola',planning:'Preparando',running:'Trabajando',reviewing:'Melodi revisa el resultado',succeeded:'Revisado por Melodi',awaiting_user:'Requiere tu revisión',awaiting_approval:'Espera tu aprobación',failed:'Detenido',cancelled:'Cancelado',interrupted:'Interrumpido'};
 const api=()=>window.pywebview?.api;
 function sizeFamily(){const extra=document.querySelector('#workspace-team:not([hidden])')?28:0,pairs=Math.ceil(buttons.size/2),maxPairs=Math.max(1,Math.floor((Math.max(128,innerWidth*.34)-72-extra)/56));document.documentElement.style.setProperty('--family-width',(72+Math.min(pairs,maxPairs)*56+extra)+'px')}
 async function select(job,button){
  try{if(!api()?.work_agent_select)return;const result=await api().work_agent_select(job.id);if(result?.panel==='auditory'){window.BrivanyIsland?.expand('auditory',button.getBoundingClientRect().x+13);return;}selected=job.id;paintDetail();window.BrivanyIsland?.expand('agent',button.getBoundingClientRect().x+13)}catch{}
 }
 function button(job,index){
  let element=buttons.get(job.agent_key||job.id);if(element)return element;
  element=document.createElement('button');element.type='button';element.className='agent-child entering';element.style.setProperty('--agent-delay',(-index*.19)+'s');
  element.innerHTML='<span class="agent-mini agent-blobatar" aria-hidden="true"><i class="agent-mini-status"></i></span>';
  element.querySelector('.agent-mini').dataset.avatarStyle='blobatar';
  element.addEventListener('mouseenter',()=>{clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>select(element._job,element),document.body.dataset.panel==='agent'?140:480)});
  element.addEventListener('mouseleave',()=>clearTimeout(hoverTimer));element.addEventListener('click',()=>{clearTimeout(hoverTimer);select(element._job,element)});
  element.addEventListener('animationend',event=>{if(event.animationName==='agent-arrive')element.classList.remove('entering')});buttons.set(job.agent_key||job.id,element);return element;
 }
 function paintDetail(){
  const job=jobs.find(j=>j.id===selected);if(!job){window.BrivanyAgentAvatars?.dispose(document.querySelector('#agent-detail-avatar'));return;}
  const title=document.querySelector('#agent-title'),phase=document.querySelector('#agent-phase'),attempt=document.querySelector('#agent-attempt'),review=document.querySelector('#agent-review'),cancel=document.querySelector('#agent-cancel');
  if(!title)return;document.querySelector('#agent-detail-avatar').dataset.avatarStyle='blobatar';window.BrivanyAgentAvatars?.render(document.querySelector('#agent-detail-avatar'),job);title.textContent=job.title||job.agent||'Agente';phase.textContent=job.phase||labels[job.state]||'';attempt.textContent=job.attempt>1?'Versión '+job.attempt:'';
  const waiting=job.state==='waiting_for_user';
  review.hidden=running.has(job.state)&&job.state!=='awaiting_approval';cancel.hidden=!running.has(job.state)&&!waiting;
  review.textContent=waiting?'Continuar':'Ver resultado';
  review.onclick=async()=>{try{if(waiting)await api()?.continue_assistant_job?.(job.id);else await api()?.work_agent_review?.(job.id);}catch{phase.textContent='La tarea ya no está disponible para continuar.';}};
  cancel.onclick=()=>api()?.cancel_assistant_job?.(job.id).catch(()=>{});
 }
 function receive(value){
  if(disposed)return;jobs=value.jobs||jobs;if(value.selected_agent)selected=value.selected_agent;
  const latest=new Map(),now=Date.now();
  for(const job of jobs){if(job.kind==='orchestrator')continue;const key=job.agent_key||job.id;
   if(value.changed_job===job.id)seen.set(key,true);
   if(!initialized&&!running.has(job.state))finished.set(key,now-31000);
   if(running.has(job.state)){finished.delete(key);seen.set(key,true)}else if(seen.has(key)&&!finished.has(key))finished.set(key,now);
   if(job.state==='waiting_for_user'||running.has(job.state)||seen.has(key)&&now-(finished.get(key)||0)<(job.state==='succeeded'?12000:30000))latest.set(key,job);
  }
  initialized=true;const visible=[...latest.values()];
  for(const [key,element] of buttons)if(!latest.has(key)&&!removing.has(key)){element.classList.add('leaving');removing.set(key,setTimeout(()=>{window.BrivanyAgentAvatars?.dispose(element.querySelector('.agent-mini'));element.remove();buttons.delete(key);removing.delete(key);sizeFamily()},950))}
  const split=Math.ceil(visible.length/2);visible.forEach((job,index)=>{const key=job.agent_key||job.id,element=button(job,index);if(removing.has(key)){clearTimeout(removing.get(key));removing.delete(key);element.classList.remove('leaving')}element._job=job;element.dataset.state=job.state;element.dataset.job=job.id;element.setAttribute('aria-label',(job.title||job.agent)+' · '+(labels[job.state]||job.state));const parent=index<split?left:right,position=index<split?index:index-split;if(parent.children[position]!==element)parent.insertBefore(element,parent.children[position]||null);window.BrivanyAgentAvatars?.render(element.querySelector('.agent-mini'),job)});
  document.body.dataset.agentsWorking=String(jobs.some(j=>running.has(j.state)));if(document.body.dataset.agentsWorking==='true')document.body.dataset.sleeping='false';sizeFamily();paintDetail();
  window.dispatchEvent(new CustomEvent('brivany-agents-snapshot',{detail:{jobs,selected}}));
 }
 window.BrivanyWorkspaceAgents={receive,resize:sizeFamily,snapshot:()=>({jobs,selected}),select:job=>{selected=job.id;jobs=[...jobs.filter(j=>j.id!==job.id),job];paintDetail()}};window.addEventListener('resize',()=>receive({jobs}));window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(hoverTimer);for(const timer of removing.values())clearTimeout(timer);buttons.clear()},{once:true});
})();
