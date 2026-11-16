import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {readFile,writeFile} from 'node:fs/promises';import {createHash,randomBytes,randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function bundle(file,override){return override?readFile(override,'utf8'):(await build({entryPoints:[fileURLToPath(new URL(file,import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers']})).outputFiles[0].text;}
test('authenticated demo creates an official QR through RPC without disclosing the issuer; revocation blocks new rooms',async()=>{
 const [demo,transfer]=await Promise.all([bundle('../worker.mjs',process.env.BRIVANY_DEMO_BUNDLE),bundle('../../file-transfer/src/index.mjs',process.env.BRIVANY_TRANSFER_BUNDLE)]);
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[
  {name:'demo',modules:true,script:demo,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:'synthetic-admin',DEMO_DATA_KEY:Buffer.alloc(32,9).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},serviceBindings:{DEMO_TRANSFERS:{name:'transfer',entrypoint:'DemoDropIssuer'}},outboundService:async()=>{throw Error('external_request_forbidden')}},
  {name:'transfer',modules:true,script:transfer,compatibilityDate:'2026-10-19',bindings:{ISSUER_TOKEN:'synthetic-private-issuer',PUBLIC_ORIGIN:'https://brivany.vetsa.es'},durableObjects:{TRANSFERS:{className:'FileTransfer',useSQLite:true},DROPS:{className:'DropSession',useSQLite:true}}}
 ]}));
 try{
  const worker=await mf.getWorker('demo'),relay=await mf.getWorker('transfer');
  const send=(path,body,token)=>worker.fetch('https://demo.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  await send('/admin/configure',{name:'Synthetic',invitation:'i'.repeat(43),expiresAt:Date.now()+86400000},'synthetic-admin');await send('/admin/providers',{meta:'synthetic-meta-key-0123456789',cartesia:'synthetic-cartesia-key-0123456789',deepgram:'synthetic-deepgram-key-0123456789'},'synthetic-admin');await send('/admin/enable',{},'synthetic-admin');
  const activated=await send('/v1/activate',{deviceId:randomUUID(),invitation:'i'.repeat(43)});assert.equal(activated.status,200);const {token}=await activated.json();
  const owner=randomBytes(32).toString('base64url'),id=randomBytes(16).toString('base64url'),body={id,owner_hash:hash(owner),claim_hash:hash('c'.repeat(43))};
  assert.equal((await send('/v1/transfers',body)).status,401);
  const created=await send('/v1/transfers',body,token);assert.equal(created.status,200);assert.deepEqual(await created.json(),{protocol:2,invite_seconds:600});
  const room=await relay.fetch('https://brivany.vetsa.es/transfer/drop/api/'+id,{headers:{Authorization:'Bearer '+owner}});assert.equal(room.status,200);
  assert.equal((await relay.fetch('https://brivany.vetsa.es/transfer/drop/api/'+randomBytes(16).toString('base64url'),{method:'POST',body:JSON.stringify(body)})).status,403);
  assert.equal((await send('/v1/transfers',body,token)).status,400);
  const second=await(await send('/v1/activate',{deviceId:randomUUID(),invitation:'i'.repeat(43)})).json();
  const concurrent=[{...body,id:randomBytes(16).toString('base64url')},{...body,id:randomBytes(16).toString('base64url')}];
  const statuses=await Promise.all(concurrent.map(value=>send('/v1/transfers',value,second.token).then(response=>response.status)));assert.deepEqual(statuses.sort(),[200,400]);
  for(const value of concurrent)await relay.fetch('https://brivany.vetsa.es/transfer/drop/api/'+value.id,{method:'DELETE',headers:{Authorization:'Bearer '+owner}});
  await send('/admin/revoke',{},'synthetic-admin');assert.equal((await send('/v1/transfers',body,token)).status,403);
  await relay.fetch('https://brivany.vetsa.es/transfer/drop/api/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+owner}});
  const report={passed:true,mode:'local_workerd_exact_bundles_RPC_and_Durable_Objects',demo_sha256:hash(demo),transfer_sha256:hash(transfer),checks:['demo session required','server-only issuer','official relay room created','new room revocation','per-device creation rate','unauthenticated direct creation rejected'],external_provider_calls:0};
  if(process.env.BRIVANY_TRANSFER_PROOF)await writeFile(process.env.BRIVANY_TRANSFER_PROOF,JSON.stringify(report,null,2));
 }finally{await mf.dispose()}
});
