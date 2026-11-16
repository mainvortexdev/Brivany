import test from 'node:test';
import assert from 'node:assert/strict';
import {FinanceD1} from './finance-fixture.js';
import {processWhatsAppEnvelope,runWhatsAppAction} from '../whatsapp-request-scope.js';
import {ownerAutonomyServices} from '../owner-features.js';
function setup(){
  const db=new FinanceD1();db.sql.exec('CREATE TABLE wa_messages(message_id TEXT PRIMARY KEY,received_at TEXT NOT NULL)');
  const env={VETSA_CLOUD:db,TEAM_CONVERSATION_LEADER:'melodi',WHATSAPP_PHONE_NUMBER_ID:'business',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')};
  const payload={entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[{id:'wamid.test1',from:'18095550101',type:'text',text:{body:'Hola'}}]}}]}]};
  const sent=[],services=ownerAutonomyServices(env);
  const raw=async(_env,phone,body)=>{sent.push({phone,body});return{status:'sent',messageId:'provider-'+sent.length};};
  return{env,payload,sent,services,raw,db};
}
test('a queued action followed by its response executes once through actual request-scope adapters',async()=>{
  const f=setup();let jobs=0,calls=0;
  const handler=async env=>{calls++;await runWhatsAppAction(env,'new-job',async()=>{jobs++;return{status:'queued',jobId:'job1'};});await env.WHATSAPP_PROCESSING_SCOPE.reply('18095550101','Melodi: Encargo registrado.',{agent:'melodi'});};
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'done');
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'done');
  assert.equal(jobs,1);assert.equal(calls,1);assert.equal(f.sent.length,1);assert.equal('WHATSAPP_PROCESSING_SCOPE' in f.env,false);
});
test('a provider/model failure before an action can retry without being lost as a seen message',async()=>{
  const f=setup();let calls=0;
  const handler=async env=>{if(++calls===1)throw Error('model timeout');await env.WHATSAPP_PROCESSING_SCOPE.reply('18095550101','Hola',{agent:'melodi'});};
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).retry,true);
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'done');
  assert.equal(f.sent.length,1);assert.equal(calls,2);
});
test('an uncertain action is quarantined and is never automatically executed a second time',async()=>{
  const f=setup();let accepted=0;
  const handler=env=>runWhatsAppAction(env,'send-email',async()=>{accepted++;throw Error('connection lost after provider acceptance');});
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'uncertain');
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'uncertain');
  assert.equal(accepted,1);assert.equal(f.sent.length,0);
});
test('a confirmed action cannot be replayed when the subsequent response preparation fails',async()=>{
  const f=setup();let jobs=0;
  const handler=async env=>{await runWhatsAppAction(env,'job',async()=>{jobs++;return{status:'queued',jobId:'job'};});throw Error('response formatting failure');};
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).retry,true);
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,handler,f.raw,f.services)).status,'done');
  assert.equal(jobs,1);
});
test('foreign business phone IDs cannot claim a receipt or execute routing',async()=>{
  const f=setup();f.payload.entry[0].changes[0].value.metadata.phone_number_id='foreign';
  assert.equal((await processWhatsAppEnvelope(f.env,f.payload,()=>{throw Error('must not route');},f.raw,f.services)).status,'ignored');
});
