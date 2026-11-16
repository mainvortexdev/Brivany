import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceD1 } from './finance-fixture.js';
import { persistSemanticCalendarEvents as createReminderBatch } from '../semantic-calendar-store.js';
import { repairRequestedSemanticSchedule, SEMANTIC_SCHEDULE_REPAIR_MESSAGE as MESSAGE,
  SEMANTIC_SCHEDULE_REPAIR_AT as SOURCE_AT, SEMANTIC_SCHEDULE_REPAIR_REPLY as REPLY } from '../semantic-calendar-request-repair.js';

const OWNER = '18495205246', NOW = Date.parse('2026-10-26T12:30:00Z');
const TEXT = 'Melodi, hoy voy al box a las 9:10, tengo un live a las 12. Alfredo me dijo: "ven a las 11:30 para hacer la cotización". Y el domingo 1 de noviembre tengo la grabación a las 5 a. m. Recuérdamelo.';
const EVENTS = [
  {title:'Ir al box',eventAt:'2026-10-26T13:10:00.000Z'},
  {title:'Hacer la cotización con Alfredo',eventAt:'2026-10-26T15:30:00.000Z'},
  {title:'Hacer el live',eventAt:'2026-10-26T16:00:00.000Z'},
  {title:'Ir a la grabación',eventAt:'2026-11-01T09:00:00.000Z'},
];
const check = (name, run) => test(name, async t => { t.mock.timers.enable({apis:['Date'],now:NOW}); await run(t); });
async function fixture() {
  const db = new FinanceD1(), calls = {model:0,persist:0,sync:0,authorize:0,queue:[]};
  db.sql.exec(`CREATE TABLE melodi_calendar_events(id TEXT PRIMARY KEY,phone TEXT NOT NULL,title TEXT NOT NULL,event_at TEXT NOT NULL,event_type TEXT NOT NULL,assigned_agent TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE wa_message_processing(owner TEXT,message_id TEXT,status TEXT,attempts INTEGER,created_at INTEGER,response_encrypted TEXT,response_iv TEXT);
    CREATE TABLE wa_message_effects(owner TEXT,message_id TEXT,kind TEXT,status TEXT);
    CREATE TABLE wa_owner_session(owner_phone TEXT PRIMARY KEY,session_type TEXT,encrypted_state TEXT,state_iv TEXT,updated_at TEXT);
    CREATE TABLE wa_melodi_private_context(owner_phone TEXT,agent TEXT,encrypted_context TEXT,context_iv TEXT,updated_at TEXT,PRIMARY KEY(owner_phone,agent));`);
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const services = {
    async encrypt(value) {const iv=crypto.getRandomValues(new Uint8Array(12));return {encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)))).toString('base64'),iv:Buffer.from(iv).toString('base64')};},
    async decrypt(value,iv) {return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(value,'base64')));},
  };
  const response = await services.encrypt({body:REPLY,agent:'melodi'});
  db.sql.prepare('INSERT INTO wa_message_processing VALUES(?,?,?,?,?,?,?)').run(OWNER,MESSAGE,'done',1,Date.parse(SOURCE_AT),response.encrypted,response.iv);
  const session = await services.encrypt({title:'Older unrelated request'});
  db.sql.prepare('INSERT INTO wa_owner_session VALUES(?,?,?,?,?)').run(OWNER,'await_reminder_time',session.encrypted,session.iv,'2026-10-26T03:23:11.574Z');
  async function context(recent=[{role:'user',message:TEXT,at:'2026-10-26T12:22:23.500Z'},{role:'assistant',message:REPLY,at:'2026-10-26T12:22:30.797Z'}]) {
    const sealed=await services.encrypt({recent});db.sql.prepare('INSERT OR REPLACE INTO wa_melodi_private_context VALUES(?,?,?,?,?)').run(OWNER,'melodi',sealed.encrypted,sealed.iv,'2026-10-26T12:22:30.797Z');
  }
  await context();
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo',REQUESTED_SEMANTIC_SCHEDULE_REPAIR_REV:'2026-10-26.2',MELODI_JOBS:{async send(body){calls.queue.push(body);}}};
  const options={services,now:()=>Date.now(),
    interpret:async(raw,request)=>{calls.model++;assert.equal(raw,TEXT);assert.equal(request.referenceAt,SOURCE_AT);assert.equal(request.now,Date.now());return{route:'events',events:EVENTS};},
    authorize:async request=>{calls.authorize++;assert.equal(request.messageId,MESSAGE);assert.equal(request.tool,'manage_calendar');return{allowed:true};},
    persist:async(...args)=>{calls.persist++;assert.equal(args[2],MESSAGE);return createReminderBatch(...args);},
    sync:async input=>{calls.sync++;assert.equal(input.owner,OWNER);},
  };
  const events=()=>db.sql.prepare('SELECT id,title,event_at,phone FROM melodi_calendar_events ORDER BY id').all().map(value=>({...value}));
  const state=()=>db.sql.prepare('SELECT * FROM semantic_calendar_request_repairs').get();
  const run=overrides=>repairRequestedSemanticSchedule(env,{...options,...overrides});
  return{db,env,services,options,calls,events,context,state,run};
}

