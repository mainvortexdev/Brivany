// Private, expiring installer distribution in an existing private R2 bucket.
// Provider credentials never occur in this artifact or in its download link.
const PART=16*1024*1024,reply=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
async function sha(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function bounded(request,limit){const reader=request.body?.getReader();if(!reader)throw Error('release_body');let n=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit){await reader.cancel();throw Error('release_limit');}chunks.push(value);}}finally{reader.releaseLock();}const data=new Uint8Array(n);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}return data;}
export async function releaseAdmin(account,request,url){
 if(!account.env.DEMO_RELEASES)throw Error('release_storage_unavailable');
 if(url.pathname==='/admin/release/start'){
  const value=JSON.parse(new TextDecoder().decode(await bounded(request,4096)));
  if(!/^Brivany-Jon-Demo-Setup-\d+\.\d+\.\d+-x64\.exe$/.test(value.name)||!Number.isSafeInteger(value.size)||value.size<1||value.size>1024**3||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('release_metadata');
  let upload=await account.ctx.storage.get('release-upload');
  if(upload){if(upload.sha256!==value.sha256||upload.size!==value.size||upload.name!==value.name)throw Error('release_upload_conflict');}
  else{const key='brivany-demo/jon-20261116/'+value.name,created=await account.env.DEMO_RELEASES.createMultipartUpload(key,{httpMetadata:{contentType:'application/vnd.microsoft.portable-executable'},customMetadata:{sha256:value.sha256}});upload={...value,key,uploadId:created.uploadId,parts:{}};await account.ctx.storage.put('release-upload',upload);}
  return reply({part_bytes:PART,uploaded_parts:Object.keys(upload.parts).map(Number)});
 }
 const upload=await account.ctx.storage.get('release-upload');if(!upload)throw Error('release_upload_missing');
 if(url.pathname==='/admin/release/part'){
  const part=Number(url.searchParams.get('part')),count=Math.ceil(upload.size/PART);if(!Number.isInteger(part)||part<1||part>count)throw Error('release_part');
  const size=Math.min(PART,upload.size-(part-1)*PART);if(Number(request.headers.get('Content-Length'))!==size)throw Error('release_part_size');
  const bytes=await bounded(request,size);if(bytes.length!==size)throw Error('release_part_size');
  const result=await account.env.DEMO_RELEASES.resumeMultipartUpload(upload.key,upload.uploadId).uploadPart(part,bytes);upload.parts[part]=result;await account.ctx.storage.put('release-upload',upload);return reply({part,accepted:true});
 }
 if(url.pathname==='/admin/release/complete'){
  const value=JSON.parse(new TextDecoder().decode(await bounded(request,4096))),cfg=await account.config();
  if(typeof value.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.ticket)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Math.min(cfg.expiresAt,Date.now()+14*86400000))throw Error('release_expiry');
  const count=Math.ceil(upload.size/PART),parts=Array.from({length:count},(_,i)=>upload.parts[i+1]);if(parts.some(p=>!p))throw Error('release_incomplete');
  await account.env.DEMO_RELEASES.resumeMultipartUpload(upload.key,upload.uploadId).complete(parts);
  const release={name:upload.name,key:upload.key,size:upload.size,sha256:upload.sha256,ticketHash:await sha(value.ticket),expiresAt:value.expiresAt};await account.ctx.storage.put('release',release);await account.ctx.storage.delete('release-upload');return reply({published:true,size:release.size,sha256:release.sha256,expires_at:release.expiresAt});
 }
 throw Error('release_route');
}
export async function releaseDownload(account,request,url){
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const ticket=url.searchParams.get('ticket'),release=await account.ctx.storage.get('release');
 if(url.searchParams.size!==1||!ticket||!/^[A-Za-z0-9_-]{43}$/.test(ticket)||!release||release.expiresAt<=Date.now()||await sha(ticket)!==release.ticketHash)return new Response('Enlace de descarga no disponible.',{status:403});
 await account.active();
 const range=request.headers.get('Range');if(range&&!/^bytes=\d+-\d*$/.test(range))return new Response('Invalid range',{status:416});
 const object=request.method==='HEAD'?await account.env.DEMO_RELEASES.head(release.key):await account.env.DEMO_RELEASES.get(release.key,range?{range:request.headers}:undefined);
 if(!object||object.size!==release.size)return new Response('Archivo no disponible.',{status:404});
 const headers=new Headers({'Content-Type':'application/vnd.microsoft.portable-executable','Content-Disposition':'attachment; filename="'+release.name+'"','Content-Length':String(object.range?.length??object.size),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Brivany-SHA256':release.sha256});
 if(range&&object.range)headers.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
 return new Response(request.method==='HEAD'?null:object.body,{status:range&&object.range?206:200,headers});
}
