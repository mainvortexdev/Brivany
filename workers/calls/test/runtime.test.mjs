import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from '../../whatsapp/node_modules/miniflare/dist/src/index.js';
const PHONE='18095550101';
// The installed workerd binary supports dates through 2026-10-19. Production
// keeps today's date; RPC/SQLite/alarm behavior is additionally checked live.
const LOCAL_COMPAT='2026-10-19';
const driver=`export default {async fetch(r,env){const u=new URL(r.url);let value;if(u.pathname==='/schedule')value=await env.CALLS.schedule(await r.json());else if(u.pathname==='/cancel'){const v=await r.json();value=await env.CALLS.cancel(v.phone,v.id);}else if(u.pathname==='/list')value=await env.CALLS.list('${PHONE}');else if(u.pathname==='/info')value=await env.CALLS.info();else return new Response('missing',{status:404});return Response.json(value);}};`;
const provider=`export default {async fetch(r,env,ctx){const u=new URL(r.url);
 if(u.hostname==='api.telnyx.com'){const b=await r.json();await env.LOG.fetch('https://log.invalid',{method:'POST',body:JSON.stringify({path:u.pathname,body:b})});return Response.json({data:{call_control_id:'v3:synthetic-runtime'}});}
 if(u.pathname==='/v1/asr/realtime'){
  const pair=new WebSocketPair(),s=pair[1];s.binaryType='arraybuffer';s.addEventListener('message',e=>{
   if(typeof e.data==='string')s.send(JSON.stringify({sessionId:'synthetic-muse'}));
   else {ctx.waitUntil(env.LOG.fetch('https://log.invalid',{method:'POST',body:JSON.stringify({path:'asr-pcm',bytes:e.data.byteLength})}));s.send(JSON.stringify({type:'speechStart',turnId:'synthetic-turn'}));s.send(JSON.stringify({type:'speechComplete',turnId:'synthetic-turn',transcript:'Hola'}));}
  });s.accept();return new Response(null,{status:101,webSocket:pair[0]});
 }
 if(u.pathname==='/v1/chat/completions')return Response.json({choices:[{message:{content:'Estoy aquí para ayudarte.'}}]});
 if(u.pathname==='/tts/bytes'){const b=await r.json();await env.LOG.fetch('https://log.invalid',{method:'POST',body:JSON.stringify({path:'cartesia-tts',voice:b.voice,model:b.model_id})});return new Response(new Uint8Array(1600).fill(255),{headers:{'Content-Type':'application/octet-stream'}});}
 return new Response('Test prohibits unknown providers',{status:403});}};`;
