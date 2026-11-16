import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
const provider=`export default {fetch(request){
 const url=new URL(request.url),p=new WebSocketPair(),s=p[1];s.binaryType='arraybuffer';
 s.addEventListener('message',e=>{
  if(typeof e.data==='string'){
   const v=JSON.parse(e.data);
   if(url.hostname==='api.meta.ai'){
    if(v.authorization?.accessToken==='Bearer synthetic-meta-key-0123456789')s.send(JSON.stringify({sessionId:'synthetic-session'}));
    else if(v.type!=='endStream')s.send(JSON.stringify({error:'unexpected-text'}));
   }else s.send(JSON.stringify({error:'unexpected-text'}));
  }else{const a=new Uint8Array(e.data);s.send(JSON.stringify({binary:a.length===4&&a[0]===0&&a[1]===255&&a[2]===128&&a[3]===1}));}
 });s.accept();return new Response(null,{status:101,webSocket:p[0]});}}`;

test('workerd: all three ASR proxies preserve binary PCM and replace only the Muse authentication handshake',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'provider',modules:true,script:provider,compatibilityDate:'2026-10-19'},{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:'admin',DEMO_DATA_KEY:Buffer.alloc(32,7).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},outboundService:'provider'}]}));
 const demo=await mf.getWorker('demo');
 const send=(path,body,token='admin')=>demo.fetch('https://demo.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  await send('/admin/configure',{name:'Synthetic',invitation:'i'.repeat(43),expiresAt:Date.now()+86400000});
  await send('/admin/providers',{meta:'synthetic-meta-key-0123456789',cartesia:'synthetic-cartesia-key-0123456789',deepgram:'synthetic-deepgram-key-0123456789'});await send('/admin/enable',{});
  const token=(await(await send('/v1/activate',{deviceId:randomUUID(),invitation:'i'.repeat(43)})).json()).token;
  for(const [name,path] of [['meta','/v1/asr/realtime'],['cartesia','/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=24000&cartesia_version=2026-08-14'],['deepgram','/v1/listen?model=nova-3&encoding=linear16&sample_rate=24000']]){
   const response=await demo.fetch('https://demo.invalid/proxy/'+name+path,{headers:{Upgrade:'websocket',Authorization:'Bearer '+token}});assert.equal(response.status,101);const s=response.webSocket,events=[];s.addEventListener('message',e=>events.push(JSON.parse(e.data)));s.accept();
   if(name==='meta')s.send(JSON.stringify({authorization:{accessToken:'Bearer '+token},audioEncoding:'PCM_24KHZ'}));
   s.send(Uint8Array.from([0,255,128,1]).buffer);
   const end=Date.now()+3000;while(!events.some(e=>e.binary)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
   assert(events.some(e=>e.binary),name+': '+JSON.stringify(events));assert(!events.some(e=>e.error));if(name==='meta')assert(events.some(e=>e.sessionId));s.close();
  }
 }finally{await mf.dispose()}
});
