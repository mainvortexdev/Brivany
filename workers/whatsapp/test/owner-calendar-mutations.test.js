import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {ownerAutonomyServices} from '../owner-features.js';
import {mutateOwnerCalendarEvent} from '../owner-calendar-mutations.js';
import {ensureScreenshotCalendarSchema} from '../screenshot-calendar-store.js';
import {GOOGLE_CALENDAR_SCHEMA} from '../google-calendar-store.js';
import {GOOGLE_CALENDAR_SCHEDULE_SCHEMA} from '../google-calendar-schedules.js';
import {createRoutineStore,routineCalendarOccurrence} from '../melodi-routines.js';

const OWNER='18095550101',OTHER='18095559999',NOW=Date.parse('2026-10-26T19:22:00Z'),OLD='2026-11-14T13:00:00.000Z',NEXT='2026-11-10T13:00:00.000Z';
async function fixture(){
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,27).toString('base64')};
  const services=ownerAutonomyServices(env),options={now:NOW,services};
  await ensureScreenshotCalendarSchema(env);db.sql.exec([...GOOGLE_CALENDAR_SCHEMA,...GOOGLE_CALENDAR_SCHEDULE_SCHEMA].join(';'));
  const add=({id='app',owner=OWNER,title='Iniciar la creación de una app para aprender boxeo',eventAt=OLD,type='REMINDER',remindedAt=null}={})=>db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,reminded_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,title,eventAt,type,'melodi',remindedAt,new Date(NOW).toISOString(),new Date(NOW).toISOString());
  add();
  const row=id=>({...db.sql.prepare('SELECT * FROM melodi_calendar_events WHERE id=?').get(id||'app')});
  const observed=()=>[{id:'app',title:row().title,eventAt:row().event_at}];
  const apply=(input={},messageId='move-one',extra={})=>mutateOwnerCalendarEvent(env,OWNER,messageId,{operation:'update',eventId:'app',expectedEventAt:OLD,eventAt:NEXT,...input},{...options,observedEvents:observed(),...extra});
  return{db,env,services,options,add,row,observed,apply};
}

test('the reported app moves to November 10 without changing its ID, title or nine am time; receipt is encrypted',async()=>{
  const f=await fixture(),before=f.row(),result=await f.apply();
  assert.equal(result.status,'applied');assert.equal(result.operation,'update');assert.equal(result.event.eventAt,NEXT);
  assert.equal(f.row().id,before.id);assert.equal(f.row().title,before.title);assert.equal(f.row().event_at,NEXT);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM owner_calendar_mutation_receipts').get()),/boxeo|noviembre|2026-11-10/);
});

test('title-only changes preserve the instant; time-only changes preserve the title',async()=>{
  for(const input of [{eventAt:undefined,title:'Crear la app de boxeo'},{eventAt:'2026-11-14T15:30:00.000Z'}]){
    const f=await fixture(),before=f.row();const result=await f.apply(input);assert.equal(result.status,'applied');
    assert.equal(f.row().title,input.title||before.title);assert.equal(f.row().event_at,input.eventAt||OLD);
  }
});

test('retries return the immutable receipt without undoing a later edit or requiring stale observations',async()=>{
  const f=await fixture(),first=await f.apply();f.db.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run('2026-11-12T16:00:00.000Z','app');
  const second=await f.apply({},'move-one',{observedEvents:[]});assert.equal(second.status,'replayed');assert.deepEqual(second.event,first.event);
  assert.equal(f.row().event_at,'2026-11-12T16:00:00.000Z');
  const mismatch=await f.apply({eventAt:'2026-11-13T13:00:00.000Z'});assert.equal(mismatch.reason,'request_replay_mismatch');
});

test('concurrent identical moves have one effect and one receipt',async()=>{
  const f=await fixture(),observedEvents=f.observed();const results=await Promise.all([f.apply({},'same',{observedEvents}),f.apply({},'same',{observedEvents})]);
  assert.deepEqual(results.map(item=>item.status).sort(),['applied','replayed']);assert.equal(f.row().event_at,NEXT);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,1);
});

test('cancel removes the exact source and is idempotent; it cannot delete a later replacement',async()=>{
  const f=await fixture(),input={operation:'cancel',eventAt:undefined},first=await f.apply(input);assert.equal(first.status,'applied');assert.equal(first.operation,'cancel');
  assert.equal(f.db.sql.prepare('SELECT id FROM melodi_calendar_events WHERE id=?').get('app'),undefined);
  f.add({title:'Replacement'});const replay=await f.apply(input);assert.equal(replay.status,'replayed');assert.equal(f.row().title,'Replacement');
});

