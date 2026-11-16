import {timingSafeEqual} from 'node:crypto';
const json=(status,error)=>Response.json({error:{message:error}},{status,headers:{'Cache-Control':'no-store'}});
async function authorized(request,secret){
 if(!secret)return false;
 const provided=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');if(provided.length>256)return false;
 const encoder=new TextEncoder(),hashes=await Promise.all([provided,secret].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 return timingSafeEqual(new Uint8Array(hashes[0]),new Uint8Array(hashes[1]));
}
export async function payload(request){
 if(!request.body)throw Error();const reader=request.body.getReader();let total=0,chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>65000)throw Error();chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const raw=new Uint8Array(total);let offset=0;for(const part of chunks){raw.set(part,offset);offset+=part.length}
 const value=JSON.parse(new TextDecoder().decode(raw));
 if(!Array.isArray(value.messages)||!value.messages.length||value.messages.length>20||value.stream!==true)throw Error();
 const messages=value.messages.map(item=>{if(!['system','user','assistant'].includes(item.role)||typeof item.content!=='string'||item.content.length>20000)throw Error();return {role:item.role,content:item.content}});
 if(messages.at(-1).role!=='user')throw Error();
 if(!Number.isInteger(value.max_tokens)||value.max_tokens<1||value.max_tokens>2400)throw Error();
 return {messages,max_tokens:value.max_tokens,stream:true,enable_thinking:false};
}
export async function relay(request,env,fetcher=fetch){
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return Response.json({service:'Melodi chat',ready:!!(env.SILICONFLOW_API_KEY&&env.CLIENT_TOKEN)},{headers:{'Cache-Control':'no-store'}});
 if(url.pathname!=='/v1/chat/completions'||request.method!=='POST')return json(404,'No disponible.');
 if(!await authorized(request,env.CLIENT_TOKEN))return json(401,'Acceso no autorizado.');
 if(!env.SILICONFLOW_API_KEY)return json(503,'Conexión pendiente.');
 let body;try{body=await payload(request)}catch{return json(422,'Petición de conversación no válida.')}
 body.model=env.CHAT_MODEL||'deepseek-ai/DeepSeek-V4-Flash';
 try{
  const upstream=await fetcher('https://api.siliconflow.com/v1/chat/completions',{method:'POST',redirect:'manual',signal:request.signal,headers:{Authorization:'Bearer '+env.SILICONFLOW_API_KEY,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(body)});
  if(!upstream.ok||!upstream.body){await upstream.body?.cancel();console.warn(JSON.stringify({event:'melodi_provider_error',status:upstream.status}));return json(upstream.status===429?429:502,'El proveedor no pudo completar la conversación.')}
  return new Response(upstream.body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return json(502,'La conexión de conversación se interrumpió.')}
}
export default {fetch(request,env){return relay(request,env)}};
