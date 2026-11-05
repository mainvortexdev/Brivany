/** Private local reminders/notes. Reading never starts a delivery worker. */
export function mountReminders(container,{api,onPrepareWhatsApp=null}={}){
  if(!container || typeof api!=='function')throw Error('Falta el contenedor o la API de recordatorios.');
  let disposed=false,busy=false,notificationsEnabled=false,snoozed=null,notes=[],reminders=[];
  const notified=new Set(),timers=new Set(),notifications=new Set();
  const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  const heading=node('h2','Lo que no quieres olvidar.'),description=node('p','Se guarda en este equipo. Los avisos locales requieren Brivany abierto.');description.className='quiet';
  const notice=node('p');notice.className='quiet';notice.setAttribute('role','status');notice.dataset.personalNotice='true';
  const error=node('p');error.className='personal-error';error.setAttribute('role','alert');error.hidden=true;
  const toolbar=node('div');toolbar.className='personal-toolbar';
  const check=node('button','Comprobar avisos');check.type='button';check.className='secondary';check.dataset.personalCheck='true';
  const notify=node('button','Avisarme aquí');notify.type='button';notify.className='text';
  toolbar.append(check,notify);const list=node('ul');list.className='personal-reminders-list';list.dataset.personalReminders='true';
  const form=node('form');form.dataset.personalReminderForm='true';
  function field(parent,title,type,maximum){const label=node('label',title),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;if(maximum)input.maxLength=maximum;label.append(input);parent.append(label);return input;}
  const text=field(form,'Recordatorio','text',1000);text.required=true;text.dataset.reminderText='true';
  const at=field(form,'Cuándo · hora de este dispositivo','datetime-local');at.required=true;at.dataset.reminderAt='true';
  const channelLabel=node('label','Dónde'),channel=node('select');channel.dataset.reminderChannel='true';
  for(const [value,title] of [['local','En Brivany abierto'],['whatsapp','En mi WhatsApp']]){const option=node('option',title);option.value=value;channel.append(option);}channelLabel.append(channel);form.append(channelLabel);
  const consentLabel=node('label');consentLabel.className='check';consentLabel.hidden=true;
  const consent=node('input');consent.type='checkbox';consentLabel.append(consent,document.createTextNode('Programar este aviso para mi chat propio autorizado. Su envío requiere el receptor configurado y una ventana WhatsApp vigente.'));form.append(consentLabel);
  const submit=node('button','Guardar recordatorio');submit.type='submit';submit.className='primary';form.append(submit);
  const snoozeForm=node('form');snoozeForm.hidden=true;snoozeForm.dataset.personalSnoozeForm='true';
  const snoozeHeading=node('p','Posponer recordatorio');snoozeForm.append(snoozeHeading);const snoozeAt=field(snoozeForm,'Nueva fecha · hora de este dispositivo','datetime-local');snoozeAt.required=true;
  const snoozeSave=node('button','Guardar nueva fecha');snoozeSave.type='submit';snoozeSave.className='secondary';const snoozeCancel=node('button','Volver');snoozeCancel.type='button';snoozeCancel.className='text';snoozeForm.append(snoozeSave,snoozeCancel);
  const noteDetails=node('details');noteDetails.className='setup';noteDetails.append(node('summary','Tus notas y tu cocina'));
  const noteActions=node('div');noteActions.className='personal-toolbar';
  const saveShopping=node('button','Anotar lista de compras');saveShopping.type='button';saveShopping.className='secondary';saveShopping.dataset.personalCaptureShopping='true';
  noteActions.append(saveShopping);noteDetails.append(noteActions);
  const noteList=node('ul');noteList.className='personal-notes-list';noteList.dataset.personalNotes='true';noteDetails.append(noteList);
  const noteForm=node('form');noteForm.dataset.personalNoteForm='true';const noteTitle=field(noteForm,'Título','text',120),noteBody=field(noteForm,'Tu nota','textarea',4000);noteTitle.required=true;noteBody.required=true;
  const noteSave=node('button','Guardar nota');noteSave.type='submit';noteSave.className='secondary';noteForm.append(noteSave);noteDetails.append(noteForm);
  container.replaceChildren(heading,description,notice,error,toolbar,list,form,snoozeForm,noteDetails);
  const message=value=>{notice.textContent=value;};
  async function run(action){if(busy || disposed)return;busy=true;error.hidden=true;try{await action();}catch(exception){error.hidden=false;error.textContent=exception.message || 'No se pudo guardar el cambio.';}finally{busy=false;}}
  const date=value=>new Date(value).toLocaleString('es');
  const states={scheduled:'Programado',local_due:'Pendiente aquí',delivering:'Envío en curso o sin confirmar',accepted_delivery_pending:'Aceptado por WhatsApp · entrega pendiente',accepted_test_stub:'Aceptación simulada de prueba',delivery_blocked:'Envío bloqueado · revisa configuración',uncertain:'Resultado sin confirmar · no se repetirá',completed:'Completado',cancelled:'Cancelado'};
  function actionButton(title,callback){const button=node('button',title);button.type='button';button.className='text';button.addEventListener('click',()=>run(callback));return button;}
  function maybeNotify(item){
    if(!notificationsEnabled || item.channel!=='local' || !['scheduled','local_due'].includes(item.state) || item.due_at_epoch>Date.now()/1000)return;
    const identity=item.id+':'+item.generation;if(notified.has(identity))return;
    notified.add(identity);if(notified.size>500)notified.delete(notified.values().next().value);
    try{const notification=new Notification('Melodi · Recordatorio',{body:item.text,tag:'brivany-reminder-'+item.id});notifications.add(notification);const timer=setTimeout(()=>{notification.close();notifications.delete(notification);timers.delete(timer);},20000);timers.add(timer);}catch{notificationsEnabled=false;message('Este dispositivo no pudo mostrar el aviso. El recordatorio sigue en la lista.');}
  }
  function renderReminders(){
    list.replaceChildren();
    if(!reminders.length){list.append(node('li','Aún no hay recordatorios activos.'));return;}
    for(const item of reminders){
      const row=node('li');row.className='personal-reminder';row.dataset.reminderId=item.id;const title=node('strong',item.text),summary=node('p',(item.state==='scheduled' && item.due_at_epoch<=Date.now()/1000 && item.channel==='local'?'Pendiente aquí':states[item.state] || 'Por revisar')+' · '+date(item.at)+' · '+(item.channel==='local'?'Este equipo':'WhatsApp'));summary.className='quiet';
      row.append(title,summary);const actions=node('div');actions.className='personal-toolbar';
      actions.append(actionButton('Hecho',async()=>{await api('/api/personal/reminders/'+item.id+'/complete',{expected_revision:item.revision});await refresh();message('Recordatorio marcado como completado por ti.');}));
      if(['scheduled','local_due','delivery_blocked'].includes(item.state))actions.append(actionButton('Posponer',async()=>{snoozed=item;snoozeHeading.textContent='Posponer: '+item.text;const next=new Date(Date.now()+15*60000);snoozeAt.value=new Date(next.getTime()-next.getTimezoneOffset()*60000).toISOString().slice(0,16);snoozeForm.hidden=false;snoozeAt.focus();}));
      actions.append(actionButton('Cancelar',async()=>{await api('/api/personal/reminders/'+item.id+'/cancel',{expected_revision:item.revision});await refresh();message('Recordatorio cancelado. Un envío que ya empezó puede quedar sin confirmar.');}));row.append(actions);list.append(row);maybeNotify(item);
    }
  }
  function renderNotes(){
    noteList.replaceChildren();
    if(!notes.length){noteList.append(node('li','Tus notas aparecerán aquí.'));return;}
    for(const item of notes){const row=node('li');row.className='personal-note';row.dataset.noteId=item.id;row.append(node('strong',item.title));const body=node('pre',item.body);row.append(body);const actions=node('div');actions.className='personal-toolbar';
      if(typeof onPrepareWhatsApp==='function')actions.append(actionButton('Revisar para WhatsApp',async()=>{await onPrepareWhatsApp(item.body);message('Texto preparado para revisión. Todavía no se ha enviado.');}));
      actions.append(actionButton('Archivar',async()=>{await api('/api/personal/notes/'+item.id+'/archive',{expected_revision:item.revision});await refresh();message('Nota archivada en este equipo.');}));row.append(actions);noteList.append(row);}
  }
  async function refresh(){if(disposed)return;const [nextReminders,nextNotes]=await Promise.all([api('/api/personal/reminders'),api('/api/personal/notes')]);if(disposed)return;reminders=nextReminders.items || [];notes=nextNotes.items || [];renderReminders();renderNotes();}
  channel.addEventListener('change',()=>{consentLabel.hidden=channel.value!=='whatsapp';if(channel.value!=='whatsapp')consent.checked=false;});
  form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{const value={text:text.value.trim(),at:new Date(at.value).toISOString(),channel:channel.value};if(channel.value==='whatsapp'){if(!consent.checked)throw Error('Confirma este aviso para tu chat propio.');value.delivery_authorized=true;}await api('/api/personal/reminders',value);form.reset();consentLabel.hidden=true;await refresh();message('Recordatorio guardado. El aviso local requiere que Brivany esté abierto.');});});
  snoozeCancel.addEventListener('click',()=>{snoozed=null;snoozeForm.hidden=true;});
  snoozeForm.addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!snoozed)return;await api('/api/personal/reminders/'+snoozed.id+'/snooze',{expected_revision:snoozed.revision,at:new Date(snoozeAt.value).toISOString()});snoozed=null;snoozeForm.hidden=true;await refresh();message('Nueva fecha guardada.');});});
  check.addEventListener('click',()=>run(async()=>{await api('/api/personal/check-due',{});await refresh();message('Avisos comprobados. La aceptación por WhatsApp no confirma entrega.');}));
  notify.addEventListener('click',()=>run(async()=>{if(!('Notification' in window))throw Error('Este navegador no ofrece notificaciones. La lista local sigue disponible.');const permission=await Notification.requestPermission();notificationsEnabled=permission==='granted';message(notificationsEnabled?'Avisos habilitados mientras esta página permanezca abierta.':'Sin permiso para notificaciones; los avisos siguen en la lista.');if(notificationsEnabled)renderReminders();}));
  noteForm.addEventListener('submit',event=>{event.preventDefault();run(async()=>{await api('/api/personal/notes',{expected_revision:0,title:noteTitle.value.trim(),body:noteBody.value.trim()});noteForm.reset();await refresh();message('Nota guardada en este equipo.');});});
  saveShopping.addEventListener('click',()=>run(async()=>{await api('/api/personal/notes/from-sous',{kind:'shopping',explicit:true});await refresh();message('Lista de compras anotada. Revísala antes de enviarla o comprar.');}));
  const interval=setInterval(()=>{if(!busy && !disposed)run(refresh);},15000);
  function dispose(){disposed=true;notificationsEnabled=false;clearInterval(interval);for(const timer of timers)clearTimeout(timer);timers.clear();for(const notification of notifications)notification.close();notifications.clear();}
  window.addEventListener('pagehide',dispose,{once:true});run(refresh);
  return {refresh,dispose};
}
