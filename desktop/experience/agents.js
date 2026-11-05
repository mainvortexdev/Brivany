/* Background task notices; no task counter or persistent agent panel. */
(() => {
 if(location.pathname!=='/brivany-shell')return;
 const session=window.BrivanyComputerSession||={token:null},seen=new Map(),seenEvents=new Map();
 const alert=document.createElement('aside');alert.className='agent-alert';alert.hidden=true;alert.setAttribute('aria-live','polite');
 const message=document.createElement('span'),open=document.createElement('button'),close=document.createElement('button');
 open.type=close.type='button';open.textContent='Ver resultado';close.textContent='×';close.setAttribute('aria-label','Ocultar aviso de agente');
 open.className='agent-result-action';close.className='agent-dismiss';
 alert.append(message,open,close);document.body.append(alert);close.onclick=()=>alert.hidden=true;
 const active=job=>['queued','planning','running','reviewing'].includes(job.state);
 const labels={queued:'En cola',planning:'Preparando',running:'En curso',reviewing:'Melodi revisa',succeeded:'Listo para revisar',failed:'Se detuvo con error',cancelled:'Cancelado',interrupted:'Interrumpido',awaiting_user:'Necesita tu intervención',awaiting_approval:'Espera tu aprobación',waiting_for_user:'En pausa'};
 let initialized=false,alertTimer,requestSequence=0,lastApplied=0;
 async function review(job){
  if(job.state==='awaiting_approval'){window.BrivanyFileApprovals?.show(job.id);alert.hidden=true;return;}
  if(window.pywebview?.api?.work_agent_review){await window.pywebview.api.work_agent_review(job.id);alert.hidden=true;return;}
  if(!session.token&&window.pywebview?.api?.authorize_computer){const grant=await window.pywebview.api.authorize_computer();session.token=grant.token;}
  const frame=document.querySelector('#module-frame');
  if(frame?.contentWindow?.BrivanyComputerUI)frame.contentWindow.BrivanyComputerUI.review(job);
  else{window.BrivanyPendingReview=job;window.BrivanyNavigate('/computer');}
  alert.hidden=true;
 }
 function notify(text,job=null){
  message.textContent=text;open.hidden=!job;open.onclick=()=>review(job);alert.hidden=false;
  open.textContent=job?.state==='waiting_for_user'?'Continuar':'Ver resultado';
  if(job?.state==='waiting_for_user')open.onclick=async()=>{try{await window.pywebview.api.continue_assistant_job(job.id);alert.hidden=true;}catch{message.textContent='La tarea todavía no está disponible para continuar.';}};
  clearTimeout(alertTimer);alertTimer=setTimeout(()=>alert.hidden=true,8000);
  document.querySelector('#module-frame')?.contentWindow?.BrivanyLiveNotice?.queue(text);
 }
 function observe(jobs,schedules=[]){
  window.BrivanyFileApprovals?.observe(jobs);
  document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.taskStatus(jobs);
  for(const job of jobs){
   const before=seen.get(job.id);seen.set(job.id,job.state);
   if(initialized&&before!==job.state&&!active(job)&&!job.reviewed&&!(job.parent_id&&job.review_state==='rejected')){
    if(job.state==='succeeded'&&job.result?.native_action==='start_work')Promise.resolve(window.pywebview?.api?.start_work?.()).catch(()=>{});
    if(job.state==='succeeded'&&job.result?.module_url)document.querySelector('#module-frame')?.contentWindow?.BrivanyComputerUI?.review(job);
    notify(job.state==='waiting_for_user'?job.phase:job.agent+' · '+labels[job.state]+'.',job);
   }
  }
  for(const rule of schedules){
   const before=seenEvents.get(rule.id);seenEvents.set(rule.id,rule.state);
   if(initialized&&before!==rule.state&&['completed','missed','uncertain','awaiting_user'].includes(rule.state))notify(rule.state==='completed'?'La espera de Melodi terminó. Revisa los resultados.':'La espera de Melodi necesita revisión.');
  }
  initialized=true;
 }
 async function refresh(){
  if(!session.token&&!window.pywebview?.api?.assistant_status)return;
  const sequence=++requestSequence;
  try{
   let data;if(session.token){const response=await fetch('/api/computer/status',{headers:{'X-Brivany-Control':session.token},cache:'no-store'});if(!response.ok)return;data=await response.json();if(data.request_authorized===false&&window.pywebview?.api?.assistant_status){session.token=null;data=await window.pywebview.api.assistant_status();}}
   else data=await window.pywebview.api.assistant_status();
   if(sequence<lastApplied)return;lastApplied=sequence;observe(data.jobs||[],data.schedules||[]);
  }catch{}
 }
 const timer=setInterval(refresh,1000);
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(alertTimer);},{once:true});
 window.BrivanyAgents={refresh,observe,review};
})();
