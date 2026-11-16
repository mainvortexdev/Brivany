import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {createAgentRuntime} from '../melodi-autonomy.js';
import {createAutonomyStore} from '../melodi-autonomy-store.js';
import {executeAutonomyTool} from '../melodi-autonomy-tools.js';
import {buildAgentEvidence,serializeAgentToolMemory} from '../melodi-result-grounding.js';

const OWNER='18095550101';
const source=()=>({configured:true,results:[{title:'Precio oficial',url:'https://example.org/pricing',
  highlights:['El precio es 10 dólares al mes. La auditoría no está disponible.']}]});
async function fixture(generate,extra={}) {
  const db=new FinanceD1();
  for(const migration of ['schema.sql','melodi-team-coordination.sql','melodi-permissions.sql','melodi-routines.sql',
    'melodi-autonomy-maintenance.sql','melodi-artifact-tracking.sql']) db.sql.exec(readFileSync(new URL(`../${migration}`,import.meta.url),'utf8'));
  let now=Date.parse('2026-10-17T16:00:00Z');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const calls={models:[],reads:[],documents:[],sends:[],queued:[]};
  const services={
    async encrypt(value){const iv=crypto.getRandomValues(new Uint8Array(12));return{encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)))).toString('base64'),iv:Buffer.from(iv).toString('base64')};},
    async decrypt(value,iv){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(value,'base64'))));},
    async generate(agent,input,prompt){calls.models.push({agent,input,prompt});return generate(agent,input);},
    async inspectWorkspace(){return{projects:[],calendar:[],jobs:[]};},
    async researchPublicWeb(input){calls.reads.push(input);return source();},
    async prepareDocument(input){calls.documents.push(input);return{status:'prepared',jobId:'grounded-document',artifact:{objectKey:'private/document.pdf',mimeType:'application/pdf'}};},
    async privateJobInfo(owner,id){if(owner!==OWNER||id!=='grounded-document'||!calls.documents.length)return null;return{row:{id,owner_phone:OWNER,status:'complete'},agent:calls.documents[0].agent,brainTaskId:calls.documents[0].brainTaskId,origin:'owner_request',artifact:{objectKey:'private/document.pdf',mimeType:'application/pdf'}};},
    async deliverArtifact(...args){calls.sends.push(args);return{status:'sent',messageId:'document-receipt'};},
    ...extra,
  };
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TEAM_AUTONOMY_ENABLED:'true',TEAM_CONVERSATION_LEADER:'melodi',MELODI_JOBS:{async send(message){calls.queued.push(message);}}};
  const store=createAutonomyStore(db,{...services,now:()=>now});await store.ensureSchema();
  const runtime=createAgentRuntime(env,{store,services,now:()=>now,async sendText(...args){calls.sends.push(args);return{status:'sent',messageId:'grounding-'+calls.sends.length};}});
  await runtime.initialize();
  return{db,env,services,runtime,store,calls,advance(){now+=3000;},get now(){return new Date(now).toISOString();}};
}
const researchDecision={action:'tool',tool:'research_public_web',input:{query:'Comprueba el precio y las restricciones'},
  plan:[{description:'Consultar fuente real',tool:'research_public_web'}]};

test('runtime replaces fabricated price and unlimited audit prose with sourced complete facts',async()=>{
  const h=await fixture((_agent,input)=>input.task_memory.receipts.length
    ? {action:'message',message:'El precio confirmado es 999999 dólares y hay auditoría ilimitada.'}:researchDecision);
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'fabricated-result',objective:'Investiga el precio y la auditoría',requiredTools:['research_public_web']});
  await h.runtime.runAgent('melodi');await h.runtime.deliverOutbox();
  assert.equal(h.calls.sends.length,1);const text=h.calls.sends[0][2];
  assert.match(text,/10 dólares/);assert.match(text,/auditoría no está disponible/);assert.match(text,/https:\/\/example.org\/pricing/);
  assert.doesNotMatch(text,/999999|auditoría ilimitada/);
  const outbox=await h.store.peekOutbox({owner:OWNER,agent:'melodi',messageKey:'nonexistent',now:h.now});assert.equal(outbox,null);
  const task=await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId});assert.equal(task.status,'completed');
  assert.ok(task.memory.every(item=>JSON.parse(item.fact)));
});

test('runtime accepts block-selected facts with labelled analysis and persists provenance receipts',async()=>{
  const h=await fixture((_agent,input)=>{
    if(!input.task_memory.receipts.length)return researchDecision;
    const fact=input.result_evidence.find(block=>block.text.includes('10 dólares'));
    return{action:'message',message:'Texto sin autoridad: 999999 dólares.',result:{claims:[{kind:'fact',evidenceIds:[fact.id]},
      {kind:'inference',evidenceIds:[fact.id],text:'Recomiendo comprobar esta limitación antes de contratar.'}]}};
  });
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'grounded-claims',objective:'Investiga el coste y sus límites',requiredTools:['research_public_web']});
  await h.runtime.runAgent('melodi');
  const pending=await h.store.peekOutbox({owner:OWNER,agent:'melodi',messageKey:`brain-result:${accepted.taskId}`,now:h.now});
  assert.equal(pending.payload.grounding.verified,true);assert.equal(pending.payload.grounding.receipts[1].verified,false);
  assert.match(pending.payload.body,/Inferencia: Recomiendo/);assert.doesNotMatch(pending.payload.body,/999999/);
  assert.ok(h.calls.models[1].prompt.includes('result_evidence'));assert.ok(pending.payload.grounding.receipts[0].provenance[0].sourceId.includes(':step'));
});

