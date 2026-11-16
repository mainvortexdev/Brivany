(() => {
 if(!['/app','/computer'].includes(location.pathname))return;
 let owner;
 try{owner=parent.location.origin===location.origin?parent:window;}catch{owner=window;}
 const session=owner.BrivanyComputerSession ||= {token:null};
 const originalFetch=window.fetch.bind(window);
 const mount=document.getElementById('computer-mount')||document.querySelector('main');
 const live=location.pathname==='/app';if(live)mount.classList.add('computer-live');
 const panel=document.createElement('section');panel.className='computer-panel';panel.setAttribute('aria-label','Control del ordenador de Melodi');
 panel.innerHTML='<div class="computer-bar"><div class="computer-heading"><h2>Ordenador y creación 3D</h2><p class="computer-state" role="status">Control desactivado.</p></div><div class="computer-actions"><button type="button" data-enable>Activar control</button><button type="button" class="computer-stop" data-stop>Detener tareas</button></div></div><p class="computer-privacy">Al activar, Melodi puede enviar a Meta los controles observados y capturas de Paint. No guarda las capturas ni tu voz.</p><div class="computer-current" hidden><span></span><button type="button" data-current-model hidden>Ver modelo</button></div><details class="computer-options"><summary>Tareas y opciones</summary><div class="computer-options-body"><p>El permiso dura esta sesión. Puedes detener las tareas cuando quieras. Las capturas de Paint y los controles observados pueden enviarse a Meta.</p><button type="button" data-folder>Elegir carpeta</button><div class="computer-roots"></div><form class="computer-task-form"><label><span class="sr-only">Tipo de tarea</span><select aria-label="Tipo de tarea"><option value="desktop">Ordenador</option><option value="model">Modelo 3D</option><option value="motion">Animación y video</option></select></label><input aria-label="Instrucción para Melodi" maxlength="2000" required placeholder="Pídele a Melodi que haga algo…"><button type="submit">Iniciar tarea</button></form><ul class="computer-jobs" aria-label="Tareas de Melodi"></ul></div></details>';
 mount.prepend(panel);
 const preview=document.createElement('section');preview.className='computer-preview';preview.setAttribute('aria-label','Modelo junto a Melodi');(live?mount:panel).append(preview);
 const $=selector=>panel.querySelector(selector),state=$('.computer-state'),list=$('.computer-jobs');
 const options=$('.computer-options');options.open=!live;
 if(live){$('.computer-heading h2').textContent='Ordenador y 3D';$('.computer-bar').append(options);options.querySelector('summary').textContent='Opciones';options.querySelector('summary').setAttribute('aria-label','Tareas y opciones');}
 let latestModel=null,jobsSnapshot='',motionUrl=null;
 const closePreview=()=>{if(motionUrl){URL.revokeObjectURL(motionUrl);motionUrl=null;}preview.replaceChildren();mount.classList.remove('computer-has-preview','computer-context-open');mount.querySelector('.computer-context-toggle')?.setAttribute('aria-expanded','false');};
 const showPreview=model=>{
  if(!model?.scene_id)return;closePreview();mount.classList.add('computer-has-preview');options.open=false;
  const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent=model.title||'Tu modelo conceptual';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar vista del modelo');close.title='Cerrar vista del modelo';close.onclick=closePreview;heading.append(title,close);
  const viewer=document.createElement('iframe');viewer.title='Modelo conceptual creado por Melodi';viewer.src='/spaces?space='+encodeURIComponent(model.scene_id)+'&embedded=melodi'+(model.representation==='plan'?'&representation=plan':'');
  const note=document.createElement('p');note.className='computer-preview-note';note.textContent=(model.representation==='plan'?'Plano conceptual':'Modelo conceptual')+' · Medidas y física sin verificar';preview.append(heading,viewer,note);
 };
 const openModule=(route,title)=>{
  const url=new URL(route,location.origin),allowed=['/spaces','/human-skills','/practice','/sous','/dubbing','/connections','/activity','/settings'];
  if(url.origin!==location.origin||!allowed.includes(url.pathname))return;
  if(url.pathname==='/settings'){owner.BrivanyOpenSettings?.(url.hash);return;}
  closePreview();mount.classList.add('computer-has-preview');options.open=false;
  const heading=document.createElement('div');heading.className='computer-preview-heading';const label=document.createElement('strong');label.textContent=title||'Junto a Melodi';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar módulo junto al chat');close.onclick=closePreview;heading.append(label,close);
  const viewer=document.createElement('iframe');viewer.title=title||'Módulo de Brivany';viewer.src=url.pathname+url.search;preview.append(heading,viewer);
 };
 $('[data-current-model]').onclick=()=>showPreview(latestModel);
 if(live){
  const toggle=document.createElement('button');toggle.type='button';toggle.className='computer-context-toggle';toggle.textContent='Notas y contexto';toggle.setAttribute('aria-expanded','false');
  const companion=mount.querySelector('.companion-panel');if(companion){companion.id ||= 'computer-context';toggle.setAttribute('aria-controls',companion.id);}
  toggle.onclick=()=>{const open=mount.classList.toggle('computer-context-open');toggle.setAttribute('aria-expanded',String(open));};
  if(companion){const close=document.createElement('button');close.type='button';close.className='computer-context-close';close.textContent='Cerrar notas y contexto';close.onclick=()=>{mount.classList.remove('computer-context-open');toggle.setAttribute('aria-expanded','false');toggle.focus();};companion.prepend(close);}
  mount.querySelector('.voice-controls')?.before(toggle);
  document.addEventListener('click',event=>{if(options.open&&!options.contains(event.target))options.open=false;if(mount.classList.contains('computer-context-open')&&event.target!==toggle&&!companion?.contains(event.target)){mount.classList.remove('computer-context-open');toggle.setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){options.open=false;mount.classList.remove('computer-context-open');toggle.setAttribute('aria-expanded','false');}});
 }
 const statusNames={queued:'En cola',planning:'Preparando',running:'En curso',reviewing:'Melodi revisa',succeeded:'Finalizada',failed:'Detenida con error',cancelled:'Cancelada',interrupted:'Interrumpida al cerrar',awaiting_user:'Necesita tu intervención'};
 async function request(url,body){
  const response=await originalFetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Brivany-Control':session.token||''},cache:'no-store',...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw Error('No se pudo completar la solicitud. Activa el control y revisa el estado.');
  return response.json();
 }
 window.fetch=(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin&&url.pathname==='/api/voice/turn'&&window.BrivanyImageRequest?.hasImages())return window.BrivanyImageRequest.requestTurn(JSON.parse(init.body),originalFetch,init.signal);
  if(url.origin===location.origin&&url.pathname==='/api/voice/turn'&&session.token){
   const headers=new Headers(init.headers);headers.set('X-Brivany-Control',session.token);
   return originalFetch('/api/computer/turn',{...init,headers});
  }
  if(url.origin===location.origin&&url.pathname==='/api/voice/turn'&&document.body.classList.contains('chat-clean'))return originalFetch('/api/computer/chat-turn',init);
  return originalFetch(input,init);
 };
 async function refresh(){
  try{
   const data=await request('/api/computer/status');
   panel.dataset.enabled=String(data.enabled);
   if(!data.enabled)session.token=null;
   state.textContent=live?(data.enabled?'Control activo':'Control desactivado'):(data.enabled?'Control activo · habla con Melodi o escribe una tarea.':'Control desactivado · actívalo desde la ventana de escritorio.');
   $('[data-enable]').textContent=data.enabled?'Desactivar control':'Activar control';
   $('[data-folder]').disabled=!data.enabled;$('.computer-task-form [type=submit]').disabled=!data.enabled;
   $('.computer-roots').textContent=data.roots?.length?'Carpetas autorizadas: '+data.roots.join(' · '):'';
   const jobs=data.jobs||[],current=jobs.at(-1),banner=$('.computer-current');banner.hidden=!current;banner.dataset.state=current?.state||'';
   window.BrivanyChat?.taskStatus(jobs);
   if(data.enabled)owner.BrivanyAgents?.observe(jobs,data.schedules||[]);
   banner.querySelector('span').textContent=current?(current.kind==='model'?'Modelo 3D':current.agent||'Ordenador')+' · '+statusNames[current.state]:'';
   latestModel=jobs.slice().reverse().find(job=>job.result?.scene_id)?.result||null;$('[data-current-model]').hidden=!latestModel;
   const snapshot=JSON.stringify(jobs);if(snapshot===jobsSnapshot)return;jobsSnapshot=snapshot;
   const expanded=new Set([...list.querySelectorAll('li:has(details[open])')].map(row=>row.dataset.jobId));
   list.replaceChildren();
   for(const job of (data.jobs||[]).slice().reverse()){
    const row=document.createElement('li'),label=document.createElement('strong'),detail=document.createElement('p');row.dataset.jobId=job.id;
    label.textContent=(job.kind==='model'?'Modelo 3D':job.agent||'Ordenador')+' · '+statusNames[job.state];detail.textContent=job.phase;row.append(label,detail);
    if(job.error){const error=document.createElement('p');error.textContent=job.error;row.append(error);}
    if(job.result?.receipts?.length){const details=document.createElement('details'),summary=document.createElement('summary');details.open=expanded.has(job.id);summary.textContent='Ver acciones y resultados';details.append(summary);
     for(const receipt of job.result.receipts){const text=document.createElement('p');text.textContent=receipt.action+' · '+(receipt.result.path||receipt.result.destination||receipt.result.localPath||(receipt.result.text_value_verified?'Texto comprobado en el campo':receipt.result.verified?'Acción comprobada':'Entrada enviada; revisa su efecto'));details.append(text);}row.append(details);}
    if(job.result?.scene_id){const link=document.createElement('a');link.textContent='Ver modelo en Espacios';link.href='/spaces?space='+encodeURIComponent(job.result.scene_id);row.append(link);
     if(live){const inline=document.createElement('button');inline.type='button';inline.textContent='Ver junto a la voz';inline.onclick=()=>showPreview(job.result);row.append(inline);}
    }
    if(!['queued','planning','running','reviewing'].includes(job.state)){const button=document.createElement('button');button.type='button';button.textContent=job.reviewed?'Volver a revisar':'Revisar resultado';button.onclick=()=>review(job);row.append(button);}
    if(['queued','planning','running','reviewing'].includes(job.state)){const button=document.createElement('button');button.type='button';button.textContent='Cancelar';button.onclick=()=>request('/api/computer/cancel',{id:job.id}).then(refresh).catch(error=>state.textContent=error.message);row.append(button);}
    list.append(row);
   }
  }catch{state.textContent='El servicio de control todavía no está disponible en esta ventana.';}
 }
 $('[data-enable]').onclick=async()=>{
  try{
   if(session.token){await request('/api/computer/disarm',{});session.token=null;}
   else{const api=owner.pywebview?.api;if(!api?.authorize_computer)throw Error('Abre Brivany Desktop para habilitar el control.');const result=await api.authorize_computer();if(!result.ok)throw Error('No se pudo habilitar el control.');session.token=result.token;}
   await refresh();
  }catch(error){state.textContent=error.message;}
 };
 $('[data-folder]').onclick=async()=>{try{await owner.pywebview.api.choose_computer_folder();await refresh();}catch{state.textContent='No se eligió ninguna carpeta.';}};
 $('[data-stop]').onclick=async()=>{try{await request('/api/computer/disarm',{});session.token=null;await refresh();}catch(error){state.textContent=error.message;}};
 $('.computer-task-form').onsubmit=async event=>{event.preventDefault();try{await request('/api/computer/jobs',{kind:$('.computer-task-form select').value,goal:$('.computer-task-form input').value});$('.computer-task-form input').value='';await refresh();}catch(error){state.textContent=error.message;}};
 async function review(job){
  try{
   if(owner.pywebview?.api?.work_agent_review){await owner.pywebview.api.work_agent_review(job.id);return;}
   if(job.result?.scene_id)showPreview(job.result);
   else if(job.kind==='orchestrator'&&job.result){
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent='Equipo de Melodi';const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar resultados del equipo');close.onclick=closePreview;heading.append(title,close);
    const content=document.createElement('section');content.className='computer-edit-result';
    for(const agent of job.result.agents||[]){const row=document.createElement('p'),button=document.createElement('button');button.type='button';button.textContent=agent.title+(agent.accepted?' · Revisado':' · Revisar');button.disabled=!agent.job_id;button.onclick=async()=>{try{const status=await request('/api/computer/status'),child=(status.jobs||[]).find(item=>item.id===agent.job_id);if(child)await review(child)}catch{state.textContent='No se pudo abrir el resultado.'}};row.append(button);content.append(row)}preview.append(heading,content);
   }
   else if(['image','research'].includes(job.kind)){
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent=job.result?.title||job.agent;
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar resultado');close.onclick=closePreview;heading.append(title,close);
    const content=document.createElement('section');content.className='computer-edit-result';const response=await fetch('/api/computer/'+job.kind+'/'+encodeURIComponent(job.id),{headers:{'X-Brivany-Control':session.token||''},cache:'no-store'});
    if(!response.ok)throw Error('No se pudo cargar el resultado.');
    if(job.kind==='image'){const image=document.createElement('img');motionUrl=URL.createObjectURL(await response.blob());image.src=motionUrl;image.alt=title.textContent;image.style.maxWidth='100%';image.style.borderRadius='16px';content.append(image)}
    else{const result=await response.json(),text=document.createElement('pre');text.textContent=result.text;text.style.whiteSpace='pre-wrap';text.style.font='inherit';content.append(text)}
    preview.append(heading,content);
   }
   else if(job.kind==='motion'&&job.result?.verified){
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent=job.result.title||'Animación';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.onclick=closePreview;heading.append(title,close);
    const content=document.createElement('section');content.className='computer-edit-result';
    const response=await fetch('/api/computer/motion/'+encodeURIComponent(job.id),{headers:{'X-Brivany-Control':session.token||''},cache:'no-store'});if(!response.ok)throw Error('No se pudo cargar el resultado creativo.');
    const blob=await response.blob(),isImage=blob.type==='image/png';if(!isImage&&blob.type!=='video/mp4')throw Error('Formato creativo no admitido.');
    const media=document.createElement(isImage?'img':'video');close.setAttribute('aria-label',isImage?'Cerrar ilustración':'Cerrar video');
    if(isImage){media.alt=job.result.title||'Ilustración creada por Melodi';media.style.maxWidth='100%';media.style.borderRadius='16px';}
    else{media.controls=true;media.preload='metadata';media.setAttribute('aria-label','Video creado por Melodi');}
    if(isImage)media.src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    else{motionUrl=URL.createObjectURL(blob);media.src=motionUrl;}content.append(media);
    const details=document.createElement('p');details.textContent=isImage?job.result.width+' × '+job.result.height:job.result.duration+' s · '+job.result.width+' × '+job.result.height+' · '+job.result.fps+' fps';content.append(details);
    for(const [kind,label] of [[isImage?'image':'video',isImage?'Abrir imagen':'Abrir video'],['project','Abrir proyecto'],['folder','Abrir carpeta']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{try{await owner.pywebview.api.open_motion_result(job.id,kind);}catch{state.textContent='No se pudo abrir el resultado guardado.';}};content.append(button);}
    preview.append(heading,content);
   }
   else if(['terminal','media','support'].includes(job.kind)){
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';
    const title=document.createElement('strong');title.textContent=job.result?.title||'Terminal';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',job.kind==='terminal'?'Cerrar resultado de terminal':job.kind==='media'?'Cerrar resultado de medios':'Cerrar documentación');close.onclick=closePreview;heading.append(title,close);
    const content=document.createElement('section');content.className='computer-edit-result';
    const message=document.createElement('p');message.textContent=job.error||job.result?.message||job.phase;content.append(message);
    if(job.kind==='media'&&job.result?.path){
     for(const [kind,label] of [['file','Abrir archivo'],['folder','Abrir carpeta']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{try{await owner.pywebview.api.open_media_result(job.id,kind);}catch{message.textContent='No se pudo abrir el archivo guardado.';}};content.append(button);}
    }
    if(job.kind==='support'){
     for(const source of job.result?.sources||[]){const url=new URL(source.url);if(url.protocol!=='https:')continue;const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title;content.append(link);}
     if(job.result?.driver_proposal_id){const check=document.createElement('button');check.type='button';check.textContent='Comprobar instalación';check.onclick=async()=>{check.disabled=true;try{const value=await owner.pywebview.api.check_driver_installation(job.id);message.textContent=value.pending?'Windows todavía no ha devuelto el resultado de la instalación.':value.message;}catch{message.textContent='No se pudo comprobar la instalación. Revisa Windows Update.';}finally{check.disabled=false;}};content.append(check);}
    }
    if(job.result?.prepared_id&&job.result?.requires_user){
     const install=document.createElement('button');install.type='button';install.textContent='Continuar instalación de Office';
     install.onclick=async()=>{install.disabled=true;try{const result=await owner.pywebview.api.continue_office_installation(job.result.prepared_id);message.textContent=result.message;}catch{message.textContent='La instalación sigue preparada. Revisa el permiso de Windows.';}finally{install.disabled=false;}};content.append(install);
    }
    for(const [kind,label] of (job.kind==='terminal'?[['capture','Ver captura'],['notes','Abrir informe'],['folder','Abrir carpeta']]:[])){
     if(!(kind==='folder'?job.result?.evidence_folder:job.result?.[kind]?.verified))continue;
     const button=document.createElement('button');button.type='button';button.textContent=label;
     button.onclick=async()=>{try{await owner.pywebview.api.open_terminal_evidence(job.id,kind);}catch{message.textContent='No se pudo abrir la evidencia guardada.';}};content.append(button);
    }
    if(job.result?.receipt_id){const receipt=document.createElement('p');receipt.textContent='Recibo: '+job.result.receipt_id+(job.result.review_required?' · Revisión de ejecución pendiente':'');content.append(receipt);}
    for(const entry of job.result?.entries||[]){
     const link=document.createElement('a');const url=new URL(entry.source);
     if(url.protocol!=='https:')continue;link.href=url.href;link.textContent=entry.name||entry.keys;link.target='_blank';link.rel='noopener noreferrer';content.append(link);
    }
    preview.append(heading,content);
   }
   else if(job.result?.event_id){
    const value=await request('/api/computer/event/'+encodeURIComponent(job.result.event_id)),event=value.event;
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent='Espera de Melodi';const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar espera');close.onclick=closePreview;heading.append(title,close);
    const body=document.createElement('section');body.className='computer-edit-result';const when=document.createElement('p');when.textContent=event.when.type==='at'?'A las '+new Date(event.when.at).toLocaleString('es',{timeZone:'America/La_Paz'}):event.when.type==='job_succeeded'?'Cuando termine correctamente la tarea indicada':'Al activar este flujo';body.append(when);
    for(const action of event.actions){const text=document.createElement('p');text.textContent=action.type==='task'?action.goal:action.type==='drive_upload'?'Subir la exportación comprobada a Drive · '+(action.folder_name||action.folder_id):'Enviar el enlace por WhatsApp al destinatario propio autorizado';body.append(text);}
    const note=document.createElement('p');note.textContent='Brivany debe permanecer abierta. Una operación incierta no se repite. Drive y WhatsApp requieren cuentas y ejecución autorizadas.';body.append(note);
    if(event.state==='draft'){const activate=document.createElement('button');activate.type='button';activate.textContent='Activar esta espera y sus entregas';activate.onclick=async()=>{try{await request('/api/computer/event-activate',{id:event.id});activate.disabled=true;activate.textContent='Espera activada';}catch{note.textContent='No se pudo activar la espera.';}};body.append(activate);}
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar espera';cancel.onclick=async()=>{await request('/api/computer/event-cancel',{id:event.id});cancel.disabled=true;note.textContent='Espera cancelada. Comprueba operaciones que ya estuvieran en curso.';};body.append(cancel);preview.append(heading,body);
   }
   else if(job.result?.editor==='Cognira Edits'){
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent=job.result.title||'Edición de video';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar resultado de edición');close.onclick=closePreview;heading.append(title,close);
    const content=document.createElement('section');content.className='computer-edit-result';const message=document.createElement('p');message.textContent=job.result.message||'La copia está guardada en Cognira Edits. Revisa los cambios antes de entregar.';
    const path=document.createElement('p');path.textContent=job.result.video_path||job.result.project_path||'';
    const open=document.createElement('button');open.type='button';open.textContent='Abrir Cognira Edits';open.onclick=async()=>{try{await owner.pywebview.api.open_edits();}catch{message.textContent='Abre Cognira Edits desde el menú del sistema para revisar el proyecto.';}};
    content.append(message,path,open);preview.append(heading,content);
   }else if(job.result?.module_url){openModule(job.result.module_url,job.result.title);}
   else if(job.result?.receipts?.some(item=>['draw_paint','save_paint'].includes(item.action)&&item.result.localPath)){
    const response=await originalFetch('/api/computer/drawing/'+encodeURIComponent(job.id),{headers:{'X-Brivany-Control':session.token}});if(!response.ok)throw Error('No se pudo abrir el dibujo guardado.');
    const data=await response.blob(),url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(data);});
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent='Dibujo guardado en Paint';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar dibujo');close.onclick=closePreview;heading.append(title,close);
    const image=document.createElement('img');image.className='computer-drawing-preview';image.src=url;image.alt='Dibujo guardado por Melodi; compara el resultado con tu referencia.';preview.append(heading,image);
   }
   else if(job.result?.document_id){
    const response=await originalFetch('/api/computer/document/'+encodeURIComponent(job.id),{headers:{'X-Brivany-Control':session.token}});if(!response.ok)throw Error('No se pudo abrir el documento.');
    closePreview();mount.classList.add('computer-has-preview');options.open=false;
    const heading=document.createElement('div');heading.className='computer-preview-heading';const title=document.createElement('strong');title.textContent=job.result.title;
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar documento');close.onclick=closePreview;heading.append(title,close);
    const viewer=document.createElement('iframe');viewer.title='Documento redactado por Melodi';viewer.setAttribute('sandbox','');viewer.srcdoc=await response.text();preview.append(heading,viewer);
   }else if(job.result?.proposal){
    options.open=true;let box=$('.computer-proposal');if(!box){box=document.createElement('section');box.className='computer-proposal';$('.computer-options-body').prepend(box);}box.replaceChildren();
    const title=document.createElement('strong');title.textContent='Revisar consulta · '+job.result.operation;
    const parameters=document.createElement('pre');parameters.style.whiteSpace='pre-wrap';parameters.textContent=JSON.stringify(job.result.proposal.parameters,null,2);
    const execute=document.createElement('button');execute.type='button';execute.textContent='Ejecutar esta consulta';
    const output=document.createElement('pre');output.className='computer-query-result';output.setAttribute('role','status');
    execute.onclick=async()=>{execute.disabled=true;output.textContent='Consultando…';try{const result=await request('/api/computer/personal-execute',{id:job.id});output.textContent=JSON.stringify(result.data,null,2);await refresh();}catch{output.textContent='No se pudo confirmar la consulta. Revisa la autorización de Google y habilita la ejecución en Conexiones. No se reintentó.';}};
    const link=document.createElement('a');link.href='/connections';link.textContent='Abrir Conexiones';box.append(title,parameters,execute,link,output);
    return;
   }else if(job.result?.review_url){owner.BrivanyNavigate?.(job.result.review_url);return;}
   else{options.open=true;list.querySelector('[data-job-id="'+job.id+'"]')?.scrollIntoView({block:'nearest'});}
   await request('/api/computer/review',{id:job.id});await refresh();
  }catch(error){state.textContent=error.message;}
 }
 const select=$('select');for(const [value,label] of [['document','Redactar documento'],['personal','Agenda, Gmail o Drive'],['edits','Editar video'],['skill','Human-skills'],['schedule','Esperar hora o evento']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
 window.BrivanyComputerUI={refresh,review,openModule};
 if(owner.BrivanyPendingReview){const job=owner.BrivanyPendingReview;delete owner.BrivanyPendingReview;review(job);}
 const timer=setInterval(refresh,1500);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});refresh();
})();
