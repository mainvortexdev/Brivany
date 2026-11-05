const $=id=>document.getElementById(id);
const labels={calendar:'Agenda de Google',gmail:'Gmail',drive:'Google Drive',whatsapp:'WhatsApp Business'};
let state=null,busy=false;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
function notice(text){$('notice').textContent=text;}
function error(text=''){$('error').hidden=!text;$('error').textContent=text;}
async function api(path,payload){
 const response=await fetch(path,{method:payload===undefined?'GET':'POST',cache:'no-store',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
 const result=await response.json();if(!response.ok)throw Error(result.error?.message||'No se pudo completar la operación.');return result;
}
async function run(action){
 if(busy)return;busy=true;error();$('main').setAttribute('aria-busy','true');
 try{await action();}catch(exception){error(exception.message);}finally{busy=false;$('main').removeAttribute('aria-busy');}
}
async function refresh(){
 state=await api('/api/integrations/status');
 for(const [id,key] of [['whatsapp-phone-id','phone_number_id'],['whatsapp-self','self_recipient']])$(id).value=state.settings[key]||'';
 $('whatsapp-optin').checked=state.registry.self_recipient_opted_in;
 $('whatsapp-webhook-enabled').checked=state.settings.webhook_enabled;
 const host=$('accounts');host.replaceChildren();
 for(const id of ['calendar','gmail','drive','whatsapp']){
  const grant=state.google.connectors.find(item=>item.connector===id),row=node('article'),copy=node('div');
  row.className='account';row.dataset.connector=id;copy.className='account-copy';
  copy.append(node('h3',labels[id]),node('p',grant?.authorized?(grant.simulated?'Autorización simulada de prueba':'Cuenta vinculada · permisos autorizados'):id==='whatsapp'?'Sin vincular':'Pendiente de autorización'));
  const write=node('input');write.type='checkbox';write.id='scope-'+id;
  if(id==='calendar'||id==='gmail'){
   write.checked=(grant?.authorized_operations||[]).includes(id==='calendar'?'calendar.create':'gmail.draft');
   const choice=node('label');choice.className='scope-choice';choice.append(write,document.createTextNode(id==='calendar'?'También crear eventos':'También preparar borradores'));copy.append(choice);
  }
  row.append(copy);
  if(id!=='whatsapp'){
   const button=node('button',grant?.authorized?'Revisar permisos':'Conectar');button.type='button';button.className='secondary';
   button.disabled=!state.google.client_configured||!state.google.storage.available;
   button.onclick=()=>run(async()=>{
    const operations=id==='calendar'?(write.checked?['calendar.list','calendar.create']:['calendar.list']):id==='gmail'?(write.checked?['gmail.search','gmail.draft']:['gmail.search']):['drive.search'];
    await api('/api/integrations/google/begin',{connector:id,operations,open_browser:true});
    notice('Continúa en Google. Al terminar, pulsa Actualizar.');
   });row.append(button);
  }
  host.append(row);
 }
 $('disconnect-google').hidden=!state.google.connectors.some(item=>item.authorized);
 notice('Las cuentas solo se usan cuando solicitas una acción.');
}
$('refresh').onclick=()=>run(refresh);
$('whatsapp-config').onsubmit=event=>{event.preventDefault();run(async()=>{
 const values={};
 for(const [id,name] of [['whatsapp-token','BRIVANY_WHATSAPP_ACCESS_TOKEN'],['whatsapp-app-secret','BRIVANY_META_APP_SECRET'],['whatsapp-verify-token','BRIVANY_WHATSAPP_VERIFY_TOKEN']])if($(id).value.trim())values[name]=$(id).value.trim();
 if(Object.keys(values).length)await api('/api/integrations/credentials',{provider:'whatsapp',values});
 const own=$('whatsapp-self').value.trim();
 await api('/api/integrations/settings',{webhook_enabled:$('whatsapp-webhook-enabled').checked,phone_number_id:$('whatsapp-phone-id').value.trim()||null,self_recipient:own||null,opted_in_recipients:$('whatsapp-optin').checked&&own?[own]:[],allowed_senders:own?[own]:[]});
 for(const id of ['whatsapp-token','whatsapp-app-secret','whatsapp-verify-token'])$(id).value='';
 await refresh();notice('Configuración guardada.');
});};
$('disconnect-google').onclick=()=>$('disconnect-dialog').showModal();
$('cancel-disconnect').onclick=()=>$('disconnect-dialog').close();
$('confirm-disconnect').onclick=()=>run(async()=>{
 const result=await api('/api/integrations/google/disconnect',{connector:'calendar',revoke:true});$('disconnect-dialog').close();await refresh();
 notice(result.revocation_request_accepted?'Cuentas desvinculadas.':'Autorizaciones locales retiradas; revocación remota sin confirmar.');
});
run(refresh);
