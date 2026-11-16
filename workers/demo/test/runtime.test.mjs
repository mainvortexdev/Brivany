import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
test('workerd: shared five-dollar budget, encrypted provider setup, device limits and immediate revocation',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});let calls=0;
 const admin='admin-'+randomUUID(),setup='setup-'+randomUUID(),invite='invite-'+randomUUID();
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:admin,DEMO_SETUP_TOKEN:setup,DEMO_DATA_KEY:Buffer.alloc(32,7).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},outboundService:async r=>{calls++;assert.equal(new URL(r.url).hostname,'api.meta.ai');assert.equal(r.headers.get('Authorization'),'Bearer '+('synthetic-meta-'.repeat(3)));const b=await r.json();assert.equal(b.model,'muse-spark-1.3');return Response.json({choices:[{message:{content:'Respuesta sintética'}}]});}}]}));
 const send=(path,body,token,method=body===undefined?'GET':'POST')=>mf.dispatchFetch('https://demo.invalid'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await send('/v1/account')).status,401);
  assert.equal((await send('/admin/configure',{name:'Equipo de prueba',invitation:invite,expiresAt:Date.now()+86400000,budgetMicros:5000001},admin)).status,400);
  assert.equal((await send('/admin/configure',{name:'Equipo de prueba',invitation:invite,expiresAt:Date.now()+86400000,budgetMicros:5000000},admin)).status,200);
  assert.equal((await send('/v1/activate',{deviceId:randomUUID(),invitation:invite})).status,403);
  const providers={meta:'synthetic-meta-'.repeat(3),cartesia:'synthetic-cartesia-'.repeat(3),deepgram:'synthetic-deepgram-'.repeat(3)};
  const stored=await send('/admin/providers',providers,setup);assert.equal(stored.status,200);assert.deepEqual(await stored.json(),{meta:true,cartesia:true,deepgram:true});assert.equal((await send('/admin/providers',providers,setup)).status,403);
  assert.equal((await send('/admin/enable',{},admin)).status,200);
  const tokens=await Promise.all(Array.from({length:10},async()=>{const r=await send('/v1/activate',{deviceId:randomUUID(),invitation:invite});return r.status===200?(await r.json()).token:null;}));assert.equal(tokens.filter(Boolean).length,8);
  const token=tokens.find(Boolean),token2=tokens.filter(Boolean)[1];assert.equal((await send('/v1/account',undefined,token)).status,200);
  const statuses=await Promise.all(Array.from({length:110},(_,i)=>send('/proxy/meta/v1/chat/completions',{model:'muse-spark-1.3',messages:[{role:'user',content:'simulado'}],max_completion_tokens:100},i%2?token:token2).then(r=>r.status)));
  assert.equal(statuses.filter(s=>s===200).length,100);assert.equal(statuses.filter(s=>s===402).length,10);assert.equal(calls,100);
  const state=await(await send('/v1/account',undefined,token)).json();assert.equal(state.remaining_usd,0);assert.equal(state.budget_usd,5);assert(!JSON.stringify(state).includes(providers.meta));
  assert.equal((await send('/admin/revoke',{},admin)).status,200);assert.equal((await send('/v1/account',undefined,token)).status,403);assert.equal(calls,100);
 }finally{await mf.dispose()}
});
