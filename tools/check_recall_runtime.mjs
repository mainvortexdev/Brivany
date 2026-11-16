// Checks the exact append-only production artifact in workerd, with local D1/Queues.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from '../workers/whatsapp/node_modules/miniflare/dist/src/index.js';
import {sourceParts,digest} from '../workers/whatsapp/tools/cloudflare-release.mjs';
import {binarySourceParts} from './release_recall.mjs';
import {appAgentSchema} from '../workers/whatsapp/vetsa-app-agents.js';
import {recallFixture,OWNER,PHONE,REC} from '../workers/whatsapp/test/recall-fixture.js';
const root=resolve(import.meta.dirname,'..'),out=join(root,'tmp/recall-release'),f=await recallFixture();
const report=JSON.parse(await readFile(join(out,'prepared.json'),'utf8')),settings=JSON.parse(await readFile(join(root,'.local/recall-live-settings.json'),'utf8'));
const source=await readFile(join(out,'worker-main.js'));assert.equal(digest(source),report.bundleSha256);
const parts=binarySourceParts({bytes:await readFile(join(root,'.local/recall-live-source.multipart')),contentType:await readFile(join(root,'.local/recall-live-source-type.txt'),'utf8')});for(const part of parts)if(part.name!=='worker-main.js'){if(part.name.endsWith('.wasm'))assert.ok(WebAssembly.validate(part.bytes),'existing Wasm bytes must survive source download');await writeFile(join(out,part.name),part.bytes);}
const requests=[],checks=[],persist=join(out,'workerd-state-'+crypto.randomUUID());
const modules=[{type:'ESModule',path:join(out,'worker-main.js'),contents:source.toString('utf8')},...parts.filter(part=>part.name.endsWith('.wasm')).map(part=>({type:'CompiledWasm',path:join(out,part.name),contents:part.bytes}))];
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,resourcePersistencePath:persist,workers:[{name:'recall-test',modules,compatibilityDate:settings.compatibility_date,compatibilityFlags:settings.compatibility_flags||[],d1Databases:{VETSA_CLOUD:'synthetic-meetings'},queueProducers:{DONA_JOBS:'synthetic-meetings-jobs'},queueConsumers:{'synthetic-meetings-jobs':{maxBatchSize:1,maxBatchTimeout:0,maxRetries:1}},bindings:Object.fromEntries(Object.entries(f.env).filter(([,value])=>typeof value==='string')),serviceBindings:{VETSA_IDENTITY:async request=>f.env.VETSA_IDENTITY.fetch(request)},outboundService:async request=>{const body=['GET','HEAD'].includes(request.method)?undefined:await request.text();requests.push({path:new URL(request.url).pathname,method:request.method});return f.fetcher(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(body?{body}:{})});}}]}));
try{
 const worker=await mf.getWorker(),db=await mf.getD1Database('VETSA_CLOUD');await db.batch(appAgentSchema.map(sql=>db.prepare(sql)));await db.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').bind(OWNER,PHONE,Date.now()).run();
 const path='https://ia.vetsa.es/api/brivany/whatsapp/meetings';
 const unauthorized=await worker.fetch(path);assert.equal(unauthorized.status,401);checks.push('existing Vetsa auth still protects the deployed route');
 const response=await worker.fetch(path,{method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify(f.input())});const data=await response.json();assert.equal(response.status,202,JSON.stringify(data));
 async function until(predicate){for(let i=0;i<60;i++){const row=await db.prepare('SELECT * FROM brivany_meetings WHERE id=?').bind(data.meeting.id).first();if(await predicate(row))return row;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Local runtime did not reach the expected durable state');}
 await until(row=>!!row.bot_id);assert.equal(f.bots.length,1);checks.push('workerd serves the app request and its actual Queue consumer creates one bot');
 const invalid=f.signed('recording.done',{signature:'v1,YmFk'});assert.equal((await worker.fetch(invalid.url,{method:'POST',headers:invalid.headers,body:await invalid.text()})).status,401);
 for(const event of ['recording.done','transcript.done']){const request=f.signed(event);assert.equal((await worker.fetch(request.url,{method:'POST',headers:request.headers,body:await request.text()})).status,200);await until(row=>event==='recording.done'?row.transcript_state==='processing':row.status==='ready');}
 const detail=await(await worker.fetch(path+'/detail?id='+data.meeting.id,{headers:{Authorization:'Bearer synthetic-user'}})).json();assert.equal(detail.transcript[0].text,'Acuerdo sintético de la reunión.');checks.push('raw-body verification, D1 inbox, Queue processing and durable transcript all run in workerd');
 assert.equal(requests.filter(r=>r.path==='/api/v1/recording/'+REC+'/create_transcript/').length,1);checks.push('the runtime requests transcription once and uses no progress polling');
 const health=await worker.fetch('https://ia.vetsa.es/health');assert.equal(health.status,200);checks.push('the original public health handler remains available');
 const operatorInput=f.input(),queue=await mf.getQueueProducer('DONA_JOBS');await queue.send({type:'recall_operator_test',confirmed:true,meetingRequest:operatorInput});
 for(let attempt=0;attempt<60;attempt++){const operator=await db.prepare('SELECT bot_id,owner FROM brivany_meetings WHERE request_key=?').bind(operatorInput.requestId).first();if(operator?.bot_id){assert.equal(operator.owner,OWNER);break;}if(attempt===59)throw Error('operator verification did not create a durable intent');await new Promise(resolve=>setTimeout(resolve,100));}
 checks.push('authenticated private operator queue resolves the linked owner and uses the same submission flow');
 const saved={passed:true,bundleSha256:report.bundleSha256,compatibilityDate:settings.compatibility_date,mode:'workerd_local_d1_and_queues_synthetic_providers',checks,real_meetings_joined:0,external_provider_calls:0};await writeFile(join(out,'runtime-verification.json'),JSON.stringify(saved,null,2));console.log(JSON.stringify(saved,null,2));
}finally{await mf.dispose();f.db.sql.close();}
