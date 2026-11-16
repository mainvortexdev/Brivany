import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createWhatsAppProcessing} from '../whatsapp-processing.js';

class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');this.sessions=[];}
  withSession(value){this.sessions.push(value);return this;}
  prepare(sql){
    const execute=values=>{const q=this.sql.prepare(sql);return q.columns().length?{results:q.all(...values).map(r=>({...r}))}:{meta:{changes:Number(q.run(...values).changes)}};};
    const bound=values=>({bind:(...next)=>bound(next),run:async()=>execute(values),all:async()=>execute(values),first:async()=>execute(values).results[0]??null});
    return bound([]);
  }
  async batch(statements){return Promise.all(statements.map(q=>q.run()));}
}
async function fixture(){
  const db=new D1(),at={value:Date.parse('2026-10-17T13:00:00Z')};
  db.sql.exec('CREATE TABLE wa_messages(message_id TEXT PRIMARY KEY,received_at TEXT NOT NULL)');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const hooks={now:()=>at.value,leaseMs:1000,
    async encrypt(text){const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:Buffer.from(iv).toString('base64'),encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text))).toString('base64')};},
    async decrypt(text,iv){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(text,'base64')));},
  };
  const inbox=createWhatsAppProcessing(db,hooks);await inbox.ensureSchema();
  const input={owner:'owner-a',messageId:'wamid.message-1'};
  return {db,at,hooks,inbox,input};
}
const started=(inbox,claim,key='create-job')=>inbox.markExternalEffect({...claim,effectKey:key,phase:'started'});
const confirmed=(inbox,claim,key='create-job',receipt={jobId:'job-1',status:'queued'})=>inbox.markExternalEffect({...claim,effectKey:key,phase:'confirmed',receipt});

test('crash before effects is retried after lease expiry, rather than permanently marked seen',async()=>{
  const {db,at,inbox,input}=await fixture(),first=await inbox.begin(input);
  assert.equal(first.action,'process');assert.equal(first.attempts,1);
  assert.equal((await inbox.begin(input)).action,'busy');
  at.value+=1001;
  const recovered=await inbox.begin(input);assert.equal(recovered.action,'process');assert.equal(recovered.attempts,2);assert.notEqual(recovered.token,first.token);
  assert.equal(await inbox.finish(first),false);assert.equal(await inbox.finish(recovered),true);
  assert.equal((await inbox.begin(input)).action,'done');
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_messages').get().n,0);
});

test('a failure before effects is retryable immediately and does not store error contents',async()=>{
  const {db,inbox,input}=await fixture(),first=await inbox.begin(input);
  assert.deepEqual(await inbox.fail({...first,code:'model_unavailable'}),{updated:true,status:'retryable',retry:true});
  const second=await inbox.begin(input);assert.equal(second.action,'process');assert.equal(second.attempts,2);
  await assert.rejects(inbox.fail({...second,code:'Contains owner private text'}),/invalid_processing_failure/);
  assert.equal(db.sql.prepare('SELECT error_code FROM wa_message_processing').get().error_code,'model_unavailable');
});

test('simultaneous deliveries get one live claim and only that token can write effects',async()=>{
  const {db,hooks,inbox,input}=await fixture();
  const another=createWhatsAppProcessing(db,hooks);
  const claims=await Promise.all([inbox.begin(input),another.begin(input)]);
  assert.equal(claims.filter(c=>c.action==='process').length,1);assert.equal(claims.filter(c=>c.action==='busy').length,1);
  const claim=claims.find(c=>c.action==='process');
  assert.equal((await started(inbox,{...claim,token:'wrong'})).allowed,false);
  assert.equal((await started(inbox,claim)).allowed,true);
  assert.deepEqual(await started(inbox,claim),{allowed:false,status:'started'});
  assert.deepEqual(db.sessions,['first-primary','first-primary']);
});

test('crash during an external effect is uncertain and never automatically executes it twice',async()=>{
  const {at,inbox,input}=await fixture(),claim=await inbox.begin(input);
  assert.equal((await started(inbox,claim)).allowed,true);at.value+=1001;
  assert.equal((await inbox.begin(input)).action,'uncertain');
  assert.equal((await confirmed(inbox,claim)).allowed,false);
  assert.equal(await inbox.finish(claim),false);
  assert.equal((await inbox.begin(input)).action,'uncertain');
});

