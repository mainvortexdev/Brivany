import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createEvent, runEmily } from '../worker.js';
import { create_reminder } from '../executors/calendar.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';

const OWNER = '18495205246';
const NOW = '2026-10-08T12:00:00.000Z';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const database = this;
    const make = values => ({ bind: (...next) => make(next),
      async first() { return database.sql.prepare(query).get(...values) || null; },
      async all() { return { results: database.sql.prepare(query).all(...values) }; },
      async run() { return { meta: { changes: database.sql.prepare(query).run(...values).changes } }; },
    });
    return make([]);
  }
}

function fixture({ onGenerate } = {}) {
  const db = new SqliteD1();
  db.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const requests = [], sent = [];
  const env = { VETSA_CLOUD: db, TIME_ZONE: 'America/Santo_Domingo',
    VETSA_INTELLIGENCE: { async fetch(request) {
      const body = await request.json(); requests.push(body);
      if (onGenerate) await onGenerate({ db, body });
      return Response.json({ text: JSON.stringify({ steps: ['Revisar los requisitos registrados.', 'Comprobar los criterios de aceptación.'] }) });
    } },
  };
  const sendText = async (_env, phone, body) => { assert.equal(phone, OWNER); sent.push(body); };
  return { db, env, requests, sent, sendText };
}

test('migration retains legacy calendar records and rejects unknown assigned agents', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE melodi_calendar_events(id TEXT PRIMARY KEY,phone TEXT,title TEXT,event_at TEXT)');
  db.prepare('INSERT INTO melodi_calendar_events VALUES(?,?,?,?)').run('legacy', OWNER, 'Legacy event', NOW);
  db.exec(readFileSync(new URL('../calendar-agent-assignment.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare('SELECT assigned_agent FROM melodi_calendar_events').get().assigned_agent, null);
  assert.throws(() => db.prepare('UPDATE melodi_calendar_events SET assigned_agent=?').run('another-agent'), /CHECK/);
});

test('calendar executor forwards the selected member and createEvent persists that assignment', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = fixture();
  const replies = [];
  const eventAt = '2026-10-16T13:00:00.000Z';
  await create_reminder({ interpretation: { intent: 'create_reminder', agent: 'melodi', title: 'Crear planos 3D', eventAt },
    upcomingEvents: [], env: context.env, phone: OWNER, reply: async value => replies.push(value),
    addReminder: (title, at, options) => createEvent(context.env, OWNER, title, at, 'REMINDER', options),
  }, { localEventTime: () => 'viernes, 16 de octubre de 2026, 9:00 a. m.' });
  const saved = context.db.sql.prepare('SELECT assigned_agent,title,event_at FROM melodi_calendar_events').get();
  assert.deepEqual({ ...saved }, { assigned_agent: 'melodi', title: 'Crear planos 3D', event_at: eventAt });
  assert.equal(replies[0], 'Vale, Daniel, te recordaré crear planos 3D.');
  await assert.rejects(createEvent(context.env, OWNER, 'Invalid', eventAt, 'REMINDER', { agent: 'invented' }), /Integrante/);
});

test('Melodi prepares and delivers her reminder while unassigned legacy events continue as Melodi', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = fixture();
  const first = await createEvent(context.env, OWNER, 'Crear planos 3D', '2026-10-08T13:00:00.000Z', 'REMINDER', { agent: 'melodi' });
  const second = await createEvent(context.env, OWNER, 'Legacy event', '2026-10-08T13:00:00.000Z');
  await runEmily(context.env, { sendText: context.sendText });
  assert.equal(context.sent.length, 2);
  assert.doesNotMatch(context.sent[0], /Melodi|Melodi|📋/);
  assert.doesNotMatch(context.sent[1], /Melodi|Melodi|📋/);
  assert.match(context.requests[0].options.systemPrompt, /Eres Melodi/);
  assert.match(context.requests[1].options.systemPrompt, /Eres Melodi/);
  assert.equal(context.db.sql.prepare('SELECT emily_prepared_at FROM melodi_calendar_events WHERE id=?').get(first.id).emily_prepared_at, NOW);
  t.mock.timers.setTime(Date.parse('2026-10-08T13:00:00.000Z'));
  await runEmily(context.env, { sendText: context.sendText });
  assert.equal(context.sent[2], 'Daniel, ya es hora de crear planos 3D.');
  assert.equal(context.sent[3], 'Daniel, te recuerdo lo de Legacy event.');
  for (const id of [first.id, second.id]) assert.ok(context.db.sql.prepare('SELECT reminded_at FROM melodi_calendar_events WHERE id=?').get(id).reminded_at);
});

