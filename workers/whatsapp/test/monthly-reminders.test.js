import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMonthlyRoutineAt } from '../melodi-routines.js';
import { listScheduledActivities,applyCalendarChange,routineCalendarRunState } from '../google-calendar-schedules.js';
import { readOwnerAgenda } from '../owner-agenda.js';
import { parseRecurringReminder } from '../finance-request.js';
import worker from '../worker.js';
import { financeFixture,OWNER,NOW } from './finance-fixture.js';

test('monthly renewal is future in Dominican time and advances across years',()=>{
  assert.equal(nextMonthlyRoutineAt(NOW,7),'2026-11-07T13:00:00.000Z');
  assert.equal(nextMonthlyRoutineAt('2026-11-07T12:59:59Z',7),'2026-11-07T13:00:00.000Z');
  assert.equal(nextMonthlyRoutineAt('2026-11-07T13:00:00Z',7),'2026-12-07T13:00:00.000Z');
  assert.equal(nextMonthlyRoutineAt('2026-12-31T23:59:00Z',7),'2027-01-07T13:00:00.000Z');
});
test('days 29, 30 and 31 skip invalid months exactly like Google BYMONTHDAY',()=>{
  assert.equal(nextMonthlyRoutineAt('2027-01-31T13:00:00Z',31),'2027-03-31T13:00:00.000Z');
  assert.equal(nextMonthlyRoutineAt('2028-01-30T13:00:00Z',29),'2028-02-29T13:00:00.000Z');
  assert.equal(nextMonthlyRoutineAt('2027-01-30T13:00:00Z',29),'2027-03-29T13:00:00.000Z');
  assert.throws(()=>nextMonthlyRoutineAt(NOW,0));assert.throws(()=>nextMonthlyRoutineAt(NOW,32));
});
test('daily ambiguous ten at eleven AM resolves to ten PM without a question',()=>{
  const r=parseRecurringReminder('Recuérdame cada día a las 10 completar las tareas pendientes',Date.parse('2026-10-08T15:00Z'));
  assert.equal(r.hour,'22:00');assert.equal(r.frequency,'daily');
});
test('monthly schedule exports a private series and appears in owner agenda',async()=>{
  const h=await financeFixture(),r=await h.routines.create({owner:OWNER,agent:'melodi',eventKey:'month',kind:'recurring_reminder',frequency:'monthly',dayOfMonth:7,title:'Renovar internet'});
  const activities=await listScheduledActivities(h.env,OWNER,h.options);assert.deepEqual(activities[0].recurrence,['RRULE:FREQ=MONTHLY;BYMONTHDAY=7']);assert.equal(activities[0].startAt,r.nextAt);
  const agenda=await readOwnerAgenda(h.env,OWNER,{start:'2026-11-07T04:00:00Z',end:'2026-11-08T04:00:00Z',limit:10,decrypt:h.services.decrypt});
  assert.ok(agenda.events.some(e=>e.title==='Renovar internet'));assert.equal(agenda.events[0].assigned_agent,'melodi');
});
test('monthly claim is leased once and advances to December, not next week',async()=>{
  const h=await financeFixture();await h.routines.create({owner:OWNER,agent:'melodi',eventKey:'renewal',kind:'recurring_reminder',frequency:'monthly',dayOfMonth:7,title:'Renovar Google One'});
  assert.equal((await h.routines.claimDue({owner:OWNER,now:NOW})).length,0);
  const at=Date.parse('2026-11-07T13:00Z'),[claim]=await h.routines.claimDue({owner:OWNER,now:at});assert.equal(claim.agent,'melodi');
  assert.equal((await h.routines.claimDue({owner:OWNER,now:at})).length,0);
  await h.routines.complete({owner:OWNER,id:claim.id,leaseToken:claim.leaseToken,success:true,now:at});assert.equal((await h.routines.list(OWNER))[0].nextAt,'2026-12-07T13:00:00.000Z');
});
async function mappedMonthly(h){
  const r=await h.routines.create({owner:OWNER,agent:'melodi',eventKey:'editable',kind:'recurring_reminder',frequency:'monthly',dayOfMonth:7,title:'Renovar cuotas'});
  const mapping={owner:OWNER,kind:'agent_routine',id:r.id,agent:'melodi',googleEventId:'google-monthly'};
  h.db.sql.prepare('INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,updated_at) VALUES(?,?,?,?,?,?)').run(OWNER,mapping.kind,r.id,'melodi','google-monthly',NOW);
  return {r,mapping};
}
test('Google can change monthly day and hour; old queued occurrence cannot execute',async()=>{
  const h=await financeFixture(),{r,mapping}=await mappedMonthly(h);
  const result=await applyCalendarChange(h.env,OWNER,mapping,{...mapping,status:'updated',title:'Cuotas nuevas',startAt:'2026-11-08T15:00:00Z',endAt:'2026-11-08T15:15:00Z',recurrence:['RRULE:FREQ=MONTHLY;BYMONTHDAY=8']},h.options);
  assert.equal(result.applied,true);const row=(await h.routines.list(OWNER))[0];assert.equal(row.dayOfMonth,8);assert.equal(row.hour,'11:00');
  assert.equal((await routineCalendarRunState(h.env,OWNER,r.id,`routine:${r.id}:${Date.parse(r.nextAt)}`,h.options)).active,false);
});
test('Google instance move keeps monthly parent and honors occurrence timing',async()=>{
  const h=await financeFixture(),{r,mapping}=await mappedMonthly(h);
  const result=await applyCalendarChange(h.env,OWNER,{...mapping,googleEventId:'instance-1'},{...mapping,googleEventId:'instance-1',recurringEventId:'google-monthly',originalStartAt:r.nextAt,status:'updated',title:'Renovar otro día',startAt:'2026-11-09T14:00:00Z',endAt:'2026-11-09T14:15:00Z',recurrence:[]},h.options);
  assert.equal(result.applied,true);assert.equal((await h.routines.list(OWNER))[0].nextAt,'2026-11-09T14:00:00.000Z');
  const state=await routineCalendarRunState(h.env,OWNER,r.id,`routine:${r.id}:${Date.parse(r.nextAt)}`,h.options);assert.equal(state.status,'waiting');
});
test('Google instance cancellation skips November; series cancellation stops all future runs',async()=>{
  const h=await financeFixture(),{r,mapping}=await mappedMonthly(h);
  assert.equal((await applyCalendarChange(h.env,OWNER,{...mapping,googleEventId:'instance-1'},{...mapping,googleEventId:'instance-1',recurringEventId:'google-monthly',originalStartAt:r.nextAt,status:'cancelled'},h.options)).applied,true);
  assert.equal((await h.routines.list(OWNER))[0].nextAt,'2026-12-07T13:00:00.000Z');
  assert.equal((await applyCalendarChange(h.env,OWNER,mapping,{...mapping,status:'cancelled'},h.options)).applied,true);
  assert.equal((await h.routines.claimDue({owner:OWNER,now:Date.parse('2026-12-07T13:00Z')})).length,0);
});
test('Free cron does only durable queue dispatch; API work occurs in consumer',async()=>{
  const messages=[],waits=[];
  await worker.scheduled({scheduledTime:NOW},{MELODI_JOBS:{async send(v){messages.push(v);}},VETSA_CLOUD:{prepare(){throw new Error('Cron must not run D1 or Calendar');}}},{waitUntil(p){waits.push(p);}});
  await Promise.all(waits);assert.deepEqual(messages,[{type:'scheduled_tick',scheduledTime:NOW}]);
});
