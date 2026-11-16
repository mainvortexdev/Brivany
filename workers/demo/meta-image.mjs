// Spaik Image uses Meta only. Secrets never leave the server-side binding.
class MetaImageError extends Error {constructor(message,status=502){super(message);this.status=status;}}
function imageData(value,mime='image/png'){
 if(typeof value!=='string'||!value)throw new MetaImageError('Falta una imagen válida.',400);
 const data=value.startsWith('data:')?value:`data:${value.startsWith('iVBOR')?'image/png':value.startsWith('/9j/')?'image/jpeg':mime};base64,${value}`;
 if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length>8_000_100)throw new MetaImageError('Usa una imagen PNG, JPEG o WebP de hasta 6 MB.',400);
 return data;
}
async function boundedJson(response,limit){
 const reader=response.body?.getReader();if(!reader)throw new MetaImageError('Meta no entregó un resultado.');
 let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new MetaImageError('La respuesta de Meta supera el límite.');}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new MetaImageError('Meta devolvió una respuesta incompleta.')}
}
export async function generateMetaImage(env,prompt,options={},fetcher=fetch){
 if(!env.META_API_KEY)throw new MetaImageError('Meta no está configurado para Spaik Image.',503);
 const inputs=[];const primary=options.imageBase64||options.image;if(primary)inputs.push(imageData(primary,options.imageMimeType));
 if(options.referenceImages!==undefined&&!Array.isArray(options.referenceImages))throw new MetaImageError('Las referencias deben ser una lista.',400);
 for(const ref of options.referenceImages||[])inputs.push(imageData(ref?.imageBase64||ref?.image,ref?.imageMimeType));
 if(inputs.length>4)throw new MetaImageError('Se admiten hasta cuatro referencias.',400);
 const mode=options.mode||options.operation||(inputs.length?'edit':'generate');
 const analyze=['analyze','analyse','analyze_image','analysis','describe','vision'].includes(mode);
 if(!analyze&&!['edit','edit_image','generate','generate_image'].includes(mode))throw new MetaImageError('Modo de Spaik Image no reconocido.',400);
 if((analyze||mode.startsWith('edit'))&&!inputs.length)throw new MetaImageError('Este modo requiere una imagen.',400);
 if(options.mask)throw new MetaImageError('Meta no admite máscaras en esta ruta.',400);
 let path,body;
 if(analyze){path='chat/completions';body={model:env.META_VISION_MODEL||'muse-spark-1.3',messages:[{role:'user',content:[{type:'text',text:prompt},...inputs.map(url=>({type:'image_url',image_url:{url}}))]}],stream:false,reasoning_effort:'minimal',max_completion_tokens:Math.min(4096,Math.max(64,Number(options.max_tokens||options.maxTokens)||1024))};}
 else{path=inputs.length?'images/edits':'images/generations';body={model:'muse-image-1.0',prompt,n:1,response_format:'b64_json',output_format:'png',reasoning_strength:'high'};if(inputs.length)body.images=inputs.map(image_url=>({image_url}));const size=options.size||({'9:16':'1080x1920','16:9':'1920x1080','4:3':'1536x1152','3:4':'1152x1536','1:1':'1024x1024'}[options.aspect_ratio]);if(size&&size!=='auto'){if(!/^\d{3,4}x\d{3,4}$/.test(size))throw new MetaImageError('Dimensiones no válidas.',400);body.size=size;}}
 let response;try{response=await fetcher('https://api.meta.ai/v1/'+path,{method:'POST',headers:{Authorization:`Bearer ${env.META_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(analyze?45000:120000),redirect:'manual'})}catch{throw new MetaImageError('Meta no pudo completar la solicitud. No se reintentó.');}
 if(!response.ok){await response.body?.cancel();throw new MetaImageError(`Meta no pudo completar la solicitud (HTTP ${response.status}). No se reintentó.`,response.status===429?429:502)}
 const result=await boundedJson(response,analyze?1_000_000:34_000_000);
 if(analyze){const choice=result.choices?.[0],text=choice?.message?.content;if(choice?.finish_reason==='length'||typeof text!=='string'||!text.trim())throw new MetaImageError('Meta no entregó un análisis completo.');return {text:text.trim(),response:text.trim(),type:'text',provider:'Meta',modelUsed:'spaik-image',providerModel:body.model,usage:result.usage};}
 const image=result.data?.[0]?.b64_json;if(result.data?.length!==1||typeof image!=='string'||!image.length||image.length>32_000_000||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(image))throw new MetaImageError('Meta no entregó una imagen PNG completa.');
 return {text:inputs.length?'Imagen editada.':'Imagen generada.',imageBase64:image,mimeType:'image/png',type:'image',provider:'Meta',modelUsed:'spaik-image',providerModel:body.model};
}
export async function metaImageResponse(env,contents,options,cors,serviceId){
 let claimed=false,requestId=options.requestId;
 const analysis=['analyze','analyse','analyze_image','analysis','describe','vision'].includes(options.mode||options.operation);
 try{
  if(requestId&&!analysis){
   if(!/^[a-f0-9-]{36}$/i.test(requestId)||!env.VETSA_CLOUD||!env.VETSA_MEDIA)throw new MetaImageError('requestId no válido o almacenamiento no disponible.',400);
   const row=await env.VETSA_CLOUD.prepare('SELECT task_id,status,object_key,mime_type FROM spaik_image_jobs WHERE request_id=? AND service_id=?').bind(requestId,serviceId).first();
   if(row&&row.task_id!=='meta-v1')return null; // Let pending legacy jobs finish on their original provider.
   if(row?.status==='completed'){
    const object=await env.VETSA_MEDIA.get(row.object_key);if(!object||object.size>24000000)throw new MetaImageError('El resultado guardado ya no está disponible.',410);
    const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return Response.json({imageBase64:btoa(binary),mimeType:'image/png',type:'image',text:'Imagen preparada.',modelUsed:'spaik-image',provider:'Meta',providerModel:'muse-image-1.0',requestId},{headers:cors});
   }
   if(row)throw new MetaImageError('La petición anterior sigue pendiente o no pudo confirmarse. No se ha vuelto a generar.',409);
   const now=new Date().toISOString(),claim=await env.VETSA_CLOUD.prepare("INSERT OR IGNORE INTO spaik_image_jobs(request_id,service_id,task_id,status,created_at,updated_at) VALUES(?,?,?,'starting',?,?)").bind(requestId,serviceId,'meta-v1',now,now).run();
   if(!claim.meta.changes)throw new MetaImageError('Esta petición ya está en curso.',409);claimed=true;
  }
  const result=await generateMetaImage(env,contents,options);
  if(claimed){const key=`spaik-image/${serviceId}/meta-${requestId}`,bytes=Uint8Array.from(atob(result.imageBase64),c=>c.charCodeAt(0));await env.VETSA_MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/png'}});await env.VETSA_CLOUD.prepare("UPDATE spaik_image_jobs SET status='completed',object_key=?,mime_type='image/png',updated_at=? WHERE request_id=? AND service_id=?").bind(key,new Date().toISOString(),requestId,serviceId).run();result.requestId=requestId;}
  return Response.json(result,{headers:cors});
 }catch(error){
  if(claimed)try{await env.VETSA_CLOUD.prepare("UPDATE spaik_image_jobs SET status='failed',error_code='meta_image_failed',updated_at=? WHERE request_id=? AND service_id=?").bind(new Date().toISOString(),requestId,serviceId).run()}catch{}
  return Response.json({error:error instanceof MetaImageError?error.message:'Meta no pudo completar la solicitud.',code:'SPAIK_IMAGE_META_ERROR'},{status:error instanceof MetaImageError?error.status:502,headers:cors});
 }
}
