import {DurableObject} from 'cloudflare:workers';
import {DROP_HTML,DROP_CSS,DROP_JS,DROP_EDGE,DROP_LOCALE,DROP_PEER,DROP_STORAGE} from './assets.mjs';
const PREFIX='/transfer/drop',ID=/^[A-Za-z0-9_-]{22}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/,HASH=/^[a-f0-9]{64}$/,COOKIE='__Host-brivany-drop',INVITE=600000,LIFETIME=21600000,MAX_PACKET=256*1024+8192;
const enc=new TextEncoder(),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const bearer=request=>(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
const reply=(status,value={},headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store, no-transform',...headers}});
export function dropOwnerOrigin(request){const u=new URL(request.url);return /^\/transfer\/drop\/api\/[\w-]{22}\/socket$/.test(u.pathname)&&request.headers.get('Upgrade')?.toLowerCase()==='websocket'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(request.headers.get('Origin')||'')}
export async function dropRoute(request,env){
 const url=new URL(request.url),assets=new Map([[PREFIX+'/',[DROP_HTML,'text/html; charset=utf-8']],[PREFIX+'/phone.js',[DROP_JS,'text/javascript; charset=utf-8']],[PREFIX+'/edge.js',[DROP_EDGE,'text/javascript; charset=utf-8']],[PREFIX+'/phone.css',[DROP_CSS,'text/css; charset=utf-8']],[PREFIX+'/locales.js',[DROP_LOCALE,'text/javascript; charset=utf-8']],[PREFIX+'/peer.js',[DROP_PEER,'text/javascript; charset=utf-8']],[PREFIX+'/storage-worker.js',[DROP_STORAGE,'text/javascript; charset=utf-8']]]);
 if(request.method==='GET'&&url.pathname===PREFIX)return new Response(null,{status:308,headers:{Location:PREFIX+'/'}});
 if(request.method==='GET'&&assets.has(url.pathname)){const [body,type]=assets.get(url.pathname);return new Response(body,{headers:{'Content-Type':type}})}
 if(request.method==='GET'&&url.pathname===PREFIX+'/health')return reply(200,{ready:!!env.ISSUER_TOKEN,protocol:2,max_file_bytes:1024**3,bidirectional:true,invite_seconds:600,session_seconds:21600});
 const match=url.pathname.match(/^\/transfer\/drop\/api\/([A-Za-z0-9_-]{22})(?:\/(claim|socket))?$/);if(!match)return reply(404);
 if(request.method==='POST'&&!match[2]){if(!same(bearer(request),env.ISSUER_TOKEN))return reply(403);if(env.UPLOAD_LIMIT&&!((await env.UPLOAD_LIMIT.limit({key:'desktop-drop-issuer'})).success))return reply(429)}
 return env.DROPS.get(env.DROPS.idFromName(match[1])).fetch(request);
}
export class DropSession extends DurableObject {
 constructor(ctx,env){super(ctx,env);ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'))}
 async end(){for(const socket of this.ctx.getWebSockets()){try{socket.send(JSON.stringify({server:'ended'}));socket.close(1000,'Ended')}catch{}}await this.ctx.storage.deleteAll()}
 async alarm(){await this.end()}
 notify(){const sockets=this.ctx.getWebSockets();for(const socket of sockets){const a=socket.deserializeAttachment();try{socket.send(JSON.stringify({server:'ready',peer:sockets.some(other=>other!==socket&&other.deserializeAttachment()?.role!==a.role),expires:a.expires}))}catch{}}}
 async fetch(request){
  const url=new URL(request.url),parts=url.pathname.split('/'),id=parts[4],action=parts[5]||'',token=bearer(request);if(!ID.test(id||''))return reply(404);
  if(request.method==='POST'&&!action){
   if(!same(token,this.env.ISSUER_TOKEN))return reply(403);
   const length=Number(request.headers.get('Content-Length'));if(!Number.isInteger(length)||length<2||length>256)return reply(413);
   let value;try{value=await request.json()}catch{return reply(400)}
   if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='claim_hash,owner_hash'||!HASH.test(value.owner_hash)||!HASH.test(value.claim_hash))return reply(400);
   const created=await this.ctx.storage.transaction(async storage=>{if(await storage.get('session'))return false;await storage.put('session',{owner:value.owner_hash,claim:value.claim_hash,grant:null,expires:Date.now()+INVITE});return true});
   if(!created)return reply(409);await this.ctx.storage.setAlarm(Date.now()+INVITE);return reply(201,{protocol:2,invite_seconds:600});
  }
  let meta=await this.ctx.storage.get('session');if(!meta||meta.expires<=Date.now()){if(meta)await this.end();return reply(410)}
  const owner=TOKEN.test(token)&&same(await hash(token),meta.owner);
  if(request.method==='POST'&&action==='claim'){
   if(request.headers.get('Origin')!==this.env.PUBLIC_ORIGIN||!TOKEN.test(token))return reply(403);
   const digest=await hash(token),grant=random(),grantHash=await hash(grant);
   const accepted=await this.ctx.storage.transaction(async storage=>{const row=await storage.get('session');if(!row||row.expires<=Date.now()||!same(row.claim,digest))return false;meta={...row,claim:null,grant:grantHash,expires:Date.now()+LIFETIME};await storage.put('session',meta);return true});
   if(!accepted)return reply(403);await this.ctx.storage.setAlarm(meta.expires);for(const socket of this.ctx.getWebSockets()){const attachment=socket.deserializeAttachment();if(attachment){attachment.expires=meta.expires;socket.serializeAttachment(attachment)}}return reply(200,{protocol:2,expires:meta.expires,max_file_bytes:1024**3},{'Set-Cookie':COOKIE+'='+id+'.'+grant+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=21600'});
  }
  const cookie=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1).split('.')||[];
  const receiver=cookie[0]===id&&TOKEN.test(cookie[1]||'')&&same(await hash(cookie[1]),meta.grant);
  if(request.method==='DELETE'&&!action){if(!owner&&!(receiver&&request.headers.get('Origin')===this.env.PUBLIC_ORIGIN))return reply(403);await this.end();return reply(200,{state:'cancelled'})}
  if(request.method==='GET'&&!action){if(!owner)return reply(403);return reply(200,{state:meta.grant?'connected':'waiting',expires:meta.expires,protocol:2})}
  if(request.method==='GET'&&action==='socket'&&request.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   const protocols=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(v=>v.trim()),ownerToken=protocols.find(v=>v.startsWith('owner.'))?.slice(6)||'';
   const desktop=TOKEN.test(ownerToken)&&same(await hash(ownerToken),meta.owner);
   if(!protocols.includes('brivany-drop-v2')||!desktop&&!receiver||!desktop&&request.headers.get('Origin')!==this.env.PUBLIC_ORIGIN||desktop&&!dropOwnerOrigin(request)&&request.headers.get('Origin')!==this.env.PUBLIC_ORIGIN)return reply(403);
   const role=desktop?'desktop':'phone';for(const socket of this.ctx.getWebSockets(role)){try{socket.close(1000,'Reconnected')}catch{}}
   const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server,[role]);server.serializeAttachment({role,expires:meta.expires,window:Date.now(),messages:0});this.notify();return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':'brivany-drop-v2'}});
  }
  return reply(405);
 }
 async webSocketMessage(socket,message){
  const state=socket.deserializeAttachment();if(!state||state.expires<=Date.now()){await this.end();return}
  if(!(message instanceof ArrayBuffer)||message.byteLength<28||message.byteLength>MAX_PACKET){socket.close(1008,'Invalid packet');return}
  const now=Date.now();if(now-state.window>=1000){state.window=now;state.messages=0}state.messages++;if(state.messages>256){socket.close(1008,'Rate limit');return}socket.serializeAttachment(state);
  for(const peer of this.ctx.getWebSockets(state.role==='desktop'?'phone':'desktop')){try{peer.send(message)}catch{}}
 }
 async webSocketClose(socket){try{socket.close()}catch{}this.notify()}
 async webSocketError(socket){try{socket.close(1011,'Connection interrupted')}catch{}}
}