test('a factual document uses verified data rather than invented model content before permission persistence',async()=>{
  const h=await fixture((_agent,input)=>!input.task_memory.receipts.length
    ? {...researchDecision,plan:[...researchDecision.plan,{description:'Preparar el informe',tool:'prepare_document'}]}
    : {action:'tool',tool:'prepare_document',input:{title:'Auditoría ilimitada por 999999 dólares',content:'El coste confirmado es 999999 dólares; auditoría ilimitada.',format:'pdf'}});
  await h.runtime.permissions.adjustLevel({owner:OWNER,agent:'melodi',level:1,eventKey:'lower-leader-for-document'});
  await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'document-before-approval',objective:'Investiga el precio y prepara el informe',requiredTools:['research_public_web','prepare_document']});
  await h.runtime.runAgent('melodi');
  const [request]=await h.runtime.permissions.listPending(OWNER);assert.equal(request.tool,'prepare_document');
  const raw=h.db.sql.prepare('SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests WHERE id=?').get(request.id);
  const input=await h.services.decrypt(raw.input_encrypted,raw.input_iv);
  assert.match(input.content,/10 dólares/);assert.match(input.content,/auditoría no está disponible/);
  assert.doesNotMatch(JSON.stringify(input),/999999|auditoría ilimitada/i);assert.equal(h.calls.documents.length,0);
});

test('authored documents without research remain available as labelled unverified drafts',async()=>{
  const h=await fixture((_agent,input)=>input.task_memory.receipts.length
    ? {action:'message',message:'Todos los hechos de la carta están verificados.'}
    : {action:'tool',tool:'prepare_document',input:{title:'Carta creativa',content:'Querida Ana, imagino un jardín en las nubes.',format:'pdf'},plan:[{description:'Redactar la carta solicitada',tool:'prepare_document'}]});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'authored-draft',objective:'Prepara una carta creativa para mí',requiredTools:['prepare_document']});
  await h.runtime.runAgent('melodi');assert.equal(h.calls.documents.length,1);assert.equal(h.calls.reads.length,0);
  assert.match(h.calls.documents[0].content,/^Borrador generado; los hechos no están verificados/);
  assert.match(h.calls.documents[0].content,/jardín en las nubes/);
  const task=await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId});assert.equal(task.status,'completed');
  const pending=await h.store.peekOutbox({owner:OWNER,agent:'melodi',messageKey:`brain-result:${accepted.taskId}`,now:h.now});
  assert.match(pending.payload.body,/Aquí tienes el documento para revisarlo/);assert.doesNotMatch(pending.payload.body,/Todos los hechos|jardín|private\/document/);
  assert.ok(pending.payload.body.length < 900,'artifact caption fits without truncating a source limitation');
});

test('a twenty kilobyte source is omitted whole and its partial coverage survives runtime and durable JSON',async()=>{
  const long='La auditoría está disponible. '+('Contenido intermedio. '.repeat(1000))+' Limitación final: la auditoría no está disponible para este plan.';
  const observed=await executeAutonomyTool({agent:'melodi',name:'research_public_web',input:{query:'Auditoría'},ownerPhone:OWNER,eventId:'large-source'},
    {researchPublicWeb:async()=>({configured:true,results:[{title:'Fuente extensa',url:'https://example.org/long',highlights:[long]}]})});
  assert.equal(observed.data._grounding.partial,true);assert.doesNotMatch(observed.data.results[0].highlights[0],/auditoría está disponible/);
  const memory=serializeAgentToolMemory(observed.data);assert.ok(memory.length<=1900);const decoded=JSON.parse(memory);
  assert.equal(decoded._grounding.partial,true);
  const blocks=buildAgentEvidence({observations:[observed]});assert.ok(blocks.some(block=>block.text.includes('Cobertura parcial')));
  assert.ok(blocks.every(block=>!block.text.includes('La auditoría está disponible')));
});

test('bounded durable memory keeps whole limitations, source URLs and useful values without broken JSON',()=>{
  const long={results:[{title:'Dato extenso',url:'https://example.org/source',highlights:['x'.repeat(4000),'No está disponible el soporte prometido.']}],summary:{currencies:{USD:{income:20,expense:5}}}};
  const memory=serializeAgentToolMemory(long),data=JSON.parse(memory);
  assert.ok(memory.length<=1900);assert.equal(data._grounding.partial,true);
  assert.ok(memory.includes('No está disponible el soporte prometido.'));assert.ok(memory.includes('https://example.org/source'));
  assert.equal(data.summary.currencies.USD.income,20);assert.doesNotMatch(memory,/x{30}/);
});
