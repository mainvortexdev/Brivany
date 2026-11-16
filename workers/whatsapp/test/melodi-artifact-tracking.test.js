import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ARTIFACT_SCHEMA, autonomousArtifactJobId, createArtifactTracker } from '../melodi-artifact-tracking.js';
import { createAutonomyStore } from '../melodi-autonomy-store.js';
import { ownerAutonomyServices, ownerExecutorServices, processOwnerJob } from '../owner-features.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const db = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      async run() { return db.execute(query, values); }, async all() { return db.execute(query, values); },
      async first() { return db.execute(query, values).results[0] ?? null; },
    });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) {
      const results = prepared.all(...values).map(row => ({ ...row }));
      return { results, meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) } };
    }
    const result = prepared.run(...values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const output = statements.map(statement => this.execute(statement.query, statement.values));
      this.sql.exec('COMMIT'); return output;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function harness({ send } = {}) {
  const database = new SqliteD1();
  database.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const queued = [];
  const env = { VETSA_CLOUD: database, MEMORY_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    MELODI_JOBS: { async send(message) { queued.push(message); if (send) await send(message); } },
  };
  const services = ownerAutonomyServices(env);
  let current = Date.parse('2026-10-08T13:00:00.000Z');
  const tracker = createArtifactTracker(database, { now: () => current });
  await tracker.ensureSchema();
  const store = createAutonomyStore(database, { ...services, now: () => current });
  await store.ensureSchema();
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true } });
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true } });
  async function addJob(id, { owner = 'owner-a', agent = 'melodi', status = 'complete', type = 'generate_document', ageDays = 30 } = {}) {
    const sealed = await services.encrypt({ deliveryMode: 'private', autonomyAgent: agent });
    const created = new Date(current - ageDays * 86400000).toISOString();
    await database.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, owner, type, sealed.encrypted, sealed.iv, status, created).run();
    return tracker.register({ jobId: id, owner, agent, jobType: type });
  }
  async function outbox(jobId, { owner = 'owner-a', agent = 'melodi', key = jobId } = {}) {
    return store.enqueueOutbox({ owner, agent, messageKey: `artifact:${key}`, payload: { artifactJobId: jobId } });
  }
  return { tracker, store, services, env, database, queued, addJob, outbox, get now() { return current; }, advance(ms) { current += ms; } };
}

test('artifact migration matches schema and stable job IDs match the existing encrypted owner queue', async () => {
  const sql = readFileSync(new URL('../melodi-artifact-tracking.sql', import.meta.url), 'utf8');
  assert.equal(sql.split('\n').slice(1).join('\n').trim(), `${ARTIFACT_SCHEMA.join(';\n\n')};`);
  const context = await harness();
  const result = await context.services.prepareDocument({ ownerPhone: 'owner-a', agent: 'melodi', title: 'Informe privado', content: 'Contenido sensible',
    format: 'pdf', idempotencyKey: 'artifact-request', channel: 'email', routineId: 'routine-1', runKey: 'weekly-private-title', approvalId: 'approval-1' });
  assert.equal(result.jobId, await autonomousArtifactJobId('owner-a', 'generate_document', 'artifact-request'));
  const [tracked] = await context.tracker.listPending({ owner: 'owner-a' });
  assert.equal(tracked.job_id, result.jobId);
  assert.equal(tracked.channel, 'email');
  assert.equal(tracked.routine_id, 'routine-1');
  assert.equal(tracked.approval_id, 'approval-1');
  assert.notEqual(tracked.run_key_hash, 'weekly-private-title');
  const persisted = JSON.stringify(context.database.sql.prepare('SELECT * FROM wa_melodi_artifact_tracking').all());
  assert.equal(persisted.includes('Contenido sensible'), false);
  assert.equal(persisted.includes('Informe privado'), false);
  assert.equal(persisted.includes('weekly-private-title'), false);
  const info = await context.services.privateJobInfo('owner-a', result.jobId);
  assert.equal(info.channel, 'email');
  assert.equal(info.runKey, 'weekly-private-title');
  assert.equal(await context.services.privateJobInfo('owner-b', result.jobId), null);
});