test('foreign, invented, unobserved and stale IDs cannot change any row',async()=>{
  const f=await fixture();f.add({id:'foreign',owner:OTHER});const before=f.db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all();
  for(const [id,input,extra] of [['unobserved',{}, {observedEvents:[]}],['foreign',{eventId:'foreign'},{observedEvents:[{id:'foreign',eventAt:OLD}]}],['invented',{eventId:'absent'},{observedEvents:[{id:'absent',eventAt:OLD}]}],['stale',{expectedEventAt:'2026-11-13T13:00:00.000Z'},{observedEvents:[{id:'app',eventAt:'2026-11-13T13:00:00.000Z'}]}]]){
    assert.equal((await f.apply(input,id,extra)).status,'clarification');
  }
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all(),before);
  await assert.rejects(mutateOwnerCalendarEvent(f.env,OTHER,'foreign-owner',{operation:'cancel',eventId:'foreign',expectedEventAt:OLD},f.options),/owner_required/);
});

test('a named target conflict, past target, linked delivery and recurring source yield concrete questions with no mutation',async()=>{
  for(const variant of ['conflict','past','delivery','recurring']){
    const f=await fixture();let input={},extra={};
    if(variant==='conflict')f.add({id:'dentist',title:'Dentista',eventAt:NEXT});
    if(variant==='past')input.eventAt='2026-10-25T13:00:00.000Z';
    if(variant==='delivery')f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='DOCUMENT_DELIVERY' WHERE id='app'").run();
    if(variant==='recurring'){input.eventId='routine:routine1:1794646800000';extra.observedEvents=[{id:input.eventId,title:'Boxeo',eventAt:OLD}];}
    const before=f.row(),result=await f.apply(input,variant,extra);assert.equal(result.status,variant==='delivery'?'unsupported':'clarification');
    if(variant==='delivery'){assert.match(result.notice,/Google Calendar/);assert.doesNotMatch(result.notice,/¿/);}else assert.match(result.clarification,/¿.+\?/);
    if(variant==='conflict')assert.match(result.clarification,/Dentista/);assert.deepEqual(f.row(),before);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
  }
});

test('screenshot retiming preserves duration and lead and clears the old sent advance notice',async()=>{
  const f=await fixture();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='SCREENSHOT_EVENT' WHERE id='app'").run();
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,reminded_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('app',OWNER,'2026-11-14T16:00:00.000Z','America/New_York',120,'2026-11-14T11:00:00.000Z',null,new Date(NOW).toISOString());
  const result=await f.apply();assert.equal(result.status,'applied');
  const meta=f.db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get();assert.equal(meta.end_at,'2026-11-10T16:00:00.000Z');assert.equal(meta.deliver_at,'2026-11-10T11:00:00.000Z');assert.equal(meta.lead_minutes,120);assert.equal(meta.source_time_zone,'America/New_York');assert.equal(meta.reminded_at,null);
  const cancel=await f.apply({operation:'cancel',eventAt:undefined,expectedEventAt:NEXT},'cancel-screenshot');assert.equal(cancel.status,'applied');assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_screenshot_calendar_events').get().n,0);
});

test('ignored writes or late source changes roll back both effect and receipt',async()=>{
  for(const variant of ['ignored_update','ignored_delete','race','metadata_ignore']){
    const f=await fixture();let input={};
    if(variant==='ignored_update')f.db.sql.exec("CREATE TRIGGER ignore_update BEFORE UPDATE ON melodi_calendar_events BEGIN SELECT RAISE(IGNORE); END");
    if(variant==='ignored_delete'){input={operation:'cancel',eventAt:undefined};f.db.sql.exec("CREATE TRIGGER ignore_delete BEFORE DELETE ON melodi_calendar_events BEGIN SELECT RAISE(IGNORE); END");}
    if(variant==='metadata_ignore'){
      f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='SCREENSHOT_EVENT' WHERE id='app'").run();
      f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('app',OWNER,'2026-11-14T14:00:00.000Z','America/Santo_Domingo',120,'2026-11-14T11:00:00.000Z',new Date(NOW).toISOString());
      f.db.sql.exec('CREATE TRIGGER ignore_metadata BEFORE UPDATE ON melodi_screenshot_calendar_events BEGIN SELECT RAISE(IGNORE); END');
    }
    if(variant==='race'){
      const original=f.db.batch.bind(f.db);let changed=false;f.db.batch=async items=>{
        if(!changed&&items.some(item=>item.query.startsWith('INSERT INTO owner_calendar_mutation_receipts'))){changed=true;f.db.sql.prepare("UPDATE melodi_calendar_events SET title='Changed elsewhere' WHERE id='app'").run();}
        return original(items);
      };
    }
    const result=await f.apply(input);assert.equal(result.reason,'event_changed');assert.equal(f.row().event_at,OLD);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
  }
});