check('repairs only the bound failed request atomically, preserves its done ledger and sends one natural notice',async()=>{
  const f=await fixture(),original=f.db.sql.prepare('SELECT * FROM wa_message_processing').get();
  assert.equal((await f.run()).status,'repaired');assert.equal(f.events().length,4);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM wa_message_processing').get(),original);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_message_effects').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_session').get().n,0);
  const notice=f.db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  const body=JSON.parse(await f.services.decrypt(notice.payload_encrypted,notice.payload_iv)).body;
  assert.match(body,/Ya quedó tu agenda/);assert.match(body,/Alfredo/);assert.match(body,/1 de noviembre/);
  assert.doesNotMatch(body,/Melodi:|Melodi|📌|2026-11-01T/);
  assert.equal(notice.owner_requested,1);assert.equal(f.calls.sync,1);
  assert.equal((await f.run()).status,'already_repaired');assert.equal(f.calls.model,1);assert.equal(f.calls.persist,1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);
  const persisted=JSON.stringify(f.state());assert.ok(!persisted.includes(TEXT));assert.ok(!persisted.includes('Alfredo'));
});

check('disabled revision and foreign owner do not create a recovery ledger or execute work',async()=>{
  for(const change of [{REQUESTED_SEMANTIC_SCHEDULE_REPAIR_REV:''},{OWNER_WHATSAPP_NUMBER:'18095550101'},{TIME_ZONE:'Europe/Madrid'}]) {
    const f=await fixture();Object.assign(f.env,change);assert.ok(['disabled','source_mismatch'].includes((await f.run()).status));
    assert.equal(f.calls.model,0);assert.equal(f.events().length,0);
    assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='semantic_calendar_request_repairs'").get().n,0);
  }
});

check('a changed failed response, original timestamp, attempt, status, action or newer owner message cannot authorize recovery',async()=>{
  for(const condition of ['reply','created','attempt','status','action','newer']) {
    const f=await fixture();
    if(condition==='reply'){const s=await f.services.encrypt({body:'Ya quedó guardado.'});f.db.sql.prepare('UPDATE wa_message_processing SET response_encrypted=?,response_iv=?').run(s.encrypted,s.iv);}
    if(condition==='created')f.db.sql.exec('UPDATE wa_message_processing SET created_at=created_at+1');
    if(condition==='attempt')f.db.sql.exec('UPDATE wa_message_processing SET attempts=2');
    if(condition==='status')f.db.sql.exec("UPDATE wa_message_processing SET status='uncertain'");
    if(condition==='action')f.db.sql.prepare('INSERT INTO wa_message_effects VALUES(?,?,?,?)').run(OWNER,MESSAGE,'action','confirmed');
    if(condition==='newer')f.db.sql.prepare('INSERT INTO wa_message_processing VALUES(?,?,?,?,?,?,?)').run(OWNER,'new-owner-message','done',1,NOW,null,null);
    assert.equal((await f.run()).status,'blocked');assert.equal(f.events().length,0);assert.equal(f.calls.model,0);
  }
});

check('an ambiguous, foreign-time or missing encrypted owner source never reaches the model',async()=>{
  for(const turns of [[],[{role:'user',message:TEXT,at:'2026-10-26T03:23:11Z'}],
    [{role:'user',message:TEXT,at:'2026-10-26T12:22:23Z'},{role:'user',message:'another request',at:'2026-10-26T12:22:24Z'}]]) {
    const f=await fixture();await f.context(turns);assert.equal((await f.run()).status,'blocked');assert.equal(f.calls.model,0);assert.equal(f.events().length,0);
  }
});

check('Pro failures retry without a question, and valid plans are frozen before calendar writes',async()=>{
  const f=await fixture();assert.equal((await f.run({interpret:async()=>{throw Error('provider timeout');}})).status,'retryable');
  assert.equal(f.state().status,'pending');assert.equal(f.events().length,0);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='wa_melodi_delivery_notices'").get().n,0);
  const persist=f.options.persist;
  assert.equal((await f.run({persist:async(...args)=>{assert.equal(f.state().status,'prepared');assert.ok(f.state().payload_encrypted);return persist(...args);}})).status,'repaired');
});

