import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
test('workerd/R2: private multipart download checks the ticket, exact length, range and revocation',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:'admin',DEMO_DATA_KEY:Buffer.alloc(32,9).toString('base64')},r2Buckets:{DEMO_RELEASES:'synthetic-installer'},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},outboundService:async()=>{throw Error('external_request_forbidden')}}]}));
 const send=(path,body)=>mf.dispatchFetch('https://demo.invalid'+path,{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  await send('/admin/configure',{name:'Synthetic',invitation:'i'.repeat(43),expiresAt:Date.now()+86400000});await send('/admin/providers',{meta:'synthetic-meta-key-0123456789',cartesia:'synthetic-cartesia-key-0123456789',deepgram:'synthetic-deepgram-key-0123456789'});await send('/admin/enable',{});
  assert.equal((await mf.dispatchFetch('https://demo.invalid/download')).status,403);
  const bytes=Buffer.from('Synthetic installer fixture '.repeat(100)),sha256=createHash('sha256').update(bytes).digest('hex'),name='Brivany-Jon-Demo-Setup-0.0.0-x64.exe';
  assert.equal((await send('/admin/release/start',{name,size:bytes.length,sha256})).status,200);
  assert.equal((await send('/admin/release/complete',{ticket:'t'.repeat(43),expiresAt:Date.now()+3600000})).status,400);
  const uploaded=await mf.dispatchFetch('https://demo.invalid/admin/release/part?part=1',{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/octet-stream','Content-Length':String(bytes.length)},body:bytes});assert.equal(uploaded.status,200);
  const completed=await send('/admin/release/complete',{ticket:'t'.repeat(43),expiresAt:Date.now()+3600000});assert.equal(completed.status,200);
  const url='https://demo.invalid/download?ticket='+'t'.repeat(43),response=await mf.dispatchFetch(url);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('X-Brivany-SHA256'),sha256);
  const head=await mf.dispatchFetch(url,{method:'HEAD'});assert.equal(head.headers.get('Content-Length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await mf.dispatchFetch(url,{headers:{Range:'bytes=4-12'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(4,13));
  assert.equal((await mf.dispatchFetch(url+'x')).status,403);
  const updated=Buffer.from('Updated synthetic installer'),newHash=createHash('sha256').update(updated).digest('hex');
  assert.equal((await send('/admin/release/start',{name:'Brivany-Jon-Demo-Setup-0.0.1-x64.exe',size:updated.length,sha256:newHash})).status,200);
  assert.equal((await mf.dispatchFetch('https://demo.invalid/admin/release/part?part=1',{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/octet-stream','Content-Length':String(updated.length)},body:updated})).status,200);
  assert.equal((await send('/admin/release/complete',{ticket:'t'.repeat(43),expiresAt:Date.now()+3600000})).status,200);
  const sameLink=await mf.dispatchFetch(url);assert.equal(sameLink.status,200);assert.deepEqual(Buffer.from(await sameLink.arrayBuffer()),updated);assert.equal(sameLink.headers.get('X-Brivany-SHA256'),newHash);
  await send('/admin/revoke',{});assert.equal((await mf.dispatchFetch(url)).status,403);
 }finally{await mf.dispose()}
});
