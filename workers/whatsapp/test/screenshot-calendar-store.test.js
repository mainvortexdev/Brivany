import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { ownerAutonomyServices } from '../owner-features.js';
import { readAgendaPlanSnapshot } from '../agenda-plan-store.js';
import { createScreenshotCalendarEvent,ensureScreenshotCalendarSchema,listDueScreenshotReminders,screenshotReminderCurrent,confirmScreenshotReminder } from '../screenshot-calendar-store.js';
import { GOOGLE_CALENDAR_SCHEDULE_SCHEMA } from '../google-calendar-schedules.js';

const OWNER='18095550101',OTHER='18095559999',NOW=Date.parse('2026-10-21T11:00:00.000Z');
const EVENT={title:'Meta Global AI Developer Hackathon',startAt:'2026-10-26T17:00:00.000Z',endAt:'2026-11-05T02:00:00.000Z',sourceTimeZone:'GMT-05:00',
  remindBeforeMinutes:120,reminderAt:'2026-10-26T15:00:00.000Z',clearStartSlot:true};
async function fixture(){
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64')};
  const services=ownerAutonomyServices(env),options={now:NOW,timeZone:env.TIME_ZONE,services};
  await ensureScreenshotCalendarSchema(env);
  const create=(event=EVENT,extra={})=>createScreenshotCalendarEvent(env,OWNER,'screenshot-owner-request-1',event,{...options,...extra});
  const add=(id,title,eventAt,owner=OWNER)=>db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,owner,title,eventAt,'REMINDER','melodi',new Date(NOW).toISOString(),new Date(NOW).toISOString());
  const events=()=>db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all().map(row=>({...row}));
  return{db,env,services,options,create,add,events};
}

test('the real start/end and independent two-hour WhatsApp notice persist atomically',async()=>{
  const f=await fixture(),result=await f.create();assert.equal(result.status,'applied');
  const calendar=f.events()[0],metadata=f.db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get();
  assert.equal(calendar.event_at,EVENT.startAt);assert.equal(calendar.event_type,'SCREENSHOT_EVENT');assert.equal(calendar.reminded_at,null);
  assert.equal(metadata.end_at,EVENT.endAt);assert.equal(metadata.deliver_at,EVENT.reminderAt);assert.equal(metadata.reminded_at,null);
  assert.equal(result.advance.deliverAt,EVENT.reminderAt);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM screenshot_calendar_receipts').get()),/Hackathon/);
  assert.equal((await f.create()).status,'replayed');assert.equal(f.events().length,1);
});

test('clearing arrival reslots only flexible work in the first 30 minutes and leaves all nine days intact',async()=>{
  const f=await fixture();
  f.add('work','Implementar conexión al ecosistema','2026-10-26T17:00:00.000Z');
  f.add('later','Reunión posterior','2026-10-26T19:00:00.000Z');
  f.add('other-day','Consulta médica','2026-11-01T17:00:00.000Z');
  f.add('foreign','Cita privada','2026-10-26T17:00:00.000Z',OTHER);
  const result=await f.create();assert.equal(result.status,'applied');assert.equal(result.moved.length,1);
  assert.equal(f.events().find(row=>row.id==='work').event_at,'2026-10-26T17:30:00.000Z');
  assert.equal(f.events().find(row=>row.id==='later').event_at,'2026-10-26T19:00:00.000Z');
  assert.equal(f.events().find(row=>row.id==='other-day').event_at,'2026-11-01T17:00:00.000Z');
  assert.equal(f.events().find(row=>row.id==='foreign').event_at,'2026-10-26T17:00:00.000Z');
});

test('a fixed appointment requires a specific clarification and no partial event or move is saved',async()=>{
  const f=await fixture();f.add('doctor','Consulta médica','2026-10-26T17:00:00.000Z');const before=f.events();
  const result=await f.create();assert.equal(result.status,'conflict');assert.equal(result.reason,'fixed_start_conflict');
  assert.equal(result.events[0].title,'Consulta médica');assert.deepEqual(f.events(),before);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_screenshot_calendar_events').get().n,0);
});

