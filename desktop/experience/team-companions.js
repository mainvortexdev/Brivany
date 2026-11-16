/* Real jobs only. The orbit is a view of Melodi's current team, not a scheduler. */
(() => {
 'use strict';const family=document.querySelector('.melodi-family');if(!family)return;
 const t=value=>window.BrivanyWorkspaceLocale?.text(value)||value;
 const open=document.createElement('button');open.id='workspace-team';open.type='button';open.hidden=true;open.setAttribute('aria-label',t('Ver equipo de Melodi'));open.innerHTML='<span id="team-count"></span>';family.append(open);
 const view=document.createElement('section');view.dataset.view='team';view.hidden=true;
 view.innerHTML='<div class="team-heading"><h2>El equipo de Melodi</h2><span id="team-summary"></span></div><div class="team-orbit"><div class="team-orbit-line"></div><div id="team-core"><div id="team-melodi"></div><strong>Melodi</strong><small>Coordina y revisa</small></div><div id="team-planets"></div></div><div id="team-tasks" role="list" aria-label="Tareas de los agentes"></div><p id="team-empty" hidden>El equipo aparecerá cuando Melodi despliegue agentes.</p>';
 document.querySelector('#island-content').append(view);window.BrivanyWorkspaceLocale?.mount(view);
 const leader=document.querySelector('.melodi-character')?.cloneNode(true);if(leader)view.querySelector('#team-melodi').append(leader);
 const active=new Set(['queued','planning','running','reviewing','awaiting_approval','waiting_for_user','awaiting_user']);
 const labels={queued:'En cola',planning:'Preparando',running:'Trabajando',reviewing:'Melodi revisa el resultado',awaiting_approval:'Espera tu aprobación',waiting_for_user:'Requiere tu revisión',awaiting_user:'Requiere tu revisión',succeeded:'Revisado por Melodi',failed:'Detenido',cancelled:'Cancelado',interrupted:'Interrumpido'};
 const records=new Map();let jobs=[],gone=false;
 function select(job,element){window.BrivanyWorkspaceAgents?.select(job);window.pywebview?.api?.work_agent_select?.(job.id).then(()=>window.BrivanyIsland?.expand('agent',element.getBoundingClientRect().x+element.offsetWidth/2)).catch(()=>{})}
 function portrait(){const face=document.createElement('span');face.className='team-portrait';face.dataset.avatarStyle='companion';face.setAttribute('aria-hidden','true');return face}
 function render(snapshot){
  if(gone)return;jobs=(snapshot?.jobs||[]).filter(job=>job.kind!=='orchestrator');
  const current=jobs.filter(job=>active.has(job.state)),visible=current.length?current:jobs.slice(-8),keys=new Set(visible.map(job=>job.agent_key||job.id));
  open.hidden=!visible.length;open.querySelector('span').textContent=String(current.length||visible.length);open.setAttribute('aria-label',t('Ver equipo de Melodi')+' · '+(current.length||visible.length));window.BrivanyWorkspaceAgents?.resize?.();
  view.querySelector('#team-summary').textContent=current.length?t('{count} agentes en tarea').replace('{count}',current.length):t('Tareas recientes');view.querySelector('#team-empty').hidden=!!visible.length;
  for(const [key,record] of records)if(!keys.has(key)){window.BrivanyAgentAvatars?.dispose(record.face);window.BrivanyAgentAvatars?.dispose(record.orbitFace);record.row.remove();record.planet.remove();records.delete(key)}
  visible.forEach((job,index)=>{
   const key=job.agent_key||job.id;let record=records.get(key);
   if(!record){
    const row=document.createElement('button');row.className='team-task';row.type='button';row.setAttribute('role','listitem');const face=portrait(),copy=document.createElement('span'),name=document.createElement('strong'),phase=document.createElement('small'),state=document.createElement('i');copy.append(name,phase);row.append(face,copy,state);view.querySelector('#team-tasks').append(row);
    const planet=document.createElement('button');planet.className='team-planet';planet.type='button';const orbitFace=portrait();planet.append(orbitFace);view.querySelector('#team-planets').append(planet);record={row,face,name,phase,state,planet,orbitFace};records.set(key,record);
    row.onclick=()=>select(record.job,row);planet.onclick=()=>select(record.job,planet);
   }
   record.job=job;record.row.dataset.state=job.state;record.name.textContent=job.title||job.agent||t('Agente');record.phase.textContent=job.phase||t(labels[job.state]||'Preparando');record.planet.setAttribute('aria-label',record.name.textContent+' · '+record.phase.textContent);
   const angle=-Math.PI/2+index/Math.min(visible.length,8)*Math.PI*2;record.planet.hidden=index>=8;record.planet.style.setProperty('--orbit-x',(50+Math.cos(angle)*37)+'%');record.planet.style.setProperty('--orbit-y',(50+Math.sin(angle)*37)+'%');
   window.BrivanyAgentAvatars?.render(record.face,job);window.BrivanyAgentAvatars?.render(record.orbitFace,job);
  });
 }
 open.onclick=()=>window.BrivanyIsland?.expand('team',open.getBoundingClientRect().x+14);
 const receive=event=>render(event.detail);window.addEventListener('brivany-agents-snapshot',receive);render(window.BrivanyWorkspaceAgents?.snapshot?.());
 window.addEventListener('pagehide',()=>{gone=true;window.removeEventListener('brivany-agents-snapshot',receive);for(const record of records.values()){window.BrivanyAgentAvatars?.dispose(record.face);window.BrivanyAgentAvatars?.dispose(record.orbitFace)}records.clear()},{once:true});
})();