test('confirmed job acceptance resumes only its existing receipt, without replaying the model or actions',async()=>{
  const {db,at,inbox,input}=await fixture(),claim=await inbox.begin(input);
  await started(inbox,claim);assert.equal((await confirmed(inbox,claim)).allowed,true);
  at.value+=1001;
  const resumed=await inbox.begin(input);assert.equal(resumed.action,'resume');assert.equal(resumed.effects[0].kind,'action');
  assert.deepEqual(resumed.effects[0].receipt,{jobId:'job-1',status:'queued'});
  assert.equal((await started(inbox,resumed,'create-job')).allowed,false);
  assert.equal((await started(inbox,resumed,'another-tool')).allowed,false);
  const response={...resumed,effectKey:'final-response',kind:'response'};
  assert.equal((await inbox.markExternalEffect(response)).allowed,true);
  assert.equal((await inbox.markExternalEffect({...response,phase:'confirmed',receipt:{messageId:'wamid.sent-1'}})).allowed,true);
  assert.equal(await inbox.finish(resumed),true);
  const raw=JSON.stringify(db.sql.prepare('SELECT * FROM wa_message_effects').all());assert.doesNotMatch(raw,/job-1|create-job|wamid.sent-1/);
});

test('prepared response survives a process restart and is encrypted, immutable and owner scoped',async()=>{
  const {db,at,hooks,inbox,input}=await fixture(),claim=await inbox.begin(input),response={body:'Private response for owner-a',agent:'melodi'};
  assert.equal(await inbox.saveResponse({...claim,response}),true);assert.equal(await inbox.saveResponse({...claim,response:{body:'replace'}}),false);
  assert.doesNotMatch(JSON.stringify(db.sql.prepare('SELECT * FROM wa_message_processing').get()),/Private response/);
  at.value+=1001;
  const restarted=createWhatsAppProcessing(db,hooks),resumed=await restarted.begin(input);
  assert.equal(resumed.action,'resume');assert.deepEqual(resumed.response,response);
  const other=await inbox.begin({...input,owner:'owner-b'});assert.equal(other.action,'process');assert.equal(other.response,null);assert.deepEqual(other.effects,[]);
  assert.equal(await inbox.finish({...resumed,owner:'owner-b'}),false);
  assert.equal(await inbox.saveResponse({...resumed,owner:'owner-b',response}),false);
});

test('confirmed effects can retry delivery after a definite rejection, uncertain sends cannot',async()=>{
  const {inbox,input}=await fixture(),claim=await inbox.begin(input);
  await started(inbox,claim);await confirmed(inbox,claim);
  const send={...claim,effectKey:'reply',kind:'response'};
  await inbox.markExternalEffect(send);
  assert.equal((await inbox.markExternalEffect({...send,phase:'rejected',receipt:{httpStatus:429}})).allowed,true);
  assert.equal((await inbox.fail({...claim,code:'reply_rate_limited'})).retry,true);
  const resume=await inbox.begin(input);assert.equal(resume.action,'resume');
  const sending={...resume,effectKey:'reply',kind:'response'};
  assert.equal((await inbox.markExternalEffect(sending)).allowed,true);
  assert.equal((await inbox.fail({...resume,code:'reply_timeout'})).status,'uncertain');
  assert.equal((await inbox.begin(input)).action,'uncertain');
});

test('finish cannot mark a still uncertain external operation as done; expiry and fake owners cannot heartbeat',async()=>{
  const {at,inbox,input}=await fixture(),claim=await inbox.begin(input);
  await started(inbox,claim);assert.equal(await inbox.finish(claim),false);
  assert.equal(await inbox.heartbeat({...claim,owner:'owner-b'}),false);
  at.value+=500;assert.equal(await inbox.heartbeat(claim),true);
  at.value+=1001;assert.equal(await inbox.heartbeat(claim),false);
  assert.deepEqual(await inbox.fail({...claim,code:'lease_elapsed'}),{updated:false,status:'lease_lost',retry:true});
  assert.equal((await inbox.begin(input)).action,'uncertain');
});

