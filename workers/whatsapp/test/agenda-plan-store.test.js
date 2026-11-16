import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { readAgendaPlanSnapshot, applyAgendaPlan } from '../agenda-plan-store.js';
import { DOCUMENT_SCHEDULE_SCHEMA, documentDeliveryState } from '../document-schedules.js';
import { GOOGLE_CALENDAR_SCHEDULE_SCHEMA } from '../google-calendar-schedules.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { ownerAutonomyServices } from '../owner-features.js';

const OWNER='18095550101',OTHER='18095559999',NOW=Date.parse('2026-10-21T14:00:00Z');
function fixture({now=NOW,timeZone='America/La_Paz'}={}) {
  const db=new FinanceD1();
  db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),TIME_ZONE:timeZone};
  const services=ownerAutonomyServices(env),options={now,timeZone,services};
  const add=({id='existing',owner=OWNER,title='Llamar a Helibert',eventAt='2026-10-21T20:15:00.000Z',type='REMINDER',remindedAt=null,agent='melodi'}={})=>{
    db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,reminded_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,owner,title,eventAt,type,agent,remindedAt,new Date(now).toISOString(),new Date(now).toISOString());
  };
  const snapshot=()=>readAgendaPlanSnapshot(env,OWNER,options);
  const apply=(plan,snap,messageId='agenda-request-1')=>applyAgendaPlan(env,OWNER,messageId,plan,{...options,snapshot:snap});
  const events=()=>db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all().map(row=>({...row}));
  return {db,env,services,options,add,snapshot,apply,events};
}
const plan=()=>({createEvents:[{title:'Avanzar Vetsa',eventAt:'2026-10-23T13:00:00.000Z',agent:'melodi'}],moveDay:{fromDate:'2026-10-21',toDate:'2026-10-22'}});

test('an explicit conflict resolution and the rest of the agenda commit atomically without moving the chosen event twice',async()=>{
  const f=fixture();f.add({id:'dentist',title:'Consulta',eventAt:'2026-10-21T20:00:00.000Z'});f.add({id:'meeting',title:'Reunión',eventAt:'2026-10-22T20:00:00.000Z'});
  const input={...plan(),eventMoves:[{id:'dentist',previousEventAt:'2026-10-21T20:00:00.000Z',eventAt:'2026-10-22T21:00:00.000Z'}]};
  const snapshot=await f.snapshot(),first=await f.apply(input,snapshot);assert.equal(first.status,'applied');assert.equal(first.movedCount,1);
  assert.equal(f.events().find(row=>row.id==='dentist').event_at,'2026-10-22T21:00:00.000Z');assert.equal(f.events().find(row=>row.id==='meeting').event_at,'2026-10-22T20:00:00.000Z');
  assert.equal((await f.apply(input,snapshot)).status,'replayed');assert.equal(f.events().length,3);
});

test('unknown, stale or conflicting explicit moves cannot create any part of a compound plan',async()=>{
  for(const variant of ['unknown','stale','conflict']){
    const f=fixture();f.add({id:'dentist',eventAt:'2026-10-21T20:00:00.000Z'});f.add({id:'meeting',eventAt:'2026-10-22T20:00:00.000Z'});
    const snapshot=await f.snapshot(),before=f.events();
    const result=await f.apply({...plan(),eventMoves:[{id:variant==='unknown'?'missing':'dentist',previousEventAt:variant==='stale'?'2026-10-21T21:00:00.000Z':'2026-10-21T20:00:00.000Z',eventAt:variant==='conflict'?'2026-10-22T20:00:00.000Z':'2026-10-22T21:00:00.000Z'}]},snapshot);
    assert.equal(result.status,'conflict');assert.deepEqual(f.events(),before);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM agenda_plan_receipts').get().n,0);
  }
});

