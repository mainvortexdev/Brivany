const $=selector=>document.querySelector(selector);
const states={queued:'Preparando',creating:'Conectando',scheduled:'Programada',joining:'Entrando',waiting:'En sala de espera',joined:'Dentro · sin grabar',permission_denied:'Permiso denegado',recording:'Grabando',processing:'Finalizando',ended:'Terminada · sin transcripción',transcribing:'Transcribiendo',ready:'Transcripción lista',failed:'No se pudo completar',cancelled:'Cancelada',uncertain:'Comprobando lanzamiento'};
const ended=new Set(['ready','failed','cancelled','ended']);
let meetings=[],calendar=[],busy=false,refreshing=false,calendarLoaded=false,pendingRequest=null,detailId=null,nextPart=null,transcript=[],detailVersion=0;
const date=value=>value?new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Entrada inmediata';
const showError=message=>{$('#error').textContent=message||'';$('#error').hidden=!message;};
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
async function api(action,body,query=''){
 const response=await fetch('/api/integrations/meetings/'+action+query,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const result=await response.json();if(!response.ok)throw Error(result.error?.message||result.error||'No se pudo conectar con Reuniones.');return result;
}
async function refresh({silent=false}={}){
 if(refreshing)return;refreshing=true;
 try{const result=await api('list');meetings=result.meetings;renderMeetings();$('#notice').textContent='Melodi · Conectada a tus reuniones';if(!silent)showError('');}
 catch(error){showError(error.message);$('#notice').textContent='Revisa tu conexión o tu Cuenta Vetsa en Ajustes.';}
 finally{refreshing=false;}
}
function renderMeetings(){
 const list=$('#meetings');const old=new Map([...list.children].map(el=>[el.dataset.id,el]));
 if(!meetings.length){list.replaceChildren(node('p','Aquí aparecerán las reuniones que envíes a Melodi.','empty'));return;}
 const order=[];
 for(const item of meetings){
  const version=JSON.stringify(item);let row=old.get(item.id);
  if(!row||row.dataset.version!==version){
   row=node('article',undefined,'meeting-row');row.dataset.id=item.id;row.dataset.version=version;
   const copy=node('div',undefined,'row-copy'),title=node('h3',item.title);copy.append(title,node('p',date(item.joinAt)+(item.source==='calendar'?' · Calendar':'')));
   if(item.error)copy.append(node('p',item.error,'error'));
   const state=node('span',states[item.status]||'Actualizando','state '+(item.status==='ready'?'ready':item.status==='failed'?'failed':ended.has(item.status)?'':'active'));
   const actions=node('div',undefined,'row-actions');actions.append(state);
   if(item.transcriptAvailable){const button=node('button','Leer transcripción','quiet-button');button.type='button';button.onclick=()=>openTranscript(item);actions.append(button);}
   if(!ended.has(item.status)){const button=node('button',['recording','joined','waiting','permission_denied'].includes(item.status)?'Retirar a Melodi':'Cancelar','quiet-button');button.type='button';button.onclick=()=>cancelMeeting(item.id,button);actions.append(button);}
   row.append(copy,actions);
  }
  order.push(row);
 }
 const keep=new Set(order);for(const child of [...list.children])if(!keep.has(child))child.remove();
 order.forEach((row,index)=>{if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);});
}
async function cancelMeeting(id,button){button.disabled=true;showError('');try{await api('cancel',{id});await refresh({silent:true});if(calendarLoaded)await loadCalendar();}catch(error){showError(error.message);}finally{button.disabled=false;}}
$('#when').onchange=()=>{const later=$('#when').value==='later';$('#date-field').hidden=!later;$('#join-at').required=later;$('#launch').textContent=later?'Programar a Melodi':'Enviar a Melodi';};
$('#launch-form').onsubmit=async event=>{
 event.preventDefault();if(busy)return;busy=true;$('#launch').disabled=true;showError('');
 try{
  const joinAt=$('#when').value==='later'?new Date($('#join-at').value).toISOString():null;
  const payload={meetingUrl:$('#meeting-url').value.trim(),title:$('#meeting-title').value.trim(),joinAt,consent:$('#consent').checked,interactive:$('#interactive').checked};
  const fingerprint=JSON.stringify(payload);if(!pendingRequest||pendingRequest.fingerprint!==fingerprint)pendingRequest={fingerprint,id:crypto.randomUUID()};
  const result=await api('launch',{...payload,requestId:pendingRequest.id});
  pendingRequest=null;$('#launch-form').reset();$('#when').onchange();meetings=[result.meeting,...meetings.filter(m=>m.id!==result.meeting.id)];renderMeetings();$('#notice').textContent='Solicitud recibida. El estado se actualizará aquí.';
 }catch(error){showError(error.message==='Invalid time value'?'Elige una fecha y hora válidas.':error.message);}
 finally{busy=false;$('#launch').disabled=false;}
};
async function loadCalendar(){
 $('#load-calendar').disabled=true;showError('');
 try{const result=await api('calendar');calendar=result.events;calendarLoaded=true;$('#calendar-note').textContent=result.calendarName+' · Próximos 90 días · Solo eventos seleccionados';renderCalendar();}
 catch(error){showError(error.message);}finally{$('#load-calendar').disabled=false;}
}
function renderCalendar(){
 const list=$('#calendar-events');list.replaceChildren();
 if(!calendar.length){list.append(node('p','No hay eventos en este calendario durante los próximos 90 días.','empty'));return;}
 for(const item of calendar){
  const label=node('label',undefined,'calendar-row'),check=document.createElement('input');check.type='checkbox';check.checked=item.selected;check.disabled=!item.eligible&&!item.selected;check.setAttribute('aria-label','Enviar a Melodi a '+item.title);
  const copy=node('span',item.title);copy.append(node('small',date(item.startAt)+(!item.meetingUrl?' · Sin enlace de Meet o Zoom':!item.eligible?' · Fuera del horario permitido':'')));label.append(check,copy);list.append(label);
  check.onchange=async()=>{const selected=check.checked;check.disabled=true;showError('');
   try{if(selected)await api('schedule',{requestId:crypto.randomUUID(),eventId:item.id,consent:true});else if(item.meetingId)await api('cancel',{id:item.meetingId});await Promise.all([refresh({silent:true}),loadCalendar()]);}
   catch(error){check.checked=!selected;check.disabled=false;showError(error.message);}
  };
 }
}
async function openTranscript(item){
 detailId=item.id;transcript=[];nextPart=0;detailVersion++;$('#transcript-title').textContent=item.title;$('#transcript-body').replaceChildren();$('#transcript-error').hidden=true;$('#transcript-dialog').showModal();await readPart(detailVersion);
}
async function readPart(version){
 if(nextPart===null)return;$('#more-transcript').disabled=true;$('#download-transcript').disabled=true;
 try{const result=await api('detail',undefined,'?'+new URLSearchParams({id:detailId,part:String(nextPart)}));if(version!==detailVersion)return;
  transcript.push(...result.transcript);nextPart=result.nextPart;
  if(!$('#meeting-summary')&&result.summary){const summary=node('section',undefined,'meeting-summary');summary.id='meeting-summary';summary.append(node('h3','Resumen'),node('p',result.summary.overview));for(const [key,label]of [['decisions','Acuerdos'],['actions','Próximos pasos'],['openQuestions','Preguntas abiertas']]){const items=result.summary[key];if(items?.length){summary.append(node('h3',label));const list=node('ul');for(const item of items)list.append(node('li',typeof item==='string'?item:item.text+(item.owner?' · '+item.owner:'')+(item.due?' · '+item.due:'')));summary.append(list);}}$('#transcript-body').prepend(summary);}
  for(const line of result.transcript){const row=node('div',undefined,'utterance'),heading=node('h3',line.speaker);const stamp=Math.floor(line.start||0);heading.append(node('time',Math.floor(stamp/60)+':'+String(stamp%60).padStart(2,'0')));row.append(heading,node('p',line.text));$('#transcript-body').append(row);}
  if(!transcript.length)$('#transcript-body').append(node('p','No se detectó conversación en la grabación.','empty'));
  $('#more-transcript').hidden=nextPart===null;
 }catch(error){if(version===detailVersion){$('#transcript-error').textContent=error.message;$('#transcript-error').hidden=false;}}
 finally{$('#more-transcript').disabled=false;$('#download-transcript').disabled=false;}
}
$('#more-transcript').onclick=()=>readPart(detailVersion);
$('#close-transcript').onclick=()=>$('#transcript-dialog').close();$('#transcript-dialog').addEventListener('close',()=>{detailVersion++;detailId=null;});
$('#download-transcript').onclick=async()=>{
 const version=detailVersion;$('#download-transcript').disabled=true;
 try{while(nextPart!==null&&version===detailVersion){const previous=nextPart;await readPart(version);if(nextPart===previous)throw Error('No se pudo completar la descarga. Vuelve a intentarlo.');}
  if(version!==detailVersion)return;
  const file=new Blob([$('#transcript-title').textContent+'\n\n'+transcript.map(line=>line.speaker+' ['+Math.floor(line.start/60)+':'+String(Math.floor(line.start%60)).padStart(2,'0')+']\n'+line.text).join('\n\n')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='Brivany - Transcripción.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }catch(error){$('#transcript-error').textContent=error.message;$('#transcript-error').hidden=false;}finally{$('#download-transcript').disabled=false;}
};
$('#refresh').onclick=()=>refresh();$('#load-calendar').onclick=loadCalendar;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});
setInterval(()=>{if(!document.hidden&&!busy&&meetings.some(item=>!ended.has(item.status)))refresh({silent:true});},6000);
refresh();