async function setup(persist,requests,voice=false){
 const script=await readFile(new URL('../.wrangler-melodi-build/worker.js',import.meta.url),'utf8');
 return new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,resourcePersistencePath:persist,workers:[
  {name:'driver',modules:true,script:driver,compatibilityDate:LOCAL_COMPAT,serviceBindings:{CALLS:'calls'}},
  {name:'calls',modules:true,script,compatibilityDate:LOCAL_COMPAT,durableObjects:{MELODI_PHONE:{className:'MelodiPhone',useSQLite:true}},bindings:{OWNER_WHATSAPP_NUMBER:PHONE,TELNYX_API_KEY:'synthetic',TELNYX_CONNECTION_ID:'synthetic',TELNYX_FROM_NUMBER:'+18095550202',TELNYX_PUBLIC_KEY:'synthetic',BRIVANY_META_API_KEY:'synthetic',BRIVANY_META_MODEL:'synthetic',BRIVANY_CARTESIA_API_KEY:'synthetic',CALLS_ENCRYPTION_KEY:btoa('a'.repeat(32))},outboundService:voice?'provider':async request=>{
   const url=new URL(request.url);assert.equal(url.origin,'https://api.telnyx.com','runtime tests cannot reach real providers');requests.push({path:url.pathname,body:await request.json()});return Response.json({data:{call_control_id:'v3:synthetic-runtime'}});
  }},
  ...(voice?[{name:'provider',modules:true,script:provider,compatibilityDate:LOCAL_COMPAT,serviceBindings:{LOG:async r=>{requests.push(await r.json());return new Response('ok');}}}]:[])
 ]}));
}
const post=async(worker,path,value)=>(await worker.fetch('https://test.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json();
test('actual workerd service RPC, SQLite and alarm execute independently of any desktop process',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'brivany-call-runtime-')),requests=[],mf=await setup(persist,requests);
 try{
  const worker=await mf.getWorker('driver'),id=crypto.randomUUID(),info=await(await worker.fetch('https://test.invalid/info')).json();assert.equal(info.tts.provider,'Cartesia');
  const result=await post(worker,'/schedule',{id,phone:PHONE,requestHash:'a'.repeat(64),dueAt:Date.now()+1200,timeZone:'America/La_Paz',objective:'Synthetic runtime test'});assert.equal(result.state,'scheduled');
  for(let i=0;i<16&&!requests.length;i++)await new Promise(r=>setTimeout(r,250));
  assert.equal(requests.filter(r=>r.path==='/v2/calls').length,1);assert.equal(requests[0].body.command_id,id);assert.equal(requests[0].body.to,'+'+PHONE);
  const rows=await(await worker.fetch('https://test.invalid/list')).json();assert.equal(rows[0].state,'ringing');
  await post(worker,'/cancel',{phone:PHONE,id});assert.equal(requests.filter(r=>r.path.endsWith('/actions/hangup')).length,1);
 }finally{await mf.dispose();}
});
test('actual SQLite schedules survive runtime shutdown and can be cancelled before any dial',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'brivany-call-persist-')),requests=[],id=crypto.randomUUID();let mf=await setup(persist,requests);
 try{
  let worker=await mf.getWorker('driver');await post(worker,'/schedule',{id,phone:PHONE,requestHash:'b'.repeat(64),dueAt:Date.now()+60000,timeZone:'America/La_Paz',objective:'Synthetic restart test'});
  await mf.dispose();mf=await setup(persist,requests);worker=await mf.getWorker('driver');
  const rows=await(await worker.fetch('https://test.invalid/list')).json();assert.equal(rows[0].id,id);assert.equal(rows[0].state,'scheduled');
  assert.equal((await post(worker,'/cancel',{phone:PHONE,id})).state,'cancelled');assert.equal(requests.length,0);
 }finally{await mf.dispose();}
});
test('actual cloud WebSockets bridge simulated caller audio, Muse and exact Cartesia voice end to end',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'brivany-call-media-')),requests=[],mf=await setup(persist,requests,true);
 try{
  const driver=await mf.getWorker('driver'),calls=await mf.getWorker('calls'),id=crypto.randomUUID();
  await post(driver,'/schedule',{id,phone:PHONE,requestHash:'c'.repeat(64),dueAt:Date.now()+700,timeZone:'America/La_Paz',objective:'Synthetic voice round trip'});
  for(let i=0;i<16&&!requests.length;i++)await new Promise(r=>setTimeout(r,250));
  const url=requests.find(r=>r.path==='/v2/calls')?.body.stream_url;assert.ok(url);
  const response=await calls.fetch(url.replace('wss://','https://'),{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);
  const socket=response.webSocket;let audio=0,marks=0,sequence=10;
  socket.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.event==='media')audio++;if(v.event==='mark'){marks++;socket.send(JSON.stringify({event:'mark',stream_id:'synthetic-stream',sequence_number:String(++sequence),mark:v.mark}));}});socket.accept();
  socket.send(JSON.stringify({event:'start',sequence_number:'1',stream_id:'synthetic-stream',start:{call_control_id:'v3:synthetic-runtime',from:'+18095550202',to:'+'+PHONE,media_format:{encoding:'PCMU',sample_rate:8000,channels:1}}}));
  for(let i=0;i<20&&!marks;i++)await new Promise(r=>setTimeout(r,100));assert.ok(audio>0,JSON.stringify({requests,rows:await(await driver.fetch('https://test.invalid/list')).json()}));assert.ok(marks>0);
  socket.send(JSON.stringify({event:'media',sequence_number:String(++sequence),stream_id:'synthetic-stream',media:{track:'inbound',payload:btoa('\xff'.repeat(160))}}));
  for(let i=0;i<20&&requests.filter(r=>r.path==='cartesia-tts').length<2;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(requests.find(r=>r.path==='asr-pcm')?.bytes,960,JSON.stringify({requests,rows:await(await driver.fetch('https://test.invalid/list')).json()}));assert.equal(requests.filter(r=>r.path==='cartesia-tts').length,2);
  assert.ok(requests.filter(r=>r.path==='cartesia-tts').every(r=>r.voice==='3597a26f-80ef-4bd5-8101-9699bc764917'&&r.model==='sonic-3.6-2026-08-27'));
  socket.send(JSON.stringify({event:'dtmf',sequence_number:String(++sequence),dtmf:{digit:'0'}}));socket.close();
 }finally{await mf.dispose();}
});