test('a compound plan creates projects and moves the owner future day atomically',async()=>{
  const f=fixture();f.add();
  f.add({id:'past',eventAt:'2026-10-21T13:00:00.000Z'});
  f.add({id:'delivered',eventAt:'2026-10-21T21:00:00.000Z',remindedAt:'2026-10-21T12:00:00Z'});
  f.add({id:'foreign',owner:OTHER});
  const snap=await f.snapshot(),result=await f.apply(plan(),snap);
  assert.equal(result.status,'applied');assert.equal(result.movedCount,1);assert.equal(result.createdCount,1);
  assert.equal(f.events().find(row=>row.id==='existing').event_at,'2026-10-22T20:15:00.000Z');
  assert.equal(f.events().find(row=>row.id==='past').event_at,'2026-10-21T13:00:00.000Z');
  assert.equal(f.events().find(row=>row.id==='delivered').event_at,'2026-10-21T21:00:00.000Z');
  assert.equal(f.events().find(row=>row.id==='foreign').event_at,'2026-10-21T20:15:00.000Z');
  const receipt=f.db.sql.prepare('SELECT * FROM agenda_plan_receipts').get();
  assert.doesNotMatch(JSON.stringify(receipt),/Helibert|Avanzar Vetsa/);
});

test('replay returns its encrypted receipt without moving today again or undoing later edits',async()=>{
  const f=fixture();f.add();
  const snap=await f.snapshot(),first=await f.apply(plan(),snap);
  f.db.sql.prepare('UPDATE melodi_calendar_events SET title=?,event_at=? WHERE id=?').run('Edited later','2026-10-25T20:15:00.000Z','existing');
  const before=f.events(),second=await f.apply(plan(),snap);
  assert.equal(second.status,'replayed');assert.deepEqual(second.created,first.created);assert.equal(second.movedCount,1);
  assert.deepEqual(f.events(),before);
  const mismatch=await f.apply({...plan(),createEvents:[]},snap);
  assert.equal(mismatch.status,'conflict');assert.equal(mismatch.reason,'request_replay_mismatch');
});

test('concurrent duplicate requests have one immutable execution and no duplicate project',async()=>{
  const f=fixture();f.add();const snap=await f.snapshot();
  const result=await Promise.all([f.apply(plan(),snap),f.apply(plan(),snap)]);
  assert.deepEqual(result.map(item=>item.status).sort(),['applied','replayed']);
  assert.equal(f.events().length,2);
});

test('a later insert failure rolls back both moves and the receipt',async()=>{
  const f=fixture();f.add();const snap=await f.snapshot(),before=f.events();
  f.db.sql.exec("CREATE TRIGGER reject_requested_project BEFORE INSERT ON melodi_calendar_events WHEN NEW.title='Avanzar Vetsa' BEGIN SELECT RAISE(ABORT,'synthetic_project_failure'); END");
  await assert.rejects(f.apply(plan(),snap),/synthetic_project_failure/);
  assert.deepEqual(f.events(),before);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM agenda_plan_receipts').get().n,0);
});

test('an ignored write rolls back every prior mutation instead of producing a false receipt',async()=>{
  const f=fixture();f.add();const snap=await f.snapshot(),before=f.events();
  f.db.sql.exec("CREATE TRIGGER ignore_requested_project BEFORE INSERT ON melodi_calendar_events WHEN NEW.title='Avanzar Vetsa' BEGIN SELECT RAISE(IGNORE); END");
  assert.deepEqual(await f.apply(plan(),snap),{status:'conflict',reason:'agenda_changed'});
  assert.deepEqual(f.events(),before);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM agenda_plan_receipts').get().n,0);
});

test('concurrent edits, delivered events and phantom inserts invalidate the whole snapshot',async()=>{
  for (const mutation of [
    f=>f.db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('Changed without updated_at','existing'),
    f=>f.db.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run('2026-10-21T22:30:00.000Z','existing'),
    f=>f.db.sql.prepare('UPDATE melodi_calendar_events SET reminded_at=? WHERE id=?').run('2026-10-21T14:01:00.000Z','existing'),
    f=>f.add({id:'phantom',eventAt:'2026-10-24T13:00:00.000Z'}),
  ]) {
    const f=fixture();f.add();const snap=await f.snapshot();mutation(f);const before=f.events();
    const result=await f.apply(plan(),snap);
    assert.deepEqual(result,{status:'conflict',reason:'agenda_changed'});
    assert.deepEqual(f.events(),before);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM agenda_plan_receipts').get().n,0);
  }
});

