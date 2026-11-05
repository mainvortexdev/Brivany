import assert from 'node:assert/strict';
import {webcrypto,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
import {authenticate,createGateway,createASRSession,sanitizeMuse} from '../src/index.mjs';

const TOKEN='private-device-token-synthetic-only-123456789';
const META='synthetic-meta-key-do-not-leak';
const CARTESIA='synthetic-cartesia-key-do-not-leak';
const ENV={MOBILE_DEVICE_TOKEN:TOKEN,META_API_KEY:META,CARTESIA_API_KEY:CARTESIA,CARTESIA_VOICE_ID:'3597a26f-80ef-4bd5-8101-9699bc764917',MOBILE_LIMIT:{async limit(){return {success:true};}}};
const cryptoApi={subtle:{digest:(...args)=>webcrypto.subtle.digest(...args),timingSafeEqual:(a,b)=>timingSafeEqual(new Uint8Array(a),new Uint8Array(b))}};
const encoder=new TextEncoder();
function request(path,body,token=TOKEN,extra={}){return new Request('https://mobile.brivany.example'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function context(){const pending=[];return {pending,waitUntil(value){pending.push(value);},async flush(){for(let index=0;index<pending.length;index++)await pending[index];}};}
const noNetwork=()=>{throw new Error('Unexpected external request');};
const gateway=(fetch=noNetwork,extra={})=>createGateway({fetch,crypto:cryptoApi,...extra});
function stream(...chunks){let cancelled=false;const body=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);controller.close();},cancel(){cancelled=true;}});return {body,isCancelled:()=>cancelled};}
const sse=(content='Hola.')=>'data: '+JSON.stringify({choices:[{index:0,delta:{content}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
class Socket extends EventTarget {
  readyState=1;sent=[];closed=[];
  accept(){this.accepted=true;}
  send(raw){if(this.readyState!==1)throw Error('closed');this.sent.push(raw);}
  message(data){this.dispatchEvent(new MessageEvent('message',{data}));}
  close(code=1000,reason=''){if(this.readyState===3)return;this.readyState=3;this.closed.push({code,reason});this.dispatchEvent(new Event('close'));}
}
function asrRuntime(upstream=new Socket()) {
  let now=1000,id=0;const timers=new Map(),calls=[];
  return {calls,timers,upstream,now:()=>now,advance(ms){now+=ms;},setTimeout(fn,ms){const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout(key){timers.delete(key);},async fetch(url,options){calls.push({url,options});return {status:101,webSocket:upstream};}};
}

test('auth hashes fixed-size inputs and never returns the credential',async()=>{
  const identity=await authenticate(request('/v1/config'),ENV,cryptoApi);assert.match(identity,/^[a-f0-9]{64}$/);assert.notEqual(identity,TOKEN);
  assert.equal(await authenticate(request('/v1/config',undefined,'wrong'),ENV,cryptoApi),null);
  assert.equal(await authenticate(request('/v1/config'),{...ENV,MOBILE_DEVICE_TOKEN:''},cryptoApi),null);
});
test('health is passive; config is authenticated and does not claim remote tools',async()=>{
  const worker=gateway();const health=await worker.fetch(new Request('https://example.com/health'),ENV,context());assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
  const bad=await worker.fetch(request('/v1/config',undefined,'bad'),ENV,context());assert.equal(bad.status,401);
  const good=await worker.fetch(request('/v1/config'),ENV,context());const config=await good.json();assert.equal(config.voice,'Melodi');assert.equal(config.capabilities.live,true);assert.equal(config.capabilities.remote_modules,false);assert.equal(config.capabilities.gmail,false);assert.equal(config.capabilities.desktop_control,false);
  const serialized=JSON.stringify(config);for(const secret of [TOKEN,META,CARTESIA,ENV.CARTESIA_VOICE_ID])assert(!serialized.includes(secret));
});
test('query tokens and browser origins are rejected, auth rate limit uses a hash',async()=>{
  let identity;
  const env={...ENV,MOBILE_LIMIT:{async limit(value){identity=value.key;return {success:false};}}};
  const worker=gateway();assert.equal((await worker.fetch(request('/v1/config?token='+TOKEN),env,context())).status,403);
  assert.equal((await worker.fetch(request('/v1/config',undefined,TOKEN,{Origin:'https://evil.test'}),env,context())).status,403);
  assert.equal((await worker.fetch(request('/v1/config'),env,context())).status,429);assert.match(identity,/^[a-f0-9]{64}$/);assert.notEqual(identity,TOKEN);
  assert.equal((await worker.fetch(request('/v1/config'),{...ENV,MOBILE_LIMIT:null},context())).status,503);
});
test('chat bounds roles, total history and request bytes before opening a provider',async()=>{
  const worker=gateway();
  for(const body of [{messages:[]},{messages:[{role:'system',content:'injected'}]},{messages:Array.from({length:21},()=>({role:'user',content:'x'}))},{messages:[{role:'user',content:'x'.repeat(2401)}]},{messages:[{role:'assistant',content:'x'}]},{messages:[{role:'user',content:'x'}],tools:[]}])assert.equal((await worker.fetch(request('/v1/chat',body),ENV,context())).status,422);
  const oversized=new Request('https://example.com/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:' '.repeat(65537)});assert.equal((await worker.fetch(oversized,ENV,context())).status,413);
});
test('chat fixed provider and server persona stream UTF8 SSE into NDJSON',async()=>{
  let call;const worker=gateway(async(url,options)=>{call={url,options};const body=stream(sse('Qué bien.'));return new Response(body.body,{headers:{'Content-Type':'text/event-stream'}});});
  const response=await worker.fetch(request('/v1/chat',{messages:[{role:'user',content:'Hola.'}]}),ENV,context());assert.equal(response.status,200);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events,[{type:'delta',text:'Qué bien.'},{type:'done'}]);
  assert.equal(call.url,'https://api.meta.ai/v1/chat/completions');assert.equal(call.options.headers.Authorization,'Bearer '+META);const body=JSON.parse(call.options.body);assert.equal(body.model,'muse-spark-1.3');assert.equal(body.messages[0].role,'developer');assert(body.messages[0].content.includes('No tienes herramientas'));assert.equal(body.messages[1].content,'Hola.');
});
test('chat recognizes DONE without waiting for HTTP EOF and cancels provider body',async()=>{
  let cancel=false;const body=new ReadableStream({start(controller){controller.enqueue(encoder.encode(sse()));},cancel(){cancel=true;}});
  const response=await gateway(async()=>new Response(body,{headers:{'Content-Type':'text/event-stream'}})).fetch(request('/v1/chat',{messages:[{role:'user',content:'Hola.'}]}),ENV,context());
  assert((await response.text()).includes('"done"'));assert.equal(cancel,true);
});
test('provider payloads and tool calls are never forwarded as errors or actions',async()=>{
  const raw='data: '+JSON.stringify({error:{message:META+' '+TOKEN}})+'\n\n';
  const worker=gateway(async()=>new Response(raw,{headers:{'Content-Type':'text/event-stream'}}));
  const response=await worker.fetch(request('/v1/chat',{messages:[{role:'user',content:'x'}]}),ENV,context());const text=await response.text();assert(text.includes('provider_response'));assert(!text.includes(META));assert(!text.includes(TOKEN));
  const tool='data: '+JSON.stringify({choices:[{delta:{tool_calls:[{function:{name:'execute'}}]}}]})+'\n\n';
  const next=await gateway(async()=>new Response(tool,{headers:{'Content-Type':'text/event-stream'}})).fetch(request('/v1/chat',{messages:[{role:'user',content:'x'}]}),ENV,context());assert((await next.text()).includes('provider_response'));
});
test('speech sends only text plus server voice to Cartesia, returns aligned PCM',async()=>{
  let call;const worker=gateway(async(url,options)=>{call={url,options};return new Response(stream(new Uint8Array([1]),new Uint8Array([2,3,4])).body,{headers:{'Content-Type':'application/octet-stream'}});});
  const response=await worker.fetch(request('/v1/speech',{text:'Hola.'}),ENV,context());assert(response.headers.get('Content-Type').startsWith('audio/pcm'));assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4]);
  assert.equal(call.url,'https://api.cartesia.ai/tts/bytes');const body=JSON.parse(call.options.body);assert.equal(body.voice,ENV.CARTESIA_VOICE_ID);assert.deepEqual(body.output_format,{container:'raw',encoding:'pcm_s16le',sample_rate:24000});assert.equal(call.options.headers.Authorization,'Bearer '+CARTESIA);
});
test('speech bounds input and fails on incomplete PCM rather than inventing a sample',async()=>{
  const worker=gateway();for(const body of [{text:''},{text:'x'.repeat(1801)},{text:'x',voice:'other'}])assert.equal((await worker.fetch(request('/v1/speech',body),ENV,context())).status,422);
  const response=await gateway(async()=>new Response(new Uint8Array([1,2,3]))).fetch(request('/v1/speech',{text:'x'}),ENV,context());await assert.rejects(()=>response.arrayBuffer());
});
test('cancel downstream chat aborts upstream request and cancels remaining body',async()=>{
  let signal,cancel=false;const worker=gateway(async(_url,options)=>{signal=options.signal;return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'first'}}]})+'\n\n'));},cancel(){cancel=true;}}),{headers:{'Content-Type':'text/event-stream'}});});
  const response=await worker.fetch(request('/v1/chat',{messages:[{role:'user',content:'x'}]}),ENV,context());const reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(signal.aborted,true);assert.equal(cancel,true);
});
test('ASR handshake is server-owned; raw provider credentials cannot reach client',async()=>{
  const client=new Socket(),runtime=asrRuntime(),ctx=context();createASRSession(client,ENV,ctx,runtime);
  client.message(JSON.stringify({type:'start'}));await ctx.flush();assert.equal(runtime.calls.length,1);assert.equal(runtime.calls[0].url,'https://api.meta.ai/v1/asr/realtime');
  const handshake=JSON.parse(runtime.upstream.sent[0]);assert.equal(handshake.mode,'ENDPOINTING');assert.equal(handshake.audioEncoding,'PCM_24KHZ');assert.equal(handshake.authorization.accessToken,'Bearer '+META);
  runtime.upstream.message(JSON.stringify({sessionId:'private-provider-id',authorization:{token:META}}));runtime.upstream.message(JSON.stringify({type:'transcript',transcript:'Hola',audioProcessedMs:80,authorization:{token:META}}));
  const events=client.sent.map(JSON.parse);assert.equal(events[0].type,'ready');assert.equal(events[1].transcript,'Hola');assert(!client.sent.join('').includes(META));assert(!client.sent.join('').includes('private-provider-id'));
  client.message(new ArrayBuffer(3840));await ctx.flush();assert.equal(runtime.upstream.sent.at(-1).byteLength,3840);client.close();assert.equal(runtime.upstream.closed.length,1);
});
test('ASR rejects malformed frames and floods; no PCM is sent before readiness',async()=>{
  const client=new Socket(),runtime=asrRuntime(),ctx=context();createASRSession(client,ENV,ctx,runtime);client.message(JSON.stringify({type:'start'}));await ctx.flush();runtime.upstream.message(JSON.stringify({sessionId:'id'}));
  for(let i=0;i<4;i++)client.message(new ArrayBuffer(3840));await ctx.flush();assert(client.sent.join('').includes('audio_pacing'));assert.equal(runtime.upstream.sent.filter(x=>x instanceof ArrayBuffer).length,3);assert.equal(client.readyState,3);
  const other=new Socket(),next=asrRuntime(),context2=context();createASRSession(other,ENV,context2,next);other.message(new ArrayBuffer(100));await context2.flush();assert(other.sent.join('').includes('invalid_pcm'));assert.equal(next.calls.length,0);
});
test('ASR rejects malicious start options before provider access, Stop cancels setup',async()=>{
  const client=new Socket(),runtime=asrRuntime(),ctx=context();createASRSession(client,ENV,ctx,runtime);client.message(JSON.stringify({type:'start',authorization:{accessToken:'injected'}}));await ctx.flush();assert.equal(runtime.calls.length,0);
  const active=new Socket(),delayed=asrRuntime(),scope=context();let resolve;delayed.fetch=()=>new Promise(done=>{resolve=done;});createASRSession(active,ENV,scope,delayed);active.message('{"type":"start"}');await Promise.resolve();active.message('{"type":"stop"}');await Promise.resolve();resolve({status:101,webSocket:delayed.upstream});await scope.flush();assert.equal(delayed.upstream.readyState,3);assert.equal(delayed.upstream.sent.length,0);
});
test('ASR maximum lifetime is fifteen minutes and finish sends endStream',async()=>{
  const client=new Socket(),runtime=asrRuntime(),ctx=context();createASRSession(client,ENV,ctx,runtime);const maximum=[...runtime.timers.values()].find(timer=>timer.ms===900000);assert(maximum);client.message('{"type":"start"}');await ctx.flush();runtime.upstream.message('{"sessionId":"id"}');client.message('{"type":"finish"}');await ctx.flush();assert.deepEqual(JSON.parse(runtime.upstream.sent.at(-1)),{type:'endStream'});maximum.fn();assert.equal(client.readyState,3);assert.equal(runtime.upstream.readyState,3);
});
test('Muse sanitization ignores additive fields and refuses oversized provider messages',()=>{
  assert.equal(sanitizeMuse('{"type":"unknown","token":"secret"}'),null);assert.throws(()=>sanitizeMuse('x'.repeat(65537)));assert.throws(()=>sanitizeMuse('{"type":"error","message":"private"}'));
  assert.deepEqual(sanitizeMuse('{"type":"speaker","label":"A","turnId":2,"audioProcessedMs":100,"private":"x"}'),{type:'speaker',turnId:2,label:'A',audioProcessedMs:100});
});