test('a preparation changed during model generation never sends or marks the old snapshot', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = fixture({ onGenerate: ({ db }) => {
    db.sql.prepare('UPDATE melodi_calendar_events SET title=?,assigned_agent=?,updated_at=?').run('Nueva tarea', 'melodi', '2026-10-08T12:00:01.000Z');
  } });
  await createEvent(context.env, OWNER, 'Old task', '2026-10-08T13:00:00.000Z', 'REMINDER', { agent: 'melodi' });
  await runEmily(context.env, { sendText: context.sendText });
  assert.deepEqual(context.sent, []);
  assert.equal(context.db.sql.prepare('SELECT emily_prepared_at FROM melodi_calendar_events').get().emily_prepared_at, null);
});

test('editing an event while its old reminder is sent does not mark the replacement delivered', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = fixture();
  await createEvent(context.env, OWNER, 'Old task', NOW, 'REMINDER', { agent: 'melodi' });
  await runEmily(context.env, { sendText: async (...args) => {
    await context.sendText(...args);
    context.db.sql.prepare('UPDATE melodi_calendar_events SET title=?,event_at=?,assigned_agent=?,updated_at=?')
      .run('Replacement task', '2026-10-16T13:00:00.000Z', 'melodi', '2026-10-08T12:00:01.000Z');
  } });
  assert.equal(context.sent.length, 1);
  const saved = context.db.sql.prepare('SELECT title,reminded_at FROM melodi_calendar_events').get();
  assert.equal(saved.title, 'Replacement task');
  assert.equal(saved.reminded_at, null);
});

test('a quarantined reminder stays silent while another member prepares and delivers her own reminder', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context=fixture();context.db.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));
  const paused=await createEvent(context.env,OWNER,'Actividad en revisión','2026-10-08T13:00:00.000Z','REMINDER',{agent:'melodi'});
  const active=await createEvent(context.env,OWNER,'Actividad compatible','2026-10-08T13:00:00.000Z','REMINDER',{agent:'melodi'});
  context.db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
    VALUES(?,'melodi_calendar_events',?,'melodi','google-paused','unsupported',?)`).run(OWNER,paused.id,Date.parse(NOW));
  await runEmily(context.env,{sendText:context.sendText});
  assert.equal(context.requests.length,1);assert.match(context.requests[0].options.systemPrompt,/Eres Melodi/);
  assert.equal(context.sent.length,1);assert.doesNotMatch(context.sent[0],/Melodi|📋/);
  t.mock.timers.setTime(Date.parse('2026-10-08T13:00:00.000Z'));await runEmily(context.env,{sendText:context.sendText});
  assert.equal(context.sent.length,2);assert.equal(context.sent[1],'Daniel, te recuerdo lo de Actividad compatible.');
  const frozen=context.db.sql.prepare('SELECT emily_prepared_at,reminded_at FROM melodi_calendar_events WHERE id=?').get(paused.id);
  assert.equal(frozen.emily_prepared_at,null);assert.equal(frozen.reminded_at,null);
  assert.ok(context.db.sql.prepare('SELECT reminded_at FROM melodi_calendar_events WHERE id=?').get(active.id).reminded_at);
});

test('quarantine added during preparation prevents sending or marking the obsolete model result',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const context=fixture({onGenerate:({db})=>{
    db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
      SELECT phone,'melodi_calendar_events',id,assigned_agent,'google-late-pause','unsupported',? FROM melodi_calendar_events`).run(Date.parse(NOW));
  }});
  context.db.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));
  await createEvent(context.env,OWNER,'Pausar durante generación','2026-10-08T13:00:00.000Z','REMINDER',{agent:'melodi'});
  await runEmily(context.env,{sendText:context.sendText});
  assert.equal(context.requests.length,1);assert.deepEqual(context.sent,[]);
  assert.equal(context.db.sql.prepare('SELECT emily_prepared_at FROM melodi_calendar_events').get().emily_prepared_at,null);
});
