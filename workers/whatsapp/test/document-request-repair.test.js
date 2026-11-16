import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {repairRequestedDocument,DOCUMENT_REPAIR_SOURCE,DOCUMENT_REPAIR_EVENT} from '../document-request-repair.js';
import {documentDeliveryState} from '../document-schedules.js';
class D1 {
 constructor(){this.sql=new DatabaseSync(':memory:');this.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));}
 prepare(query){const make=values=>({bind:(...v)=>make(v),run:async()=>({meta:{changes:Number(this.sql.prepare(query).run(...values).changes)}}),all:async()=>({results:this.sql.prepare(query).all(...values).map(r=>({...r}))}),first:async()=>this.sql.prepare(query).get(...values)||null});return make([]);}
 async batch(statements){this.sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());this.sql.exec('COMMIT');return out;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
const owner='18095551234',now=Date.parse('2026-10-08T23:00:00Z'),due='2026-10-12T13:00:00.000Z';
function fixture(){
 const db=new D1(),env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:owner,TEAM_AUTONOMY_ENABLED:'true',REQUESTED_DOCUMENT_REPAIR_REV:'2026-10-08.1'},jobs=[];
 const payload={prompt:'Quiero para ese mismo día 1 documento de todas las funcionalidades que Alexa AI deberá tener para esa empresa',deliveryMode:'private',autonomyAgent:'melodi',kind:'document',format:'docx'};
 db.sql.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at) VALUES (?,?, 'generate_document',?,'iv','complete',?)`).run(DOCUMENT_REPAIR_SOURCE,owner,JSON.stringify(payload),new Date(now).toISOString());
 db.sql.prepare(`INSERT INTO wa_owner_documents(id,owner_phone,document_kind,encrypted_metadata,metadata_iv,object_key,mime_type,file_name,created_at) VALUES (?,?,'document','{}','iv','private/original','application/docx','documento-2026-10-08-auto-Cmh.docx',?)`).run(DOCUMENT_REPAIR_SOURCE,owner,new Date(now).toISOString());
 db.sql.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES (?,?,?,?,'REMINDER','melodi',?,?)`).run(DOCUMENT_REPAIR_EVENT,owner,'terminar toda la integración de Alexa AI en el ecosistema de Electro Wisly',due,new Date(now).toISOString(),new Date(now).toISOString());
 const services={encrypt:async value=>({encrypted:value,iv:'iv'}),decrypt:async value=>JSON.parse(value),enqueue:async(...args)=>{jobs.push(args);}};
 return {db,env,services,jobs};
}
test('the exact reported document is repaired privately once with Melodi authoring and Melodi responsible for the original deadline',async()=>{
 const f=fixture(),result=await repairRequestedDocument(f.env,{services:f.services,now});assert.equal(result.status,'repaired');
 assert.equal(f.jobs.length,1);const payload=f.jobs[0][2];assert.equal(payload.deliveryAt,due);assert.equal(payload.autonomyAgent,'melodi');assert.equal(payload.authorAgent,'melodi');assert.equal(payload.authoredDocument,true);assert.equal(payload.deliveryMode,'private');assert.equal(payload.emailDelivery,null);
 assert.match(payload.sourceContent,/Electro Wisly/);assert.doesNotMatch(payload.sourceContent,/veterinari/i);assert.match(payload.sourceContent,/Por designar/);
 assert.equal(f.db.sql.prepare('SELECT event_at FROM melodi_calendar_events WHERE id=?').get(DOCUMENT_REPAIR_EVENT).event_at,due);
 assert.equal((await documentDeliveryState(f.env,owner,result.jobId,now,true)).status,'waiting');
 assert.equal((await repairRequestedDocument(f.env,{services:f.services,now})).status,'already_repaired');assert.equal(f.jobs.length,1);
 const notice=f.db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();assert.equal(notice.agent,'melodi');assert.equal(notice.owner_requested,1);assert.match(JSON.parse(notice.payload_encrypted).body,/9:00 a\. m\./);
 f.db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(`document-${result.jobId}`);await repairRequestedDocument(f.env,{services:f.services,now});assert.equal((await documentDeliveryState(f.env,owner,result.jobId,now,true)).active,false);
});
test('a queue failure can resume the same private repair without duplicating its calendar activity or notice',async()=>{
 const f=fixture(),enqueue=f.services.enqueue;f.services.enqueue=async()=>{throw Error('queue unavailable');};
 await assert.rejects(repairRequestedDocument(f.env,{services:f.services,now}),/queue unavailable/);
 f.services.enqueue=enqueue;assert.equal((await repairRequestedDocument(f.env,{services:f.services,now})).status,'repaired');
 assert.equal(f.db.sql.prepare('SELECT count(*) n FROM melodi_calendar_events').get().n,2);assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_delivery_notices').get().n,1);
});
test('repair does not infer authorization from quoted source text or cross-agent or cross-owner jobs',async()=>{
 for(const mode of ['source','agent','owner','disabled']){
  const f=fixture();if(mode==='source')f.db.sql.prepare('UPDATE wa_owner_jobs SET encrypted_payload=?').run(JSON.stringify({prompt:'Crea un documento\n\nQuiero para ese mismo día 1 documento',deliveryMode:'private',autonomyAgent:'melodi',kind:'document',format:'docx'}));
  if(mode==='agent')f.db.sql.prepare('UPDATE wa_owner_jobs SET encrypted_payload=?').run(JSON.stringify({prompt:'Quiero para ese mismo día 1 documento',deliveryMode:'private',autonomyAgent:'retired-agent',kind:'document',format:'docx'}));
  if(mode==='owner')f.env.OWNER_WHATSAPP_NUMBER='different';if(mode==='disabled')f.env.REQUESTED_DOCUMENT_REPAIR_REV='unknown';
  assert.notEqual((await repairRequestedDocument(f.env,{services:f.services,now})).status,'repaired');assert.equal(f.jobs.length,0);
 }
});
test('cancelled or elapsed integration events do not cause a replacement document to be scheduled',async()=>{
 for(const mode of ['cancelled','elapsed']){const f=fixture();if(mode==='cancelled')f.db.sql.prepare('DELETE FROM melodi_calendar_events').run();else f.db.sql.prepare('UPDATE melodi_calendar_events SET event_at=?').run(new Date(now-1000).toISOString());
  assert.equal((await repairRequestedDocument(f.env,{services:f.services,now})).status,'date_unavailable');assert.equal(f.jobs.length,0);
 }
});
