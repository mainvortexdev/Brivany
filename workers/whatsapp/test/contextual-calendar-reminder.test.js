import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { GOOGLE_CALENDAR_SCHEDULE_SCHEMA } from '../google-calendar-schedules.js';
import { contextualCalendarReminderMessage } from '../calendar-reminder-delivery.js';
import { reminderDueMessage } from '../reminder-language.js';

const OWNER = '18095550101', NOW = Date.parse('2026-10-22T15:00:00Z');
function fixture({ at = NOW, priorAt = NOW - 2 * 3600000, priorTitle = 'Entrenar boxeo', priorOwner = OWNER } = {}) {
  const db = new FinanceD1(); db.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.sql.exec([...GOOGLE_CALENDAR_SCHEMA, ...GOOGLE_CALENDAR_SCHEDULE_SCHEMA].join(';'));
  const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER, TIME_ZONE: 'America/Santo_Domingo' };
  const insert = (id, owner, title, eventTime) => db.sql.prepare(`INSERT INTO melodi_calendar_events
    (id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)`)
    .run(id, owner, title, new Date(eventTime).toISOString(), new Date(NOW - 86400000).toISOString(), new Date(NOW - 86400000).toISOString());
  insert('current', OWNER, 'Ir a casa de Alfredo', at); insert('previous', priorOwner, priorTitle, priorAt);
  const row = db.sql.prepare('SELECT * FROM melodi_calendar_events WHERE id=?').get('current');
  const reminder = { id: row.id, title: row.title, eventAt: row.event_at, agent: row.assigned_agent, updatedAt: row.updated_at };
  const render = (now = at) => contextualCalendarReminderMessage(env, reminder, { now });
  return { db, env, reminder, render };
}

test('an 11 am visit can ask about the same owners 9 am boxing plan without claiming attendance or completion', async () => {
  const h = fixture();
  // A delivered notification proves notification only, never that Daniel went.
  h.db.sql.prepare('UPDATE melodi_calendar_events SET reminded_at=? WHERE id=?').run(new Date(NOW - 2 * 3600000).toISOString(), 'previous');
  assert.equal(await h.render(), 'Oye, Daniel, recuerda que tienes que ir a casa de Alfredo a las 11. ¿Pudiste terminar el entrenamiento de boxeo?');
  assert.doesNotMatch(await h.render(), /Melodi|Melodi|2026|terminaste el entrenamiento\.|ya entrenaste|ya fuiste/);
});

test('a previous cancellation after enqueue is reread at transport time and removes the follow-up', async () => {
  const h = fixture(); assert.match(await h.render(), /boxeo/);
  h.db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run('previous');
  assert.equal(await h.render(), reminderDueMessage(h.reminder.title));
});

for (const [table, status] of [['melodi_google_calendar_activity_map', 'unsupported'], ['melodi_google_calendar_activity_map', 'cancelled'], ['melodi_google_calendar_schedule_overrides', 'cancelled']]) {
  test(`a previous activity with ${table}/${status} is excluded`, async () => {
    const h = fixture();
    if (table === 'melodi_google_calendar_activity_map') h.db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map
      (owner,kind,source_id,agent,google_event_id,status,updated_at) VALUES(?,'melodi_calendar_events','previous','melodi','google-previous',?,?)`).run(OWNER, status, NOW);
    else h.db.sql.prepare(`INSERT INTO melodi_google_calendar_schedule_overrides
      (owner,kind,source_id,agent,payload_encrypted,payload_iv,status,updated_at) VALUES(?,'melodi_calendar_events','previous','melodi','unused','unused','cancelled',?)`).run(OWNER, NOW);
    assert.equal(await h.render(), reminderDueMessage(h.reminder.title));
  });
}

for (const [label, options] of [
  ['foreign owner', { priorOwner: '18095559999' }],
  ['another local day', { at: Date.parse('2026-10-22T05:00:00Z'), priorAt: Date.parse('2026-10-22T03:00:00Z') }],
  ['less than half an hour earlier', { priorAt: NOW - 20 * 60000 }],
  ['more than four hours earlier', { priorAt: NOW - 5 * 3600000 }],
  ['sensitive health context', { priorTitle: 'Terapia médica después de boxeo' }],
  ['a secret embedded in a sporting title', { priorTitle: 'Boxeo con clave privada 123456' }],
  ['unrecognized private context', { priorTitle: 'Visita privada con un cliente' }],
]) {
  test(`${label} never becomes conversational follow-up`, async () => {
    const h = fixture(options);
    assert.equal(await h.render(), reminderDueMessage(h.reminder.title));
  });
}

test('a current appointment edited or cancelled since enqueue cannot send the old message', async () => {
  const h = fixture(); h.db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('New owner task', 'current');
  assert.equal(await h.render(), null);
  h.db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run('current');
  assert.equal(await h.render(), null);
});

test('a late reminder acknowledges the delay, and an earlier day never supplies a follow-up', async () => {
  const h = fixture();
  const late = await h.render(NOW + 30 * 60000);
  assert.match(late, /te debía este recordatorio.*previsto para las 11/);
  assert.match(late, /¿Pudiste terminar/);
  assert.doesNotMatch(late, /ya es hora|tienes que ir.*a las 11/);
  const nextDay = await h.render(NOW + 86400000);
  assert.match(nextDay, /te debía este recordatorio/); assert.doesNotMatch(nextDay, /boxeo|¿/);
});

test('unavailable optional context falls back to the requested reminder without inventing a previous plan', async () => {
  const h = fixture(), prepare = h.db.prepare.bind(h.db);
  h.db.prepare = query => { if (query.includes('SELECT id,title,event_at')) throw Error('context_read_unavailable'); return prepare(query); };
  assert.equal(await h.render(), reminderDueMessage(h.reminder.title));
});
