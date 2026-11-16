// Validate the exact preserved production bundle with local identities/D1 and
// a substituted demo binding. Never sends a message, calls a phone or captures PC.
import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from '../workers/whatsapp/node_modules/miniflare/dist/src/index.js';
import {binarySourceParts} from './release_recall.mjs';import {digest} from '../workers/whatsapp/tools/cloudflare-release.mjs';import {appAgentSchema} from '../workers/whatsapp/vetsa-app-agents.js';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local/demo-jon/whatsapp-release'),report=JSON.parse(await readFile(join(out,'prepared.json'),'utf8')),settings=JSON.parse(await readFile(join(out,'settings.json'),'utf8')),source=await readFile(join(out,'worker-main.js'));
assert.equal(digest(source),report.bundleSha256);
const parts=binarySourceParts({bytes:await readFile(join(out,'baseline.multipart')),contentType:await readFile(join(out,'baseline-type.txt'),'utf8')}),PHONE='18095550101',OTHER='18095550202',DEVICE='10000000-0000-4000-8000-000000000001',KEY='a'.repeat(64);
const modules=[{type:'ESModule',path:join(out,'worker-main.js'),contents:source.toString()},...parts.filter(p=>p.name.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:join(out,p.name),contents:p.bytes}))];
const fake=`import {WorkerEntrypoint} from 'cloudflare:workers';export class DemoAccess extends WorkerEntrypoint {enroll(user,token){if(token!=='s'.repeat(43))throw Error('invalid');return {linked:true};}member(){return false;}generate(){return null;}}export default{fetch(){return new Response('Fixture')}}`;
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'whatsapp',modules,compatibilityDate:settings.compatibility_date,compatibilityFlags:settings.compatibility_flags||[],d1Databases:{VETSA_CLOUD:'demo-runtime'},bindings:{OWNER_WHATSAPP_NUMBER:PHONE,MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),ASSISTANT_WHATSAPP_NUMBER:'18095559999'},serviceBindings:{BRIVANY_DEMO:{name:'demo',entrypoint:'DemoAccess'},VETSA_IDENTITY:async r=>{const id=r.headers.get('Authorization')==='Bearer tester-a'?'a':r.headers.get('Authorization')==='Bearer tester-b'?'b':null;return Response.json(id?{authenticated:true,client:'brivany-desktop',user:{id,email:id+'@example.com',name:id==='a'?'Ana':'Bea'}}:{authenticated:false});}},outboundService:async()=>{throw Error('unexpected_external_request');}},{name:'demo',modules:true,script:fake,compatibilityDate:'2026-10-19'}]}));
try{
 const worker=await mf.getWorker('whatsapp'),db=await mf.getD1Database('VETSA_CLOUD');await db.batch(appAgentSchema.map(sql=>db.prepare(sql)));for(const [id,phone] of [['a',PHONE],['b',OTHER]])await db.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').bind(id,phone,Date.now()).run();
 const register=(token,demoToken,deviceKey=KEY)=>worker.fetch('https://ia.vetsa.es/api/brivany/whatsapp/desktop/register',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({deviceId:DEVICE,deviceKey,name:'PC sintético',demoToken})});
 assert.equal((await worker.fetch('https://ia.vetsa.es/health')).status,200);
 assert.equal((await register(null,'s'.repeat(43))).status,401);
 assert.equal((await register('tester-a','x'.repeat(43))).status,403);
 const accepted=await register('tester-a','s'.repeat(43));assert.equal(accepted.status,200,await accepted.text());
 assert.equal((await register('tester-b','s'.repeat(43))).status,403);
 assert.equal((await register('tester-a','s'.repeat(43),'b'.repeat(64))).status,403);
 const row=await db.prepare('SELECT * FROM brivany_desktop_devices WHERE device_id=?').bind(DEVICE).first();assert.equal(row.user_id,'a');assert.equal(row.phone,PHONE);assert(!JSON.stringify(row).includes(KEY));
 const proof={passed:true,bundleSha256:report.bundleSha256,existingCodePreserved:report.existingCodePreserved,mode:'workerd_local_D1_synthetic_identity_and_demo_binding',checks:['original_health_handler','native_account_authentication','demo_entitlement_required','own_phone_and_device_binding','cross_account_device_reassignment_rejected','device_key_not_stored_plaintext'],real_whatsapp_messages:0,external_provider_calls:0};await writeFile(join(out,'runtime.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
}finally{await mf.dispose()}
