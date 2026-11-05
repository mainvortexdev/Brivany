/* User decisions stay in the native shell; no planner/HTTP approval endpoint. */
(() => {
 if(location.pathname!=='/brivany-shell')return;
 const dialog=document.createElement('dialog');dialog.className='file-approval';
 const title=document.createElement('h2');title.id='file-approval-title';dialog.setAttribute('aria-labelledby',title.id);
 const note=document.createElement('p'),files=document.createElement('dl'),state=document.createElement('p'),buttons=document.createElement('div');
 state.setAttribute('role','status');state.className='file-approval-state';buttons.className='file-approval-buttons';
 const later=document.createElement('button'),reject=document.createElement('button'),accept=document.createElement('button');
 for(const button of [later,reject,accept])button.type='button';later.textContent='Más tarde';reject.textContent='Rechazar';accept.className='file-approval-confirm';
 buttons.append(later,reject,accept);dialog.append(title,note,files,state,buttons);document.body.append(dialog);
 let jobs=[],selected=null,busy=false;const announced=new Set(),pending=new Map();
 const labels={move_file:['Mover archivo','Mover este archivo','Se moverá al destino indicado.'],delete_file:['Eliminar archivo','Enviar a la papelera','Se enviará a la papelera del sistema.'],replace_file:['Sobrescribir archivo','Sobrescribir este archivo','Se conservará una copia de la versión anterior en Brivany.']};
 function show(identifier){
  if(busy)return;
  const job=jobs.find(item=>item.id===identifier)||jobs[0];if(!job){if(dialog.open)dialog.close();return;}
  selected=job;const approval=job.approval,[heading,label,description]=labels[approval.action]||['Revisar acción','Aprobar',''];
  title.textContent=heading;accept.textContent=label;note.textContent=description;files.replaceChildren();
  for(const [label,value] of [['Archivo',approval.source],['Destino',approval.destination]]){if(!value)continue;const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;files.append(term,detail);}
  state.textContent='Sólo se autoriza este archivo. Si cambia, se detendrá la acción.';accept.disabled=false;reject.disabled=false;
  if(!dialog.open)dialog.showModal();
 }
 function observe(values){
  // Grant responses and overlapping status polls may contain a partial/older
  // list. Absence is not cancellation and must not dismiss a user's decision.
  for(const job of values){
   if(job.state==='awaiting_approval'&&job.approval)pending.set(job.id,job);
   else if(['succeeded','cancelled','interrupted','failed','awaiting_user'].includes(job.state))pending.delete(job.id);
  }
  for(const [id,job] of pending)if(job.approval.expires_at*1000<=Date.now())pending.delete(id);
  jobs=[...pending.values()];
  if(selected&&!jobs.some(job=>job.id===selected.id)&&!busy){dialog.close();selected=null;}
  const unseen=jobs.find(job=>!announced.has(job.approval.id));if(unseen){announced.add(unseen.approval.id);if(!dialog.open)show(unseen.id);}
 }
 async function decide(accepted){
  if(!selected||busy)return;busy=true;accept.disabled=reject.disabled=later.disabled=true;
  try{await window.pywebview.api.approve_file_action(selected.id,selected.approval.id,accepted);dialog.close();selected=null;}
  catch{state.textContent='La aprobación caducó o el archivo cambió. La acción no se confirmó.';}
  finally{busy=false;later.disabled=false;await window.BrivanyAgents?.refresh();}
 }
 accept.onclick=()=>decide(true);reject.onclick=()=>decide(false);later.onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 window.BrivanyFileApprovals={observe,show};
})();
