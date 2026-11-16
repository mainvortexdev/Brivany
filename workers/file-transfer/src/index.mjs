import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {HTML,CSS,JS} from './assets.mjs';
import {dropRoute,dropOwnerOrigin} from './drop.mjs';
export {DropSession} from './drop.mjs';
const PREFIX='/transfer',TTL=300000,MAX=8*1024*1024+1024,CHUNK=65536,COOKIE='__Host-brivany-transfer';
const ID=/^[A-Za-z0-9_-]{22}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/,HASH=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
// Bound first-party demo service only. The issuer credential never reaches a PC.
export class DemoDropIssuer extends WorkerEntrypoint {
 async create(value){
  if(!value||Object.keys(value).sort().join(',')!=='claim_hash,id,owner_hash'||!ID.test(value.id)||!HASH.test(value.owner_hash)||!HASH.test(value.claim_hash))throw Error('invalid_drop_request');
  const body=JSON.stringify({owner_hash:value.owner_hash,claim_hash:value.claim_hash});
  const response=await dropRoute(new Request(this.env.PUBLIC_ORIGIN+'/transfer/drop/api/'+value.id,{method:'POST',headers:{Authorization:'Bearer '+this.env.ISSUER_TOKEN,'Content-Type':'application/json','Content-Length':String(body.length)},body}),this.env);
  if(response.status!==201){await response.body?.cancel();throw Error('drop_unavailable')}
  return response.json();
 }
}
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0}
function bearer(request){const value=request.headers.get('Authorization')||'';return value.startsWith('Bearer ')?value.slice(7):''}
function reply(code,value={},extra={}){return new Response(JSON.stringify(value),{status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...extra}})}
function secure(response,drop=false){const headers=new Headers(response.headers);headers.set('Cache-Control','no-store, no-transform');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'"+(drop?" wss://brivany.vetsa.es; worker-src 'self'":"")+"; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'");return new Response(response.body,{status:response.status,headers})}
async function bounded(request,max){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let length=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();return null}chunks.push(value)}}finally{reader.releaseLock()}const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result}
export default {
 async fetch(request,env){
  try{
   const url=new URL(request.url);if(url.origin!==env.PUBLIC_ORIGIN)return reply(404);
   if(request.headers.get('Origin')&&!same(request.headers.get('Origin'),env.PUBLIC_ORIGIN)&&!dropOwnerOrigin(request))return secure(reply(403));
   if(url.pathname.startsWith(PREFIX+'/drop')){const response=await dropRoute(request,env);return response.status===101?response:secure(response,true)}
   if(url.pathname===PREFIX&&request.method==='GET')return secure(new Response(null,{status:308,headers:{Location:PREFIX+'/'}}));
   const assets=new Map([[PREFIX+'/',[HTML,'text/html; charset=utf-8']],[PREFIX+'/phone.js',[JS,'text/javascript; charset=utf-8']],[PREFIX+'/phone.css',[CSS,'text/css; charset=utf-8']]]);
   if(request.method==='GET'&&assets.has(url.pathname)){const [body,type]=assets.get(url.pathname);return secure(new Response(body,{headers:{'Content-Type':type}}))}
   if(url.pathname===PREFIX+'/health'&&request.method==='GET')return secure(reply(200,{ready:!!env.ISSUER_TOKEN,protocol:1,max_file_bytes:8*1024*1024,ttl_seconds:300}));
   const match=url.pathname.match(/^\/transfer\/api\/([A-Za-z0-9_-]{22})(?:\/(payload|claim|sent))?$/);if(!match)return secure(reply(404));
   if(request.method==='POST'&&!match[2]){
    if(!env.ISSUER_TOKEN||!same(bearer(request),env.ISSUER_TOKEN))return secure(reply(403));
    if(env.UPLOAD_LIMIT&&!((await env.UPLOAD_LIMIT.limit({key:'desktop-issuer'})).success))return secure(reply(429));
   }
   const stub=env.TRANSFERS.get(env.TRANSFERS.idFromName(match[1]));return secure(await stub.fetch(request));
  }catch{return secure(reply(503,{error:'transfer_unavailable'}))}
 }
};

