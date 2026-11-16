const BASE='/api/brivany/whatsapp';
const methods=new Map([['/number','GET'],['/status','GET'],['/link','POST'],['/unlink','POST'],
 ['/google/calendar','POST'],['/google/drive','POST'],['/google/gmail','POST']]);
for(const path of ['register','poll','update','disable','artifact','reference'])methods.set('/desktop/'+path,'POST');
/** Fixed service binding: account credentials never travel to an arbitrary host. */
export async function handleWhatsApp(request,env){
 const url=new URL(request.url);if(!url.pathname.startsWith(BASE))return null;
 const path=url.pathname.slice(BASE.length),method=methods.get(path);
 const fail=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
 if(!method||url.search)return fail('Ruta no disponible.',404);
 if(request.method!==method)return fail('Método no permitido.',405);
 if(!env.MELODI_WHATSAPP)return fail('El servicio de Melodi no está disponible.',503);
 const headers=new Headers({'Accept':'application/json'});
 const auth=request.headers.get('Authorization');if(auth)headers.set('Authorization',auth);
 let body;
 if(method==='POST'){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return fail('Usa JSON.',415);
  const reader=request.body?.getReader();let length=0;const parts=[];
  const maximum=path==='/desktop/artifact'?7100000:path==='/desktop/update'?18000:10000;
  if(reader)try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>maximum){await reader.cancel();return fail('Solicitud demasiado grande.',413);}parts.push(item.value);}}finally{reader.releaseLock();}
  body=new Uint8Array(length);let index=0;for(const part of parts){body.set(part,index);index+=part.byteLength;}
  headers.set('Content-Type','application/json');
 }
 try{return await env.MELODI_WHATSAPP.fetch(new Request('https://ia.vetsa.es'+BASE+path,{method,headers,body,signal:AbortSignal.timeout(20000)}));}
 catch{return fail('No se pudo conectar con Melodi.',503);}
}
