import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { handleOwnerMessage, ownerAutonomyServices } from '../owner-features.js';
import { createReminderBatch } from '../calendar-reminder-batch.js';

const OWNER = '18095550101';
const OTHER = '18095559999';
const NOW = '2026-10-17T22:06:00.000Z';
const TIMESTAMP = String(Date.parse(NOW) / 1000);
const EXACT = 'Mañana a las 7:00 a.m tengo un rodaje, anótalo en mi agenda, para el lunes tengo otro a las 8:00 p.m';
const EXPECTED = ['2026-10-18T11:00:00.000Z', '2026-10-20T00:00:00.000Z'];
const EVENTS = [{ title: 'Rodaje', eventAt: EXPECTED[0] }, { title: 'Rodaje', eventAt: EXPECTED[1] }];

function fixture({ allowed = true } = {}) {
  const db = new FinanceD1();
  for (const file of ['schema.sql', 'melodi-team-coordination.sql', 'story-campaign.sql', 'story-approval.sql']) {
    db.sql.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  const replies = [], permissions = [], modelCalls = [];
  const env = {
    VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER,
    TEAM_AUTONOMY_ENABLED: 'true', TEAM_CONVERSATION_LEADER: 'melodi', TIME_ZONE: 'America/Santo_Domingo',
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
    VETSA_INTELLIGENCE: { async fetch(request) { modelCalls.push(request); throw Error('synthetic_router_unavailable'); } },
  };
  const send = (incoming = EXACT, { id = 'wa-multiple-rodajes-1', timestamp = TIMESTAMP } = {}) => handleOwnerMessage(env, {
    phone: OWNER, incoming, message: { id, timestamp, type: 'text' },
    markTyping: async () => {},
    sendText: async (_env, phone, body, options) => { assert.equal(phone, OWNER); replies.push({ body, agent: options?.agent }); },
    addReminder: async () => assert.fail('Multiple events must use the atomic batch, never sequential single inserts'),
    configureTeam: async command => {
      permissions.push(command);
      if (command.action === 'authorize_skill') return { allowed, response: 'Necesito autorización para modificar tu agenda.' };
      return null;
    },
  });
  const rows = () => db.sql.prepare('SELECT id,phone,title,event_at,assigned_agent FROM melodi_calendar_events ORDER BY event_at,id').all().map(row => ({ ...row }));
  return { db, env, send, rows, replies, permissions, modelCalls };
}

async function encryptedContext(env, owner, agent, recent) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', Buffer.from(env.MEMORY_ENCRYPTION_KEY, 'base64'), 'AES-GCM', false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ recent })));
  env.VETSA_CLOUD.sql.prepare('INSERT INTO wa_melodi_private_context(owner_phone,agent,encrypted_context,context_iv,updated_at) VALUES(?,?,?,?,?)')
    .run(owner, agent, Buffer.from(cipher).toString('base64'), Buffer.from(iv).toString('base64'), NOW);
}

test('the exact reported WhatsApp request atomically saves both rodajes and answers once as Melodi without a classifier', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  assert.equal(await f.send(), true);
  const rows = f.rows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.event_at), EXPECTED);
  for (const row of rows) {
    assert.match(row.title, /^rodaje$/i);
    assert.equal(row.phone, OWNER);
    assert.equal(row.assigned_agent, 'melodi');
  }
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].agent, 'melodi');
  assert.match(f.replies[0].body, /^Listo, te recordaré/);
  assert.doesNotMatch(f.replies[0].body, /Melodi:|Melodi:|📌|2026/);
  assert.match(f.replies[0].body, /7:00|07:00/);
  assert.match(f.replies[0].body, /8:00|20:00/);
  assert.doesNotMatch(f.replies[0].body, /¿Qué tarea concreta|lo que mencioné|correo|Melodi|Spaik/i);
  const grants = f.permissions.filter(command => command.action === 'authorize_skill');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].tool, 'manage_calendar');
  assert.equal(grants[0].agent, 'melodi');
  assert.equal(f.permissions.some(command => !['authorize_skill', 'selected', 'approval_notified'].includes(command.action)), false);
  assert.equal(f.modelCalls.length, 0);
});