export class FileTransfer extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.sql=ctx.storage.sql}
 init(){this.sql.exec('CREATE TABLE IF NOT EXISTS transfer (id INTEGER PRIMARY KEY, expires INTEGER NOT NULL, state TEXT NOT NULL, claim_hash TEXT, owner_hash TEXT NOT NULL, grant_hash TEXT, size INTEGER NOT NULL)');this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (part INTEGER PRIMARY KEY, data BLOB NOT NULL)')}
 meta(){if(!this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='transfer'").toArray().length)return null;return this.sql.exec('SELECT * FROM transfer WHERE id=1').toArray()[0]||null}
 async alarm(){await this.ctx.storage.deleteAll()}
 async fetch(request){
  const url=new URL(request.url),parts=url.pathname.split('/'),id=parts[3],action=parts[4]||'',now=Date.now();if(!ID.test(id||''))return reply(404);
  const token=bearer(request),digest=TOKEN.test(token)?await hash(token):'';
  if(request.method==='POST'&&!action){
   if(!same(token,this.env.ISSUER_TOKEN))return reply(403);
   if(Number(request.headers.get('Content-Length'))>256)return reply(413);
   const raw=await bounded(request,256);if(!raw)return reply(413);let value;try{value=JSON.parse(new TextDecoder().decode(raw))}catch{return reply(400)}
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='claim_hash,owner_hash'||!HASH.test(value.claim_hash)||!HASH.test(value.owner_hash))return reply(400);
   if(this.meta())return reply(409);
   this.init();
   this.sql.exec('INSERT INTO transfer VALUES (1,?,?,?,?,?,?)',now+TTL,'uploading',value.claim_hash,value.owner_hash,null,0);await this.ctx.storage.setAlarm(now+TTL);return reply(201,{ttl_seconds:300});
  }
  let meta=this.meta();if(!meta||meta.expires<=now){if(meta)await this.ctx.storage.deleteAll();return reply(410)}
  const owner=same(digest,meta.owner_hash);
  if(request.method==='DELETE'&&!action){if(!owner)return reply(403);await this.ctx.storage.deleteAll();return reply(200,{state:'cancelled'})}
  if(request.method==='GET'&&!action){if(!owner)return reply(403);return reply(200,{state:meta.state,expires_in:Math.max(0,Math.floor((meta.expires-Date.now())/1000))})}
  if(request.method==='PUT'&&action==='payload'){
   if(!owner||meta.state!=='uploading')return reply(403);
   const length=Number(request.headers.get('Content-Length'));if(!Number.isSafeInteger(length)||length<32||length>MAX||request.headers.get('Content-Type')!=='application/octet-stream')return reply(413);
   const data=await bounded(request,MAX);if(!data||data.length!==length)return reply(413);
   meta=this.meta();if(!meta||meta.state!=='uploading'||meta.expires<=Date.now()||!same(digest,meta.owner_hash))return reply(410);
   this.ctx.storage.transactionSync(()=>{for(let start=0,part=0;start<data.length;start+=CHUNK,part++)this.sql.exec('INSERT INTO chunks VALUES (?,?)',part,data.slice(start,start+CHUNK).buffer);this.sql.exec("UPDATE transfer SET state='waiting',size=? WHERE id=1",data.length)});return reply(200,{state:'waiting'});
  }
  if(request.method==='POST'&&action==='claim'){
   if(request.headers.get('Origin')!==this.env.PUBLIC_ORIGIN||!digest)return reply(403);
   const grant=random(),grantHash=await hash(grant);let accepted=false;
   this.ctx.storage.transactionSync(()=>{const value=this.meta();if(value&&value.expires>Date.now()&&value.state==='waiting'&&same(digest,value.claim_hash)){this.sql.exec("UPDATE transfer SET claim_hash=NULL,grant_hash=?,state='connected' WHERE id=1",grantHash);accepted=true}});
   if(!accepted)return reply(403);return reply(200,{expires_in:Math.max(0,Math.floor((meta.expires-Date.now())/1000))},{'Set-Cookie':COOKIE+'='+id+'.'+grant+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300'});
  }
  const cookie=(request.headers.get('Cookie')||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'',pair=cookie.split('.');
  const receiver=pair[0]===id&&TOKEN.test(pair[1]||'')&&same(await hash(pair[1]),meta.grant_hash);
  if(request.method==='GET'&&action==='payload'){
   if(!receiver||meta.state!=='connected')return reply(403);const output=new Uint8Array(meta.size);let offset=0;
   for(const row of this.sql.exec('SELECT data FROM chunks ORDER BY part')){const piece=new Uint8Array(row.data);output.set(piece,offset);offset+=piece.length}
   if(offset!==meta.size)return reply(410);return new Response(output,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(output.length)}});
  }
  if(request.method==='POST'&&action==='sent'){
   if(!receiver||request.headers.get('Origin')!==this.env.PUBLIC_ORIGIN)return reply(403);
   this.ctx.storage.transactionSync(()=>{this.sql.exec('DELETE FROM chunks');this.sql.exec("UPDATE transfer SET state='sent' WHERE id=1")});return reply(200,{state:'sent'});
  }
  return reply(405);
 }
}
