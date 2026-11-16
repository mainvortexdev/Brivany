import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderConfirmation, reminderDueMessage, shortReminderTime } from '../reminder-language.js';
import { create_reminder } from '../executors/calendar.js';

const NOW = Date.parse('2026-10-21T20:00:00Z');
const FUTURE = '2026-10-22T11:10:00.000Z';
const TITLE = 'Imprimir el documento de Helibert';

test('a straightforward reminder uses a short natural confirmation and due message', () => {
  assert.equal(reminderConfirmation(TITLE), 'Vale, Daniel, te recordaré imprimir el documento de Helibert.');
  assert.equal(reminderDueMessage(TITLE), 'Daniel, ya es hora de imprimir el documento de Helibert.');
  assert.equal(reminderDueMessage('Reunión con Helibert'), 'Daniel, te recuerdo lo de Reunión con Helibert.');
  assert.equal(reminderConfirmation('Revisar VETSA y el PDF de Helibert.'), 'Vale, Daniel, te recordaré revisar VETSA y el PDF de Helibert.');
  assert.match(reminderConfirmation(TITLE, { assumedHour: true }), /Como no indicaste hora, elegí las 9:00 a\. m\./);
});

test('batch dates are brief and resolved in the configured time zone across UTC midnight', () => {
  const now = Date.parse('2026-10-22T01:00:00Z');
  assert.match(shortReminderTime('2026-10-22T02:00:00Z', 'America/Santo_Domingo', now), /^hoy a las /);
  assert.match(shortReminderTime(FUTURE, 'America/Santo_Domingo', now), /^mañana a las 7:10/);
  assert.match(shortReminderTime('2027-01-02T11:10:00Z', 'America/Santo_Domingo', now), /2027/);
  assert.doesNotMatch(shortReminderTime(FUTURE, 'America/Santo_Domingo', now), /2026|jueves|T11:/);
  assert.match(shortReminderTime('2026-03-08T13:00:00Z', 'America/New_York', Date.parse('2026-03-08T04:30:00Z')), /^mañana a las /);
});

function context(addReminder, extra = {}) {
  const replies = [], cleared = [], sessions = [];
  return {
    replies, cleared, sessions,
    request: { interpretation: { intent: 'create_reminder', title: TITLE, eventAt: FUTURE, agent: 'melodi' },
      env: { TIME_ZONE: 'America/Santo_Domingo' }, phone: '18095550101', upcomingEvents: [],
      session: { type: 'await_reminder_time' }, addReminder, reply: async body => replies.push(body), ...extra },
    services: { clearOwnerSession: async (...args) => cleared.push(args), setOwnerSession: async (...args) => sessions.push(args) },
  };
}

test('confirmation waits for a persisted reminder and only then clears its pending question', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let persist;
  const f = context(() => new Promise(resolve => { persist = resolve; }));
  const executing = create_reminder(f.request, f.services);
  assert.equal(f.replies.length, 0);
  assert.equal(f.cleared.length, 0);
  persist({ id: 'confirmed-event' });
  assert.equal(await executing, true);
  assert.equal(f.replies[0], reminderConfirmation(TITLE));
  assert.equal(f.cleared.length, 1);
});

for (const [label, save] of [
  ['a database rejection', async () => { throw Error('synthetic_insert_failure'); }],
  ['an absent persistence receipt', async () => null],
]) {
  test(`${label} never emits a success or clears the pending question`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const f = context(save);
    await assert.rejects(create_reminder(f.request, f.services));
    assert.deepEqual(f.replies, []);
    assert.deepEqual(f.cleared, []);
  });
}

test('a past requested time stays pending and asks for a new time without claiming it was saved', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = context(async () => assert.fail('A past reminder cannot be saved'));
  f.request.interpretation.eventAt = '2026-10-21T11:10:00Z';
  await create_reminder(f.request, f.services);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0][2], 'await_reminder_time');
  assert.match(f.replies[0], /¿/);
  assert.doesNotMatch(f.replies[0], /te recordaré|guardado|anoté/);
  assert.deepEqual(f.cleared, []);
});