test('registration is durable before dispatch failure and repeated preparation keeps one job and ledger', async () => {
  const context = await harness({ send: async () => { throw new Error('Queue unavailable'); } });
  const request = { ownerPhone: 'owner-a', agent: 'melodi', brief: 'Historia privada', idempotencyKey: 'same-story' };
  await assert.rejects(context.services.prepareStory(request), /Queue unavailable/);
  await assert.rejects(context.services.prepareStory(request), /Queue unavailable/);
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 1);
  const [tracked] = await context.tracker.listPending({ owner: 'owner-a' });
  assert.equal(tracked.job_type, 'generate_story');
  assert.equal(tracked.agent, 'melodi');
  assert.equal((await context.tracker.listPending({ owner: 'owner-a' })).length, 1);
  assert.equal(context.queued[0].jobId, tracked.job_id);
});

test('completed artifacts remain discoverable without a 24 hour or last twelve jobs cutoff', async () => {
  const context = await harness();
  for (let index = 0; index < 25; index += 1) await context.addJob(`old-${index}`);
  const ready = await context.tracker.listReady({ owner: 'owner-a', limit: 100 });
  assert.equal(ready.length, 25);
  assert.ok(ready.every(row => row.status === 'pending'));
  assert.ok(ready.every(row => !('lease_token' in row)));
});

test('artifact claims are atomic, owner-bound and require the matching completed job', async () => {
  const context = await harness();
  await context.addJob('ready');
  await context.addJob('unfinished', { status: 'processing' });
  assert.equal(await context.tracker.claim({ owner: 'owner-b', jobId: 'ready' }), null);
  assert.equal(await context.tracker.claim({ owner: 'owner-a', jobId: 'unfinished' }), null);
  const claims = await Promise.all(Array.from({ length: 4 }, () => context.tracker.claim({ owner: 'owner-a', jobId: 'ready' })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await context.tracker.listReady({ owner: 'owner-a' })).length, 0);
  await assert.rejects(context.tracker.register({ jobId: 'ready', owner: 'owner-b', agent: 'melodi', jobType: 'generate_document' }), /scope_conflict/);
});

test('lost enqueue leases can be reclaimed and old tokens cannot attach a delivery', async () => {
  const context = await harness();
  await context.addJob('ready');
  const first = await context.tracker.claim({ owner: 'owner-a', jobId: 'ready', leaseMs: 1000 });
  const notification = await context.outbox('ready');
  context.advance(1001);
  assert.equal((await context.tracker.listReady({ owner: 'owner-a' })).length, 1);
  const replacement = await context.tracker.claim({ owner: 'owner-a', jobId: 'ready' });
  assert.notEqual(replacement.token, first.token);
  assert.equal(await context.tracker.markEnqueued({ owner: 'owner-a', jobId: 'ready', token: first.token, outboxId: notification.id }), false);
  assert.equal(await context.tracker.markEnqueued({ owner: 'owner-a', jobId: 'ready', token: replacement.token, outboxId: notification.id }), true);
  assert.equal(await context.tracker.claim({ owner: 'owner-a', jobId: 'ready' }), null);
  assert.equal((await context.tracker.listReady({ owner: 'owner-a' })).length, 0);
});

test('outbox attachments and delivered receipts require the same owner and agent', async () => {
  const context = await harness();
  await context.addJob('ready');
  const claim = await context.tracker.claim({ owner: 'owner-a', jobId: 'ready' });
  const wrongAgent = await context.outbox('ready', { agent: 'melodi', key: 'wrong-agent' });
  assert.equal(await context.tracker.markEnqueued({ owner: 'owner-a', jobId: 'ready', token: claim.token, outboxId: wrongAgent.id }), false);
  const correct = await context.outbox('ready');
  assert.equal(await context.tracker.markEnqueued({ owner: 'owner-a', jobId: 'ready', token: claim.token, outboxId: correct.id }), true);
  assert.equal(await context.tracker.markDelivered({ owner: 'owner-a', jobId: 'ready', outboxId: correct.id }), false);
  const sending = await context.store.claimOutbox({ owner: 'owner-a', agent: 'melodi' });
  await context.store.finishOutbox({ id: sending.id, leaseToken: sending.leaseToken, status: 'sent' });
  assert.equal(await context.tracker.markDelivered({ owner: 'owner-b', jobId: 'ready', outboxId: correct.id }), false);
  assert.equal(await context.tracker.markDelivered({ owner: 'owner-a', jobId: 'ready', outboxId: correct.id }), true);
  assert.equal(await context.tracker.markDelivered({ owner: 'owner-a', jobId: 'ready', outboxId: correct.id }), false);
  assert.deepEqual(await context.tracker.listPending({ owner: 'owner-a' }), []);
});

