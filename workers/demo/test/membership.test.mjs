import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
test('workerd: WhatsApp membership needs the demo device token, shares its budget and stays assigned after revocation',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});let requests=0;
 const driver=`export default {async fetch(r,e){const b=await r.json();try{return Response.json(b.action==='enroll'?await e.DEMO.enroll(b.user,b.token,'18095550101'):await e.DEMO.generate(b.user,{model:'spaik-pro',contents:'Synthetic message',options:{max_tokens:100}}));}catch{return new Response('Rejected',{status:403});}}}`;
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:'admin',DEMO_DATA_KEY:Buffer.alloc(32,9).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},outboundService:async r=>{requests++;assert.equal(new URL(r.url).hostname,'api.meta.ai');return Response.json({choices:[{message:{content:'Synthetic answer'},finish_reason:'stop'}]});}},{name:'driver',modules:true,script:driver,compatibilityDate:'2026-10-19',serviceBindings:{DEMO:{name:'demo',entrypoint:'DemoAccess'}}}]}));
 const send=(path,body,token='admin')=>mf.dispatchFetch('https://demo.invalid'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  await send('/admin/configure',{name:'Synthetic',invitation:'i'.repeat(43),expiresAt:Date.now()+86400000});await send('/admin/providers',{meta:'synthetic-meta-key-0123456789',cartesia:'synthetic-cartesia-key-0123456789',deepgram:'synthetic-deepgram-key-0123456789'});await send('/admin/enable',{});
  const session=await(await send('/v1/activate',{deviceId:randomUUID(),invitation:'i'.repeat(43)})).json(),channel=await mf.getWorker('driver');const rpc=body=>channel.fetch('https://channel.invalid',{method:'POST',body:JSON.stringify(body)});
  assert.equal(await(await rpc({user:'not-a-demo-user'})).json(),null);assert.equal(requests,0);
  assert.equal((await rpc({action:'enroll',user:'tester-a',token:'x'.repeat(43)})).status,403);
  assert.equal((await rpc({action:'enroll',user:'tester-a',token:session.token})).status,200);
  assert.equal((await rpc({action:'enroll',user:'tester-b',token:session.token})).status,403);
  assert.equal((await(await rpc({user:'tester-a'})).json()).provider,'Meta');assert.equal(requests,1);
  const state=await(await send('/v1/account',undefined,session.token)).json();assert.equal(state.reserved_usd,.05);
  await send('/admin/revoke',{});assert.equal((await rpc({user:'tester-a'})).status,403);assert.equal(requests,1);
 }finally{await mf.dispose()}
});
