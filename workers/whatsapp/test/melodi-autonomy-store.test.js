import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AUTONOMY_SCHEMA, autonomyLocalDay, autonomyRetryDelay, createAutonomyStore } from '../melodi-autonomy-store.js';

// Exercise the actual SQL, including partial unique indexes and transactional batches.
class SqliteD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec('PRAGMA foreign_keys=ON');
  }
  prepare(query) {
    const database = this;
    const make = values => ({
      query, values,
      bind: (...next) => make(next),
      async run() { return database.execute(query, values); },
      async all() { return database.execute(query, values); },
      async first() { return database.execute(query, values).results[0] ?? null; },
    });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) {
      const rows = prepared.all(...values).map(row => ({ ...row }));
      return { results: rows, meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) }, success: true };
    }
    const result = prepared.run(...values);
    return { results: [], meta: { changes: Number(result.changes) }, success: true };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const output = statements.map(statement => this.execute(statement.query, statement.values));
      this.sql.exec('COMMIT');
      return output;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}

async function harness(config = {}, options = {}) {
  const database = new SqliteD1();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return new TextDecoder().decode(value);
    },
  };
  let current = Date.parse('2026-10-08T13:00:00Z');
  let ids = 0;
  const store = createAutonomyStore(database, { ...hooks, now: () => current, uuid: () => `test-id-${++ids}`, ...options });
  await store.ensureSchema();
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true, cooldownMs: 0, ...config } });
  return { store, database, hooks, get now() { return current; }, advance(ms) { current += ms; } };
}

const enqueue = (store, key = 'event-1', extra = {}) => store.enqueueEvent({ owner: 'owner-a', agent: 'melodi', eventKey: key, type: 'heartbeat', payload: { task: 'Revisar proyecto privado' }, ...extra });
const claim = (store, extra = {}) => store.claimEvent({ owner: 'owner-a', agent: 'melodi', ...extra });
const finish = (store, event, extra = {}) => store.finishEvent({ owner: event.owner, agent: event.agent, eventId: event.id, leaseToken: event.leaseToken, ...extra });

test('generic media deferral retains the original encrypted context and one run reservation across bounded polling', async () => {
  const h = await harness({ dailyRunLimit: 1 });
  const context = { task: 'Private context retained', allowContact: false };
  const accepted = await enqueue(h.store, 'generic-media', { type: 'background_review', payload: context });
  const pendingTool = { name: 'inspect_public_media', url: 'https://instagram.com/reel/EXACT/?original=yes',
    eventId: `${accepted.id}:public-media`, originalType: 'background_review', goalScope: 'team', observations: [], receipts: [] };
  const mediaOperation = { operationId: 'one-private-operation', eventId: pendingTool.eventId, startedAt: h.now };
  for (let count = 0; count < 4; count++) {
    const running = await claim(h.store);
    assert.equal(running.id, accepted.id);
    assert.equal(await h.store.deferEvent({ owner: running.owner, agent: running.agent, eventId: running.id, leaseToken: running.leaseToken,
      payload: { task: 'Attempted replacement', pendingTool, mediaOperation }, retryAt: h.now + 60000 }), true);
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
    const payload = JSON.parse(await h.hooks.decrypt(row.payload_encrypted, row.payload_iv));
    assert.equal(row.type, 'public_media_poll');
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(payload.task, context.task);
    assert.equal(payload.pendingTool.url, pendingTool.url);
    assert.equal(payload.mediaOperation.eventId, pendingTool.eventId);
    assert.equal(JSON.stringify(row).includes(context.task), false);
    assert.equal((await h.store.getState('owner-a', 'melodi')).runs_today, 1);
    h.advance(60000);
    assert.deepEqual(await h.store.listDueAgents({ owner: 'owner-a' }), [{ owner: 'owner-a', agent: 'melodi' }]);
  }
  await h.store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: false } });
  assert.equal(await claim(h.store), null);
  assert.deepEqual(await h.store.listDueAgents({ owner: 'owner-a' }), []);
  await h.store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true } });
  const contenders = await Promise.all([claim(h.store), claim(h.store)]);
  assert.equal(contenders.filter(Boolean).length, 1);
});