test('sent outbox receipts reconcile delivery after a lost tracker update, but uncertain delivery stays held', async () => {
  const context = await harness();
  for (const id of ['sent', 'uncertain']) {
    await context.addJob(id);
    const claim = await context.tracker.claim({ owner: 'owner-a', jobId: id });
    const notification = await context.outbox(id);
    await context.tracker.markEnqueued({ owner: 'owner-a', jobId: id, token: claim.token, outboxId: notification.id });
    context.database.sql.prepare('UPDATE wa_melodi_work_outbox SET status=? WHERE id=?').run(id === 'sent' ? 'sent' : 'uncertain', notification.id);
  }
  assert.equal((await context.tracker.reconcileDelivered({ owner: 'owner-a' })).delivered, 1);
  const [remaining] = await context.tracker.listPending({ owner: 'owner-a' });
  assert.equal(remaining.job_id, 'uncertain');
  assert.equal(remaining.status, 'enqueued');
  assert.deepEqual(await context.tracker.listReady({ owner: 'owner-a' }), []);
});

test('cancelling pending artifacts is isolated and does not change owner jobs or delivered notifications', async () => {
  const context = await harness();
  await context.addJob('cancel');
  assert.equal(await context.tracker.cancel({ owner: 'owner-b', jobId: 'cancel' }), false);
  assert.equal(await context.tracker.cancel({ owner: 'owner-a', jobId: 'cancel', reasonCode: 'routine_stopped' }), true);
  assert.equal((await context.tracker.listReady({ owner: 'owner-a' })).length, 0);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_owner_jobs WHERE id=?').get('cancel').status, 'complete');
});

test('outbox cancellation reconciles an enqueued artifact into a terminal cancelled receipt', async () => {
  const context = await harness();
  await context.addJob('stopped');
  const claim = await context.tracker.claim({ owner: 'owner-a', jobId: 'stopped' });
  const notification = await context.outbox('stopped');
  await context.tracker.markEnqueued({ owner: 'owner-a', jobId: 'stopped', token: claim.token, outboxId: notification.id });
  context.database.sql.prepare("UPDATE wa_melodi_work_outbox SET status='failed',error_code='cancelled' WHERE id=?").run(notification.id);
  assert.equal((await context.tracker.reconcileDelivered({ owner: 'owner-a' })).cancelled, 1);
  assert.deepEqual(await context.tracker.listPending({ owner: 'owner-a' }), []);
  assert.deepEqual(await context.tracker.listReady({ owner: 'owner-a' }), []);
});

test('private processing starts with encrypted snapshot fencing and an accurate private started timestamp', async () => {
  const context = await harness();
  const prepared = await context.services.prepareDocument({ ownerPhone: 'owner-a', idempotencyKey: 'process', title: 'Título', content: 'Texto exacto', format: 'txt', agent: 'melodi' });
  const metadata = await context.services.encrypt({ title: 'Archivo existente' });
  context.database.sql.prepare(`INSERT INTO wa_owner_documents(id,owner_phone,document_kind,encrypted_metadata,metadata_iv,object_key,mime_type,file_name,created_at)
    VALUES(?,?,'document',?,?,?,'text/plain',?,?)`).run(prepared.jobId, 'owner-a', metadata.encrypted, metadata.iv, 'private-object', 'documento.txt', new Date().toISOString());
  let sent = 0;
  const before = Date.now();
  await Promise.all([processOwnerJob(context.env, prepared.jobId, async () => { sent += 1; }), processOwnerJob(context.env, prepared.jobId, async () => { sent += 1; })]);
  const job = context.database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(prepared.jobId);
  const payload = await context.services.decrypt(job.encrypted_payload, job.payload_iv);
  assert.equal(job.status, 'complete');
  assert.ok(Date.parse(payload.autonomyStartedAt) >= before);
  assert.ok(Date.parse(payload.autonomyStartedAt) <= Date.now());
  assert.equal(job.encrypted_payload.includes('autonomyStartedAt'), false);
  assert.equal(payload.sourceContent, 'Título\n\nTexto exacto');
  assert.equal(sent, 0);
});

