/* Compact pairing, consent and progress UI. Transport and file bytes stay off the chat. */
(() => {
 // The native bar and floating panel share state. Only the panel owns the
 // peer connection; otherwise their two sockets would replace each other.
 if(new URLSearchParams(location.search).get('surface')==='bar')return;
 'use strict';const mount=document.querySelector('#workspace-files'),panel=mount?.querySelector('.shelf-phone');if(!panel||!window.BrivanyDropPeer)return;
 const t=value=>window.BrivanyWorkspaceLocale?.text(value)||value,{DropPeer,unbase}=window.BrivanyDropPeer;
 const controls=document.createElement('div');controls.className='drop-controls';controls.hidden=true;
 controls.innerHTML='<div id="drop-device" hidden><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="3" width="14" height="26" rx="3"/><path d="M14 7h4m-3 17h2"/></svg><span>Teléfono conectado</span></div><div id="drop-offer" hidden><strong id="drop-offer-name"></strong><small id="drop-offer-size"></small><div class="drop-actions"><button id="drop-decline">Rechazar</button><button id="drop-accept" class="drop-primary">Recibir</button></div></div><div id="drop-transfer" hidden><strong id="drop-name"></strong><progress id="drop-progress" max="1" value="0"></progress><div class="drop-progress-meta"><span id="drop-amount"></span><button id="drop-cancel" aria-label="Cancelar archivo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div></div><div class="drop-actions"><button id="drop-send" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Enviar archivo</button><button id="drop-reveal" hidden>Ruta del archivo</button></div>';
 panel.append(controls);const pair=document.createElement('button');pair.className='shelf-pair';pair.type='button';pair.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/></svg><span>Conectar teléfono</span>';mount.append(pair);window.BrivanyWorkspaceLocale?.mount(controls);window.BrivanyWorkspaceLocale?.mount(pair);
 const $=selector=>controls.querySelector(selector),native=(method,...args)=>{const fn=window.pywebview?.api?.[method];if(!fn)throw Error('Abre Brivany Desktop para usar la transferencia.');return fn(...args)};
 let peer,session,offered,accepting,saved,lastNative=0,connected=false,failed=false,advancing=false,approvedBatch=null;
 const queueLabel=document.createElement('small');queueLabel.id='drop-queue';queueLabel.hidden=true;queueLabel.setAttribute('role','status');controls.prepend(queueLabel);
 const format=bytes=>bytes>=1000**3?(bytes/1000**3).toFixed(1)+' GB':bytes>=1000**2?(bytes/1000**2).toFixed(1)+' MB':bytes>=1000?(bytes/1000).toFixed(1)+' KB':bytes+' B';
 const base64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result)};
 function feedback(message){const target=panel.querySelector('#phone-state');if(target)target.textContent=t(message)}
 function refreshSelection(){const selected=window.BrivanyWorkspaceFiles?.selected?.(),file=peer?.tx?.meta||peer?.rx?.meta||selected;$('#drop-send').lastChild.textContent=t(selected?'Enviar':'Enviar archivo');$('#drop-send').title=selected?.name||'';if(session){const title=panel.querySelector('#phone-file-name');if(title)title.textContent=file?.name||t('Conectar teléfono')}}
 function dismiss(){if(accepting){accepting.reject(Object.assign(Error('Cancelado.'),{declined:true}));accepting=null}$('#drop-offer').hidden=true}
 function update(state,extra={}){if(!session)return;native('workspace_phone_update',session.id,{state,...extra}).catch(()=>{})}
 function edge(state='idle',edge='right'){if(session)native('workspace_phone_edge',session.id,{state,edge}).catch(()=>{})}
 function clearQueue(){if(session)native('workspace_phone_cancel_queue',session.id).catch(()=>{})}
 function dispose(){approvedBatch=null;edge();peer?.close();peer=null;session=null;offered=null;connected=false;failed=false;advancing=false;dismiss();controls.hidden=true;$('#drop-device').hidden=true;$('#drop-transfer').hidden=true;$('#drop-send').hidden=true;$('#drop-reveal').hidden=true;queueLabel.hidden=true}
 async function writer(meta){
  const value=await native('workspace_phone_receive_begin',session.id,meta),id=session.id;
  const local=session.local_url,owner=session.owner;
  return {offset:value.offset,write:async(offset,bytes,digest)=>{
   if(!local)return native('workspace_phone_receive_write',id,meta.id,offset,base64(bytes),digest);
   const response=await fetch(local+'/incoming/'+meta.id+'?offset='+offset,{method:'POST',headers:{Authorization:'Bearer '+owner,'Content-Type':'application/octet-stream','X-Brivany-Block-SHA256':digest},body:bytes,cache:'no-store'});if(!response.ok)throw Error('No se pudo guardar el bloque recibido.');return response.json();
  },finish:async()=>native('workspace_phone_receive_finish',id,meta.id),abort:async()=>native('workspace_phone_receive_abort',id,meta.id)};
 }
 function attach(value){
  pair.hidden=value.active===true;
  if(!value.active||value.state==='cancelling'||value.state==='cancel_pending'){dispose();return}
  if(value.transport!=='drop-v2')return;
  if(!value.session)return;const next=value.session;
  queueLabel.hidden=!(value.queued>1);queueLabel.textContent=t('{count} archivos en cola').replace('{count}',String(value.queued||0));
  if(session?.id!==next.id){
   dispose();session=next;controls.hidden=false;
   peer=new DropPeer({...next,role:'desktop',
    onstate:event=>{
     if(!session)return;
     if(event.state==='connected'&&peer?.peerPresent){connected=true;$('#drop-device').hidden=false;$('#drop-send').hidden=false;$('#drop-send').disabled=!!(peer.tx||peer.rx||peer.pending||advancing);if(!failed&&!peer.tx&&!peer.rx&&!peer.pending&&!advancing)update('connected')}
     if(event.state==='reconnecting'&&connected){edge();feedback('Reconectando…');update('reconnecting')}
     if(['declined','failed'].includes(event.state)){approvedBatch=null;failed=event.state==='failed';$('#drop-send').disabled=false;edge();clearQueue();update(event.state,{failure:event.failure||null})}
    },
    onedge:event=>edge(event.active?'preview':'idle',({left:'right',right:'left',top:'bottom',bottom:'top'})[event.edge]),
    accept:meta=>{if(meta.batch&&approvedBatch===meta.batch.id)return writer(meta);return new Promise((resolve,reject)=>{dismiss();failed=false;update('connected',{offer_pending:true});edge('offer');$('#drop-send').disabled=true;$('#drop-offer-name').textContent=meta.name;$('#drop-offer-size').textContent=format(meta.batch?.total??meta.size);$('#drop-accept').textContent=meta.batch?.count>1?t('Recibir {count} archivos').replace('{count}',String(meta.batch.count)):t('Recibir');$('#drop-offer').hidden=false;$('#drop-reveal').hidden=true;accepting={meta,resolve,reject};window.BrivanyIsland?.expand('files')})},
    ondismiss:dismiss,
    onprogress:event=>{
     failed=false;$('#drop-send').disabled=true;$('#drop-transfer').hidden=false;$('#drop-name').textContent=event.name;$('#drop-progress').value=event.size?event.done/event.size:1;$('#drop-amount').textContent=Math.floor((event.size?event.done/event.size:1)*100)+'% · '+format(event.done)+' / '+format(event.size);feedback(event.direction==='sending'?'Enviando…':'Recibiendo…');
     if(performance.now()-lastNative>250||event.done===event.size){lastNative=performance.now();edge(event.direction);update(event.direction,{progress:event})}
    },
    onsent:async meta=>{
     $('#drop-transfer').hidden=true;edge();feedback('Archivo enviado.');advancing=true;const current=session?.id;
     try{const value=await native('workspace_phone_next',current,meta.id);if(session?.id===current)window.BrivanyWorkspacePhone.receive(value)}catch(error){if(session?.id===current){clearQueue();feedback(error.message)}}finally{if(session?.id===current){advancing=false;$('#drop-send').disabled=!!(peer?.tx||peer?.rx||peer?.pending)}}
    },
    onreceived:(meta)=>{if(meta.batch?.index===meta.batch?.count)approvedBatch=null;saved=meta.id;edge('received');$('#drop-transfer').hidden=true;$('#drop-send').disabled=false;$('#drop-reveal').hidden=false;feedback('Guardado en Descargas/Brivany.');update('received')},
    oncancel:()=>{approvedBatch=null;edge();clearQueue();$('#drop-send').disabled=false;$('#drop-transfer').hidden=true;feedback('Envío cancelado.');update('connected')},
    onended:()=>{feedback('El teléfono se desconectó.');native('workspace_phone_stop').then(result=>window.BrivanyWorkspacePhone.receive(result)).catch(()=>{})},
    onerror:feedback
   });peer.start();
  }
  if(next.source&&offered!==next.source.id){
   failed=false;
   try{const source=next.source,id=next.id;peer.offer(source,async(offset,length)=>{
    if(!next.local_url)return unbase((await native('workspace_phone_read',id,source.id,offset,length)).data);
    const response=await fetch(next.local_url+'/source/'+source.id+'?offset='+offset+'&length='+length,{headers:{Authorization:'Bearer '+next.owner},cache:'no-store'});if(!response.ok)throw Error('No se pudo leer el bloque del archivo.');return new Uint8Array(await response.arrayBuffer());
   });offered=source.id;$('#drop-send').disabled=true;$('#drop-reveal').hidden=true}catch(error){clearQueue();feedback(error.message)}
  }
  refreshSelection();
 }
 pair.onclick=async()=>{pair.disabled=true;try{window.BrivanyWorkspacePhone.receive(await native('workspace_phone_pair',window.BrivanyWorkspaceLocale?.current()||'es'))}catch(error){const target=mount.querySelector('.shelf-status');if(target)target.textContent=error.message}finally{pair.disabled=false}};
 $('#drop-accept').onclick=async()=>{if(!accepting)return;const value=accepting;accepting=null;$('#drop-offer').hidden=true;try{const sink=await writer(value.meta);approvedBatch=value.meta.batch?.id||null;value.resolve(sink)}catch(error){value.reject(error);feedback(error.message)}};
 $('#drop-decline').onclick=dismiss;$('#drop-cancel').onclick=()=>peer?.cancelCurrent();
 $('#drop-send').onclick=async()=>{const button=$('#drop-send');if(button.disabled)return;button.disabled=true;try{let item=window.BrivanyWorkspaceFiles?.selected?.();if(!item){const chosen=await native('workspace_files_choose');window.BrivanyWorkspaceFiles?.receive(chosen);if(chosen.cancelled||chosen.errors?.length)return;item=window.BrivanyWorkspaceFiles?.selected?.()||chosen.items.at(-1)}if(item)await window.BrivanyWorkspacePhone.start(item.id)}catch(error){feedback(error.message)}finally{button.disabled=!!(peer?.tx||peer?.rx||peer?.pending);refreshSelection()}};
 $('#drop-reveal').onclick=()=>{if(saved&&session)native('workspace_phone_reveal_received',session.id,saved).catch(error=>feedback(error.message))};
 window.BrivanyWorkspaceDrop={receive:attach,dispose,notice:feedback,preview:event=>peer?.preview(event.active,event.count,event.edge)};window.addEventListener('brivany-files-selection',refreshSelection);window.addEventListener('brivany-workspace-locale',refreshSelection);window.addEventListener('pagehide',()=>{window.removeEventListener('brivany-files-selection',refreshSelection);window.removeEventListener('brivany-workspace-locale',refreshSelection);dispose()},{once:true});
 native('workspace_phone_state').then(value=>{if(value.transport==='drop-v2')window.BrivanyWorkspacePhone?.receive(value)}).catch(()=>{});
})();
