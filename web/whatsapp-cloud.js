export function mountWhatsAppCloud(host,{api}={}){
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 const card=node('article');card.className='melodi-whatsapp';card.dataset.connector='whatsapp';
 const intro=node('div'),eyebrow=node('p','MELODI · WHATSAPP'),title=node('h3','Llévame contigo.'),copy=node('p','Escríbeme por WhatsApp con tu cuenta de Brivany vinculada.');
 eyebrow.className='eyebrow';intro.append(eyebrow,title,copy);
 const number=node('p','Consultando número…'),status=node('p',''),error=node('p','');number.className='melodi-whatsapp-number';status.className='quiet';status.setAttribute('role','status');error.className='connection-error';error.setAttribute('role','alert');error.hidden=true;
 const actions=node('div'),link=node('button','Vincular mi WhatsApp'),check=node('button','Comprobar vínculo'),copyNumber=node('button','Copiar número'),unlink=node('button','Desvincular');
 actions.className='melodi-whatsapp-actions';for(const button of [link,check,copyNumber,unlink]){button.type='button';button.className=button===link?'primary':'text';actions.append(button);}
 const google=node('div'),googleCopy=node('p','Conecta tus cuentas para usarlas al escribir a Melodi por WhatsApp.');google.className='melodi-whatsapp-google';google.append(googleCopy);google.hidden=true;
 const desktop=node('div'),remoteLabel=node('label'),remote=node('input'),remoteText=node('span','Controlar este ordenador desde WhatsApp'),remoteStatus=node('p');
 remote.type='checkbox';remoteLabel.append(remote,remoteText);remoteStatus.className='quiet';desktop.append(remoteLabel,remoteStatus);
 let current=null,busy=false,poll=null,expires=0;
 const buttons=[link,check,copyNumber,unlink];
 function render(value){
  current=value;number.textContent='+'+value.number;
  status.textContent=value.account_required?'Inicia sesión en Cuenta Vetsa de Brivany para vincular tu WhatsApp.':value.linked?'Cuenta vinculada'+(value.phone?' · '+value.phone:''):'Envía el mensaje de vinculación desde tu WhatsApp.';
  link.hidden=value.linked;link.disabled=value.account_required;unlink.hidden=!value.linked;google.hidden=!value.linked;
  copyNumber.disabled=false;check.disabled=value.account_required;
  remote.checked=Boolean(value.desktop?.enabled);remote.disabled=busy||(!value.linked&&!value.desktop?.enabled);
  remoteStatus.textContent=value.desktop?.error||(value.desktop?.connected?'Este ordenador está conectado. Puedes pedirme tareas por WhatsApp.':value.desktop?.enabled?'Conectando este ordenador…':'Mantén Brivany abierta. Las tareas respetan las carpetas autorizadas y las aprobaciones de archivos.');
  if(value.linked&&poll){clearInterval(poll);poll=null;}
 }
 async function refresh(){
  try{error.hidden=true;render(await api('/api/integrations/whatsapp-cloud/status'));}
  catch(failure){error.textContent=failure.message||'No pude consultar WhatsApp.';error.hidden=false;}
 }
 async function run(action){
  if(busy)return;busy=true;for(const button of buttons)button.disabled=true;
  error.hidden=true;card.setAttribute('aria-busy','true');
  try{await action();}catch(failure){error.textContent=failure.message||'No pude completar esta acción.';error.hidden=false;}
  finally{busy=false;card.removeAttribute('aria-busy');for(const button of buttons)button.disabled=false;if(current)link.disabled=Boolean(current.account_required);}
 }
 link.onclick=()=>run(async()=>{
  const result=await api('/api/integrations/whatsapp-cloud/begin',{time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',open_browser:true});
  expires=result.expires_at;status.textContent='Envía el mensaje que abrimos en WhatsApp para terminar de vincular tu cuenta.';
  if(poll)clearInterval(poll);
  poll=setInterval(()=>{if(Date.now()>=expires){clearInterval(poll);poll=null;status.textContent='El enlace caducó. Puedes solicitar uno nuevo.';}else if(!document.hidden&&!busy)refresh();},15000);
 });
 check.onclick=()=>run(refresh);
 copyNumber.onclick=()=>run(async()=>{if(!current)throw Error('El número todavía no está disponible.');await navigator.clipboard.writeText('+'+current.number);status.textContent='Número de Melodi copiado.';});
 unlink.onclick=()=>run(async()=>{render(await api('/api/integrations/whatsapp-cloud/disconnect',{}));status.textContent='WhatsApp desvinculado de tu cuenta.';});
 remote.onchange=()=>run(async()=>{const native=window.pywebview?.api;if(!native?.configure_whatsapp_desktop)throw Error('Activa este control desde Brivany Desktop.');await native.configure_whatsapp_desktop(remote.checked);await refresh();});
 for(const [connector,label] of [['calendar','Agenda de Google'],['drive','Google Drive'],['gmail','Gmail']]){
  const button=node('button',label);button.type='button';button.className='secondary';google.append(button);
  button.onclick=()=>run(async()=>{await api('/api/integrations/whatsapp-cloud/google',{connector,open_browser:true});status.textContent='Completa la autorización de '+label+' en Google.';});
 }
 card.append(intro,number,status,error,actions,desktop,google);host.append(card);
 window.addEventListener('pagehide',()=>{if(poll)clearInterval(poll);});
 return{refresh};
}