test('foreign-owner writes neither poison owner snapshots nor enter their agenda',async()=>{
  const f=fixture();f.add();const snap=await f.snapshot();
  f.add({id:'foreign',owner:OTHER});
  assert.equal((await f.apply(plan(),snap)).status,'applied');
  await assert.rejects(readAgendaPlanSnapshot(f.env,OTHER,f.options),/invalid_agenda_plan_owner/);
  await assert.rejects(applyAgendaPlan(f.env,OTHER,'foreign-request',plan(),{...f.options,snapshot:snap}),/invalid_agenda_plan_owner/);
});

test('derived snapshot fields cannot be edited after reading to expand move scope',async()=>{
  const f=fixture();f.add();const snap=await f.snapshot(),before=f.events();
  snap.events[0].eventAt='2026-10-22T20:15:00.000Z';
  await assert.rejects(f.apply(plan(),snap),/invalid_agenda_plan_snapshot/);
  assert.deepEqual(f.events(),before);
});

test('day moves preserve wall time across daylight-saving changes',async()=>{
  const f=fixture({now:Date.parse('2026-03-07T14:00:00Z'),timeZone:'America/New_York'});
  f.add({eventAt:'2026-03-07T15:15:00.000Z'}); // 10:15 EST.
  const result=await f.apply({createEvents:[],moveDay:{fromDate:'2026-03-07',toDate:'2026-03-08'}},await f.snapshot());
  assert.equal(result.status,'applied');
  assert.equal(f.events()[0].event_at,'2026-03-08T14:15:00.000Z'); // 10:15 EDT.
});

test('a nonexistent target wall time blocks the whole compound request',async()=>{
  const f=fixture({now:Date.parse('2026-03-06T14:00:00Z'),timeZone:'America/New_York'});
  f.add({eventAt:'2026-03-07T07:30:00.000Z'}); // 02:30 EST, missing on March 8.
  const before=f.events(),result=await f.apply({createEvents:[{title:'Proyecto',eventAt:'2026-03-09T14:00:00.000Z'}],moveDay:{fromDate:'2026-03-07',toDate:'2026-03-08'}},await f.snapshot());
  assert.equal(result.status,'unsupported');assert.equal(result.unsupported[0].reason,'target_wall_time_unavailable');
  assert.deepEqual(f.events(),before);
});

test('document delivery clocks move through their calendar source without breaking the linked job',async()=>{
  const f=fixture();f.db.sql.exec(DOCUMENT_SCHEDULE_SCHEMA);
  f.add({id:'document-job',eventAt:'2026-10-21T20:15:00.000Z',type:'DOCUMENT_DELIVERY'});
  f.db.sql.prepare('INSERT INTO wa_melodi_document_delivery_schedules(job_id,owner,agent,event_id,created_at) VALUES(?,?,?,?,?)').run('job',OWNER,'melodi','document-job',new Date(NOW).toISOString());
  const result=await f.apply({createEvents:[],moveDay:plan().moveDay},await f.snapshot());
  assert.equal(result.status,'applied');assert.equal(result.movedCount,1);
  const job=await documentDeliveryState(f.env,OWNER,'job',NOW,true);
  assert.equal(job.status,'waiting');assert.equal(job.retryAt,Date.parse('2026-10-22T20:15:00.000Z'));
});

