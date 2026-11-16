(() => {
 const $=selector=>document.querySelector(selector),owner=parent.location.origin===location.origin?parent:window,session=owner.BrivanyComputerSession ||= {token:null};
 const bindNative=()=>{if(owner!==window&&owner.pywebview)window.pywebview=owner.pywebview};bindNative();owner.addEventListener('pywebviewready',bindNative);
 const notify=text=>$('#settings-status').textContent=text;
 for(const [id,label] of [['capabilities','Capacidades'],['work','Melodi WorkSpace']]){const button=document.createElement('button');button.type='button';button.dataset.tab=id;button.textContent=label;$('.settings-nav nav').append(button);}
 function render(){const values=BrivanyPreferences.get();document.querySelectorAll('[data-pref]').forEach(input=>{const value=values[input.dataset.pref];if(input.type==='checkbox')input.checked=value;else input.value=value;});for(const key of ['rate','threshold'])$('[data-value='+key+']').textContent=key==='rate'?values[key].toFixed(2)+'×':values[key].toFixed(3);}
 document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(tab=>tab.removeAttribute('aria-current'));button.setAttribute('aria-current','page');document.querySelectorAll('[data-section]').forEach(section=>section.hidden=section.dataset.section!==button.dataset.tab);notify('');const id=button.dataset.tab,embedded=['connections','activity'].includes(id);$('.settings-content').dataset.embedded=String(embedded);if(embedded){const frame=document.querySelector('[data-section=\"'+id+'\"] iframe');if(!frame.src)frame.src=frame.dataset.settingsModule;}});
 async function savePreference(action, message=''){
  try{await action();notify(message)}catch(error){notify(error.message||'No se pudo guardar el ajuste.')}
  finally{render()}
 }
 document.querySelectorAll('[data-pref]').forEach(input=>input.onchange=()=>{
  const value=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
  return savePreference(()=>BrivanyPreferences.set(input.dataset.pref,value));
 });
 $('#reset-preferences').onclick=()=>savePreference(()=>BrivanyPreferences.reset(),'Preferencias restablecidas.');
 async function request(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Brivany-Control':session.token||''},cache:'no-store',...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok)throw Error('No se pudo completar la operación.');return response.json();}
 const folderList=document.createElement('div');
 folderList.className='settings-folder-list';
 $('#choose-folder').closest('.setting-row').after(folderList);
 function renderFolders(state){
  const active=new Set(state.roots||[]);
  $('#computer-folders').textContent=state.roots?.[0]||'Carpeta local de trabajo';
  folderList.replaceChildren();
  for(const folder of state.saved_folders||[]){
   if(folder===state.roots?.[0])continue;
   const row=document.createElement('div');
   row.className='setting-row';
   const label=document.createElement('small');
   label.textContent=active.has(folder)?folder:folder+' · No disponible';
   const remove=document.createElement('button');
   remove.type='button';remove.textContent='Quitar';
   remove.setAttribute('aria-label','Quitar carpeta '+folder);
   remove.onclick=async()=>{
    remove.disabled=true;
    try{renderFolders(await owner.pywebview.api.forget_computer_folder(folder));session.token=null;await refresh();notify('Carpeta quitada. Se cerró el acceso de esta sesión.');}
    catch(error){remove.disabled=false;notify(error.message||'No se pudo quitar la carpeta.');}
   };
   row.append(label,remove);folderList.append(row);
  }
 }
 async function refresh(){
  try{const status=await request('/api/computer/status');document.querySelectorAll('[name=access-mode]').forEach(input=>{input.checked=input.value===(status.access?.mode||'normal');});$('#control-status').textContent=status.enabled?'Activo en esta sesión':'Se activa al solicitar una acción';$('#control-toggle').textContent=status.enabled?'Desactivar':'Activar';const folders=await owner.pywebview?.api?.computer_folder_settings?.();renderFolders(folders||status);$('#active-jobs').textContent=(status.jobs||[]).filter(job=>['queued','planning','running'].includes(job.state)).length+' tareas en curso';
   $('#edits-status').textContent=status.edits?.descriptor_ready?'Conexión local disponible':status.edits?.installed?'Editor instalado':'Instala o abre Cognira Edits';
   const catalog=await request('/api/computer/capabilities'),capabilities=$('#capability-list');capabilities.replaceChildren();for(const item of [...catalog.capabilities,...catalog.human_skills]){const row=document.createElement('div');row.className='setting-row';const name=document.createElement('span');name.textContent=item.title;const state=document.createElement('small');state.textContent=item.available===false?'Requiere configuración':item.authorization_required?'Requiere cuenta autorizada':item.kind==='module'?'Controles de la aplicación':'Disponible';row.append(name,state);capabilities.append(row);}
   const services=await request('/api/desktop/services');const box=$('#settings-services');box.replaceChildren();for(const item of services.services){const row=document.createElement('div');row.className='setting-row';const name=document.createElement('span');name.textContent=item.name;const state=document.createElement('span');state.textContent=item.configured?'Configurado':'Sin configurar';if(item.configured)state.className='configured';row.append(name,state);box.append(row);}
  }catch{notify('No se pudo consultar la configuración.');}
 }
 document.querySelectorAll('[name=access-mode]').forEach(input=>input.onchange=async()=>{const radios=document.querySelectorAll('[name=access-mode]');radios.forEach(item=>item.disabled=true);try{await owner.pywebview.api.configure_computer_access(input.value);session.token=null;notify('Modo guardado. Se cerró la autorización anterior.');}catch{notify('No se pudo cambiar el modo. Usa Brivany Desktop.');}finally{radios.forEach(item=>item.disabled=false);await refresh();}});
 $('#control-toggle').onclick=async()=>{try{if(session.token){await request('/api/computer/disarm',{});session.token=null;}else{const result=await owner.pywebview.api.authorize_computer();if(!result.ok)throw Error();session.token=result.token;owner.BrivanyAgents?.observe(result.jobs||[]);}await refresh();}catch{notify('El control requiere la ventana de Brivany Desktop.');}};
 $('#choose-folder').onclick=async()=>{try{await owner.pywebview.api.choose_computer_folder();await refresh();}catch{notify('No se eligió una carpeta.');}};
 $('#stop-agents').onclick=async()=>{try{if(owner.pywebview?.api?.stop_assistant_tasks)await owner.pywebview.api.stop_assistant_tasks();else await request('/api/computer/disarm',{});session.token=null;await refresh();notify('Tareas detenidas.');}catch{notify('No se pudieron detener las tareas.');}};
 $('#credentials-form').onsubmit=async event=>{event.preventDefault();const key=$('#credential-key').value.trim();$('#credential-key').value='';try{await request('/api/desktop/credentials',{provider:$('#credential-provider').value,key});notify('Clave guardada en este equipo.');await refresh();}catch{notify('No se pudo guardar la clave. Pégala completa, sin espacios.');}};
 $('#clear-chat').onclick=()=>{owner.document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.clear();notify('Conversación e imágenes borradas de esta sesión.');};
 window.addEventListener('message',event=>{if(event.origin===location.origin&&[...document.querySelectorAll('[data-settings-module]')].some(frame=>frame.contentWindow===event.source)&&event.data?.type==='brivany-navigate')owner.postMessage(event.data,location.origin)});
 document.querySelectorAll('a[href]').forEach(link=>link.onclick=event=>{if(['/connections','/activity'].includes(new URL(link.href).pathname)){event.preventDefault();tab(new URL(link.href).pathname.slice(1));return;}if(owner!==window){event.preventDefault();owner.postMessage({type:'brivany-navigate',route:new URL(link.href).pathname},location.origin);}});
 $('#settings-work-start').onclick=async()=>{try{await owner.pywebview.api.start_work();}catch{notify('Work requiere la ventana de Brivany Desktop.');}};
 function renderChatVisibility(value){document.querySelectorAll('[name=workspace-chat-visibility]').forEach(input=>{input.checked=input.value===value.mode;input.disabled=value.supported===false&&input.value==='auto';});$('#workspace-chat-visibility-status').textContent=value.supported===false?'El cierre automático al escribir en otra app está disponible en Windows.':'';}
 async function loadChatVisibility(){const api=owner.pywebview?.api;if(api?.workspace_chat_visibility)renderChatVisibility(await api.workspace_chat_visibility());}
 document.querySelectorAll('[name=workspace-chat-visibility]').forEach(input=>input.onchange=async()=>{try{renderChatVisibility(await owner.pywebview.api.workspace_chat_visibility(input.value));notify('Comportamiento del chat guardado.');}catch{notify('No se pudo guardar el comportamiento del chat.');await loadChatVisibility();}});
 loadChatVisibility().catch(()=>{});owner.addEventListener('pywebviewready',()=>loadChatVisibility().catch(()=>{}),{once:true});
 function renderTranslationPreferences(value){$('#settings-translation-transcript').checked=value.show_transcript!==false;}
 async function loadTranslationPreferences(){const api=owner.pywebview?.api;if(api?.work_translation_preferences)renderTranslationPreferences(await api.work_translation_preferences());}
 $('#settings-translation-transcript').onchange=async event=>{try{renderTranslationPreferences(await owner.pywebview.api.work_translation_preferences(event.target.checked));notify('Preferencia guardada.');}catch{notify('No se pudo guardar la transcripción visible.');await loadTranslationPreferences();}};
 loadTranslationPreferences().catch(()=>{});owner.addEventListener('pywebviewready',()=>loadTranslationPreferences().catch(()=>{}),{once:true});
 $('#settings-edits-open').onclick=async()=>{try{const value=await owner.pywebview.api.open_edits();$('#edits-status').textContent='MCP conectado · '+value.tools+' herramientas del editor.';}catch{notify('No se pudo conectar Cognira Edits. Abre el editor y vuelve a intentarlo.');}};
 async function renderDucking(value){
  if(!value){const api=owner.pywebview?.api;if(!api?.music_ducking_status)return;value=await api.music_ducking_status();}
  $('#ducking-settings').hidden=!value.supported;$('#settings-duck-enabled').checked=value.enabled;
  const list=$('#settings-duck-games');list.replaceChildren();(value.excluded||[]).forEach((name,index)=>{const row=document.createElement('div');row.className='setting-row';const label=document.createElement('span');label.textContent=name;const remove=document.createElement('button');remove.type='button';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar exclusión '+name);remove.onclick=async()=>{try{await renderDucking(await owner.pywebview.api.music_ducking_configure(null,index));}catch{notify('No se pudo quitar la exclusión.');}};row.append(label,remove);list.append(row);});
 }
 $('#settings-duck-enabled').onchange=async event=>{try{await renderDucking(await owner.pywebview.api.music_ducking_configure(event.target.checked));}catch{notify('No se pudo cambiar la reducción de música.');}};
 $('#settings-duck-game').onclick=async()=>{try{await renderDucking(await owner.pywebview.api.music_ducking_add_game());}catch{notify('No se eligió un juego.');}};
 renderDucking().catch(()=>{});
 owner.addEventListener('pywebviewready',()=>owner.pywebview?.api?.computer_folder_settings?.().then(renderFolders).catch(()=>{}),{once:true});
 document.querySelector('.settings-nav').addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)document.querySelector('.settings-content').dataset.embedded=String(['connections','activity'].includes(button.dataset.tab));});
 const tab=id=>document.querySelector('[data-tab="'+id+'"]')?.click();window.BrivanySettings={refresh,tab};render();refresh();if(location.hash)tab(location.hash.slice(1));
})();
