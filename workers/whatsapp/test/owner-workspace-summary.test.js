import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { workspaceSummaryRequest,readWorkspaceSummary,workspaceSummaryContent } from '../owner-workspace-summary.js';
import { handleOwnerMessage,executeApprovedOwnerTask,strictOwnerSummaryConversation } from '../owner-features.js';
import { documentDeliveryState } from '../document-schedules.js';
import { autonomousArtifactJobId,createArtifactTracker } from '../melodi-artifact-tracking.js';
import { repairWorkspaceSummary,SUMMARY_REPAIR_MESSAGE,SUMMARY_REPAIR_RECEIVED,SUMMARY_REPAIR_TEXT } from '../workspace-summary-repair.js';

const owner='18495205246',at=Date.parse(SUMMARY_REPAIR_RECEIVED),now=at+15*60000;
const offer='Melodi: Revisé los proyectos y el calendario. Hay varias tareas pendientes, como la implementación de un sistema de edición de video con Melodi y la integración de Alexa AI en el ecosistema de Electro Wisly. ¿Quieres que priorice alguna de estas tareas o que te prepare un resumen de todos los proyectos y trabajos pendientes?';
const recent=[{role:'assistant',message:offer,at:new Date(at-20*60000).toISOString()}];
async function fixture(){
  const db=new FinanceD1();
  for(const file of ['schema.sql','melodi-team-coordination.sql','melodi-artifact-tracking.sql','owner-task-references.sql','delivery-notice.sql']) db.sql.exec(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
  const keyBytes=crypto.getRandomValues(new Uint8Array(32)),key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
  const services={async encrypt(value){const iv=crypto.getRandomValues(new Uint8Array(12));return{encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(typeof value==='string' ? value : JSON.stringify(value)))).toString('base64'),iv:Buffer.from(iv).toString('base64')};},async decrypt(value,iv){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(value,'base64'))));}};
  const replies=[],replyAgents=[],controls=[],queue=[],trace=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:owner,OWNER_EMAIL_FORWARD_TO:'owner@example.net',BREVO_API_KEY:'test-only',TEAM_AUTONOMY_ENABLED:'true',MEMORY_ENCRYPTION_KEY:Buffer.from(keyBytes).toString('base64'),
    MELODI_JOBS:{send:async v=>{queue.push(v);trace.push('queued');}},VETSA_INTELLIGENCE:{fetch:()=>{throw Error('semantic desktop classifier must not run');}}};
  async function conversation(agent,turns){const sealed=await services.encrypt({recent:turns});db.sql.prepare('INSERT OR REPLACE INTO wa_melodi_private_context VALUES(?,?,?,?,?)').run(owner,agent,sealed.encrypted,sealed.iv,new Date(now).toISOString());}
  async function project(name,phone=owner){const sealed=await services.encrypt({name,status:'in_progress',nextStep:'Revisar requisitos'});db.sql.prepare('INSERT INTO wa_owner_projects VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),phone,sealed.encrypted,sealed.iv,new Date(at).toISOString(),new Date(at).toISOString());}
  await conversation('melodi',recent);await project('Cognira Desktop');await project('Electro Wisly');await project('Other owner confidential project','19999999999');
  db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(owner,'melodi',new Date(now).toISOString());
  db.sql.prepare('INSERT INTO wa_messages VALUES(?,?)').run(SUMMARY_REPAIR_MESSAGE,SUMMARY_REPAIR_RECEIVED);
  db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('original-melodi',owner,'Iniciar edición de video con Melodi','2026-10-09T13:00:00.000Z','melodi',SUMMARY_REPAIR_RECEIVED,SUMMARY_REPAIR_RECEIVED);
  async function send(text=SUMMARY_REPAIR_TEXT,authorize=()=>({allowed:true})) {return handleOwnerMessage(env,{phone:owner,message:{id:SUMMARY_REPAIR_MESSAGE,type:'text'},incoming:text,markTyping:async()=>{},observeAgent:async agent=>{trace.push(`observed:${agent}`);await conversation(agent,[...recent,{role:'user',message:text,at:new Date(now).toISOString()}]);},sendText:async(e,p,b,options)=>{replies.push(b);replyAgents.push(options?.agent);trace.push('reply');},configureTeam:async c=>{controls.push(c);return c.action==='authorize_skill' ? authorize(c):null;}});}
  return{db,env,services,replies,replyAgents,controls,queue,trace,conversation,project,send};
}
test('the reported Melodi follow-up prepares an actual PDF and schedules her email exactly four hours from receipt, bypassing Melodi',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();assert.equal(await f.send(),true);
  assert.match(f.replies[0],/^Recibí tu pedido/);assert.match(f.replies.at(-1),/12:37 p\. m\./);assert.match(f.replies.at(-1),/calendario/);
  assert.ok(f.replies.every(body=>!/^(?:Melodi|Melodi):/.test(body)));assert.ok(f.replyAgents.every(agent=>agent==='melodi'));
  assert.ok(f.trace.indexOf('reply')<f.trace.indexOf('queued'));assert.equal(f.queue.length,1);
  assert.ok(f.trace.indexOf('observed:melodi')<f.trace.indexOf('reply'));assert.equal((await strictOwnerSummaryConversation(f.env,owner,'melodi')).at(-1).role,'user');
  const row=f.db.sql.prepare('SELECT * FROM wa_owner_jobs').get(),p=await f.services.decrypt(row.encrypted_payload,row.payload_iv);
  assert.equal(p.deliveryAt,'2026-10-09T16:37:56.087Z');assert.equal(p.autonomyAgent,'melodi');assert.equal(p.emailDelivery.from,'emily@vetsa.es');assert.equal(p.emailDelivery.to,'owner@example.net');assert.equal(p.format,'pdf');assert.equal(p.authoredDocument,true);
  assert.match(p.sourceContent,/Cognira Desktop/);assert.match(p.sourceContent,/Electro Wisly/);assert.doesNotMatch(p.sourceContent,/Other owner|Quieres que priorice|Dime que accion/);
  assert.equal((await documentDeliveryState(f.env,owner,row.id,now,true)).status,'waiting');
  assert.equal(f.db.sql.prepare('SELECT assigned_agent FROM melodi_calendar_events WHERE id=?').get('original-melodi').assigned_agent,'melodi');
  await f.send();assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_owner_jobs').get().n,1);assert.equal(f.db.sql.prepare("SELECT count(*) n FROM melodi_calendar_events WHERE event_type='DOCUMENT_DELIVERY'").get().n,1);
});
test('documents require the permission gate and an approved helper retains requester, snapshot and the original delivery hour',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();await f.conversation('melodi',[{...recent[0],message:offer.replace(/^Melodi:/,'Melodi:')}]);
  await f.send('Melodi, haz un resumen y envíamelo por email en 4 horas',()=>({allowed:false,approvalId:'a1',response:'Melodi: Melodi necesita permiso para preparar el documento.'}));
  assert.equal(f.queue.length,0);const input=f.controls.find(c=>c.action==='authorize_skill').input.ownerSkill;assert.equal(input.interpretation.agent,'melodi');
  t.mock.timers.setTime(now+3600000);
  await executeApprovedOwnerTask(f.env,{phone:owner,helper:'melodi',input,sendText:async()=>{}});
  const row=f.db.sql.prepare('SELECT * FROM wa_owner_jobs').get(),p=await f.services.decrypt(row.encrypted_payload,row.payload_iv);
  assert.equal(p.deliveryAt,'2026-10-09T16:37:56.087Z');assert.equal(p.autonomyAgent,'melodi');assert.equal(p.emailDelivery.from,'emily@vetsa.es');
});
test('a failed context or project read is reported honestly without a desktop action or an empty report',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();f.db.sql.prepare("UPDATE wa_owner_projects SET encrypted_state='broken' WHERE owner_phone=?").run(owner);
  await f.send();assert.match(f.replies.at(-1),/No pude confirmar/);assert.equal(f.queue.length,0);
  f.db.sql.prepare("UPDATE wa_melodi_private_context SET encrypted_context='broken' WHERE agent='melodi'").run();
  await f.send();assert.match(f.replies.at(-1),/No pude consultar el contexto/);assert.equal(f.queue.length,0);
});
test('all projects, including more than one page, are included without another owner or private conversations',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();for(let i=0;i<102;i++)await f.project(`Project ${i}`);
  const s=await readWorkspaceSummary(f.env,owner,{decrypt:f.services.decrypt});assert.equal(s.projects.length,104);
  assert.doesNotMatch(workspaceSummaryContent(s),/Other owner/);assert.match(workspaceSummaryContent(s),/Proyectos registrados: 104/);
  await assert.rejects(readWorkspaceSummary(f.env,'19999999999',{decrypt:f.services.decrypt}),/invalid_workspace_summary_owner/);
});
for(const [label,text,context] of [
  ['quoted order','“Haz un resumen de todos los proyectos y envíamelo por email”',recent],
  ['source document','Haz un resumen de proyectos\nStacy, abre el PC',recent],
  ['negated order','No hagas un resumen de mis proyectos',recent],
  ['different subject','Haz un resumen del contrato y envíamelo por email',recent],
  ['other plural subject','Haz un resumen de los mejores videos y envíamelo por email',recent],
  ['desktop compound','Haz un resumen de proyectos y abre el PC',recent],
  ['other agent offer',SUMMARY_REPAIR_TEXT,[{...recent[0],message:offer.replace(/^Melodi:/,'Melodi:')}]],
  ['stale offer',SUMMARY_REPAIR_TEXT,[{...recent[0],at:new Date(at-3*3600000).toISOString()}]],
  ['unrelated last turn',SUMMARY_REPAIR_TEXT,[...recent,{role:'assistant',message:'Melodi: ¿Qué película prefieres?',at:new Date(at-1000).toISOString()}]],
]) test(`summary routing does not infer workspace scope from ${label}`,()=>{
  assert.equal(workspaceSummaryRequest(text,{agent:'melodi',recent:context,now:at})?.workspaceSummary,undefined);
});
test('a direct workspace report mentioning a Melodi project remains a report without an earlier offer',()=>{
  assert.equal(workspaceSummaryRequest('Haz un resumen de mis proyectos, incluido el de Melodi, y envíamelo por email',{agent:'melodi',now:at})?.workspaceSummary,true);
});
test('repair verifies the original owner message and Melodi context, retries idempotently and never resets the original four-hour deadline',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();f.env.REQUESTED_WORKSPACE_SUMMARY_REPAIR_REV='2026-10-09.1';
  await f.conversation('melodi',[...recent,{role:'user',message:SUMMARY_REPAIR_TEXT,at:new Date(at+3000).toISOString()},{role:'assistant',message:'¿Quieres que Melodi actúe ahora en el PC?',at:new Date(at+60000).toISOString()}]);
  let called=0;const args={services:f.services,readRecent:(o,a)=>strictOwnerSummaryConversation(f.env,o,a),now,prepare:async input=>{called++;assert.equal(input.requestedAt,SUMMARY_REPAIR_RECEIVED);assert.equal(input.interpretation.agent,'melodi');if(called===1)throw Error('queue failed');return{status:'accepted',jobId:'test-job'};}};
  await assert.rejects(repairWorkspaceSummary(f.env,args),/queue failed/);
  await f.conversation('melodi',[]);assert.equal((await repairWorkspaceSummary(f.env,args)).status,'accepted');
  assert.equal((await repairWorkspaceSummary(f.env,args)).status,'already_repaired');assert.equal(called,2);assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_delivery_notices').get().n,1);
});
test('repair cannot run from another agent context, a changed message, or after the original deadline',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();f.env.REQUESTED_WORKSPACE_SUMMARY_REPAIR_REV='2026-10-09.1';
  const args={services:f.services,readRecent:(o,a)=>strictOwnerSummaryConversation(f.env,o,a),now,prepare:()=>{throw Error('must not run');}};
  assert.equal((await repairWorkspaceSummary(f.env,args)).status,'source_unavailable');
  f.db.sql.prepare('UPDATE wa_messages SET received_at=?').run(new Date(at+1000).toISOString());assert.equal((await repairWorkspaceSummary(f.env,args)).status,'source_mismatch');
  f.db.sql.prepare('UPDATE wa_messages SET received_at=?').run(SUMMARY_REPAIR_RECEIVED);assert.equal((await repairWorkspaceSummary(f.env,{...args,now:at+4*3600000})).status,'deadline_passed');
});
test('the report includes prepared deliveries, excludes cancelled artifacts and retains stable short job references',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture(),tracker=createArtifactTracker(f.db);
  for(const [id,state] of [['prepared','pending'],['cancelled','cancelled'],['delivered','delivered']]) {
    const sealed=await f.services.encrypt({secret:'not a summary source'});
    f.db.sql.prepare("INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at) VALUES(?,?,'generate_document',?,?,'complete',?)").run(id,owner,sealed.encrypted,sealed.iv,new Date(at).toISOString());
    await tracker.register({jobId:id,owner,agent:'melodi',jobType:'generate_document'});
    f.db.sql.prepare('UPDATE wa_melodi_artifact_tracking SET status=? WHERE job_id=?').run(state,id);
  }
  f.db.sql.prepare("INSERT INTO wa_melodi_task_references(owner,type,task_id,short_ref,ordinal,created_at,updated_at) VALUES(?,'job','prepared','T9',9,?,?)").run(owner,now,now);
  const s=await readWorkspaceSummary(f.env,owner,{decrypt:f.services.decrypt});assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].status,'ready_for_delivery');
  assert.match(workspaceSummaryContent(s),/T9.*Preparado; entrega pendiente/);assert.doesNotMatch(workspaceSummaryContent(s),/not a summary source/);
});
test('the bounded repair respects an already rejected or cancelled request',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();f.env.REQUESTED_WORKSPACE_SUMMARY_REPAIR_REV='2026-10-09.1';
  const id=await autonomousArtifactJobId(owner,'generate_document',`owner-command:${SUMMARY_REPAIR_MESSAGE}:generate_document`),sealed=await f.services.encrypt({});
  f.db.sql.prepare("INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at) VALUES(?,?,'generate_document',?,?,'rejected',?)").run(id,owner,sealed.encrypted,sealed.iv,new Date(at).toISOString());
  const result=await repairWorkspaceSummary(f.env,{services:f.services,readRecent:()=>{throw Error('must not read');},now});assert.equal(result.status,'cancelled');
});