test('cancelled document deliveries and already delivered jobs do not move',async()=>{
  const f=fixture();f.db.sql.exec(DOCUMENT_SCHEDULE_SCHEMA);f.db.sql.exec(GOOGLE_CALENDAR_SCHEDULE_SCHEMA.join(';'));
  for (const id of ['cancelled','delivered']) {
    f.add({id,type:'DOCUMENT_DELIVERY'});
    f.db.sql.prepare('INSERT INTO wa_melodi_document_delivery_schedules(job_id,owner,agent,event_id,created_at,delivered_at) VALUES(?,?,?,?,?,?)')
      .run(id,OWNER,'melodi',id,new Date(NOW).toISOString(),id==='delivered' ? new Date(NOW).toISOString() : null);
  }
  const sealed=await f.services.encrypt('{}');
  f.db.sql.prepare("INSERT INTO melodi_google_calendar_schedule_overrides(owner,kind,source_id,agent,payload_encrypted,payload_iv,status,updated_at) VALUES(?,'melodi_calendar_events',?,'melodi',?,?,'cancelled',?)")
    .run(OWNER,'cancelled',sealed.encrypted,sealed.iv,NOW);
  const before=f.events(),result=await f.apply({createEvents:[],moveDay:plan().moveDay},await f.snapshot());
  assert.equal(result.status,'applied');assert.equal(result.movedCount,0);assert.deepEqual(f.events(),before);
});

test('unsupported routine occurrences block day moves without creating any requested projects',async()=>{
  const f=fixture();f.add();f.db.sql.exec(readFileSync(new URL('../melodi-routines.sql',import.meta.url),'utf8'));
  const sealed=await f.services.encrypt(JSON.stringify({title:'Frase diaria',frequency:'daily'}));
  f.db.sql.prepare(`INSERT INTO wa_melodi_routines(id,owner,agent,event_key,payload_encrypted,payload_iv,channel,weekday,hour,status,next_at,available_at,created_at,updated_at)
    VALUES(?,?,'melodi',?,?,?,'whatsapp',3,'17:00','active',?,?,?,?)`)
    .run('daily',OWNER,'daily-key',sealed.encrypted,sealed.iv,Date.parse('2026-10-21T21:00:00Z'),Date.parse('2026-10-21T21:00:00Z'),NOW,NOW);
  const snap=await f.snapshot(),before=f.events();
  assert.ok(snap.events.some(item=>item.kind==='agent_routine'));
  const result=await f.apply(plan(),snap);
  assert.equal(result.status,'unsupported');assert.equal(result.reason,'unsupported_day_activities');
  assert.ok(result.unsupported.some(item=>item.kind==='agent_routine'));
  assert.deepEqual(f.events(),before);
  const routineBefore=f.db.sql.prepare('SELECT * FROM wa_melodi_routines').get();
  const narrowed={...plan(),moveDay:{...plan().moveDay,onlyCalendarEvents:true}};
  const accepted=await f.apply(narrowed,snap);
  assert.equal(accepted.status,'applied');assert.equal(accepted.movedCount,1);assert.equal(accepted.createdCount,1);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM wa_melodi_routines').get(),routineBefore);
  assert.equal((await f.apply(plan(),snap)).reason,'request_replay_mismatch');
});

test('paused calendar sources and new schedule tables are guarded against partial application',async()=>{
  const f=fixture();f.add();f.db.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));
  f.db.sql.prepare("INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at) VALUES(?,'melodi_calendar_events','existing','melodi','google-event','unsupported',?)").run(OWNER,NOW);
  assert.equal((await f.apply(plan(),await f.snapshot())).status,'unsupported');
  const g=fixture();g.add();const snap=await g.snapshot();
  g.db.sql.exec(GOOGLE_CALENDAR_SCHEDULE_SCHEMA.join(';'));
  assert.deepEqual(await g.apply(plan(),snap),{status:'conflict',reason:'agenda_changed'});
});

test('exact occupied slots block a compound plan before mutation',async()=>{
  const f=fixture();f.add();f.add({id:'tomorrow',eventAt:'2026-10-22T20:15:00.000Z'});
  const before=f.events(),result=await f.apply(plan(),await f.snapshot());
  assert.equal(result.status,'conflict');assert.equal(result.reason,'time_conflict');assert.deepEqual(f.events(),before);
});
