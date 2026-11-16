import {mountWhatsAppCloud} from './whatsapp-cloud.js';
const $=id=>document.getElementById(id);
const labels={calendar:'Agenda de Google',gmail:'Gmail',drive:'Google Drive',whatsapp:'WhatsApp Business'};
let state=null,busy=false;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
function notice(text){$('notice').textContent=text;}
function error(text=''){$('error').hidden=!text;$('error').textContent=text;}
const queryReview=node('dialog');queryReview.id='google-query-review';
queryReview.append(node('h2','Revisar consulta'));
const reviewService=node('p'),reviewParameters=node('p'),reviewExecute=node('button','Consultar'),reviewCancel=node('button','Cancelar');
reviewParameters.className='query-review-parameters';reviewExecute.className='primary';reviewCancel.className='text';
reviewExecute.type=reviewCancel.type='button';queryReview.append(reviewService,reviewParameters,reviewExecute,reviewCancel);document.body.append(queryReview);
reviewCancel.onclick=()=>queryReview.close();
function queryForm(connector){
 const form=node('form'),result=node('div'),submit=node('button',connector==='calendar'?'Consultar':'Buscar');
 form.className='google-query';form.dataset.queryConnector=connector;result.className='google-query-result';result.setAttribute('role','status');result.setAttribute('aria-live','polite');
 submit.type='submit';submit.className='secondary';let input,start,end;
 if(connector==='calendar'){
  const range=node('div');range.className='query-date-range';start=node('input');end=node('input');start.type=end.type='date';start.setAttribute('aria-label','Desde');end.setAttribute('aria-label','Hasta');
  const date=new Date(),format=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  start.value=format(date);date.setDate(date.getDate()+7);end.value=format(date);range.append(start,end);form.append(range);
 }else{input=node('input');input.type='search';input.required=true;input.maxLength=1000;input.placeholder=connector==='gmail'?'Buscar en Gmail':'Nombre de archivo';input.setAttribute('aria-label',input.placeholder);form.append(input);}
 form.append(submit,result);
 form.onsubmit=event=>{event.preventDefault();run(async()=>{
  const parameters=connector==='calendar'?{start:new Date(start.value+'T00:00:00').toISOString(),end:new Date(end.value+'T00:00:00').toISOString()}:{query:input.value.trim()};
  const operation=connector==='calendar'?'calendar.list':connector+'.search';
  const proposal=await api('/api/integrations/proposals',{operation,parameters,request_id:crypto.randomUUID()});
  reviewService.textContent=labels[connector];reviewParameters.textContent=connector==='calendar'?`${start.value} → ${end.value}`:parameters.query;reviewExecute.disabled=false;
  let used=false;
  reviewExecute.onclick=()=>{if(used)return;used=true;reviewExecute.disabled=true;run(async()=>{
   try{
    const approval=await api('/api/integrations/approve',{proposal_id:proposal.id,action_sha256:proposal.action_sha256});
    const response=await api('/api/integrations/execute',{proposal_id:proposal.id,parameters,approval_id:approval.approval_id,execute:true});
    result.replaceChildren();
    if(!['succeeded','succeeded_test_stub'].includes(response.state)){result.textContent='Resultado sin confirmar. No se repetirá automáticamente.';return;}
    const payload=response.result||{},items=payload[connector==='gmail'?'messages':connector==='drive'?'files':'items']||[];
    const count=items.length,kind=connector==='gmail'?'mensajes':connector==='drive'?'archivos':'eventos';
    result.append(node('strong',(response.state==='succeeded_test_stub'?'Simulación · ':'')+(count?`${count} ${kind}`:'Sin coincidencias')));
    if(connector==='gmail'&&count)result.append(node('span','Referencias encontradas · sin descargar el contenido'));
    if(connector!=='gmail'&&count){const list=node('ul');for(const item of items)list.append(node('li',connector==='drive'?item.name||'Archivo':item.summary||'Evento'));result.append(list);}
    if(payload.more_available)result.append(node('span','Hay más resultados. Ajusta la búsqueda.'));
   }finally{queryReview.close();}
  });};queryReview.showModal();
 });};return form;
}
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
 for(const id of ['calendar','gmail','drive']){
  const grant=state.google.connectors.find(item=>item.connector===id),row=node('article'),copy=node('div');
  row.className='account';row.dataset.connector=id;copy.className='account-copy';
  copy.append(node('h3',labels[id]),node('p',grant?.authorized?(grant.simulated?'Autorización simulada de prueba':'Cuenta vinculada · permisos autorizados'):id==='whatsapp'?'Sin vincular':'Pendiente de autorización'));
  const write=node('input');write.type='checkbox';write.id='scope-'+id;
  if(id==='gmail'){
   write.checked=(grant?.authorized_operations||[]).includes('gmail.draft');
   const choice=node('label');choice.className='scope-choice';choice.append(write,document.createTextNode('También preparar borradores'));copy.append(choice);
  }
  row.append(copy);
  if(id!=='whatsapp'){
   const button=node('button',grant?.authorized?'Revisar permisos':'Conectar');button.type='button';button.className='secondary';
   button.disabled=!state.google.client_configured||!state.google.storage.available;
   button.onclick=()=>run(async()=>{
    const operations=id==='calendar'?['calendar.list']:id==='gmail'?(write.checked?['gmail.search','gmail.draft']:['gmail.search']):['drive.search'];
    await api('/api/integrations/google/begin',{connector:id,operations,open_browser:true});
    notice('Continúa en Google. Al terminar, pulsa Actualizar.');
   });row.append(button);
  }
  host.append(row);
  if(grant?.authorized&&id!=='whatsapp')host.append(queryForm(id));
 }
 $('disconnect-google').hidden=!state.google.connectors.some(item=>item.authorized);
 notice('Las cuentas solo se usan cuando solicitas una acción.');
 await whatsappCloud.refresh();
}
const whatsappCloud=mountWhatsAppCloud($('melodi-whatsapp'),{api});
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