test('a destination inserted after planning invalidates the transaction rather than double booking',async()=>{
  const f=await fixture(),original=f.db.batch.bind(f.db);let inserted=false;
  f.db.batch=async items=>{if(!inserted&&items.some(item=>item.query.startsWith('INSERT INTO owner_calendar_mutation_receipts'))){inserted=true;f.add({id:'raced',title:'Otra cita',eventAt:NEXT});}return original(items);};
  const result=await f.apply();assert.equal(result.reason,'event_changed');assert.equal(f.row().event_at,OLD);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
});

test('a committed update or cancellation queues Calendar sync, while queue failure retains a verifiable local receipt',async()=>{
  for(const variant of ['update','cancel','queue_failure']){
    const f=await fixture(),jobs=[];Object.assign(f.env,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',MELODI_JOBS:{send:async job=>{if(variant==='queue_failure')throw Error('queue unavailable');jobs.push(job);}}});
    f.db.sql.prepare('INSERT INTO google_calendar_connections(owner,state_encrypted,state_iv,status,updated_at) VALUES(?,?,?,?,?)').run(OWNER,'encrypted','iv','connected',NOW);
    const result=await f.apply(variant==='cancel'?{operation:'cancel',eventAt:undefined}:{});
    assert.equal(result.status,'applied');assert.equal(result.syncPending,true);assert.equal(jobs.length,variant==='queue_failure'?0:1);
    if(jobs.length)assert.deepEqual(Object.keys(jobs[0]).sort(),['owner','token','type']);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,1);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,variant==='cancel'?0:1);
    if(variant==='queue_failure'){const replay=await f.apply();assert.equal(replay.status,'replayed');assert.equal(f.row().event_at,NEXT);}
  }
});

test('equivalent ISO instant spellings are accepted without interpreting them as a stale change',async()=>{
  const f=await fixture();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_at='2026-11-14T13:00:00Z' WHERE id='app'").run();
  const result=await f.apply();assert.equal(result.status,'applied');assert.equal(f.row().event_at,NEXT);
});

async function routineFixture({frequency='weekly',weekdays=[1,2,3,4,5],dayOfMonth}={}){
  const f=await fixture(),routines=createRoutineStore(f.db,{...f.services,now:()=>NOW,uuid:()=> 'boxing-routine'});await routines.ensureSchema();
  const created=await routines.create({owner:OWNER,agent:'melodi',eventKey:'boxing-each-week',title:'Boxeo',brief:'Entrenar boxeo',kind:'recurring_reminder',channel:'whatsapp',frequency,hour:'09:00',...(frequency==='weekly'?{weekdays}:{}),...(dayOfMonth?{dayOfMonth}:{})});
  const row=()=>({...f.db.sql.prepare('SELECT * FROM wa_melodi_routines WHERE id=?').get(created.id)});
  const original=row(),eventAt=new Date(original.next_at).toISOString(),eventId=`routine:${created.id}:${original.next_at}`;
  const apply=(input={},messageId='routine-change',extra={})=>mutateOwnerCalendarEvent(f.env,OWNER,messageId,{operation:'update',eventId,expectedEventAt:eventAt,eventAt:new Date(original.next_at+3600000).toISOString(),scope:'series',...input},{...f.options,observedEvents:[{id:eventId,eventAt,title:'Boxeo'}],...extra});
  const payload=async()=>JSON.parse(await f.services.decrypt(row().payload_encrypted,row().payload_iv));
  return{...f,routines,routineRow:row,original,payload,applyRoutine:apply,eventId,eventAt};
}

test('an explicit series hour change preserves every weekday, frequency, identity and private content',async()=>{
  const f=await routineFixture(),result=await f.applyRoutine();assert.equal(result.status,'applied');assert.equal(result.scope,'series');assert.equal(f.routineRow().hour,'10:00');assert.equal(f.routineRow().id,f.original.id);
  const payload=await f.payload();assert.equal(payload.frequency,'weekly');assert.deepEqual(payload.weekdays,[1,2,3,4,5]);assert.equal(payload.brief,'Entrenar boxeo');assert.equal(payload.kind,'recurring_reminder');assert.equal(payload.title,'Boxeo');
  assert.equal(f.routineRow().next_at,f.original.next_at+3600000);assert.equal(f.routineRow().available_at,f.original.next_at+3600000);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM owner_calendar_mutation_receipts').get()),/Boxeo|Entrenar/);
});