test('failure after moving work rolls back the work, event, metadata and receipt',async()=>{
  const f=await fixture();f.add('work','Implementar conexión','2026-10-26T17:00:00.000Z');const before=f.events();
  f.db.sql.exec("CREATE TRIGGER reject_screenshot_metadata BEFORE INSERT ON melodi_screenshot_calendar_events BEGIN SELECT RAISE(ABORT,'synthetic_metadata_failure'); END");
  await assert.rejects(f.create(),/synthetic_metadata_failure/);assert.deepEqual(f.events(),before);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM screenshot_calendar_receipts').get().n,0);
});

test('snapshot changes invalidate the whole import and the foreign owner cannot use the store',async()=>{
  const f=await fixture();
  const snapshot=await readAgendaPlanSnapshot(f.env,OWNER,{...f.options,start:'2026-10-26T04:00:00.000Z',end:'2026-10-27T04:00:00.000Z'});
  f.add('new-appointment','Cita añadida','2026-10-26T18:00:00.000Z');const before=f.events();
  assert.deepEqual(await f.create(EVENT,{snapshot}),{status:'conflict',reason:'agenda_changed'});assert.deepEqual(f.events(),before);
  await assert.rejects(createScreenshotCalendarEvent(f.env,OTHER,'request',EVENT,f.options),/invalid_screenshot_calendar_owner/);
});

test('the notice is due at 15Z, confirms only its own delivery and never marks the event delivered before 17Z',async()=>{
  const f=await fixture();await f.create();
  assert.deepEqual(await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse('2026-10-26T14:59:00Z')}),[]);
  const due=await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse(EVENT.reminderAt)});assert.equal(due.length,1);
  assert.equal(await screenshotReminderCurrent(f.env,OWNER,due[0],{now:Date.parse(EVENT.reminderAt)}),true);
  assert.deepEqual(await confirmScreenshotReminder(f.env,OWNER,due[0],{now:Date.parse(EVENT.reminderAt)}),{confirmed:true});
  assert.equal(f.events()[0].reminded_at,null);
  assert.equal(f.db.sql.prepare('SELECT reminded_at FROM melodi_screenshot_calendar_events').get().reminded_at,EVENT.reminderAt);
  assert.deepEqual(await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse(EVENT.reminderAt)}),[]);
});

test('a retimed source atomically updates the real end and advance clock and suppresses its stale queued notice',async()=>{
  const f=await fixture(),created=await f.create();const due=(await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse(EVENT.reminderAt)}))[0];
  f.db.sql.prepare('UPDATE melodi_calendar_events SET event_at=?,updated_at=? WHERE id=?').run('2026-10-27T17:00:00.000Z','2026-10-22T11:00:00.000Z',created.event.id);
  const metadata=f.db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get();
  assert.equal(metadata.end_at,'2026-11-06T02:00:00.000Z');assert.equal(metadata.deliver_at,'2026-10-27T15:00:00.000Z');
  assert.equal(await screenshotReminderCurrent(f.env,OWNER,due,{now:Date.parse(EVENT.reminderAt)}),false);
  assert.deepEqual(await confirmScreenshotReminder(f.env,OWNER,due,{now:Date.parse(EVENT.reminderAt)}),{confirmed:false});
  assert.equal(f.db.sql.prepare('SELECT reminded_at FROM melodi_screenshot_calendar_events').get().reminded_at,null);
  f.db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(created.event.id);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_screenshot_calendar_events').get().n,0);
});

test('cancellation and an already started event suppress advance delivery without deleting unrelated events',async()=>{
  const f=await fixture(),created=await f.create();f.db.sql.exec(GOOGLE_CALENDAR_SCHEDULE_SCHEMA.join(';'));
  const sealed=await f.services.encrypt('{}');
  f.db.sql.prepare("INSERT INTO melodi_google_calendar_schedule_overrides(owner,kind,source_id,agent,payload_encrypted,payload_iv,status,updated_at) VALUES(?,'melodi_calendar_events',?,'melodi',?,?,'cancelled',?)")
    .run(OWNER,created.event.id,sealed.encrypted,sealed.iv,NOW);
  assert.deepEqual(await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse(EVENT.reminderAt)}),[]);
  assert.deepEqual(await listDueScreenshotReminders(f.env,OWNER,{now:Date.parse(EVENT.startAt)}),[]);
});
