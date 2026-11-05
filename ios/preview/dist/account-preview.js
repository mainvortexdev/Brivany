/* Account proxy: session/provider credentials never reach the page. */
(() => {
 const state={signed_in:false,devices:[]},pending=new Map(),jobs=new Map(),requests=new Map();let generation=0;
 const api=async(path,body)=>{const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Brivany-Preview':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok)throw Error('No se pudo conectar con tu cuenta Brivany.');return response.json()};
 function update(next){
  if((state.account?.id||null)!==(next.account?.id||null)){
   generation++;for(const controller of requests.values())controller.abort();requests.clear();for(const timer of jobs.values())clearInterval(timer);jobs.clear();pending.clear();setChatAccount(next.account?.id);
  }
  for(const key of Object.keys(state))delete state[key];Object.assign(state,next);
 }
 const profilePage=()=>`${detailHeader('Cuenta Brivany')}<div class="content"><section class="detail-area">${state.signed_in?`<div class="group"><div class="row"><span>${safe(state.account.name)}</span></div><div class="row"><span class="value">${safe(state.account.email)}</span></div></div><h3 class="account-subtitle">Ordenadores</h3><div class="group">${state.devices.filter(d=>d.kind==='desktop'&&d.enabled!==false).map(d=>`<div class="row"><span>${safe(d.name)}</span><span class="value"><i class="connection-dot ${d.online?'online':''}"></i>${d.online?'Conectado':'Sin conexión'}</span></div>`).join('')||'<div class="row note">No hay ordenadores conectados.</div>'}</div><button class="pill wide" id="account-logout">Cerrar sesión</button>`:`<form id="account-signin" class="account-signin"><label>Correo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button class="pill primary wide" type="submit">Iniciar sesión</button><p id="account-error" role="status"></p></form>`}</section></div>`;
 async function refresh(first=false){try{const next=await api('account'),changed=JSON.stringify(next)!==JSON.stringify(state);update(next);if(first||changed&&detail==='connection')render()}catch{}}
 function commit(id,thread,owner){if(owner!==generation)return;saveConversation(id,thread);if(currentChat===id){messages=thread;render()}}
 function enhance(){
  const form=document.querySelector('#account-signin');if(form)form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{update(await api('account/login',{email:form.elements.email.value,password:form.elements.password.value}));form.elements.password.value='';render()}catch(error){form.querySelector('#account-error').textContent=error.message}finally{button.disabled=false}};
  const logout=document.querySelector('#account-logout');if(logout)logout.onclick=async()=>{try{update(await api('account/logout',{}));render()}catch(error){toast(error.message)}};
  const choice=pending.get(currentChat);
  if(choice&&tab==='chat'&&!detail){const anchor=document.querySelector('.compose-zone');if(anchor){const choices=document.createElement('div');choices.className='computer-choices';
   for(const computer of choice.command.computers||[]){const button=document.createElement('button');button.className='pill';button.textContent=computer.name;button.disabled=requests.has(currentChat);button.onclick=async()=>{
    button.disabled=true;const owner=generation,id=currentChat;
    try{const value=await api('commands/select',{id:choice.command.id,computer:computer.id});if(owner!==generation)return;
     if(value.command.state==='needs_device'){choice.command=value.command;toast(value.command.message);return}
     pending.delete(id);const thread=(chatHistory.find(c=>c.id===id)?.messages||messages).map(m=>({...m}));thread.push({role:'assistant',text:value.command.message});commit(id,thread,owner);watch(value.command.id,id,owner);
    }catch(error){if(owner===generation)toast(error.message)}finally{button.disabled=false}
   };choices.append(button)}anchor.before(choices)}}
  const busy=requests.has(currentChat),liveStatus=document.querySelector('.live-status');if(liveStatus&&busy)liveStatus.textContent='Pensando…';const submit=document.querySelector('#send-message');if(submit)submit.disabled=busy;
 }
 async function send(source){
  const id=currentChat;if(requests.has(id))return;const field=document.querySelector(source==='voice'?'#live-draft':'#draft'),text=field?.value.trim();if(!text)return;if(text.length>1200){toast('El mensaje admite hasta 1.200 caracteres.');return}
  const owner=generation,controller=new AbortController(),thread=messages.map(m=>({...m}));requests.set(id,controller);
  const history=thread.filter(m=>m.text).slice(-11).map(m=>({role:m.role,content:m.text.slice(0,1000)}));thread.push({role:'user',text});history.push({role:'user',content:text});const answer={role:'assistant',text:''};thread.push(answer);commit(id,thread,owner);
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Brivany-Preview':'1'},body:JSON.stringify({messages:history,source,conversation_id:id}),signal:controller.signal});if(!response.ok)throw Error('Inicia sesión en tu cuenta Brivany.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
   try{while(!finished){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>65536)throw Error('La respuesta superó su límite.');let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const event=JSON.parse(line);if(owner!==generation)return;
     if(event.type==='error')throw Error(event.message);if(event.type==='delta')answer.text+=event.text;if(event.type==='computer_choice')pending.set(id,{command:event.command});if(event.type==='computer_job'){pending.delete(id);watch(event.command.id,id,owner)}if(event.type==='done')finished=true;
    }
   }if(!finished)throw Error('La respuesta se interrumpió.');}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  }catch(error){if(error.name!=='AbortError')answer.text=error.message}finally{if(owner===generation){requests.delete(id);commit(id,thread,owner)}}
 }
 function watch(jobID,chatID,owner){
  if(jobs.has(jobID))return;let checking=false,attempts=0;const stop=()=>{clearInterval(jobs.get(jobID));jobs.delete(jobID)};
  const timer=setInterval(async()=>{if(checking||requests.has(chatID))return;if(owner!==generation||++attempts>720){stop();return}checking=true;
   try{const {command:job}=await api('commands/'+jobID);if(owner!==generation){stop();return}if(['succeeded','failed','cancelled','uncertain'].includes(job.state)){stop();const thread=(chatHistory.find(c=>c.id===chatID)?.messages||[]).map(m=>({...m}));thread.push({role:'assistant',text:job.result?.phase||job.message});commit(chatID,thread,owner)}}catch{stop()}finally{checking=false}
  },2500);jobs.set(jobID,timer);
 }
 window.BrivanyAccountPreview={state,get signedIn(){return state.signed_in},page:profilePage,enhance,send};refresh(true);const timer=setInterval(()=>refresh(),10000);
 window.addEventListener('pagehide',()=>{clearInterval(timer);for(const value of jobs.values())clearInterval(value);for(const controller of requests.values())controller.abort()},{once:true});
})();
