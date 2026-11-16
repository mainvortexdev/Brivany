import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { handleOwnerMessage, ownerAutonomyServices } from '../owner-features.js';

const OWNER = '18095550101';
const NOW = '2026-10-21T20:00:00.000Z';
const TIMESTAMP = String(Date.parse(NOW) / 1000);
const EXACT = 'Recuérdame mañana a las 7:10 a.m imprimir el documento de Helibert';

function fixture({ allowed = true } = {}) {
  const db = new FinanceD1();
  for (const file of ['schema.sql', 'melodi-team-coordination.sql', 'story-campaign.sql', 'story-approval.sql']) {
    db.sql.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  const replies = [], permissions = [], modelCalls = [], observations = [], stages = [];
  const env = {
    VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER,
    TEAM_AUTONOMY_ENABLED: 'true', TEAM_CONVERSATION_LEADER: 'melodi', TIME_ZONE: 'America/La_Paz',
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
    VETSA_INTELLIGENCE: { async fetch(request) { modelCalls.push(request); throw Error('synthetic_router_unavailable'); } },
  };
  const rows = () => db.sql.prepare('SELECT id,phone,title,event_at,assigned_agent FROM melodi_calendar_events ORDER BY event_at,id').all().map(row => ({ ...row }));
  const send = (incoming = EXACT, { id = 'wa-simple-1', timestamp = TIMESTAMP, persist } = {}) => handleOwnerMessage(env, {
    phone: OWNER, incoming, message: { id, timestamp, type: 'text' },
    markTyping: async () => {},
    sendText: async (_env, phone, body, options) => {
      assert.equal(phone, OWNER);
      stages.push('reply');
      replies.push({ body, agent: options?.agent, eventsAtReply: rows() });
    },
    addReminder: persist || (async (title, eventAt, options) => {
      stages.push('persist');
      const eventId = `event-${rows().length + 1}`;
      db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,created_at,updated_at,assigned_agent) VALUES(?,?,?,?,?,?,?,?)')
        .run(eventId, OWNER, title, eventAt, 'REMINDER', NOW, NOW, options.agent);
      return { id: eventId, eventAt };
    }),
    configureTeam: async command => {
      permissions.push(command);
      if (command.action === 'authorize_skill') return { allowed, response: 'Necesito autorización para modificar tu agenda.' };
      return null;
    },
    observeAgent: async agent => { observations.push({ kind: 'owner', agent }); },
    observeAgentReply: async (agent, body) => { observations.push({ kind: 'assistant', agent, body }); },
  });
  const session = async (type, state) => {
    const sealed = await ownerAutonomyServices(env).encrypt(state);
    db.sql.prepare('INSERT INTO wa_owner_session VALUES(?,?,?,?,?)').run(OWNER, type, sealed.encrypted, sealed.iv, NOW);
  };
  return { db, env, send, rows, replies, permissions, modelCalls, observations, stages, session };
}

test('the exact owner request persists before one natural response with the model unavailable', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  assert.equal(await f.send(), true);
  assert.deepEqual(f.rows().map(({ title, event_at, assigned_agent }) => ({ title, event_at, assigned_agent })), [{
    title: 'imprimir el documento de Helibert', event_at: '2026-10-22T11:10:00.000Z', assigned_agent: 'melodi',
  }]);
  assert.deepEqual(f.stages, ['persist', 'reply']);
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].eventsAtReply.length, 1);
  assert.equal(f.replies[0].agent, 'melodi');
  assert.match(f.replies[0].body, /te recordaré imprimir el documento de Helibert/i);
  assert.doesNotMatch(f.replies[0].body, /Melodi:|Melodi|📌|2026|Spaik/);
  assert.equal(f.modelCalls.length, 0);
  const grants = f.permissions.filter(item => item.action === 'authorize_skill');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].agent, 'melodi');
  assert.equal(grants[0].tool, 'manage_calendar');
  assert.deepEqual(f.observations.map(({ kind, agent }) => ({ kind, agent })), [
    { kind: 'owner', agent: 'melodi' }, { kind: 'assistant', agent: 'melodi' },
  ]);
});