test('generic media deferral rejects unlisted event types, tools, scope and operation identity changes', async () => {
  for (const mode of ['event_type', 'tool', 'scope', 'url', 'identity']) {
    const h = await harness();
    const accepted = await enqueue(h.store, mode, { type: mode === 'event_type' ? 'heartbeat' : 'daily_review' });
    const running = await claim(h.store);
    const pendingTool = { name: mode === 'tool' ? 'prepare_document' : 'inspect_public_media',
      url: mode === 'url' ? 'https://127.0.0.1/private' : 'https://instagram.com/p/EXACT/',
      goalScope: mode === 'scope' ? 'foreign' : 'team', originalType: 'daily_review', eventId: `${accepted.id}:public-media` };
    const mediaOperation = { operationId: 'one-operation', startedAt: h.now,
      eventId: mode === 'identity' ? 'another-event' : pendingTool.eventId };
    await assert.rejects(h.store.deferEvent({ owner: 'owner-a', agent: 'melodi', eventId: running.id, leaseToken: running.leaseToken,
      payload: { pendingTool, mediaOperation } }), /Invalid deferred media|Deferred media event changed/);
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
    assert.equal(row.type, mode === 'event_type' ? 'heartbeat' : 'daily_review');
    assert.equal(row.status, 'processing');
    assert.equal(row.attempts, 1);
  }
});

test('external media polling preserves the encrypted original request and never exhausts analysis retries', async () => {
  const h = await harness();
  const request = { agent: 'melodi', brief: 'Original private research request', sourceUrl: 'https://instagram.com/reel/EXACT/' };
  await enqueue(h.store, 'requested-media', { type: 'owner_research_report', priority: 20, payload: { request } });
  const startedAt = h.now;
  for (let i = 0; i < 4; i++) {
    const running = await claim(h.store);
    assert.equal(running.attempts, 1);
    assert.equal(await h.store.deferEvent({ owner: 'owner-a', agent: 'melodi', eventId: running.id, leaseToken: running.leaseToken,
      payload: { request: { brief: 'A caller must not replace the original' }, mediaOperation: { operationId: 'private-media-operation', startedAt } },
      retryAt: h.now + 60000, checkpoint: { pendingMedia: true } }), true);
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    const payload = JSON.parse(await h.hooks.decrypt(row.payload_encrypted, row.payload_iv));
    assert.deepEqual(payload.request, request);
    assert.equal(payload.mediaOperation.operationId, 'private-media-operation');
    assert.equal(payload.mediaOperation.startedAt, startedAt);
    assert.equal(payload.mediaOperation.deadline, startedAt + 15 * 60000);
    assert.equal(JSON.stringify(row).includes('private-media-operation'), false);
    assert.equal(JSON.stringify(row).includes(request.brief), false);
    assert.equal(h.database.sql.prepare('SELECT lease_token FROM wa_melodi_work_state').get().lease_token, null);
    assert.equal(await claim(h.store), null);
    h.advance(60000);
  }
  const running = await claim(h.store);
  await finish(h.store, running, { status: 'pending', errorCode: 'requested_research_invalid_analysis' });
  assert.equal(h.database.sql.prepare('SELECT attempts FROM wa_melodi_work_events').get().attempts, 1);
});

