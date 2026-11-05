/** Private own-chat request inbox. A message is never an account approval. */
export function mountChatRequests(container,{api,onReview}) {
  const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  const heading=node('h2','Del chat, a tu día.'),copy=node('p','Las solicitudes de tu WhatsApp propio se revisan aquí antes de ejecutarse.');copy.className='quiet';
  const optLabel=node('label');optLabel.className='check';const enabled=node('input');enabled.type='checkbox';enabled.dataset.chatRequestsEnabled='true';optLabel.append(enabled,document.createTextNode('Preparar solicitudes desde mi chat propio autorizado.'));
  const status=node('p');status.className='quiet';status.setAttribute('role','status');const error=node('p');error.className='personal-error';error.hidden=true;error.setAttribute('role','alert');
  const refreshButton=node('button','Actualizar solicitudes');refreshButton.type='button';refreshButton.className='secondary';refreshButton.dataset.chatRequestsRefresh='true';
  const help=node('details');help.className='setup';help.append(node('summary','Cómo preparar una solicitud'));
  help.append(node('p','Ejemplos: /nota Visita | Preguntar por las ventanas, /drive plano, /gmail factura o /recordatorio 2026-10-30T09:00:00-04:00 | Visitar la casa. Usa una fecha con zona horaria.'));
  const guide=node('p','El receptor debe estar configurado e iniciado con solicitudes habilitadas. Los recordatorios creados aquí avisan en Brivany abierto; el envío programado por WhatsApp sigue pendiente.');guide.className='quiet';help.append(guide);
  const list=node('ul');list.className='personal-notes-list';list.dataset.chatRequestsList='true';
  container.replaceChildren(heading,copy,optLabel,refreshButton,status,error,help,list);let busy=false;
  async function run(action){if(busy)return;busy=true;error.hidden=true;try{await action();}catch(exception){error.textContent=exception.message;error.hidden=false;}finally{busy=false;}}
  function actionButton(title,action){const button=node('button',title);button.type='button';button.className='text';button.addEventListener('click',()=>run(action));return button;}
  async function refresh(){const [state,pending]=await Promise.all([api('/api/integrations/status'),api('/api/integrations/chat/requests')]);enabled.checked=state.settings.chat_requests_enabled===true;list.replaceChildren();
    for(const item of pending.items){
      const row=node('li');row.className='personal-note';row.dataset.chatRequestId=item.id;
      const names={'reminder.create':'Recordatorio en Brivany abierto','note.create':'Nota privada','calendar.list':'Consultar agenda','calendar.create':'Crear evento','drive.search':'Buscar en Drive','gmail.search':'Buscar en Gmail','gmail.draft':'Borrador de correo'};
      row.append(node('strong',names[item.action.operation] || 'Solicitud del chat'));
      const labels={text:'Texto',at:'Fecha',title:'Título',body:'Mensaje',start:'Inicio',end:'Final',query:'Búsqueda',to:'Destinatario',subject:'Asunto'};
      for(const [key,value] of Object.entries(item.action.parameters))if(key!=='channel')row.append(node('p',(labels[key] || key)+': '+value));
      const state=node('p',item.state==='pending'?'Pendiente de tu revisión.':'Resultado sin confirmar. No se repetirá automáticamente.');state.className='quiet';row.append(state);
      if(item.state==='pending'){
        const review=node('div');review.hidden=true;
        review.append(node('p','Revisa los datos anteriores. Esta acción se guardará en este equipo.'));
        review.append(actionButton('Confirmar y guardar',async()=>{
          const result=await api('/api/integrations/chat/requests/'+item.id+'/execute-local',{expected_revision:item.revision,action_sha256:item.action_sha256,execute:true});
          await refresh();status.textContent=result.request.state==='completed'?'Guardado en este equipo.':'Resultado sin confirmar; no se repetirá.';
        }),actionButton('Volver',async()=>{review.hidden=true;}));row.append(review);
        row.append(actionButton('Revisar solicitud',async()=>{
          if(item.action.kind==='personal'){review.hidden=false;return;}
          const proposal=await api('/api/integrations/chat/requests/'+item.id+'/propose',{expected_revision:item.revision,action_sha256:item.action_sha256});
          const result=await onReview(proposal);
          if(result)await api('/api/integrations/chat/requests/'+item.id+'/settle',{expected_revision:item.revision});
          await refresh();
        }),actionButton('Descartar',async()=>{await api('/api/integrations/chat/requests/'+item.id+'/dismiss',{expected_revision:item.revision});await refresh();status.textContent='Solicitud descartada.';}));
      }
      list.append(row);
    }
    if(!pending.items.length)list.append(node('li','Aún no hay solicitudes pendientes del chat.'));
  }
  enabled.addEventListener('change',()=>run(async()=>{await api('/api/integrations/settings',{chat_requests_enabled:enabled.checked});await refresh();status.textContent=enabled.checked?'Preparación habilitada para tu chat propio. El receptor aún requiere configuración.':'Preparación del chat deshabilitada.';}));
  refreshButton.addEventListener('click',()=>run(refresh));run(refresh);return {refresh};
}