test('denied calendar authority cannot write or confirm a fast reminder', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture({ allowed: false });
  assert.equal(await f.send(), true);
  assert.deepEqual(f.rows(), []);
  assert.equal(f.replies.length, 1);
  assert.match(f.replies[0].body, /autorización/);
  assert.doesNotMatch(f.replies[0].body, /te recordaré|anoté|guardé|programé/i);
  assert.equal(f.modelCalls.length, 0);
});

test('storage failure cannot emit a successful confirmation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await assert.rejects(f.send(EXACT, { persist: async () => { throw Error('synthetic_insert_failed'); } }), /synthetic_insert_failed/);
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.replies, []);
  assert.equal(f.modelCalls.length, 0);
});

test('a missing persistence receipt cannot emit a successful confirmation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await assert.rejects(f.send(EXACT, { persist: async () => null }));
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.replies, []);
  assert.equal(f.modelCalls.length, 0);
});

test('a delayed webhook preserves the original local day across midnight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-22T05:00:00.000Z') });
  const f = fixture();
  assert.equal(await f.send(), true);
  assert.equal(f.rows()[0].event_at, '2026-10-22T11:10:00.000Z');
  assert.equal(f.modelCalls.length, 0);
});

test('duration retries use the durable receipt time rather than a fresh delay', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T20:05:00.000Z') });
  const f = fixture();
  assert.equal(await f.send('Recuérdame en 10 minutos imprimir el documento de Helibert'), true);
  assert.equal(f.rows()[0].event_at, '2026-10-21T20:10:00.000Z');
  assert.equal(f.modelCalls.length, 0);
});

test('a complete new reminder clears an old time question only after persistence', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await f.session('await_reminder_time', { title: 'Trabajo anterior que no debe reutilizarse' });
  assert.equal(await f.send(), true);
  assert.equal(f.rows()[0].title, 'imprimir el documento de Helibert');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_session').get().n, 0);
  assert.equal(f.modelCalls.length, 0);
});

test('ambiguous references and email requests cannot execute through the fast path', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  for (const text of [
    'Recuérdame mañana a las 7:10 a.m. eso que mencionaste',
    'Recuérdame mañana a las 7:10 a.m. enviar el documento por correo a Helibert',
  ]) {
    const f = fixture();
    await assert.rejects(f.send(text), /owner_routing_temporarily_unavailable/);
    assert.deepEqual(f.rows(), [], text);
    assert.deepEqual(f.replies, [], text);
    assert.ok(f.modelCalls.length > 0, text);
  }
});

test('an attachment continuation session remains with the existing semantic flow', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  await f.session('await_reminder_attachment', { title: 'Recordatorio con foto', eventAt: '2026-10-22T12:00:00.000Z' });
  await assert.rejects(f.send(), /owner_routing_temporarily_unavailable/);
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.replies, []);
  assert.ok(f.modelCalls.length > 0);
});

test('inline work defers an incompatible pending session before any model or calendar action', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fixture();
  f.env.VETSA_FAST_REMINDER_ONLY = true;
  await f.session('await_reminder_attachment', { title: 'Recordatorio con foto', eventAt: '2026-10-22T12:00:00.000Z' });
  await assert.rejects(f.send(), /fast_reminder_deferred/);
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(f.replies, []);
  assert.equal(f.modelCalls.length, 0);
  assert.deepEqual(f.permissions, []);
  assert.deepEqual(f.observations, []);
});

test('inline work defers unparseable text instead of waiting for model fallback', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  for (const text of ['Recuérdame mañana a las 7:10 a.m. eso que mencionaste', 'Hola Melodi']) {
    const f = fixture();
    f.env.VETSA_FAST_REMINDER_ONLY = true;
    await assert.rejects(f.send(text), /fast_reminder_deferred/);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual(f.replies, []);
    assert.equal(f.modelCalls.length, 0);
    assert.deepEqual(f.permissions, []);
    assert.deepEqual(f.observations, []);
  }
});