test('media deferral requires both current leases, a verified operation ID and the original fifteen minute deadline', async () => {
  const h = await harness();
  await enqueue(h.store, 'requested-media', { type: 'owner_research_report', priority: 20 });
  let running = await claim(h.store);
  const startedAt = h.now;
  const params = { owner: 'owner-a', agent: 'melodi', eventId: running.id, leaseToken: running.leaseToken,
    payload: { mediaOperation: { operationId: 'media-operation-1', startedAt } } };
  assert.equal(await h.store.deferEvent({ ...params, owner: 'owner-b' }), false);
  assert.equal(await h.store.deferEvent({ ...params, leaseToken: 'stale-lease' }), false);
  await assert.rejects(h.store.deferEvent({ ...params, payload: { mediaOperation: { operationId: '../another-job', startedAt } } }));
  h.database.sql.prepare("UPDATE wa_melodi_work_state SET lease_token='replacement'").run();
  assert.equal(await h.store.deferEvent(params), false);
  h.database.sql.prepare('UPDATE wa_melodi_work_state SET lease_token=?').run(running.leaseToken);
  assert.equal(await h.store.deferEvent(params), true);
  h.advance(60000);
  running = await claim(h.store);
  await assert.rejects(h.store.deferEvent({ ...params, leaseToken: running.leaseToken,
    payload: { mediaOperation: { operationId: 'different-job', startedAt: h.now } } }), /changed/);
  assert.equal(await h.store.deferEvent({ ...params, leaseToken: running.leaseToken,
    payload: { mediaOperation: { operationId: 'media-operation-1', startedAt: h.now } }, retryAt: h.now + 24 * 3600000 }), true);
  const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
  assert.equal(row.available_at, startedAt + 15 * 60000);
  h.advance(14 * 60000);
  running = await claim(h.store);
  await assert.rejects(h.store.deferEvent({ ...params, leaseToken: running.leaseToken,
    payload: { mediaOperation: { operationId: 'media-operation-1', startedAt: h.now } } }), /requested_research_media_timeout/);
});

test('migration matches the runtime schema and initialization keeps new agents disabled', async () => {
  const sql = readFileSync(new URL('../melodi-autonomy.sql', import.meta.url), 'utf8');
  assert.equal(sql.split('\n').slice(1).join('\n').trim(), `${AUTONOMY_SCHEMA.join(';\n\n')};`);
  const { store } = await harness();
  const state = await store.ensureAgent({ owner: 'owner-a', agent: 'melodi' });
  assert.equal(state.enabled, false);
  assert.equal(state.dailyRunLimit, 8);
  assert.equal(state.dailyMessageLimit, 3);
  assert.equal(state.cooldownMs, 45 * 60000);
  assert.equal(await store.claimEvent({ owner: 'owner-a', agent: 'melodi' }), null);
});

test('payloads, idempotency keys, checkpoints and notification text stay encrypted', async () => {
  const { store, database } = await harness();
  const sensitive = 'private detailed personal goal';
  await enqueue(store, sensitive, { payload: { task: sensitive } });
  const event = await claim(store);
  assert.deepEqual(event.payload, { task: sensitive });
  assert.equal(await finish(store, event, { checkpoint: { goal: sensitive } }), true);
  assert.deepEqual(await store.getCheckpoint('owner-a', 'melodi'), { goal: sensitive });
  await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: sensitive, payload: { text: sensitive }, eventId: event.id });
  for (const table of ['state', 'events', 'outbox', 'audit']) {
    const contents = JSON.stringify(database.sql.prepare(`SELECT * FROM wa_melodi_work_${table}`).all());
    assert.equal(contents.includes(sensitive), false);
  }
  const state = await store.getState('owner-a', 'melodi');
  assert.equal(state.hasCheckpoint, true);
  assert.equal('checkpoint_encrypted' in state, false);
  assert.equal('lease_token' in state, false);
  assert.equal(JSON.stringify(await store.listEvents({ owner: 'owner-a', agent: 'melodi' })).includes(sensitive), false);
});