test('replaying and concurrently receiving the same WhatsApp message cannot duplicate the calendar set', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await Promise.all([f.send(), f.send()]);
  const first = f.rows();
  assert.equal(first.length, 2);
  await f.send();
  assert.deepEqual(f.rows(), first);
  assert.equal(f.modelCalls.length, 0);
});

test('a delayed webhook resolves relative dates from the original Meta timestamp', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T10:00:00.000Z') });
  const f = fixture();
  await f.send();
  assert.deepEqual(f.rows().map(row => row.event_at), EXPECTED);
  assert.equal(f.modelCalls.length, 0);
});

test('a completed calendar set clears the old reminder clarification only after persistence', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f=fixture(),sealed=await ownerAutonomyServices(f.env).encrypt({title:EXACT});
  f.db.sql.prepare('INSERT INTO wa_owner_session VALUES(?,?,?,?,?)').run(OWNER,'await_reminder_time',sealed.encrypted,sealed.iv,NOW);
  await f.send();
  assert.equal(f.rows().length,2);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_session').get().n,0);
  assert.equal(f.replies.length,1);
});

test('explicit dates without any time use the existing 09:00 policy and disclose that choice', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f=fixture();
  await f.send('Anota mañana rodaje y el lunes revisión de contrato');
  assert.deepEqual(f.rows().map(row=>row.event_at),['2026-10-18T13:00:00.000Z','2026-10-19T13:00:00.000Z']);
  assert.match(f.replies[0].body,/Como no indicaste hora, elegí las 9:00/);
  assert.equal(f.modelCalls.length,0);
});

test('concrete events in the same message are independent of stale projects and every agents private history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  for (const [owner, agent, message] of [
    [OWNER, 'melodi', 'Siguiente paso: crear planos 3D para el proyecto incorrecto.'],
    [OWNER, 'melodi', '¿Qué tarea concreta de lo que mencioné quieres que agende?'],
    [OTHER, 'melodi', 'Siguiente paso: PRIVATE_OTHER_OWNER_TASK.'],
  ]) await encryptedContext(f.env, owner, agent, [{ role: 'assistant', message, at: NOW }]);
  f.db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('old-unrelated-event', OWNER, 'Crear planos 3D', '2026-10-21T14:00:00.000Z', 'REMINDER', NOW, NOW);
  await f.send();
  const added = f.rows().filter(row => row.id !== 'old-unrelated-event');
  assert.deepEqual(added.map(row => row.event_at), EXPECTED);
  assert.ok(added.every(row => /^rodaje$/i.test(row.title)));
  assert.doesNotMatch(f.replies[0].body, /3D|proyecto incorrecto|PRIVATE_OTHER_OWNER|Qué tarea concreta/i);
  assert.equal(f.modelCalls.length, 0);
});

test('denied calendar authority cannot write either event or claim success', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture({ allowed: false });
  await f.send();
  assert.deepEqual(f.rows(), []);
  assert.equal(f.replies.length, 1);
  assert.match(f.replies[0].body, /autorización/);
  assert.doesNotMatch(f.replies[0].body, /anoté|agendé|programados|guardados/i);
  assert.equal(f.modelCalls.length, 0);
});

test('an explicit specialist address preserves that interlocutor for the whole calendar set', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await f.send(`Melodi, ${EXACT}`, { id: 'wa-explicit-melodi-calendar' });
  assert.equal(f.rows().length, 2);
  assert.ok(f.rows().every(row => row.assigned_agent === 'melodi'));
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].agent, 'melodi');
  assert.match(f.replies[0].body, /^Listo, te recordaré/);
  assert.doesNotMatch(f.replies[0].body, /Melodi:|Melodi:|📌/);
  const grants = f.permissions.filter(command => command.action === 'authorize_skill');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].agent, 'melodi');
  assert.equal(f.modelCalls.length, 0);
});

