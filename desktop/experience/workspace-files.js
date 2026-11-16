/* Local shelf: event driven, no background polling and no provider requests. */
(() => {
 'use strict';
 const mount=document.querySelector('#workspace-files');if(!mount)return;
 const body=document.body,api=()=>window.pywebview?.api;
 const localization=window.BrivanyWorkspaceLocale,t=source=>localization?.text(source)??source;
 const named=(source,name)=>t(source).replace('{name}',()=>name);
 const LIMIT=20_000_000_000,INLINE=8*1024*1024,BLOCK=256*1024,ACCEPT='.txt,.md,.csv,.json,.log,.yaml,.yml,.xml,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.wav,.mp3,.m4a,.mp4,.webm,.mov,.mkv,.heic,.zip,.7z,.rar,.bin';
 let state={revision:-1,items:[]},busy=false,gone=false,dragDepth=0,selectedId=null;
 mount.innerHTML='<div class="shelf-heading"><span class="shelf-count"></span><button type="button" class="shelf-add" aria-label="Añadir archivos">＋</button></div><div class="shelf-drop" tabindex="0" role="button" aria-label="Añadir archivos a la bandeja"><span aria-hidden="true">＋</span><strong>Arrastra un archivo</strong><small>Hasta 20 GB</small></div><input class="shelf-picker" type="file" multiple hidden><div class="shelf-list" role="list" aria-label="Archivos de esta sesión"></div><p class="shelf-status" role="status" aria-live="polite"></p>';
 const list=mount.querySelector('.shelf-list'),status=mount.querySelector('.shelf-status'),picker=mount.querySelector('.shelf-picker'),drop=mount.querySelector('.shelf-drop'),addButton=mount.querySelector('.shelf-add');picker.accept=ACCEPT;
 localization?.mount(mount);
 let feedback='',rowLabels=[];
 const announce=text=>{feedback=text||'';status.textContent=t(feedback);};
 function format(bytes){return bytes>=1000**3?(bytes/1000**3).toFixed(1)+' GB':bytes>=1000**2?(bytes/1000**2).toFixed(1)+' MB':bytes>=1000?(bytes/1000).toFixed(0)+' KB':bytes+' B';}
 function button(label,action){const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=action;return el;}
 async function call(method,...args){if(!api()?.[method])throw Error('Abre Brivany Desktop para usar la bandeja.');return api()[method](...args);}
 async function perform(action){if(busy)return;for(const menu of mount.querySelectorAll('.shelf-more[open]')){const focused=menu.contains(document.activeElement);menu.open=false;if(focused)menu.querySelector('summary')?.focus({preventScroll:true})}busy=true;mount.setAttribute('aria-busy','true');try{await action();}catch(error){announce(error.message||'No se pudo completar la acción.');}finally{busy=false;mount.setAttribute('aria-busy','false');}}
 const selected=()=>state.items.find(item=>item.id===selectedId)||null;
 function paintSelection(){for(const row of list.children){const active=row.dataset.id===selectedId;row.dataset.selected=String(active);row.querySelector('.shelf-copy')?.setAttribute('aria-pressed',String(active))}window.dispatchEvent(new CustomEvent('brivany-files-selection',{detail:{id:selectedId}}))}
 function select(id){if(!state.items.some(item=>item.id===id))return false;selectedId=id;paintSelection();return true}
 function receive(next){if(gone||!next||!Number.isFinite(next.revision)||next.revision<state.revision)return;const previous=state.items.length,known=new Set(state.items.map(item=>item.id)),added=next.items.filter(item=>!known.has(item.id));state=next;if(added.length)selectedId=added.at(-1).id;else if(!selected())selectedId=state.items.at(-1)?.id||null;list.replaceChildren();rowLabels=[];drop.hidden=state.items.length>0;
  addButton.disabled=state.items.length>=1000;addButton.hidden=!state.items.length;
  for(const item of state.items){const row=document.createElement('article');row.className='shelf-file';row.dataset.id=item.id;row.setAttribute('role','listitem');const icon=document.createElement('span');icon.className='shelf-kind';icon.textContent=item.kind.toUpperCase();icon.setAttribute('aria-hidden','true');const copy=document.createElement('div');copy.className='shelf-copy';copy.tabIndex=0;copy.setAttribute('role','button');copy.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(item.id)}};row.onclick=event=>{if(!event.target.closest('button,details'))select(item.id)};const title=document.createElement('strong');title.textContent=item.name;title.title=item.name;const size=document.createElement('small');size.textContent=format(item.size);copy.append(title,size);const actions=document.createElement('div');actions.className='shelf-actions';
   const open=button('Abrir',()=>perform(async()=>{await call('workspace_file_open',item.id);announce('Abierto con su aplicación.');}));
   const path=button('Ruta',()=>perform(async()=>{const result=await call('workspace_file_path',item.id);if(!navigator.clipboard?.writeText)throw Error('No se pudo acceder al portapapeles.');await navigator.clipboard.writeText(result.path);announce(item.temporary?'Ruta copiada; válida durante esta sesión.':'Ruta copiada.');}));
   const ask=button('Preguntar',()=>perform(async()=>{const result=await call('workspace_file_draft',item.id);const input=document.querySelector('#workspace-chat-input');if(!input)throw Error('No se pudo preparar el chat.');input.value=result.draft;input.dispatchEvent(new Event('input',{bubbles:true}));await window.BrivanyIsland?.expand('chat');input.focus();const chatStatus=document.querySelector('#workspace-chat-status');if(chatStatus)chatStatus.textContent=t(result.message);announce(result.message);}));
   const email=button('Correo',()=>perform(async()=>{
    const result=await call('workspace_file_email',item.id);
    announce(result.opened?'Correo abierto con el adjunto.':result.saved?'Correo guardado con el adjunto.':'');
   }));
   const remove=button('×',()=>perform(async()=>{receive(await call('workspace_files_remove',item.id));announce('Archivo retirado de la bandeja.');}));remove.className='shelf-remove';
   const phone=button('Teléfono',()=>perform(async()=>{select(item.id);if(!window.BrivanyWorkspacePhone)throw Error('No se pudo preparar el envío.');await window.BrivanyWorkspacePhone.start(item.id);}));
   const more=document.createElement('details'),summary=document.createElement('summary'),menu=document.createElement('div');more.className='shelf-more';summary.textContent='⋯';menu.className='shelf-menu';menu.append(open,path,email,phone);more.append(summary,menu);more.ontoggle=()=>{if(more.open)more.scrollIntoView({block:'nearest'})};actions.append(ask,more,remove);row.append(icon,copy,actions);list.append(row);
   rowLabels.push(()=>{
    for(const [node,source] of [[ask,'Preguntar'],[open,'Abrir'],[path,'Ruta'],[email,'Correo'],[phone,'Teléfono']])node.textContent=t(source);
    copy.setAttribute('aria-label',named('Seleccionar {name}',item.name));path.setAttribute('aria-label',named('Copiar ruta de {name}',item.name));
    remove.setAttribute('aria-label',named('Quitar {name}',item.name));
    summary.setAttribute('aria-label',named('Opciones de {name}',item.name));
   });
  }
  paintLabels();paintSelection();
  if(state.items.length>previous){window.dispatchEvent(new CustomEvent('brivany-files-added',{detail:{count:state.items.length-previous}}));body.dataset.shelfState='received';}
 }
 function paintLabels(){
  const count=state.items.length;
  mount.querySelector('.shelf-count').textContent=count?t(count===1?'{count} archivo':'{count} archivos').replace('{count}',String(count)):'';
  for(const paint of rowLabels)paint();
  document.querySelectorAll('[data-panel="files"]').forEach(el=>{el.dataset.count=String(count);el.setAttribute('aria-label',t('Bandeja de archivos')+(count?' · '+count:''));});
  announce(feedback);
 }
 function encoded(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('No se pudo leer el archivo.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
 async function upload(files){await perform(async()=>{const errors=[];for(const file of files){if(state.items.length>=1000){errors.push(t('La bandeja admite 1.000 archivos.'));break;}if(file.size>LIMIT){errors.push(named('{name}: supera 20 GB.',file.name));continue;}if(!ACCEPT.split(',').some(ext=>file.name.toLowerCase().endsWith(ext))){errors.push(named('{name}: formato no compatible.',file.name));continue;}announce(named('Preparando {name}…',file.name));let token;try{
    if(file.size<=INLINE)receive(await call('workspace_files_upload',file.name,await encoded(file)));
    else{const started=await call('workspace_files_upload_begin',file.name,file.size);token=started.token;for(let offset=0;offset<file.size;offset+=BLOCK){if(gone)throw Error('Copia cancelada.');const chunk=file.slice(offset,offset+BLOCK);if(started.local_url){const response=await fetch(started.local_url+'?offset='+offset,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:chunk,cache:'no-store'});if(!response.ok)throw Error('No se pudo copiar el archivo.')}else await call('workspace_files_upload_write',token,offset,await encoded(chunk));announce(named('Preparando {name}…',file.name)+' '+Math.floor(Math.min(offset+BLOCK,file.size)/file.size*100)+'%')}receive(await call('workspace_files_upload_commit',token));token=null}
   }catch(error){if(token)await call('workspace_files_upload_abort',token).catch(()=>{});errors.push(t(error.message||'No se pudo añadir el archivo.'));}}
   announce(errors.length?errors.join(' '):'');
  });}
 function choose(){if(busy)return;if(api()?.workspace_files_choose)perform(async()=>{const result=await call('workspace_files_choose');receive(result);announce(result.errors?.join(' ')||'');});else picker.click();}
 addButton.onclick=choose;drop.onclick=choose;drop.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}};
 picker.onchange=()=>{upload([...picker.files]);picker.value='';};
 function isFileDrag(event){return [...(event.dataTransfer?.types||[])].includes('Files');}
 function openShelf(){if(body.dataset.panel!=='files'||body.dataset.expanded!=='true')window.BrivanyIsland?.expand('files');}
 function enter(event){if(!isFileDrag(event))return;event.preventDefault();dragDepth++;if(body.dataset.fileDragging!=='true'){body.dataset.fileDragging='true';openShelf();}}
 function over(event){if(!isFileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';}
 function leave(event){if(!isFileDrag(event))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)delete body.dataset.fileDragging;}
 function reset(){dragDepth=0;delete body.dataset.fileDragging;}
 function dropped(event){if(!isFileDrag(event))return;event.preventDefault();reset();openShelf();upload([...event.dataTransfer.files]);}
 async function pull(){if(!api()?.workspace_files_state)return;try{receive(await call('workspace_files_state'));}catch(error){announce(error.message);}}
 document.addEventListener('dragenter',enter);document.addEventListener('dragover',over);document.addEventListener('dragleave',leave);document.addEventListener('drop',dropped);document.addEventListener('dragend',reset);window.addEventListener('blur',reset);window.addEventListener('pywebviewready',pull);
 window.addEventListener('brivany-workspace-locale',paintLabels);
 window.BrivanyWorkspaceFiles={receive,selected,select,dispose(){gone=true;reset();for(const [type,fn] of [['dragenter',enter],['dragover',over],['dragleave',leave],['drop',dropped],['dragend',reset]])document.removeEventListener(type,fn);window.removeEventListener('blur',reset);window.removeEventListener('pywebviewready',pull);window.removeEventListener('brivany-workspace-locale',paintLabels);}};
 window.addEventListener('pagehide',()=>window.BrivanyWorkspaceFiles.dispose(),{once:true});receive(state);pull();
})();