test('event dedupe and checkpoints are isolated by owner and agent', async () => {
  const { store } = await harness();
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true, cooldownMs: 0 } });
  await store.ensureAgent({ owner: 'owner-b', agent: 'melodi', config: { enabled: true, cooldownMs: 0 } });
  const first = await enqueue(store);
  assert.equal((await enqueue(store)).id, first.id);
  const melodi = await enqueue(store, 'event-1', { agent: 'melodi' });
  const otherOwner = await enqueue(store, 'event-1', { owner: 'owner-b' });
  assert.notEqual(melodi.id, first.id);
  assert.notEqual(otherOwner.id, first.id);
  const donaEvent = await claim(store);
  await finish(store, donaEvent, { checkpoint: { private: 'melodi-only' } });
  assert.equal(await store.getCheckpoint('owner-a', 'melodi'), null);
  assert.equal(await store.getCheckpoint('owner-b', 'melodi'), null);
  assert.equal((await store.listStates('owner-a')).length, 2);
  assert.equal((await store.listStates('owner-b')).length, 1);
});

test('concurrent claims process exactly one event for each independent agent', async () => {
  const { store } = await harness();
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true, cooldownMs: 0 } });
  await Promise.all([enqueue(store, 'one'), enqueue(store, 'two'), enqueue(store, 'three', { agent: 'melodi' })]);
  const claims = await Promise.all([claim(store), claim(store), store.claimEvent({ owner: 'owner-a', agent: 'melodi' })]);
  assert.equal(claims.filter(event => event?.agent === 'melodi').length, 1);
  assert.equal(claims.filter(event => event?.agent === 'melodi').length, 1);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 1);
  assert.equal((await store.getState('owner-a', 'melodi')).eventCounts.processing, 1);
});

test('future events are not claimed and priority chooses due work', async () => {
  const { store, now } = await harness();
  await enqueue(store, 'future', { availableAt: now + 60000, priority: 100 });
  assert.equal(await claim(store), null);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 0);
  await enqueue(store, 'low', { priority: 1 });
  const urgent = await enqueue(store, 'urgent', { priority: 5 });
  assert.equal((await claim(store)).id, urgent.id);
});

test('due-agent discovery applies owner scope before its bounded limit', async () => {
  const { store } = await harness();
  await enqueue(store);
  for (const agent of ['melodi']) {
    await store.ensureAgent({ owner: 'owner-b', agent, config: { enabled: true } });
    await enqueue(store, 'other-owner-event', { owner: 'owner-b', agent });
  }
  assert.deepEqual(await store.listDueAgents({ owner: 'owner-a', limit: 1 }), [{ owner: 'owner-a', agent: 'melodi' }]);
  assert.deepEqual(await store.listDueAgents({ owner: 'missing-owner', limit: 1 }), []);
});

test('expired leases recover with attempts capped and stale completion fenced out', async () => {
  const context = await harness();
  await enqueue(context.store, 'retry', { maxAttempts: 2 });
  const first = await claim(context.store, { leaseMs: 1000 });
  context.advance(1001);
  const second = await claim(context.store, { leaseMs: 1000 });
  assert.equal(second.id, first.id);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(second.attempts, 2);
  assert.equal(await finish(context.store, first, { checkpoint: { stale: true } }), false);
  assert.equal(await context.store.getCheckpoint('owner-a', 'melodi'), null);
  context.advance(1001);
  assert.equal(await claim(context.store), null);
  assert.equal((await context.store.listEvents({ owner: 'owner-a', agent: 'melodi' }))[0].status, 'failed');
  assert.equal((await context.store.getState('owner-a', 'melodi')).runs_today, 2);
});

test('renewal extends both leases and expired renewals cannot steal a replacement', async () => {
  const context = await harness();
  await enqueue(context.store);
  const event = await claim(context.store, { leaseMs: 1000 });
  context.advance(500);
  assert.equal(await context.store.renewLease({ owner: 'owner-a', agent: 'melodi', eventId: event.id, leaseToken: event.leaseToken, leaseMs: 5000 }), true);
  context.advance(1000);
  assert.equal(await claim(context.store), null);
  context.advance(5000);
  const replacement = await claim(context.store);
  assert.equal(await context.store.renewLease({ owner: 'owner-a', agent: 'melodi', eventId: event.id, leaseToken: event.leaseToken }), false);
  assert.equal(await finish(context.store, replacement), true);
});

