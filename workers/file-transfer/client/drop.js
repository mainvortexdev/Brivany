(() => {
 'use strict';const t=window.BrivanyDropText||(value=>value),$=id=>document.getElementById(id),{DropPeer,MAX,nameOK}=window.BrivanyDropPeer;let peer,worker,sequence=0,pendingAccept=null,wake=null,urls=[];const pending=new Map(),parts=location.hash.slice(1).split('.');let [id,claim,key]=parts;parts.fill('');history.replaceState(null,'',location.pathname+location.search);
 const size=bytes=>bytes>=1024**3?(bytes/1024**3).toFixed(1)+' GB':bytes>=1024**2?(bytes/1024**2).toFixed(1)+' MB':bytes>=1024?(bytes/1024).toFixed(1)+' KB':bytes+' B';
 const error=message=>{$('status').dataset.error='true';$('status').textContent=t(message)};
 const storageError=(code='storage_failed')=>Object.assign(Error(window.BrivanyDropPeer.failures[code]||window.BrivanyDropPeer.failures.storage_failed),{code,storageFailure:true});
 function resetDisk(error){worker?.terminate();worker=null;for(const item of pending.values()){clearTimeout(item.timer);item.reject(error)}pending.clear()}
 const disk=(op,meta,extra={},transfer=[])=>new Promise((resolve,reject)=>{try{
  if(!worker){worker=new Worker('/transfer/drop/storage-worker.js');worker.onmessage=event=>{const item=pending.get(event.data.request);if(!item)return;pending.delete(event.data.request);clearTimeout(item.timer);event.data.error?item.reject(storageError(event.data.code)):item.resolve(event.data.value)};worker.onerror=event=>{event.preventDefault();resetDisk(storageError('storage_unavailable'))};worker.onmessageerror=()=>resetDisk(storageError())}
  const request=++sequence,timer=setTimeout(()=>resetDisk(storageError('storage_timeout')),30000);pending.set(request,{resolve,reject,timer});worker.postMessage({request,op,id:meta.id,...extra},transfer);
 }catch{resetDisk(storageError('storage_unavailable'));reject(storageError('storage_unavailable'))}});
 // A README/photo must still work in an iPhone QR preview that restricts OPFS.
 // This fallback is deliberately bounded; large files always use disk storage.
 function memorySink(meta){let chunks=[],offset=0;return {offset:0,write:async(position,bytes)=>{if(position!==offset||offset+bytes.length>meta.size)throw storageError();chunks.push(bytes.slice());offset+=bytes.length},finish:async()=>{if(offset!==meta.size)throw storageError();const file=new File(chunks,meta.name,{type:'application/octet-stream'});chunks=[];return {file,size:file.size,storage:'memory'}},abort:async()=>{chunks=[]}}}
 async function sink(meta){
  let value;try{value=await disk('open',meta,{size:meta.size})}catch(error){if(meta.size<=16*1024*1024)return memorySink(meta);throw error}
  return {offset:value.offset,write:async(offset,bytes)=>{const copy=bytes.slice().buffer;await disk('write',meta,{offset,data:copy},[copy])},finish:async()=>disk('finish',meta),abort:async()=>disk('abort',meta)};
 }
 function dismiss(){if(pendingAccept){pendingAccept.reject(Object.assign(Error('Cancelado.'),{declined:true}));pendingAccept=null}$('offer').hidden=true}
 const selection=new window.BrivanyEdgeSelection({
  canSend:()=>!!peer?.peerPresent&&!peer.closed&&!peer.tx&&!peer.rx&&!peer.pending,
  preview:(active,count,edge)=>peer?.preview(active,count,edge),error,
  send:async file=>{
   wake=await navigator.wakeLock?.request('screen').catch(()=>null);
   if(!peer?.peerPresent||peer.closed)throw Error(t('La conexión se interrumpió.'));
   peer.offer({id:crypto.randomUUID().replaceAll('-',''),name:file.name,size:file.size},async(offset,length)=>new Uint8Array(await file.slice(offset,offset+length).arrayBuffer()));
  }
 });
 function connected(){delete $('status').dataset.error;$('heading').textContent=t('Conectado a tu PC.');$('send-label').hidden=false;$('disconnect').hidden=false;$('hint').hidden=false;selection.setEnabled(true)}
 function releaseWake(){wake?.release().catch(()=>{});wake=null}
 function received(meta,result){
  const previous=$('save');
  if(previous.hasAttribute('href')){const link=document.createElement('a');link.href=previous.href;link.download=previous.download;link.textContent=previous.download;link.className='received-file';$('received-files').append(link)}
  const url=URL.createObjectURL(result.file);urls.push(url);previous.href=url;previous.download=meta.name;previous.hidden=false;
  while(urls.length>16){URL.revokeObjectURL(urls.shift());$('received-files').firstElementChild?.remove()}
  $('transfer').hidden=true;selection.show(null);selection.render();releaseWake();
 }
 if(!/^[\w-]{22}$/.test(id||'')||!/^[\w-]{43}$/.test(claim||'')||!/^[\w-]{43}$/.test(key||'')){error('El enlace terminó. Genera otro QR en Brivany.');return}
 window.addEventListener('hashchange',()=>{if(location.hash)location.reload()});
 (async()=>{try{
  const response=await fetch('/transfer/drop/api/'+id+'/claim',{method:'POST',headers:{Authorization:'Bearer '+claim},credentials:'same-origin',cache:'no-store'});claim='';if(!response.ok)throw Error('El enlace terminó. Genera otro QR en Brivany.');
  await response.json();
  peer=new DropPeer({id,key,role:'phone',socket:location.origin.replace('https:','wss:')+'/transfer/drop/api/'+id+'/socket',
   onstate:value=>{if(value.state==='connected'&&$('status').dataset.error==='true')return;delete $('status').dataset.error;if(['connected','sending','receiving','sent','received'].includes(value.state))connected();else selection.setEnabled(false);if(['failed','declined'].includes(value.state)){selection.stop();selection.setEnabled(!!peer?.peerPresent)}if(value.failure){error(window.BrivanyDropPeer.failures[value.failure]);return}if(!['sending','receiving'].includes(value.state))$('status').textContent=t(({connecting:'Conectando…',waiting:'Esperando al PC…',reconnecting:'Reconectando…',connected:'Listo para enviar o recibir.',sent:'Archivo enviado.',received:'Archivo recibido.',declined:'Envío cancelado.',failed:'La conexión se interrumpió.'})[value.state]||'')},
   onedge:value=>selection.remote(value),
   accept:meta=>new Promise((resolve,reject)=>{dismiss();delete $('status').dataset.error;$('save').hidden=true;$('status').textContent=t('Archivo listo para recibir.');$('offer-name').textContent=meta.name;$('offer-size').textContent=size(meta.size);$('offer').hidden=false;pendingAccept={resolve,reject,meta};selection.reset();selection.show('left',t('Archivos listos para recibir.'));selection.render()}),
   ondismiss:()=>dismiss(),
   onprogress:value=>{$('transfer').hidden=false;$('file-name').textContent=value.name;$('progress').value=value.size?value.done/value.size:1;$('amount').textContent=Math.floor((value.size?value.done/value.size:1)*100)+'% · '+size(value.done)+' / '+size(value.size);$('status').textContent=t(value.direction==='sending'?'Enviando…':'Recibiendo…');selection.show(value.direction==='sending'?'right':'left',t(value.direction==='sending'?'Enviando…':'Recibiendo…'));selection.render()},
   onreceived:received,
   onsent:()=>{$('transfer').hidden=true;selection.show(null);releaseWake();queueMicrotask(()=>selection.next())},
   oncancel:()=>{$('transfer').hidden=true;dismiss();selection.stop();releaseWake()},
   onended:()=>{dismiss();selection.stop();selection.setEnabled(false);releaseWake();$('send-label').hidden=true;$('disconnect').hidden=true;$('hint').hidden=true;$('heading').textContent=t('Transferencia terminada.');$('status').textContent=t('Genera otro QR en Brivany para conectar.')},
   onerror:message=>{$('transfer').hidden=true;selection.stop();releaseWake();error(message)}
  });key='';peer.start();
 }catch(value){error(value.message||'No se pudo conectar con Brivany.')}})();
 $('accept').onclick=async()=>{if(!pendingAccept)return;const item=pendingAccept;pendingAccept=null;$('offer').hidden=true;$('status').textContent=t('Preparando recepción…');try{wake=await navigator.wakeLock?.request('screen').catch(()=>null);item.resolve(await sink(item.meta))}catch(value){item.reject(value)}};
 $('decline').onclick=dismiss;
 $('send-file').onchange=()=>{const files=[...$('send-file').files];$('send-file').value='';try{selection.stage(files)}catch(value){error(value.message)}};
 $('cancel-file').onclick=()=>{selection.stop();peer?.cancelCurrent()};
 $('disconnect').onclick=async()=>{selection.stop();selection.setEnabled(false);peer?.close();dismiss();releaseWake();await fetch('/transfer/drop/api/'+id,{method:'DELETE',credentials:'same-origin',cache:'no-store',keepalive:true}).catch(()=>{});$('heading').textContent=t('Transferencia terminada.');$('status').textContent=t('Puedes cerrar esta pantalla.');$('disconnect').hidden=true;$('send-label').hidden=true;$('hint').hidden=true};
 window.addEventListener('pagehide',()=>{selection.dispose();peer?.close();releaseWake();for(const url of urls)URL.revokeObjectURL(url);worker?.terminate()},{once:true});
})();