test('legacy seen messages remain intact and are never replayed or deleted',async()=>{
  const {db,inbox,input}=await fixture();
  db.sql.prepare('INSERT INTO wa_messages VALUES(?,?)').run(input.messageId,'2026-10-01T00:00:00Z');
  assert.equal((await inbox.begin(input)).action,'legacy');
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_messages').get().n,1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_message_processing').get().n,0);
});

test('invalid encryption and damaged receipts never permit an unverified replay',async()=>{
  const {db,at,inbox,input}=await fixture(),claim=await inbox.begin(input);
  await inbox.saveResponse({...claim,response:{body:'Private'}});
  db.sql.prepare("UPDATE wa_message_processing SET response_encrypted='damaged'").run();at.value+=1001;
  assert.deepEqual(await inbox.begin(input),{action:'uncertain',status:'uncertain',retry:false});
  const corrupt=createWhatsAppProcessing(db,{encrypt:async()=>null,decrypt:async()=>null});
  const fresh=await corrupt.begin({...input,messageId:'another'});
  await assert.rejects(corrupt.saveResponse({...fresh,response:{body:'private'}}),/processing_encryption_failed/);
});

test('retries are bounded and late confirmed effects cannot be attached to a different kind',async()=>{
  const {db,hooks,input}=await fixture(),inbox=createWhatsAppProcessing(db,{...hooks,maxAttempts:2});
  const first=await inbox.begin(input);await inbox.fail({...first,code:'temporarily_unavailable'});
  const second=await inbox.begin(input);assert.equal(second.attempts,2);
  assert.deepEqual(await inbox.fail({...second,code:'temporarily_unavailable'}),{updated:true,status:'uncertain',retry:false});
  assert.equal((await inbox.begin(input)).action,'uncertain');
  const fresh=await inbox.begin({...input,messageId:'second-message'});
  await started(inbox,fresh);
  assert.equal((await inbox.markExternalEffect({...fresh,effectKey:'create-job',kind:'response',phase:'confirmed',receipt:{messageId:'fake'}})).allowed,false);
  assert.equal(await inbox.finish(fresh),false);
});

test('a frozen-plan handoff releases its lease without spending a retry and fences the old worker',async()=>{
  const {db,inbox,input}=await fixture(),inline=await inbox.begin(input);
  assert.equal(await inbox.handoff(inline),true);
  assert.deepEqual({...db.sql.prepare('SELECT status,attempts,lease_token FROM wa_message_processing').get()},{status:'retryable',attempts:0,lease_token:null});
  const queued=await inbox.begin(input);assert.equal(queued.action,'process');assert.equal(queued.attempts,1);assert.notEqual(queued.token,inline.token);
  assert.equal(await inbox.heartbeat(inline),false);assert.equal((await started(inbox,inline)).allowed,false);assert.equal(await inbox.finish(inline),false);
  assert.equal(await inbox.finish(queued),true);
});

test('a prepared reply or any external effect prevents a handoff that could replay its work',async()=>{
  for(const mode of ['reply','started','confirmed']){
    const {inbox,input}=await fixture(),claim=await inbox.begin(input);
    if(mode==='reply')await inbox.saveResponse({...claim,response:{body:'Prepared answer'}});
    else{await started(inbox,claim);if(mode==='confirmed')await confirmed(inbox,claim);}
    assert.equal(await inbox.handoff(claim),false);assert.equal(await inbox.heartbeat(claim),true);
  }
});

test('different messages of one owner cannot process together while other owners stay independent',async()=>{
  const {inbox,input}=await fixture(),first=await inbox.begin({...input,serializeOwner:true});
  const next={...input,messageId:'next-owner-message',serializeOwner:true};
  assert.deepEqual(await inbox.begin(next),{action:'busy',status:'waiting_for_owner_turn',retry:true,retryAfterMs:1000});
  const other=await inbox.begin({...next,owner:'other-owner'});assert.equal(other.action,'process');
  assert.equal(await inbox.finish(first),true);assert.equal((await inbox.begin(next)).action,'process');
});