test('retries back off, sanitize raw errors and stop at max attempts', async () => {
  const context = await harness();
  await enqueue(context.store, 'retry', { maxAttempts: 2 });
  const first = await claim(context.store);
  await finish(context.store, first, { status: 'pending', errorCode: 'User private text with spaces' });
  assert.equal(await claim(context.store), null);
  const [waiting] = await context.store.listEvents({ owner: 'owner-a', agent: 'melodi' });
  assert.equal(waiting.error_code, 'operation_failed');
  assert.equal(waiting.available_at, context.now + 60000);
  context.advance(60000);
  const second = await claim(context.store);
  assert.equal(await finish(context.store, second, { status: 'pending', errorCode: 'provider_unavailable' }), true);
  assert.equal((await context.store.listEvents({ owner: 'owner-a', agent: 'melodi' }))[0].status, 'failed');
  assert.equal(autonomyRetryDelay(1), 60000);
  assert.equal(autonomyRetryDelay(3), 240000);
  assert.equal(autonomyRetryDelay(1000), 3600000);
});

test('waiting events need an explicit scoped resumption', async () => {
  const { store } = await harness();
  await enqueue(store);
  const event = await claim(store);
  await finish(store, event, { status: 'waiting', checkpoint: { waitingFor: 'owner' } });
  assert.equal(await claim(store), null);
  assert.equal(await store.resumeEvent({ owner: 'owner-b', agent: 'melodi', eventId: event.id }), false);
  assert.equal(await store.resumeEvent({ owner: 'owner-a', agent: 'melodi', eventId: event.id, payload: { answer: 'new context' } }), true);
  assert.deepEqual((await claim(store)).payload, { answer: 'new context' });
});

test('run budgets reset at Dominican midnight and cooldowns still apply', async () => {
  const context = await harness({ dailyRunLimit: 1, cooldownMs: 60000 });
  await enqueue(context.store, 'first');
  await enqueue(context.store, 'second');
  const event = await claim(context.store, { now: '2026-10-09T03:59:30Z' });
  await finish(context.store, event, { now: '2026-10-09T03:59:30Z' });
  assert.equal(await claim(context.store, { now: '2026-10-09T03:59:59Z' }), null);
  assert.equal(await claim(context.store, { now: '2026-10-09T04:00:01Z' }), null);
  assert.ok(await claim(context.store, { now: '2026-10-09T04:00:31Z' }));
  const state = await context.store.getState('owner-a', 'melodi');
  assert.equal(state.budget_day, '2026-10-09');
  assert.equal(state.runs_today, 1);
  assert.equal(autonomyLocalDay('2026-10-09T03:59:59Z'), '2026-10-08');
  assert.equal(autonomyLocalDay('2026-10-09T04:00:00Z'), '2026-10-09');
});

test('stale event lease recovery cannot exceed the daily run budget', async () => {
  const context = await harness({ dailyRunLimit: 1 });
  await enqueue(context.store);
  await claim(context.store, { leaseMs: 1000 });
  context.advance(1001);
  assert.equal(await claim(context.store), null);
  assert.equal((await context.store.getState('owner-a', 'melodi')).runs_today, 1);
  assert.equal((await context.store.listEvents({ owner: 'owner-a', agent: 'melodi' }))[0].status, 'pending');
  assert.equal((await context.store.listDueAgents()).length, 0);
});

