/* Session-only images, shared by the home composer and live view. */
(() => {
 if(!['/brivany-shell','/app','/computer'].includes(location.pathname))return;
 let owner;try{owner=parent.location.origin===location.origin?parent:window;}catch{owner=window;}
 const state=owner.BrivanyReferences ||= {items:[],active:null,busy:0,generation:0};
 const rawFetch=window.fetch.bind(window),session=owner.BrivanyComputerSession ||= {token:null};
 const root=location.pathname==='/brivany-shell',mount=root?document.querySelector('.composer-wrap'):document.querySelector('#chat-images')||document.querySelector('.computer-options-body');
 if(!mount)return;
 const section=document.createElement('section');section.className='melodi-references';section.setAttribute('aria-label','Imágenes para Melodi');
 section.innerHTML='<div class="reference-tools"><button type="button" class="reference-attach" aria-label="Adjuntar imágenes a Melodi">＋ Imagen</button><span class="reference-status" role="status">Puedes pegar una imagen aquí.</span><input type="file" hidden accept="image/png,image/jpeg,image/webp" multiple></div><div class="reference-list" aria-label="Referencias adjuntas"></div><p class="reference-disclosure" hidden>Al enviar, Meta analizará estas imágenes. Se conservan en memoria durante esta sesión, hasta 30 minutos. La seleccionada se usará para dibujar en Paint.</p>';
 mount.prepend(section);
 const list=section.querySelector('.reference-list'),status=section.querySelector('.reference-status'),input=section.querySelector('input'),attachButton=section.querySelector('.reference-attach');
 if(document.body.classList.contains('chat-clean')){window.BrivanyIcons?.set(attachButton,'image');attachButton.setAttribute('aria-label','Adjuntar imágenes');}
 const changed=()=>owner.dispatchEvent(new Event('brivany-references'));
 const reportError=message=>{status.textContent=message;window.dispatchEvent(new CustomEvent('brivany-reference-error',{detail:message}));};
 const remove=async id=>{state.items=state.items.filter(item=>item.id!==id);if(state.active===id)state.active=state.items.at(-1)?.id||null;changed();await rawFetch('/api/computer/references/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).catch(()=>{});};
 const clear=()=>{state.generation++;return Promise.all(state.items.map(item=>remove(item.id)));};
 function render(){
  list.replaceChildren();section.querySelector('.reference-disclosure').hidden=!state.items.length;
  const form=section.querySelector('.reference-prompt');if(form)form.hidden=!state.items.length;
  for(const [index,item] of state.items.entries()){
   const row=document.createElement('div');row.className='reference-item';
   const select=document.createElement('button');select.type='button';select.className='reference-select';select.setAttribute('aria-label','Usar imagen '+(index+1)+' para Paint');select.setAttribute('aria-pressed',String(state.active===item.id));
   const image=document.createElement('img');image.src=item.preview;image.alt='Referencia '+(index+1);image.width=56;image.height=48;select.append(image);select.onclick=()=>{state.active=item.id;changed();};
   const label=document.createElement('span');label.textContent=(state.active===item.id?'Activa · ':'')+item.width+' × '+item.height;label.hidden=document.body.classList.contains('chat-clean');select.setAttribute('aria-label','Usar imagen '+(index+1));
   const button=document.createElement('button');button.type='button';button.className='reference-remove';if(window.BrivanyIcons)window.BrivanyIcons.set(button,'close');else button.textContent='×';button.setAttribute('aria-label','Quitar imagen '+(index+1));button.onclick=()=>remove(item.id);
   row.append(select,label,button);list.append(row);
  }
  status.textContent=state.busy?'Preparando imagen…':state.items.length?state.items.length+' de 4 imágenes · puedes seguir hablando':'Puedes pegar una imagen aquí.';
  attachButton.disabled=state.busy>0||state.items.length>=4;
 }
 async function add(files){
  for(const file of files){
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)){reportError('Usa PNG, JPEG o WebP.');continue;}
   if(state.items.length+state.busy>=4){reportError('Puedes adjuntar hasta cuatro imágenes.');break;}
   if(file.size>20000000){reportError('La imagen supera los 20 MB.');continue;}
   const generation=state.generation;state.busy++;changed();
   try{
    const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    if(Math.min(bitmap.width,bitmap.height)<16||bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('Las dimensiones no son válidas.');}
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    let preview=file.type==='image/png'?canvas.toDataURL('image/png'):canvas.toDataURL('image/jpeg',.9);if(preview.length>2000000)preview=canvas.toDataURL('image/jpeg',.72);
    if(preview.length>2100000)throw Error('La imagen sigue siendo demasiado grande.');
    const response=await rawFetch('/api/computer/references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_url:preview})});
    if(!response.ok)throw Error('No se pudo adjuntar esa imagen.');
    const item=await response.json();if(generation!==state.generation){await remove(item.id);state.busy--;changed();continue;}state.items.push({...item,preview});state.active=item.id;
   }catch(error){state.busy--;changed();reportError(error.message);continue;}
   state.busy--;changed();
  }
 }
 input.onchange=()=>{add([...input.files]);input.value='';};attachButton.onclick=()=>input.click();
 document.addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));if(!files.length)return;if(!event.target.closest('input,textarea,.melodi-references,.composer-wrap'))return;event.preventDefault();add(files);});
 owner.addEventListener('brivany-references',render);window.addEventListener('pagehide',()=>owner.removeEventListener('brivany-references',render),{once:true});render();
 document.querySelector('#clear-session')?.addEventListener('click',clear);
 const responseFor=events=>new Response(events.map(event=>JSON.stringify(event)).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
 async function requestTurn(body,fetcher=rawFetch,signal){
  if(state.busy)throw Error('Espera a que se prepare la imagen.');
  const refs=state.items.map(item=>item.id),active=state.active,generation=state.generation;
  if(!refs.length)throw Error('Adjunta una imagen primero.');
  const response=await fetcher('/api/computer/image-turn',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Brivany-Control':session.token||''},body:JSON.stringify({...body,reference_ids:refs,active_reference_id:active})});
  if(!response.ok)return response;
  const events=(await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse),action=events.find(event=>event.type==='reference_action');
  if(!action)return responseFor(events);
  signal?.throwIfAborted();if(generation!==state.generation)throw Error('La sesión cambió; no se inició la tarea.');
  const api=owner.pywebview?.api;if(!api?.authorize_computer)throw Error('Abre Brivany Desktop para ejecutar esta tarea.');
  if(!session.token){const grant=await api.authorize_computer();if(!grant.ok||!grant.token)throw Error('No se pudo activar el control.');session.token=grant.token;owner.BrivanyAgents?.observe(grant.jobs||[]);}
  signal?.throwIfAborted();if(generation!==state.generation)throw Error('La sesión cambió; no se inició la tarea.');
  const execution=await fetcher('/api/computer/execute-prepared',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Brivany-Control':session.token},body:JSON.stringify({ticket:action.ticket})});
  if(!execution.ok)throw Error('La tarea no se inició. No se repetirá automáticamente.');
  const {job}=await execution.json(),text='Trabajo con la imagen adjunta. Puedes seguir hablando mientras preparo el resultado.';
  return responseFor([{type:'computer_task',job},{type:'delta',text},{type:'sentence',text},{type:'done',text,await_user:true}]);
 }
 const answer=document.createElement('p');answer.className='reference-answer';answer.setAttribute('role','status');answer.hidden=true;section.append(answer);
 async function send(text){
  if(!text.trim())text='¿Qué ves en esta imagen?';
  answer.hidden=false;answer.textContent='Melodi está viendo la referencia…';
  try{const response=await requestTurn({text:text.slice(0,1200),history:[],consent:true,language:'es'});if(!response.ok)throw Error('No se pudo analizar la referencia.');
   const events=(await response.text()).trim().split('\n').map(JSON.parse),error=events.find(event=>event.type==='error');if(error)throw Error(error.message);
   answer.textContent=events.filter(event=>event.type==='delta').map(event=>event.text).join('');window.BrivanyComputerUI?.refresh();
  }catch(error){answer.textContent=error.message;}
 }
 function attachFromWork(value){if(state.items.length>=4){reportError('Quita una imagen antes de adjuntar la región.');rawFetch('/api/computer/references/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:value.id})});return false;}state.items.push(value);state.active=value.id;changed();return true;}
 window.BrivanyImageRequest={requestTurn,send,clear,attachFromWork,attachFiles:add,hasImages:()=>state.items.length>0};
 if(owner.BrivanyPendingWorkRegion){const value=owner.BrivanyPendingWorkRegion;delete owner.BrivanyPendingWorkRegion;if(attachFromWork(value))window.BrivanyChat?.send(value.question);}
 if(!root&&!document.body.classList.contains('chat-clean')){
  const form=document.createElement('form');form.className='reference-prompt';form.innerHTML='<label class="sr-only">Pedir a Melodi sobre las imágenes<input maxlength="1200"></label>';
  form.replaceChildren();const text=document.createElement('input');text.setAttribute('aria-label','Pedir a Melodi sobre las imágenes');text.placeholder='Descríbela, dibújala, crea un 3D o un plano…';text.maxLength=1200;
  const button=document.createElement('button');button.type='submit';button.textContent='Enviar';form.append(text,button);section.append(form);
  form.hidden=!state.items.length;form.onsubmit=event=>{event.preventDefault();if(state.items.length){send(text.value);text.value='';}};
 }
})();
