import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAutonomyStore } from '../melodi-autonomy-store.js';
import { MAINTENANCE_SCHEMA, createAutonomyMaintenance } from '../melodi-autonomy-maintenance.js';

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

async function harness({ send, encrypt: overrideEncrypt } = {}) {
  const database = new SqliteD1();
  database.sql.exec(`CREATE TABLE wa_owner_jobs(id TEXT PRIMARY KEY,owner_phone TEXT NOT NULL,job_type TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,payload_iv TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,error_code TEXT)`);
  let current = Date.parse('2026-10-08T16:00:00.000Z');
  const queued = [];
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(bytes).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(cipher, iv) {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(cipher, 'base64'));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
  const store = createAutonomyStore(database, { ...hooks, now: () => current });
  await store.ensureSchema();
  await store.ensureAgent({ owner: 'owner-a', agent: 'melodi', config: { enabled: true, cooldownMs: 0 } });
  const maintenance = createAutonomyMaintenance(database, { ...hooks, ...(overrideEncrypt ? { encrypt: overrideEncrypt } : {}), now: () => current,
    queue: { async send(message) { queued.push(message); if (send) await send(message); } },
  });
  await maintenance.ensureSchema();
  async function addJob(id, options = {}) {
    const payload = { deliveryMode: 'private', autonomyAgent: 'melodi', prompt: 'Mi contenido privado', ...options.payload };
    const sealed = await hooks.encrypt(payload);
    await database.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at,error_code) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id, options.owner || 'owner-a', options.type || 'generate_document', sealed.encrypted, sealed.iv, options.status || 'pending',
        new Date(current - (options.ageMinutes ?? 3) * 60000).toISOString(), options.errorCode ?? null).run();
    return payload;
  }
  const getJob = id => database.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').bind(id).first();
  return { database, store, maintenance, hooks, queued, addJob, getJob, get now() { return current; }, advance(minutes) { current += minutes * 60000; } };
}

test('maintenance SQL matches runtime migration and never stores artifact plaintext', async () => {
  const sql = readFileSync(new URL('../melodi-autonomy-maintenance.sql', import.meta.url), 'utf8');
  assert.equal(sql.split('\n').slice(1).join('\n').trim(), `${MAINTENANCE_SCHEMA.join(';\n\n')};`);
  const context = await harness();
  await context.addJob('doc');
  await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  const all = JSON.stringify(context.database.sql.prepare('SELECT * FROM wa_melodi_work_job_recovery').all());
  assert.equal(all.includes('Mi contenido privado'), false);
  assert.equal(all.includes('prompt'), false);
});

test('only old pending daily/background events expire, preserving goals, work and processing leases', async () => {
  const context = await harness();
  const insert = (key, type, owner = 'owner-a', ageHours = 25) => context.store.enqueueEvent({ owner, agent: 'melodi', eventKey: key, type, payload: { private: 'context' }, availableAt: context.now - ageHours * 3600000 });
  await context.store.ensureAgent({ owner: 'owner-b', agent: 'melodi', config: { enabled: true } });
  const old = [];
  for (const [key, type] of [['daily', 'daily_review'], ['background', 'background_review'], ['goal', 'goal_followup'], ['job', 'job_failure'], ['owner', 'owner_context'], ['delegate', 'delegation']]) {
    old.push(await insert(key, type));
  }
  await insert('other-owner', 'daily_review', 'owner-b');
  await insert('recent', 'daily_review', 'owner-a', 1);
  const processing = await insert('processing', 'daily_review');
  context.database.sql.exec(`UPDATE wa_melodi_work_events SET created_at=${context.now - 25 * 3600000} WHERE id IN (${old.map(row => `'${row.id}'`).join(',')})`);
  context.database.sql.prepare("UPDATE wa_melodi_work_events SET status='processing',lease_token='existing',lease_until=? WHERE id=?").run(context.now + 60000, processing.id);
  const result = await context.maintenance.pruneExpiredEvents({ owner: 'owner-a' });
  assert.equal(result.expired, 2);
  for (const [index, expected] of [[0, 'done'], [1, 'done'], [2, 'pending'], [3, 'pending'], [4, 'pending'], [5, 'pending']]) {
    assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(old[index].id).status, expected);
  }
  assert.equal((await context.store.listEvents({ owner: 'owner-b', agent: 'melodi' }))[0].status, 'pending');
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(processing.id).status, 'processing');
  assert.equal((await context.maintenance.pruneExpiredEvents({ owner: 'owner-a' })).expired, 0);
  const audits = await context.store.listAudit({ owner: 'owner-a', agent: 'melodi' });
  assert.equal(audits.filter(row => row.action === 'event_expire').length, 2);
});

test('private documents and stories recover into opaque queue envelopes with encrypted retry state', async () => {
  const context = await harness();
  await context.addJob('document');
  await context.addJob('story', { type: 'generate_story', status: 'waiting', ageMinutes: 5, payload: { autonomyAgent: 'melodi' } });
  const result = await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  assert.equal(result.recovered, 2);
  assert.deepEqual(context.queued, [{ jobId: 'story' }, { jobId: 'document' }]);
  for (const id of ['document', 'story']) {
    const job = await context.getJob(id);
    assert.equal(job.status, 'waiting');
    assert.equal(job.encrypted_payload.includes('Mi contenido privado'), false);
    const payload = await context.hooks.decrypt(job.encrypted_payload, job.payload_iv);
    assert.equal(payload.autonomyRetries, 1);
    assert.equal(payload.deliveryMode, 'private');
    assert.equal((await context.maintenance.inspectRecovery({ owner: 'owner-a', jobId: id })).status, 'dispatched');
  }
});