test('outbox is idempotent, scopes event links and reserves message budget atomically', async () => {
  const { store } = await harness({ dailyMessageLimit: 1 });
  const event = await enqueue(store);
  const message = { owner: 'owner-a', agent: 'melodi', messageKey: 'notification', eventId: event.id, payload: { text: 'Buen día' } };
  assert.equal((await store.enqueueOutbox(message)).id, (await store.enqueueOutbox(message)).id);
  await store.ensureAgent({ owner: 'owner-b', agent: 'melodi' });
  await assert.rejects(store.enqueueOutbox({ ...message, owner: 'owner-b' }), /scope mismatch/);
  await store.enqueueOutbox({ ...message, messageKey: 'notification-2' });
  const claims = await Promise.all([store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), store.claimOutbox({ owner: 'owner-a', agent: 'melodi' })]);
  const sent = claims.find(Boolean);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.deepEqual(sent.payload, { text: 'Buen día' });
  assert.equal(await store.finishOutbox({ id: sent.id, leaseToken: sent.leaseToken, status: 'sent' }), true);
  assert.equal(await store.finishOutbox({ id: sent.id, leaseToken: sent.leaseToken, status: 'sent' }), false);
  assert.equal(await store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  const state = await store.getState('owner-a', 'melodi');
  assert.equal(state.messages_today, 1);
  assert.ok(state.last_message_at);
  assert.equal(state.outboxCounts.sent, 1);
  assert.equal((await store.listAudit({ owner: 'owner-a', agent: 'melodi' })).filter(row => row.action === 'outbox_finish').length, 1);
});

test('unknown delivery after crash is quarantined and never resent automatically', async () => {
  const context = await harness();
  await context.store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'once', payload: { text: 'one notification' } });
  const sending = await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi', leaseMs: 1000 });
  context.advance(1001);
  assert.equal(await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  assert.equal(await context.store.finishOutbox({ id: sending.id, leaseToken: sending.leaseToken, status: 'sent' }), false);
  const state = await context.store.getState('owner-a', 'melodi');
  assert.equal(state.outboxCounts.uncertain, 1);
  assert.equal(state.messages_today, 1);
  assert.ok((await context.store.listAudit({ owner: 'owner-a', agent: 'melodi' })).some(row => row.action === 'outbox_recover'));
});

test('expired sending rows recover independently of pending notifications without claiming or charging quota', async () => {
  const context = await harness();
  await context.store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'crashed-only', payload: { body: 'Una entrega' } });
  const sending = await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi', leaseMs: 1000 });
  context.advance(1001);
  assert.equal(await context.store.peekOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  assert.equal((await context.store.recoverExpiredOutbox({ owner: 'owner-b' })).recovered, 0);
  assert.equal((await context.store.recoverExpiredOutbox({ owner: 'owner-a' })).recovered, 1);
  assert.equal((await context.store.recoverExpiredOutbox({ owner: 'owner-a' })).recovered, 0);
  const state = await context.store.getState('owner-a', 'melodi');
  assert.equal(state.outboxCounts.uncertain, 1);
  assert.equal(state.outboxCounts.sending, 0);
  assert.equal(state.messages_today, 1);
  assert.equal(state.outbox_lease_until, null);
  assert.equal(await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  assert.equal(await context.store.finishOutbox({ id: sending.id, leaseToken: sending.leaseToken, status: 'sent' }), false);
  assert.equal((await context.store.listAudit({ owner: 'owner-a', agent: 'melodi' })).filter(row => row.action === 'outbox_recover').length, 1);
});

test('outbox message-key claims select a pending approval without consuming an older ordinary message', async () => {
  const { store } = await harness();
  const old = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'ordinary-old', payload: { text: 'Tema anterior' } });
  const approval = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'approval:one', payload: { text: '¿Apruebas esta colaboración?' } });
  assert.equal(await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'approval:missing' }), null);
  const selected = await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'approval:one' });
  assert.equal(selected.id, approval.id);
  assert.notEqual(selected.id, old.id);
  assert.equal((await store.getState('owner-a', 'melodi')).outboxCounts.pending, 1);
  await store.finishOutbox({ id: selected.id, leaseToken: selected.leaseToken, status: 'sent' });
  assert.equal((await store.claimOutbox({ owner: 'owner-a', agent: 'melodi' })).id, old.id);
});

