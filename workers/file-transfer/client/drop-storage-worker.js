/* Disk-backed receiving for Safari/Chromium. No whole-file ArrayBuffer or Blob assembly. */
'use strict';
const MAX=1024**3,BLOCK=256*1024;let directory;const files=new Map();
async function root(){
 if(directory)return directory;directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('brivany-drop-v2',{create:true});
 if(directory.entries)for await(const [name,entry] of directory.entries()){
  if(entry.kind==='file'&&/^[a-f0-9]{32}\.part$/.test(name)){try{const file=await entry.getFile();if(Date.now()-file.lastModified>12*3600000)await directory.removeEntry(name)}catch{}}
 }
 return directory;
}
self.onmessage=async event=>{
 const {request,op,id}=event.data;try{
  if(!/^[a-f0-9]{32}$/.test(id||''))throw Error('Archivo no válido.');let item=files.get(id),value;
  if(op==='open'){
   const size=event.data.size;if(!Number.isSafeInteger(size)||size<0||size>MAX)throw Error('El archivo admite hasta 1 GB.');
   if(item){value={offset:item.offset};return self.postMessage({request,value})}
   // Safari may expose OPFS without estimate(). Estimation is advisory and must
   // never prevent an otherwise writable file from being received.
   const quota=await navigator.storage.estimate?.().catch(()=>null);if(Number.isFinite(quota?.quota)&&quota.quota-(quota.usage||0)<size+8*1024*1024)throw Object.assign(Error('No hay espacio suficiente en el teléfono.'),{code:'storage_full'});
   const folder=await root(),handle=await folder.getFileHandle(id+'.part',{create:true});let writer,sync=false;
   if(handle.createSyncAccessHandle){writer=await handle.createSyncAccessHandle();sync=true;await writer.truncate(0)}
   else if(handle.createWritable)writer=await handle.createWritable();
   else throw Object.assign(Error('Abre el enlace en Safari para recibir archivos grandes.'),{code:'storage_unavailable'});
   item={handle,writer,sync,offset:0,size};files.set(id,item);value={offset:0};
  }else if(op==='write'){
   const bytes=new Uint8Array(event.data.data);if(!item||!item.writer||event.data.offset!==item.offset||bytes.length<1||bytes.length>BLOCK||item.offset+bytes.length>item.size)throw Error('El bloque recibido no es válido.');
   if(item.sync){const written=await item.writer.write(bytes,{at:item.offset});if(written!==bytes.length)throw Error('No se pudo guardar el bloque.')}else await item.writer.write({type:'write',position:item.offset,data:bytes});
   item.offset+=bytes.length;value={offset:item.offset};
  }else if(op==='finish'){
   if(!item||!item.writer||item.offset!==item.size)throw Error('El archivo recibido está incompleto.');
   if(item.sync){await item.writer.flush();await item.writer.close()}else await item.writer.close();item.writer=null;const file=await item.handle.getFile();value={file,size:file.size,storage:'opfs'};files.delete(id);
  }else if(op==='abort'){
   if(item?.writer){if(item.sync)await item.writer.close();else await item.writer.abort()}files.delete(id);await (await root()).removeEntry(id+'.part').catch(()=>{});value={cancelled:true};
  }else throw Error('Operación no válida.');
  self.postMessage({request,value});
 }catch(error){const code=error.code==='storage_full'||error.name==='QuotaExceededError'?'storage_full':error.code==='storage_unavailable'||['NotAllowedError','SecurityError','NotSupportedError','TypeError'].includes(error.name)?'storage_unavailable':'storage_failed';self.postMessage({request,error:true,code})}
};
