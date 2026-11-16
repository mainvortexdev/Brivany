import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { createEvent, runEmily } from '../worker.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { selectOwnerSpeaker } from '../owner-speaker.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';

const OWNER = '18095550101', NOW = Date.parse('2026-10-08T13:00:00Z');
async function fixture(t, send) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = new FinanceD1();
  db.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for(const file of ['melodi-team-coordination.sql','melodi-autonomy.sql','melodi-permissions.sql','melodi-routines.sql','melodi-autonomy-maintenance.sql','melodi-artifact-tracking.sql','owner-task-references.sql','delivery-notice.sql']) db.sql.exec(readFileSync(new URL('../'+file, import.meta.url), 'utf8'));
  const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER, TEAM_CONVERSATION_LEADER: 'melodi', TEAM_AUTONOMY_ENABLED: 'true',
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), MELODI_JOBS: { async send() {} } };
  const sends = [];
  const runtime = createAgentRuntime(env, { sendText: async (...args) => {
    sends.push(args); return send ? send(...args) : { status: 'sent', messageId: `synthetic-receipt-${sends.length}` };
  } });
  await runtime.initialize();
  const event = await createEvent(env, OWNER, 'Revisar la tarea solicitada', new Date(NOW).toISOString(), 'REMINDER', { agent: 'melodi' });
  const notice = () => db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  const saved = () => db.sql.prepare('SELECT * FROM melodi_calendar_events WHERE id=?').get(event.id);
  return { db, env, runtime, sends, event, notice, saved };
}

test('concurrent cron queues one encrypted reminder and concurrent delivery sends one receipt as Melodi', async t => {
  const h = await fixture(t);
  await Promise.all([runEmily(h.env), runEmily(h.env)]);
  assert.equal(h.sends.length, 0);
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
  assert.doesNotMatch(h.notice().payload_encrypted, /Revisar|solicitada/);
  assert.equal(h.saved().emily_prepared_at, null);
  assert.equal(h.saved().reminded_at, null);
  await Promise.all([h.runtime.deliverNotices(), h.runtime.deliverNotices()]);
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0][2], 'Daniel, ya es hora de revisar la tarea solicitada.');
  assert.equal(h.sends[0][3].agent, 'melodi');
  assert.equal(h.notice().status, 'sent');
  assert.ok(h.saved().reminded_at);
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.sends.length, 1);
});

test('the explicitly selected reminder specialist can speak without a second unsolicited preparation', async t => {
  const h = await fixture(t);
  await selectOwnerSpeaker(h.env, OWNER, 'melodi', 'synthetic-owner-address');
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0][2], 'Daniel, ya es hora de revisar la tarea solicitada.');
  assert.equal(h.sends[0][3].agent, 'melodi');
});

for (const [label, send] of [['missing receipt', async () => ({ status: 'sent' })], ['transport timeout', async () => { throw Error('transport timeout'); }], ['ambiguous provider failure', async () => { throw Error('WhatsApp API returned 503'); }]]) {
  test(`${label} quarantines delivery without marking the event or replaying it`, async t => {
    const h = await fixture(t, send);
    await runEmily(h.env); await h.runtime.deliverNotices();
    assert.equal(h.notice().status, 'uncertain');
    assert.equal(h.saved().reminded_at, null);
    await runEmily(h.env); await h.runtime.deliverNotices();
    assert.equal(h.sends.length, 1);
  });
}

test('an explicit provider rejection retries the same notice only after its backoff', async t => {
  let attempts = 0;
  const h = await fixture(t, async () => { if (++attempts === 1) throw Error('WhatsApp API returned 429'); return { status: 'sent', messageId: 'synthetic-retry-receipt' }; });
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.notice().status, 'pending');
  assert.equal(h.saved().reminded_at, null);
  await h.runtime.deliverNotices(); assert.equal(attempts, 1);
  t.mock.timers.setTime(NOW + 60000); await h.runtime.deliverNotices();
  assert.equal(attempts, 2); assert.equal(h.notice().status, 'sent'); assert.ok(h.saved().reminded_at);
});

test('contact policy blocks a due reminder before sending', async t => {
  const h = await fixture(t);
  await h.runtime.contactPolicy.update(OWNER, { topic: 'tarea solicitada', blocked: true });
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.sends.length, 0); assert.equal(h.saved().reminded_at, null);
});

test('a Calendar synchronization hold leaves a queued reminder unclaimed until state is current',async t=>{
  const h=await fixture(t);await runEmily(h.env);
  await h.runtime.deliverNotices({calendarReady:false});
  assert.equal(h.sends.length,0);assert.equal(h.notice().status,'pending');assert.equal(h.notice().attempts,0);
  await h.runtime.deliverNotices({calendarReady:true});assert.equal(h.sends.length,1);assert.equal(h.notice().status,'sent');
});

test('an event edited after enqueue cannot send its obsolete reminder', async t => {
  const h = await fixture(t);
  await runEmily(h.env);
  h.db.sql.prepare('UPDATE melodi_calendar_events SET title=?,updated_at=? WHERE id=?').run('Replacement request', new Date(NOW + 1000).toISOString(), h.event.id);
  await h.runtime.deliverNotices();
  assert.equal(h.sends.length, 0); assert.equal(h.saved().reminded_at, null); assert.equal(h.notice().status, 'uncertain');
});

test('an event paused after enqueue cannot send its obsolete reminder', async t => {
  const h = await fixture(t);
  await runEmily(h.env); h.db.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));
  h.db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
    VALUES(?,'melodi_calendar_events',?,'melodi','synthetic-paused','unsupported',?)`).run(OWNER, h.event.id, NOW);
  await h.runtime.deliverNotices();
  assert.equal(h.sends.length, 0); assert.equal(h.saved().reminded_at, null);
});

test('an event edited while sending never marks the replacement as delivered', async t => {
  let h;
  h = await fixture(t, async () => {
    h.db.sql.prepare('UPDATE melodi_calendar_events SET title=?,updated_at=? WHERE id=?').run('Replacement request', new Date(NOW + 1000).toISOString(), h.event.id);
    return { status: 'sent', messageId: 'synthetic-receipt' };
  });
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.notice().status, 'sent'); assert.equal(h.saved().reminded_at, null);
});

test('a confirmed notice reconciles a calendar write failure without repeating the transport', async t => {
  const h = await fixture(t);
  const prepare = h.db.prepare.bind(h.db); let fail = true;
  h.db.prepare = sql => {
    if (fail && sql.startsWith('UPDATE melodi_calendar_events SET reminded_at=')) { fail = false; throw Error('synthetic_calendar_write_failure'); }
    return prepare(sql);
  };
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.equal(h.notice().status, 'sent'); assert.equal(h.saved().reminded_at, null);
  await runEmily(h.env); await h.runtime.deliverNotices();
  assert.ok(h.saved().reminded_at); assert.equal(h.sends.length, 1);
});