test('outbox peeks are private read-only observations and exact-ID claims preserve row selection', async () => {
  const { store } = await harness();
  const older = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'older', payload: { text: 'ordinary' } });
  const exact = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'exact', payload: { artifactJobId: 'job-one', routineId: 'routine-one' } });
  const before = await store.getState('owner-a', 'melodi');
  const observed = await store.peekOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: exact.id });
  assert.equal(observed.id, exact.id);
  assert.deepEqual(observed.payload, { artifactJobId: 'job-one', routineId: 'routine-one' });
  assert.equal('payload_encrypted' in observed, false);
  assert.equal('lease_token' in observed, false);
  assert.deepEqual(await store.getState('owner-a', 'melodi'), before);
  assert.equal(await store.peekOutbox({ owner: 'owner-b', agent: 'melodi', outboxId: exact.id }), null);
  assert.equal(await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: exact.id, messageKey: 'older' }), null);
  const leased = await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: exact.id });
  assert.equal(leased.id, exact.id);
  assert.notEqual(leased.id, older.id);
  assert.equal(await store.peekOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: exact.id }), null);
  assert.equal(await store.claimOutbox({ owner: 'owner-b', agent: 'melodi', outboxId: older.id }), null);
});

test('confirmed unsuccessful deliveries may retry and successful notifications honor cooldown', async () => {
  const context = await harness({ cooldownMs: 60000 });
  await context.store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'retry-notification', payload: { text: 'hello' } });
  const first = await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' });
  await context.store.finishOutbox({ id: first.id, leaseToken: first.leaseToken, status: 'pending' });
  assert.equal(await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  context.advance(60000);
  const retry = await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' });
  assert.ok(retry);
  await context.store.finishOutbox({ id: retry.id, leaseToken: retry.leaseToken, status: 'sent' });
  await context.store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'another', payload: { text: 'followup' } });
  assert.equal(await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }), null);
  context.advance(60000);
  assert.ok(await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' }));
});

test('message budget resets independently while preserving run reservations', async () => {
  const { store } = await harness();
  await enqueue(store);
  const event = await claim(store);
  await finish(store, event);
  await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'message', payload: { text: 'hello' } });
  const message = await store.claimOutbox({ owner: 'owner-a', agent: 'melodi' });
  await store.finishOutbox({ id: message.id, leaseToken: message.leaseToken, status: 'sent' });
  const state = await store.getState('owner-a', 'melodi');
  assert.equal(state.runs_today, 1);
  assert.equal(state.messages_today, 1);
});

test('encryption failures and corrupt payloads cannot expose or execute plaintext work', async () => {
  assert.throws(() => createAutonomyStore(new SqliteD1()), /encryption hooks/);
  const context = await harness();
  await enqueue(context.store);
  context.database.sql.exec("UPDATE wa_melodi_work_events SET payload_encrypted='corrupt'");
  assert.equal(await claim(context.store), null);
  const state = await context.store.getState('owner-a', 'melodi');
  assert.equal(state.eventCounts.failed, 1);
  assert.equal(state.lease_until, null);
  const broken = await harness({}, { encrypt: async () => ({}) });
  await assert.rejects(enqueue(broken.store), /encryption failed/);
  assert.equal((await broken.store.getState('owner-a', 'melodi')).eventCounts.pending, 0);
});

test('disabled agents, malformed config and unsupported agents never claim work', async () => {
  const { store } = await harness();
  await enqueue(store);
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: false } });
  assert.equal(await claim(store), null);
  assert.deepEqual(await store.listDueAgents(), []);
  await assert.rejects(store.ensureAgent({ owner: 'owner-a', agent: 'melodi' }), /Invalid autonomous agent/);
  await assert.rejects(store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { dailyRunLimit: -1 } }), /Invalid autonomy configuration/);
  await assert.rejects(store.claimOutbox({ owner: 'owner-a' }), /requires owner and agent/);
});

