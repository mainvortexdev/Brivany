import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {recordOwnerMessageReference,resolveOwnerReplyContext} from '../owner-reply-context.js';
import {projectDocumentRequest,resolveProjectDocument,cogniraImpactReport} from '../project-document-context.js';
import {handleOwnerMessage,ownerExecutorServices,executeApprovedOwnerTask,prepareOwnerProjectReport,ownerAutonomyServices,sendWhatsAppMedia} from '../owner-features.js';
import {sendWhatsApp} from '../worker.js';
import {job_generate_document} from '../executors/jobs/documents.js';
import {repairProjectDocument,PROJECT_REPAIR_MESSAGE,PROJECT_REPAIR_RECEIVED,PROJECT_REPAIR_JOB,PROJECT_REPAIR_FILENAME,PROJECT_REPAIR_TEXT} from '../project-document-repair.js';
import {ensureDocumentQuality} from '../document-quality.js';

const owner='18495205246',now=Date.parse('2026-10-09T16:30:00Z');
const quoted='Melodi: El proyecto Cognira Desktop está en progreso y el siguiente paso es crear planos 3D a partir de imágenes. Me gustaría investigar su utilidad.';
async function fixture(){
  const db=new FinanceD1();
  for(const file of ['schema.sql','story-campaign.sql','story-approval.sql','melodi-team-coordination.sql','melodi-artifact-tracking.sql','owner-task-references.sql','delivery-notice.sql'])db.sql.exec(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:owner,TEAM_AUTONOMY_ENABLED:'true',MEMORY_ENCRYPTION_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    WHATSAPP_PHONE_NUMBER_ID:'test-id',WHATSAPP_TOKEN:'test-only',MELODI_JOBS:{send:async value=>queue.push(value)},
    VETSA_INTELLIGENCE:{fetch:()=>{throw Error('must not ask a model to guess the project');}}};
  const services=ownerAutonomyServices(env),replies=[],controls=[],queue=[];
  async function project(name='Cognira Desktop',phone=owner){const s=await services.encrypt({name,status:'in_progress',nextStep:'Crear planos 3D a partir de imágenes'});
    db.sql.prepare('INSERT INTO wa_owner_projects VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),phone,s.encrypted,s.iv,new Date(now).toISOString(),new Date(now).toISOString());}
  async function conversation(agent,turns){const s=await services.encrypt({recent:turns});db.sql.prepare('INSERT OR REPLACE INTO wa_melodi_private_context VALUES(?,?,?,?,?)').run(owner,agent,s.encrypted,s.iv,new Date(now).toISOString());}
  await project();await project('Proyecto de otra persona','19999999999');
  db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(owner,'melodi',new Date(now).toISOString());
  db.sql.prepare('INSERT INTO wa_messages VALUES(?,?)').run(PROJECT_REPAIR_MESSAGE,PROJECT_REPAIR_RECEIVED);
  await recordOwnerMessageReference(env,{phone:owner,messageId:'melodi-visible-id',body:quoted,encrypt:services.encrypt});
  async function send(text=PROJECT_REPAIR_TEXT,{context='melodi-visible-id',authorize=()=>({allowed:true})}={}){
    return handleOwnerMessage(env,{phone:owner,message:{id:PROJECT_REPAIR_MESSAGE,type:'text',...(context?{context:{id:context}}:{})},incoming:text,
      markTyping:async()=>{},sendText:async(e,p,body,options)=>replies.push({body,options}),configureTeam:async command=>{controls.push(command);return command.action==='authorize_skill'?authorize(command):null;}});
  }
  return {env,db,services,replies,controls,queue,project,conversation,send};
}
test('a verified WhatsApp quote overrides stale Melodi ownership and prepares a grounded Melodi report before executing',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();assert.equal(await f.send(),true);
  assert.match(f.replies[0].body,/Cognira Desktop/);assert.doesNotMatch(f.replies[0].body,/^Melodi:/);assert.equal(f.replies[0].options.agent,'melodi');
  const auth=f.controls.find(c=>c.action==='authorize_skill');assert.equal(auth.agent,'melodi');assert.equal(auth.tool,'prepare_document');
  const p=await f.services.decrypt(...Object.values(f.db.sql.prepare('SELECT encrypted_payload,payload_iv FROM wa_owner_jobs').get()));
  assert.equal(p.autonomyAgent,'melodi');assert.equal(p.authorAgent,'melodi');assert.equal(p.preserveSourceContent,true);assert.equal(p.projectSubject,'Cognira Desktop');
  assert.match(p.sourceContent,/Melodi/);assert.match(p.sourceContent,/no resultados medidos/);assert.doesNotMatch(p.sourceContent,/otra persona/);assert.equal(f.queue.length,1);
  await f.send();assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_owner_jobs').get().n,1);
});
test('Melodi document authority must be approved; the helper retains Melodi ownership and Melodi authorship',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();
  await f.send(undefined,{authorize:()=>({allowed:false,approvalId:'approval-id',response:'Melodi: Melodi necesita mi ayuda. ¿Apruebas colaboración A4?'})});
  assert.equal(f.queue.length,0);assert.equal(f.replies.at(-1).options.agent,'melodi');assert.equal(f.controls.at(-1).action,'approval_notified');
  const input=f.controls.find(c=>c.action==='authorize_skill').input.ownerSkill;
  await executeApprovedOwnerTask(f.env,{phone:owner,helper:'melodi',input,sendText:async()=>{}});
  const row=f.db.sql.prepare('SELECT encrypted_payload,payload_iv FROM wa_owner_jobs').get(),p=await f.services.decrypt(row.encrypted_payload,row.payload_iv);
  assert.equal(p.autonomyAgent,'melodi');assert.equal(p.agent,'melodi');assert.equal(p.authorAgent,'melodi');assert.match(p.sourceContent,/Cognira Desktop/);
});
test('explicit owner addressing wins while only the quoted visible span supplies the project',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();await f.conversation('melodi',[{role:'assistant',message:'PRIVATE LILA SECRET',at:new Date(now).toISOString()}]);
  await f.send(`Melodi, ${PROJECT_REPAIR_TEXT}`);assert.equal(f.controls.find(c=>c.action==='authorize_skill').agent,'melodi');
  const row=f.db.sql.prepare('SELECT encrypted_payload,payload_iv FROM wa_owner_jobs').get(),p=await f.services.decrypt(row.encrypted_payload,row.payload_iv);
  assert.equal(p.autonomyAgent,'melodi');assert.doesNotMatch(p.sourceContent,/PRIVATE LILA SECRET/);
});
test('an unknown or another owner quote cannot create a report or select its alleged author',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();
  await f.send(undefined,{context:'unknown'});assert.equal(f.replies.length,1);assert.match(f.replies[0].body,/No pude recuperar/);assert.equal(f.queue.length,0);
  assert.equal((await resolveOwnerReplyContext(f.env,owner,{context:{id:'unknown'}},{decrypt:f.services.decrypt})).status,'unavailable');
  await assert.rejects(resolveOwnerReplyContext(f.env,'19999999999',{context:{id:'melodi-visible-id'}},{decrypt:f.services.decrypt}),/invalid_owner_reply_context/);
});
test('an unquoted anaphora uses only the selected agent recent offer, never a sole project or another agent context',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();await f.conversation('melodi',[{role:'assistant',message:quoted,at:new Date(now-60000).toISOString()}]);
  await f.send(undefined,{context:null});assert.equal(f.queue.length,0);assert.match(f.replies.at(-1).body,/¿De qué proyecto/);
  const options={agent:'melodi',recent:[{role:'assistant',message:quoted,at:new Date(now-60000).toISOString()}],decrypt:f.services.decrypt};
  assert.equal((await resolveProjectDocument(f.env,owner,PROJECT_REPAIR_TEXT,options)).project.name,'Cognira Desktop');
  assert.ok((await resolveProjectDocument(f.env,owner,PROJECT_REPAIR_TEXT,{...options,recent:[{...options.recent[0],at:new Date(now-3*3600000).toISOString()}]})).clarification);
  await f.project('Electro Wisly');assert.ok((await resolveProjectDocument(f.env,owner,PROJECT_REPAIR_TEXT,{...options,replyContext:{status:'resolved',body:quoted+' Electro Wisly'}})).clarification);
});
test('provider acknowledgement stores the real author encrypted, while failed sends and public recipients cannot forge owner references',async t=>{
  const f=await fixture();t.mock.method(globalThis,'fetch',async()=>Response.json({messages:[{id:'meta-confirmed-id'}]}));
  await sendWhatsApp(f.env,owner,'Melodi: Documento listo.',{agent:'melodi'});
  const row=f.db.sql.prepare('SELECT * FROM wa_melodi_message_references WHERE message_id=?').get('meta-confirmed-id');assert.equal(row.agent,'melodi');assert.doesNotMatch(row.encrypted_body,/Documento listo/);
  const resolved=await resolveOwnerReplyContext(f.env,owner,{context:{id:'meta-confirmed-id'}},{decrypt:f.services.decrypt});assert.equal(resolved.body,'Documento listo.');
  await sendWhatsApp(f.env,'19999999999','Melodi: Otro cliente.',{agent:'melodi'});assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_message_references').get().n,2);
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:131047}},{status:400}));
  await assert.rejects(sendWhatsApp(f.env,owner,'Melodi: No enviado.',{agent:'melodi'}),/WhatsApp API/);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_message_references').get().n,2);
  await assert.rejects(recordOwnerMessageReference(f.env,{phone:owner,messageId:'spoof',body:'Melodi: Hola',agent:'melodi',encrypt:f.services.encrypt}),/author_mismatch/);
});
test('projectless model output fails before rendering, storing or claiming delivery',async()=>{
  await assert.rejects(job_generate_document({env:{},row:{owner_phone:owner},jobId:'new-job',payload:{kind:'document',format:'docx',prompt:'Informe',projectSubject:'Cognira Desktop'}},
    {getIssuedDocument:async()=>null,documentKind:()=> 'document',cleanText:v=>v,callVetsa:async()=>({text:'# Impacto genérico\nSalud y educación'}),documentBytes:()=>{throw Error('must not render');},storeIssuedDocument:()=>{throw Error('must not store');}}),/project_document_subject_missing/);
});
test('a conversational quote survives semantic routing and deferred answer generation as visible data only',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture(),requests=[];
  f.env.VETSA_INTELLIGENCE.fetch=async request=>{const body=await request.json();requests.push(body);
    return Response.json({text:JSON.stringify(body.options.systemPrompt.includes('Clasifica semánticamente')?{intent:'chat',agent:'melodi'}:{category:'other'})});};
  const result=await f.send('¿Por qué crees que será útil?');assert.equal(result.agent,'melodi');assert.equal(result.handled,false);assert.equal(result.replyContext.body,quoted);
  const classification=requests.find(r=>r.options.systemPrompt.includes('Clasifica semánticamente'));
  assert.equal(JSON.parse(classification.contents).context.quotedMessage.body,quoted);assert.equal(f.queue.length,0);
});
test('a media reply stores only its actually visible caption and never an unsent audio caption',async t=>{
  const f=await fixture();let number=0;t.mock.method(globalThis,'fetch',async url=>Response.json(url.endsWith('/media')?{id:'upload'}:{messages:[{id:`media-ref-${++number}`}]}));
  await sendWhatsAppMedia(f.env,owner,'document',new Uint8Array([1]),'application/docx','report.docx','Melodi: '+ 'x'.repeat(2000));
  const result=await resolveOwnerReplyContext(f.env,owner,{context:{id:'media-ref-1'}},{decrypt:f.services.decrypt});assert.equal(result.agent,'melodi');assert.equal(result.body.length,1024);
  await sendWhatsAppMedia(f.env,owner,'audio',new Uint8Array([1]),'audio/ogg','audio.ogg','Melodi: Invisible caption');
  assert.equal((await resolveOwnerReplyContext(f.env,owner,{context:{id:'media-ref-2'}},{decrypt:f.services.decrypt})).status,'unavailable');
});
async function reported(f){
  const s=await f.services.encrypt({prompt:PROJECT_REPAIR_TEXT});
  f.db.sql.prepare("INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at) VALUES(?,?,'generate_document',?,?,'complete',?)").run(PROJECT_REPAIR_JOB,owner,s.encrypted,s.iv,PROJECT_REPAIR_RECEIVED);
  f.db.sql.prepare("INSERT INTO wa_melodi_artifact_tracking(job_id,owner,agent,job_type,status,created_at,updated_at) VALUES(?,?,'melodi','generate_document','delivered',?,?)").run(PROJECT_REPAIR_JOB,owner,now,now);
  f.db.sql.prepare("INSERT INTO wa_owner_documents(id,owner_phone,encrypted_metadata,metadata_iv,object_key,mime_type,file_name,created_at) VALUES(?,?,?,?,?,?,?,?)").run(PROJECT_REPAIR_JOB,owner,s.encrypted,s.iv,'private-old-file','application/docx',PROJECT_REPAIR_FILENAME,PROJECT_REPAIR_RECEIVED);
  f.env.REQUESTED_PROJECT_DOCUMENT_REPAIR_REV='2026-10-09.1';
}
test('bounded repair persists researched context across retries, rejects the old file, and asks approval once under the original requester',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();await reported(f);let calls=0;
  const args={services:f.services,now,prepare:async input=>{calls++;assert.equal(input.interpretation.agent,'melodi');assert.match(input.interpretation.sourceContent,/Cognira Desktop/);
    if(calls===1)throw Error('temporary failed enqueue');return prepareOwnerProjectReport(f.env,{...input,configureTeam:async command=>command.action==='authorize_skill'?{allowed:false,approvalId:'a1',response:'Melodi: ¿Apruebas colaboración A1?'}:null});}};
  await assert.rejects(repairProjectDocument(f.env,args),/temporary failed enqueue/);
  f.db.sql.prepare('DELETE FROM wa_owner_projects').run();assert.equal((await repairProjectDocument(f.env,args)).status,'approval_required');
  assert.equal((await repairProjectDocument(f.env,args)).status,'already_repaired');assert.equal(calls,2);assert.equal(f.queue.length,0);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_delivery_notices').get().n,2);
  const services=ownerExecutorServices();await assert.rejects(services.getIssuedDocument(f.env,owner,PROJECT_REPAIR_JOB),/document_quality_rejected/);
  assert.deepEqual(await services.findIssuedDocuments(f.env,owner,''),[]);assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_owner_documents').get().n,1);
});
test('repair refuses changed source or another owner and quality reviews do not hide another owner document',async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=await fixture();await reported(f);
  f.db.sql.prepare("UPDATE wa_melodi_artifact_tracking SET agent='melodi'").run();
  const result=await repairProjectDocument(f.env,{services:f.services,now,prepare:()=>{throw Error('must not run');}});assert.equal(result.status,'source_mismatch');
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM wa_melodi_delivery_notices').get().n,0);
  await ensureDocumentQuality(f.db);f.db.sql.prepare("INSERT INTO wa_document_quality_reviews VALUES(?,?,'invalid','other',NULL,?)").run('19999999999',PROJECT_REPAIR_JOB,new Date(now).toISOString());
  assert.ok(await ownerExecutorServices().getIssuedDocument(f.env,owner,PROJECT_REPAIR_JOB));
});
test('researched report states subject, explicit evidence limits and sources instead of unsupported social benefits',()=>{
  const p=projectDocumentRequest(PROJECT_REPAIR_TEXT);assert.equal(p.impactReport,true);assert.equal(p.intent,'generate_document');
  const report=cogniraImpactReport({name:'Cognira Desktop',status:'in_progress',nextStep:'Planos 3D'});assert.match(report,/Estado registrado: En curso/);assert.match(report,/Stanford/);assert.match(report,/no evalúa Cognira/);
  assert.equal(projectDocumentRequest('“'+PROJECT_REPAIR_TEXT+'”'),null);assert.equal(projectDocumentRequest('No '+PROJECT_REPAIR_TEXT),null);
});
