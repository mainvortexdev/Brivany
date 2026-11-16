import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture, OWNER, OTHER } from './finance-fixture.js';
import { createRoutineStore } from '../melodi-routines.js';
import { contextualRoutineReminderMessage } from '../calendar-reminder-delivery.js';
import { reminderDueMessage } from '../reminder-language.js';

const THURSDAY = Date.parse('2026-10-22T15:00:00Z');
async function fixture({ at = THURSDAY, priorOwner = OWNER, priorTitle = 'Entrenar boxeo' } = {}) {
  const h = await financeFixture(); h.env.TIME_ZONE = 'America/Santo_Domingo';
  const routines = createRoutineStore(h.db, { ...h.services, now: () => at - 86400000 });
  const boxing = await routines.create({ owner: priorOwner, agent: 'melodi', kind: 'recurring_reminder', frequency: 'weekly',
    weekdays: [1,2,3,4,5], weekday: 1, hour: '09:00', title: priorTitle, eventKey: 'owner-boxing', channel: 'whatsapp' });
  const work = await routines.create({ owner: OWNER, agent: 'melodi', kind: 'recurring_reminder', frequency: 'weekly',
    weekdays: [1,2,3,4,5,6], weekday: 1, hour: '11:00', title: 'Ir a casa de Alfredo', eventKey: 'owner-work', channel: 'whatsapp' });
  const reminder = { id: work.id, runKey: `routine:${work.id}:${at}`, title: work.title, startAt: new Date(at).toISOString() };
  const render = () => contextualRoutineReminderMessage(h.env, reminder, { services: h.services, now: at });
  const edit = async (id, changes) => {
    const row = h.db.sql.prepare('SELECT * FROM wa_melodi_routines WHERE id=?').get(id);
    const value = await h.services.decrypt(row.payload_encrypted, row.payload_iv), payload = typeof value === 'string' ? JSON.parse(value) : value;
    const sealed = await h.services.encrypt(JSON.stringify({ ...payload, ...changes }));
    h.db.sql.prepare('UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted, sealed.iv, id);
  };
  return { ...h, routines, boxing, work, reminder, render, edit };
}

test('a recurring weekday 11 am work reminder asks about the same-day 9 am boxing plan using current state', async () => {
  const h = await fixture();
  assert.equal(await h.render(), 'Oye, Daniel, recuerda que tienes que ir a casa de Alfredo a las 11. ¿Pudiste terminar el entrenamiento de boxeo?');
  await h.routines.cancel({ owner: OWNER, id: h.boxing.id });
  assert.equal(await h.render(), reminderDueMessage(h.work.title));
});

for (const [label, settings] of [
  ['Saturday work without weekday boxing', { at: Date.parse('2026-10-24T15:00:00Z') }],
  ['a foreign owners boxing plan', { priorOwner: OTHER }],
  ['sensitive title mentioning boxing', { priorTitle: 'Terapia médica después de boxeo' }],
]) {
  test(`${label} supplies no personal follow-up`, async () => {
    const h = await fixture(settings); assert.equal(await h.render(), reminderDueMessage(h.work.title));
  });
}

test('Sunday is outside both weekly schedules and never delivers an invented work occurrence', async () => {
  const h = await fixture({ at: Date.parse('2026-10-25T15:00:00Z') }); assert.equal(await h.render(), null);
});

test('a cancelled or retimed boxing instance is not described as the original morning training', async () => {
  const h = await fixture(), original = '2026-10-22T13:00:00.000Z';
  await h.edit(h.boxing.id, { calendarExceptions: { [original]: { status: 'cancelled' } } });
  assert.equal(await h.render(), reminderDueMessage(h.work.title));
  await h.edit(h.boxing.id, { calendarExceptions: { [original]: { status: 'updated', title: 'Entrenar boxeo', startAt: '2026-10-22T16:00:00.000Z' } } });
  assert.equal(await h.render(), reminderDueMessage(h.work.title));
});

test('a paused prior routine is excluded even when its encrypted payload still says boxing', async () => {
  const h = await fixture();
  h.db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
    VALUES(?,'agent_routine',?,'melodi','paused-boxing','unsupported',?)`).run(OWNER, h.boxing.id, THURSDAY);
  assert.equal(await h.render(), reminderDueMessage(h.work.title));
});

test('a changed or stopped current routine invalidates the queued reminder instead of sending old text', async () => {
  const h = await fixture(); await h.edit(h.work.id, { title: 'Nueva tarea acordada' }); assert.equal(await h.render(), null);
  await h.routines.cancel({ owner: OWNER, id: h.work.id }); assert.equal(await h.render(), null);
});

test('a cancellation of the exact current occurrence invalidates delivery without stopping its series', async () => {
  const h = await fixture();
  await h.edit(h.work.id, { calendarExceptions: { [h.reminder.startAt]: { status: 'cancelled' } } });
  assert.equal(await h.render(), null); assert.equal((await h.routines.list(OWNER)).find(row => row.id === h.work.id).status, 'active');
});