test('explicit approved actions bypass an exhausted autonomy budget without charging extra background runs', async () => {
  const { store } = await harness({ dailyRunLimit: 8 });
  for (let count = 0; count < 8; count += 1) {
    await enqueue(store, `background-${count}`);
    const job = await claim(store);
    await finish(store, job);
  }
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 8);
  await enqueue(store, 'normal-over-budget', { priority: 100 });
  await enqueue(store, 'not-approved-priority', { type: 'daily_review', priority: 20 });
  assert.equal(await claim(store), null);
  assert.deepEqual(await store.listDueAgents({ owner: 'owner-a' }), []);
  const approved = await enqueue(store, 'owner-approved', { type: 'approved_action', priority: 20 });
  assert.deepEqual(await store.listDueAgents({ owner: 'owner-a' }), [{ owner: 'owner-a', agent: 'melodi' }]);
  const event = await claim(store);
  assert.equal(event.id, approved.id);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 8);
  assert.equal(await claim(store), null);
  await finish(store, event);
  assert.equal(await claim(store), null);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 8);
});

test('approved actions retain agent enablement and leases while bypassing autonomous cooldown', async () => {
  const { store } = await harness({ cooldownMs: 45 * 60000 });
  await enqueue(store, 'background');
  await finish(store, await claim(store));
  const approved = await enqueue(store, 'approved-during-cooldown', { type: 'approved_action', priority: 20 });
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: false } });
  assert.equal(await claim(store), null);
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true } });
  const claims = await Promise.all([claim(store), claim(store)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).id, approved.id);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 1);
});

test('trusted exact owner-request replies bypass message quotas and cooldown without charging autonomous contact', async () => {
  const { store } = await harness({ dailyMessageLimit: 1, cooldownMs: 45 * 60000 });
  await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'spontaneous', payload: { text: 'Un avance' } });
  const spontaneous = await store.claimOutbox({ owner: 'owner-a', agent: 'melodi' });
  await store.finishOutbox({ id: spontaneous.id, leaseToken: spontaneous.leaseToken, status: 'sent' });
  const requested = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'requested', payload: { artifactJobId: 'owner-private-job' } });
  assert.equal(await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: requested.id }), null);
  assert.equal((await store.peekOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: requested.id })).id, requested.id);
  await assert.rejects(store.claimOutbox({ owner: 'owner-a', agent: 'melodi', requestedReply: true }), /trusted exact outbox scope/);
  assert.equal(await store.claimOutbox({ owner: 'owner-b', agent: 'melodi', outboxId: requested.id, requestedReply: true }), null);
  const claims = await Promise.all(Array.from({ length: 3 }, () => store.claimOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: requested.id, requestedReply: true })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.getState('owner-a', 'melodi')).messages_today, 1);
  await store.finishOutbox({ id: claims.find(Boolean).id, leaseToken: claims.find(Boolean).leaseToken, status: 'sent' });
  const disabled = await store.enqueueOutbox({ owner: 'owner-a', agent: 'melodi', messageKey: 'disabled-request', payload: { artifactJobId: 'other-private-job' } });
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: false } });
  assert.equal(await store.claimOutbox({ owner: 'owner-a', agent: 'melodi', outboxId: disabled.id, requestedReply: true }), null);
});

test('explicit research reports bypass exhausted autonomous runs while retaining enablement, priority and a single lease', async () => {
  const { store } = await harness({ dailyRunLimit: 1, cooldownMs: 45 * 60000 });
  await enqueue(store, 'one-background');
  await finish(store, await claim(store));
  await enqueue(store, 'untrusted-low-priority-research', { type: 'owner_research_report', priority: 1 });
  assert.equal(await claim(store), null);
  const request = await enqueue(store, 'requested-report', { type: 'owner_research_report', priority: 20 });
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: false } });
  assert.equal(await claim(store), null);
  await store.configureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true } });
  assert.deepEqual(await store.listDueAgents({ owner: 'owner-a' }), [{ owner: 'owner-a', agent: 'melodi' }]);
  const claims = await Promise.all([claim(store), claim(store), claim(store)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).id, request.id);
  assert.equal((await store.getState('owner-a', 'melodi')).runs_today, 1);
});