test('renaming a whole routine preserves its next instant and all individual exceptions',async()=>{
  const f=await routineFixture();const payload=await f.payload(),originalNext=new Date(f.original.next_at).toISOString();payload.calendarExceptions={[new Date(f.original.next_at+86400000).toISOString()]:{status:'cancelled'}};
  const sealed=await f.services.encrypt(JSON.stringify(payload));f.db.sql.prepare('UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted,sealed.iv,f.original.id);
  const result=await f.applyRoutine({eventAt:undefined,title:'Entrenamiento de boxeo'});assert.equal(result.status,'applied');assert.equal(result.event.eventAt,originalNext);assert.equal((await f.payload()).title,'Entrenamiento de boxeo');assert.deepEqual((await f.payload()).calendarExceptions,payload.calendarExceptions);
});

test('series cancellation stops the real routine; retries and new changes cannot reactivate it',async()=>{
  const f=await routineFixture(),input={operation:'cancel',eventAt:undefined},first=await f.applyRoutine(input);assert.equal(first.status,'applied');assert.equal(f.routineRow().status,'stopped');
  const second=await f.applyRoutine(input);assert.equal(second.status,'replayed');assert.equal(f.routineRow().status,'stopped');
  const refused=await f.applyRoutine({},'after-cancellation');assert.equal(refused.reason,'routine_inactive');assert.equal(f.routineRow().status,'stopped');assert.doesNotMatch(refused.notice,/¿/);
});

test('unspecified recurrence scope asks about the supported whole series; explicit instance limitations do not promise an action',async()=>{
  const f=await routineFixture(),before=f.routineRow();
  const unspecified=await f.applyRoutine({scope:undefined},'scope-question');assert.equal(unspecified.status,'clarification');assert.match(unspecified.clarification,/toda la rutina/);
  const instance=await f.applyRoutine({scope:'occurrence'},'instance');assert.equal(instance.status,'unsupported');assert.equal(instance.reason,'routine_occurrence_unsupported');assert.match(instance.notice,/Google Calendar/);assert.doesNotMatch(instance.notice,/¿/);assert.deepEqual(f.routineRow(),before);
});

test('active execution leases and concurrent routine edits prevent any routine change',async()=>{
  for(const variant of ['lease','race','ignored']){
    const f=await routineFixture();
    if(variant==='lease')f.db.sql.prepare('UPDATE wa_melodi_routines SET lease_token=?,lease_until=? WHERE id=?').run('active-claim',NOW+10000,f.original.id);
    if(variant==='race'){
      const batch=f.db.batch.bind(f.db);let mutated=false;f.db.batch=async items=>{if(!mutated&&items.some(item=>item.query.startsWith('INSERT INTO owner_calendar_mutation_receipts'))){mutated=true;f.db.sql.prepare('UPDATE wa_melodi_routines SET attempts=attempts+1 WHERE id=?').run(f.original.id);}return batch(items);};
    }
    if(variant==='ignored')f.db.sql.exec('CREATE TRIGGER ignore_routine BEFORE UPDATE ON wa_melodi_routines BEGIN SELECT RAISE(IGNORE); END');
    const result=await f.applyRoutine();assert.equal(result.reason,variant==='lease'?'routine_running':'event_changed');assert.equal(f.routineRow().hour,'09:00');assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
  }
});

test('a single weekly day and a monthly day can change while retaining their recurrence kind',async()=>{
  for(const config of [{frequency:'weekly',weekdays:[2]},{frequency:'monthly',dayOfMonth:28}]){
    const f=await routineFixture(config),target=new Date(f.original.next_at+86400000).toISOString(),result=await f.applyRoutine({eventAt:target});assert.equal(result.status,'applied');const payload=await f.payload();assert.equal(payload.frequency,config.frequency);
    if(config.frequency==='weekly')assert.deepEqual(payload.weekdays,[3]);else assert.equal(payload.dayOfMonth,29);
    assert.equal(result.event.eventAt,target);
  }
});

test('routine hour edits preserve future individually cancelled instances on their new recurring clock',async()=>{
  const f=await routineFixture(),payload=await f.payload(),originalException=new Date(f.original.next_at+86400000).toISOString();payload.calendarExceptions={[originalException]:{status:'cancelled'}};
  const sealed=await f.services.encrypt(JSON.stringify(payload));f.db.sql.prepare('UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted,sealed.iv,f.original.id);
  assert.equal((await f.applyRoutine()).status,'applied');const nextPayload=await f.payload(),shifted=new Date(Date.parse(originalException)+3600000).toISOString();assert.equal(routineCalendarOccurrence(nextPayload,shifted).cancelled,true);
});

test('an interval inside an occupied screenshot blocks, while touching its end remains available',async()=>{
  for(const minute of [30,60]){
    const f=await fixture();f.add({id:'meeting',title:'Reunión con Alfredo',eventAt:NEXT,type:'SCREENSHOT_EVENT'});
    f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('meeting',OWNER,'2026-11-10T14:00:00.000Z','America/Santo_Domingo',120,'2026-11-10T11:00:00.000Z',new Date(NOW).toISOString());
    const eventAt=new Date(Date.parse(NEXT)+minute*60000).toISOString(),result=await f.apply({eventAt});
    if(minute===30){assert.equal(result.reason,'time_conflict');assert.match(result.clarification,/Alfredo/);assert.equal(f.row().event_at,OLD);}else{assert.equal(result.status,'applied');assert.equal(f.row().event_at,eventAt);}
  }
});

test('the moved event retains its duration, so its end cannot overlap a later starting commitment',async()=>{
  const f=await fixture();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='SCREENSHOT_EVENT' WHERE id='app'").run();
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('app',OWNER,'2026-11-14T14:00:00.000Z','America/Santo_Domingo',120,'2026-11-14T11:00:00.000Z',new Date(NOW).toISOString());
  f.add({id:'dentist',title:'Dentista',eventAt:'2026-11-10T13:45:00.000Z'});const result=await f.apply();assert.equal(result.reason,'time_conflict');assert.match(result.clarification,/Dentista/);assert.equal(f.row().event_at,OLD);
});

test('a multi-day invitation occupies its thirty-minute arrival slot according to existing agenda policy',async()=>{
  const f=await fixture();f.add({id:'hackathon',title:'Hackathon de Meta',eventAt:NEXT,type:'SCREENSHOT_EVENT'});
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('hackathon',OWNER,'2026-11-15T21:00:00.000Z','America/Santo_Domingo',120,'2026-11-10T11:00:00.000Z',new Date(NOW).toISOString());
  const result=await f.apply({eventAt:'2026-11-10T14:00:00.000Z'});assert.equal(result.status,'applied');
});

test('a concurrent change to another event duration invalidates the atomic overlap snapshot',async()=>{
  const f=await fixture();f.add({id:'meeting',title:'Reunión',eventAt:'2026-11-10T12:00:00.000Z',type:'SCREENSHOT_EVENT'});
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('meeting',OWNER,NEXT,'America/Santo_Domingo',120,'2026-11-10T10:00:00.000Z',new Date(NOW).toISOString());
  const batch=f.db.batch.bind(f.db);let changed=false;f.db.batch=async items=>{if(!changed&&items.some(item=>item.query.startsWith('INSERT INTO owner_calendar_mutation_receipts'))){changed=true;f.db.sql.prepare("UPDATE melodi_screenshot_calendar_events SET end_at='2026-11-10T14:00:00.000Z' WHERE event_id='meeting'").run();}return batch(items);};
  const result=await f.apply();assert.equal(result.reason,'event_changed');assert.equal(f.row().event_at,OLD);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
});

test('an event extending past midnight conflicts with a commitment on the next local day',async()=>{
  const f=await fixture();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='SCREENSHOT_EVENT' WHERE id='app'").run();
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('app',OWNER,'2026-11-14T14:00:00.000Z','America/Santo_Domingo',120,'2026-11-14T11:00:00.000Z',new Date(NOW).toISOString());
  f.add({id:'next-day',title:'Cita de medianoche',eventAt:'2026-11-11T04:15:00.000Z'});
  const result=await f.apply({eventAt:'2026-11-11T03:45:00.000Z'});assert.equal(result.reason,'time_conflict');assert.match(result.clarification,/medianoche/);assert.equal(f.row().event_at,OLD);
});

test('a no-op update preserves a screenshot duration, notice timestamp and source identity',async()=>{
  const f=await fixture();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='SCREENSHOT_EVENT' WHERE id='app'").run();
  f.db.sql.prepare('INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,reminded_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('app',OWNER,'2026-11-14T14:00:00.000Z','America/Santo_Domingo',120,'2026-11-14T11:00:00.000Z','2026-10-25T11:00:00.000Z',new Date(NOW).toISOString());
  const before=f.db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get();const result=await f.apply({eventAt:OLD});assert.equal(result.status,'applied');assert.deepEqual(f.db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get(),before);assert.equal(f.row().id,'app');
});