test('ordinary jobs, different owners, unsupported types, recent jobs and unavailable encrypted payloads stay untouched', async () => {
  const context = await harness();
  const variants = {
    normal: { payload: { deliveryMode: 'normal' } },
    noAgent: { payload: { autonomyAgent: null } },
    wrongAgent: { payload: { autonomyAgent: 'melodi' } },
    otherOwner: { owner: 'owner-b' },
    wrongType: { type: 'send_email' },
    tooRecent: { ageMinutes: 1 },
    recentProcessing: { status: 'processing', ageMinutes: 10 },
    complete: { status: 'complete' },
    failed: { status: 'failed' },
    corrupt: {},
  };
  for (const [id, options] of Object.entries(variants)) await context.addJob(id, options);
  context.database.sql.exec("UPDATE wa_owner_jobs SET encrypted_payload='broken' WHERE id='corrupt'");
  const before = context.database.sql.prepare('SELECT * FROM wa_owner_jobs ORDER BY id').all();
  await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  assert.deepEqual(context.database.sql.prepare('SELECT * FROM wa_owner_jobs ORDER BY id').all(), before);
  assert.equal(context.queued.length, 0);
});

test('concurrent recovery is exclusive per job and reserves at most two dispatches per owner minute', async () => {
  const context = await harness();
  for (let number = 0; number < 5; number += 1) await context.addJob(`job-${number}`);
  await Promise.all(Array.from({ length: 4 }, () => context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })));
  assert.equal(context.queued.length, 2);
  assert.equal(new Set(context.queued.map(job => job.jobId)).size, 2);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  context.advance(1);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 2);
  assert.equal(context.queued.length, 4);
});

test('recovery uses the shared two-retry budget and cannot dispatch exhausted jobs', async () => {
  const context = await harness();
  await context.addJob('shared', { payload: { autonomyRetries: 1 } });
  await context.addJob('exhausted', { payload: { autonomyRetries: 2 } });
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
  context.advance(3);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  assert.deepEqual(context.queued, [{ jobId: 'shared' }]);
  assert.equal((await context.maintenance.inspectRecovery({ owner: 'owner-a', jobId: 'shared' })).attempts, 2);
});

test('queue dispatch failure remains recoverable once, keeps private state and consumes the minute cap', async () => {
  const context = await harness({ send: async () => { throw new Error('Queue timed out with private content'); } });
  await context.addJob('job');
  const first = await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  assert.equal(first.failed, 1);
  assert.equal((await context.maintenance.inspectRecovery({ owner: 'owner-a', jobId: 'job' })).error_code, 'queue_dispatch_failed');
  await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  assert.equal(context.queued.length, 1);
  context.advance(2);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).failed, 1);
  context.advance(2);
  await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' });
  assert.equal(context.queued.length, 2);
});

test('stale processing may recover while recently recovered processing waits twelve minutes', async () => {
  const context = await harness();
  await context.addJob('processing', { status: 'processing', ageMinutes: 20 });
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
  context.database.sql.exec("UPDATE wa_owner_jobs SET status='processing' WHERE id='processing'");
  context.advance(3);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  context.advance(9);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
  assert.equal(context.queued.length, 2);
});

test('a freshly started private job is not reclaimed just because it was created long ago', async () => {
  const context = await harness();
  await context.addJob('recently-started', { status: 'processing', ageMinutes: 60,
    payload: { autonomyStartedAt: new Date(context.now - 60000).toISOString() } });
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  assert.equal(context.queued.length, 0);
  context.advance(11);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
});

test('scheduled retries are respected and minute quotas are isolated by owner', async () => {
  const context = await harness();
  await context.addJob('delayed', { status: 'waiting', errorCode: `retry_after:${new Date(context.now + 10 * 60000).toISOString()}` });
  await context.addJob('owner-b-job', { owner: 'owner-b' });
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-b' })).recovered, 1);
  context.advance(10);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
  assert.equal(await context.maintenance.inspectRecovery({ owner: 'owner-b', jobId: 'delayed' }), null);
});

test('failures to encrypt never mutate job payload or reserve a recovery attempt', async () => {
  const context = await harness({ encrypt: async () => ({ encrypted: '', iv: '' }) });
  await context.addJob('job');
  const before = await context.getJob('job');
  await assert.rejects(context.maintenance.recoverPrivateJobs({ owner: 'owner-a' }), /encryption failed/);
  assert.deepEqual(await context.getJob('job'), before);
  assert.equal(context.queued.length, 0);
  assert.equal(await context.maintenance.inspectRecovery({ owner: 'owner-a', jobId: 'job' }), null);
});

test('old ordinary jobs cannot permanently crowd private recovery out of a bounded scan', async () => {
  const context = await harness();
  for (let index = 0; index < 41; index += 1) await context.addJob(`normal-${index}`, { ageMinutes: 20, payload: { deliveryMode: 'normal' } });
  await context.addJob('new-private', { ageMinutes: 3 });
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 0);
  assert.equal((await context.maintenance.recoverPrivateJobs({ owner: 'owner-a' })).recovered, 1);
  assert.deepEqual(context.queued, [{ jobId: 'new-private' }]);
  assert.equal(context.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_owner_jobs WHERE id LIKE 'normal-%' AND status='pending'").get().n, 41);
});