test('bounded discovery backfills old private completions while ordinary artifacts remain untracked', async () => {
  const context = await harness();
  for (let index = 0; index < 42; index += 1) {
    const sealed = await context.services.encrypt({ deliveryMode: index === 41 ? 'private' : 'normal', autonomyAgent: 'melodi' });
    context.database.sql.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at)
      VALUES(?,'owner-a','generate_document',?,?,'complete',?)`).run(`legacy-${String(index).padStart(2, '0')}`, sealed.encrypted, sealed.iv, '2026-01-01T00:00:00Z');
  }
  assert.equal((await context.tracker.discoverExisting({ owner: 'owner-a', decrypt: context.services.decrypt })).registered, 0);
  assert.equal((await context.tracker.discoverExisting({ owner: 'owner-a', decrypt: context.services.decrypt })).registered, 1);
  const ready = await context.tracker.listReady({ owner: 'owner-a' });
  assert.equal(ready.length, 1);
  assert.equal(ready[0].job_id, 'legacy-41');
  assert.equal((await context.tracker.discoverExisting({ owner: 'owner-b', decrypt: context.services.decrypt })).scanned, 0);
});

test('direct owner documents preserve exact source and original assignment in one durable private artifact', async () => {
  const context = await harness();
  context.env.TEAM_AUTONOMY_ENABLED = 'true';
  const executor = ownerExecutorServices({ assignmentAgent: 'melodi', messageId: 'owner-message-1' });
  const source = '“NO ES SOLO EDITAR\r\n\r\nESCENA 1 — Título ñ\r\n  Texto con   espacios.  \r\n';
  const payload = { prompt: 'Crea el PDF', sourceContent: source, preserveSourceContent: true, format: 'pdf', kind: 'document', emailDelivery: null };
  const first = await executor.enqueueOwnerJob(context.env, 'owner-a', 'generate_document', payload);
  const second = await executor.enqueueOwnerJob(context.env, 'owner-a', 'generate_document', payload);
  assert.equal(first, second);
  assert.equal(first, await autonomousArtifactJobId('owner-a', 'generate_document', 'owner-command:owner-message-1:generate_document'));
  const job = context.database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(first);
  const stored = await context.services.decrypt(job.encrypted_payload, job.payload_iv);
  assert.equal(stored.sourceContent, source);
  assert.equal(stored.preserveSourceContent, true);
  assert.equal(stored.deliveryMode, 'private');
  assert.equal(stored.autonomyAgent, 'melodi');
  assert.equal(stored.autonomyChannel, 'auto');
  assert.equal(stored.autonomyOrigin, 'owner_request');
  assert.equal((await context.services.privateJobInfo('owner-a', first)).origin, 'owner_request');
  assert.equal((await context.tracker.listPending({ owner: 'owner-a' }))[0].agent, 'melodi');
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 1);
  assert.equal(payload.deliveryMode, undefined);
});

test('direct owner-email artifacts retain the requested email and choose coordinated email delivery', async () => {
  const context = await harness();
  context.env.TEAM_AUTONOMY_ENABLED = 'true';
  context.env.OWNER_EMAIL_FORWARD_TO = 'owner@example.com';
  const executor = ownerExecutorServices({ assignmentAgent: 'melodi', messageId: 'owner-email-request' });
  const emailDelivery = { to: 'OWNER@example.com', from: 'emily@vetsa.es' };
  const id = await executor.enqueueOwnerJob(context.env, 'owner-a', 'generate_story', { prompt: 'Historia exacta', emailDelivery });
  const job = context.database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(id);
  const payload = await context.services.decrypt(job.encrypted_payload, job.payload_iv);
  assert.deepEqual(payload.emailDelivery, emailDelivery);
  assert.equal(payload.autonomyChannel, 'email');
  assert.equal(payload.deliveryMode, 'private');
  assert.equal((await context.tracker.listPending({ owner: 'owner-a' }))[0].channel, 'email');
});

test('direct third-party email jobs and non-artifact commands retain their explicit legacy delivery', async () => {
  const context = await harness();
  context.env.TEAM_AUTONOMY_ENABLED = 'true';
  context.env.OWNER_EMAIL_FORWARD_TO = 'owner@example.com';
  const executor = ownerExecutorServices({ assignmentAgent: 'melodi', messageId: 'third-party' });
  const external = { prompt: 'Cotización para mi cliente', format: 'pdf', emailDelivery: { to: 'client@example.com', from: 'emily@vetsa.es' } };
  const id = await executor.enqueueOwnerJob(context.env, 'owner-a', 'generate_document', external);
  const row = context.database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(id);
  assert.deepEqual(await context.services.decrypt(row.encrypted_payload, row.payload_iv), external);
  await executor.enqueueOwnerJob(context.env, 'owner-a', 'send_email', { to: 'client@example.com', body: 'Texto autorizado' });
  assert.deepEqual(await context.tracker.listPending({ owner: 'owner-a' }), []);
});