test('a handler database failure cannot leak a success response for the first event', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  f.db.sql.exec(`CREATE TRIGGER reject_second_requested_time BEFORE INSERT ON melodi_calendar_events
    WHEN NEW.event_at='2026-10-20T00:00:00.000Z' BEGIN SELECT RAISE(ABORT,'synthetic_requested_insert_failure'); END`);
  await assert.rejects(f.send(), /synthetic_requested_insert_failure/);
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.replies, []);
  assert.equal(f.modelCalls.length, 0);
});

test('incomplete second event asks about the actual missing detail and leaves both unsaved', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  for (const incoming of [
    'Mañana a las 7 a.m. tengo un rodaje, anótalo en mi agenda y tengo otro a las 8 p.m.',
    'Mañana a las 7 a.m. tengo un rodaje, anótalo en mi agenda, para el lunes tengo algo a las 8 p.m.',
  ]) {
    const f = fixture();
    await f.send(incoming);
    assert.deepEqual(f.rows(), [], incoming);
    assert.equal(f.replies.length, 1, incoming);
    assert.match(f.replies[0].body, /¿/);
    assert.match(f.replies[0].body, /segund|otro|lunes|fecha|hora|actividad/i);
    assert.doesNotMatch(f.replies[0].body, /¿Qué tarea concreta de lo que mencioné|anoté|agendé|programados/i);
    assert.equal(f.modelCalls.length, 0, incoming);
  }
});

test('batch input validates every event before any calendar insert', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  for (const bad of [
    { title: '', eventAt: EXPECTED[1] },
    { title: 'Rodaje', eventAt: 'not-a-date' },
    { title: 'Rodaje', eventAt: '2020-01-01T00:00:00Z' },
  ]) {
    const f = fixture();
    await assert.rejects(createReminderBatch(f.env, OWNER, 'invalid-second', [EVENTS[0], bad]), /invalid_reminder_batch_event/);
    assert.deepEqual(f.rows(), []);
  }
});

test('a database failure on the second event rolls back its first event and idempotency manifest', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  f.db.sql.exec(`CREATE TRIGGER reject_second_event BEFORE INSERT ON melodi_calendar_events
    WHEN NEW.title='Evento fallará' BEGIN SELECT RAISE(ABORT,'synthetic_second_insert_failure'); END`);
  const input = [EVENTS[0], { title: 'Evento fallará', eventAt: EXPECTED[1] }];
  await assert.rejects(createReminderBatch(f.env, OWNER, 'atomic-failure', input), /synthetic_second_insert_failure/);
  assert.deepEqual(f.rows(), []);
  assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM calendar_reminder_batches').get().n, 0);
  f.db.sql.exec('DROP TRIGGER reject_second_event');
  const result = await createReminderBatch(f.env, OWNER, 'atomic-failure', input);
  assert.equal(result.status, 'scheduled');
  assert.equal(f.rows().length, 2);
});

test('the batch source identity is isolated by owner and rejects changed payloads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  const original = await createReminderBatch(f.env, OWNER, 'shared-source', EVENTS);
  const other = await createReminderBatch(f.env, OTHER, 'shared-source', EVENTS);
  assert.notEqual(original.id, other.id);
  assert.equal(f.rows().length, 4);
  await assert.rejects(createReminderBatch(f.env, OWNER, 'shared-source', [EVENTS[0], { ...EVENTS[1], title: 'Changed task' }]));
  assert.ok(f.rows().every(row => row.title === 'Rodaje'));
  assert.equal(f.rows().length, 4);
});

test('replaying a batch cannot restore a subsequently edited event', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  const original = await createReminderBatch(f.env, OWNER, 'calendar-edited', EVENTS);
  f.db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('Rodaje reprogramado por el propietario', original.events[1].id);
  await assert.rejects(createReminderBatch(f.env, OWNER, 'calendar-edited', EVENTS));
  const edited = f.rows().find(row => row.id === original.events[1].id);
  assert.equal(edited.title, 'Rodaje reprogramado por el propietario');
  assert.equal(f.rows().length, 2);
});