check('permission denial retains the frozen plan and never claims that the events were saved',async()=>{
  const f=await fixture();assert.equal((await f.run({authorize:async()=>({allowed:false})})).status,'approval_required');
  assert.equal(f.events().length,0);assert.equal(f.state().status,'prepared');
  assert.equal((await f.run()).status,'repaired');assert.equal(f.calls.model,1);
});

check('one elapsed event blocks the whole plan without partial creation or shifting the date',async t=>{
  const f=await fixture();t.mock.timers.setTime(Date.parse(EVENTS[0].eventAt));
  const result=await f.run();assert.deepEqual(result,{status:'blocked',reason:'event_time_elapsed'});
  assert.equal(f.events().length,0);assert.equal(f.calls.persist,0);
});

check('context, session, response or cancellation changes during preparation roll back the entire calendar batch',async()=>{
  for(const mutation of ['context','session','reply','newer','session_deleted']) {
    const f=await fixture(),persist=f.options.persist;
    const result=await f.run({persist:async(...args)=>{
      if(mutation==='context')await f.context([{role:'user',message:'Cancel the previous request.',at:'2026-10-26T12:31:00Z'}]);
      if(mutation==='session')f.db.sql.exec("UPDATE wa_owner_session SET updated_at='2026-10-26T12:31:00Z'");
      if(mutation==='session_deleted')f.db.sql.exec('DELETE FROM wa_owner_session');
      if(mutation==='reply')f.db.sql.exec("UPDATE wa_message_processing SET response_iv='changed'");
      if(mutation==='newer')f.db.sql.prepare('INSERT INTO wa_message_processing VALUES(?,?,?,?,?,?,?)').run(OWNER,'cancel-this','done',1,NOW,null,null);
      return persist(...args);
    }});
    assert.equal(result.status,'unconfirmed',mutation);assert.equal(f.events().length,0,mutation);
    assert.equal(f.state().status,'prepared');
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM semantic_calendar_requests').get().n,0);
  }
});

check('a failing fourth insert rolls back all events, receipt and cleanup then retries the same frozen plan',async()=>{
  const f=await fixture(),execute=f.db.execute.bind(f.db);let inserts=0;
  f.db.execute=(sql,values)=>{if(sql.startsWith('INSERT INTO melodi_calendar_events')&&++inserts===4)throw Error('fourth_insert_failed');return execute(sql,values);};
  assert.equal((await f.run()).status,'unconfirmed');assert.equal(f.events().length,0);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_session').get().n,1);
  f.db.execute=execute;assert.equal((await f.run()).status,'repaired');assert.equal(f.calls.model,1);assert.equal(f.events().length,4);
});

check('a post-commit crash resumes the existing receipt and never recreates a later deleted or edited event',async()=>{
  for(const mutation of ['none','delete','edit']) {
    const f=await fixture(),prepare=f.db.prepare.bind(f.db);let fail=true;
    f.db.prepare=sql=>{if(fail&&sql.startsWith('CREATE TABLE IF NOT EXISTS wa_melodi_delivery_notices')){fail=false;throw Error('post_commit_crash');}return prepare(sql);};
    assert.equal((await f.run()).status,'retryable');assert.equal(f.state().status,'applied');assert.equal(f.events().length,4);
    const id=f.events()[0].id;
    if(mutation==='delete')f.db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(id);
    if(mutation==='edit')f.db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('Owner changed this activity',id);
    f.db.prepare=prepare;
    const result=await f.run();assert.equal(result.status,mutation==='none'?'repaired':'blocked');
    assert.equal(f.calls.persist,1);assert.equal(f.calls.model,1);
    assert.equal(f.events().length,mutation==='delete'?3:4);
    if(mutation==='edit')assert.equal(f.events()[0].title,'Owner changed this activity');
  }
});

check('concurrent repair ticks lease the source once without duplicate Pro calls or notices',async()=>{
  const f=await fixture();let start,finish;const started=new Promise(resolve=>start=resolve),hold=new Promise(resolve=>finish=resolve);
  const first=f.run({interpret:async(...args)=>{start();await hold;return f.options.interpret(...args);}});
  await started;assert.equal((await f.run()).status,'busy');finish();assert.equal((await first).status,'repaired');
  assert.equal(f.calls.model,1);assert.equal(f.events().length,4);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);
});
