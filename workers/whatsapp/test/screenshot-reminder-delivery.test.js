import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { ownerAutonomyServices } from '../owner-features.js';
import { createScreenshotCalendarEvent } from '../screenshot-calendar-store.js';
import { enqueueScreenshotReminders } from '../screenshot-reminder-delivery.js';
import { runEmily } from '../worker.js';

const OWNER='18095550101',NOW=Date.parse('2026-10-26T15:00:00Z');
async function fixture(t,{send}={}) {
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const db=new FinanceD1();
  for (const file of ['schema.sql','melodi-team-coordination.sql','melodi-autonomy.sql','melodi-permissions.sql','melodi-routines.sql','melodi-autonomy-maintenance.sql','melodi-artifact-tracking.sql','owner-task-references.sql','delivery-notice.sql']) db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TEAM_CONVERSATION_LEADER:'melodi',TEAM_AUTONOMY_ENABLED:'true',
    TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MELODI_JOBS:{async send(){}}};
  const services=ownerAutonomyServices(env),sends=[];
  const runtime=createAgentRuntime(env,{sendText:async(...args)=>{
    sends.push(args); return send ? send(...args) : {status:'sent',messageId:'test-provider-1'};
  }}); await runtime.initialize();
  const created=await createScreenshotCalendarEvent(env,OWNER,'screenshot-1',{title:'Meta Global AI Developer Hackathon',
    startAt:'2026-10-26T17:00:00.000Z',endAt:'2026-11-05T02:00:00.000Z',sourceTimeZone:'GMT-05:00',
    remindBeforeMinutes:120,clearStartSlot:true},{services,now:NOW-86400000});
  assert.equal(created.status,'applied');
  return {db,env,services,runtime,sends,created,
    saved:()=>db.sql.prepare('SELECT * FROM melodi_screenshot_calendar_events').get(),
    notice:()=>db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get()};
}

test('advance notice delivers once as Melodi and never completes the calendar event',async t=>{
  const h=await fixture(t);
  await enqueueScreenshotReminders(h.env,{services:h.services,now:NOW-1}); assert.equal(h.notice(),undefined);
  await Promise.all([enqueueScreenshotReminders(h.env,{services:h.services,now:NOW}),enqueueScreenshotReminders(h.env,{services:h.services,now:NOW})]);
  await Promise.all([h.runtime.deliverNotices(),h.runtime.deliverNotices()]);
  assert.equal(h.sends.length,1); assert.match(h.sends[0][2],/Hackathon empieza hoy a las 1:00/);
  assert.doesNotMatch(h.sends[0][2],/Melodi:|Melodi|GMT|2026/);
  assert.ok(h.saved().reminded_at); assert.equal(h.notice().status,'sent');
  assert.equal(h.db.sql.prepare('SELECT reminded_at FROM melodi_calendar_events WHERE id=?').get(h.created.event.id).reminded_at,null);
  await runEmily(h.env); await h.runtime.deliverNotices(); assert.equal(h.sends.length,1);
});

test('queued advance notice rereads changes and cannot send an obsolete event',async t=>{
  const h=await fixture(t); await enqueueScreenshotReminders(h.env,{services:h.services,now:NOW});
  h.db.sql.prepare('UPDATE melodi_calendar_events SET event_at=?,updated_at=? WHERE id=?').run('2026-10-27T17:00:00.000Z',new Date(NOW+1).toISOString(),h.created.event.id);
  await h.runtime.deliverNotices(); assert.equal(h.sends.length,0); assert.equal(h.saved().reminded_at,null);
});

test('an uncertain provider response never marks an advance notice delivered',async t=>{
  const h=await fixture(t,{send:async()=>{throw Error('network failure');}});
  await enqueueScreenshotReminders(h.env,{services:h.services,now:NOW}); await h.runtime.deliverNotices();
  assert.equal(h.saved().reminded_at,null); assert.equal(h.notice().status,'uncertain');
  await h.runtime.deliverNotices(); assert.equal(h.sends.length,1);
});
