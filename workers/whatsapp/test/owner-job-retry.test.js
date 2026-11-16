import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { RETRY_JOB_TYPES, createOwnerJobRetry, ownerJobRetryPolicy } from '../owner-job-retry.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const database = this;
    const make = values => ({ bind: (...next) => make(next),
      async run() { return database.execute(query, values); },
      async all() { return database.execute(query, values); },
      async first() { return database.execute(query, values).results[0] ?? null; } });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) return { results: prepared.all(...values).map(row => ({ ...row })), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(prepared.run(...values).changes) } };
  }
}

async function fixture() {
  const db = new SqliteD1();
  db.sql.exec(`CREATE TABLE wa_owner_jobs(id TEXT PRIMARY KEY,owner_phone TEXT NOT NULL,job_type TEXT NOT NULL,status TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,error_code TEXT);
    CREATE TABLE wa_owner_sessions(owner_phone TEXT PRIMARY KEY,state TEXT NOT NULL)`);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
  const envelopes = [];
  let queueFails = false;
  const queue = { async send(value) { if (queueFails) throw new Error('network'); envelopes.push(value); } };
  const retry = createOwnerJobRetry(db, { ...hooks, queue, now: () => Date.parse('2026-10-08T14:00:00Z') });
  async function add(id, payload = { autonomyAgent: 'melodi', sourceText: 'Original content' }, extra = {}) {
    const sealed = await hooks.encrypt(payload);
    db.sql.prepare('INSERT INTO wa_owner_jobs VALUES(?,?,?,?,?,?,?,?,?)').run(id, extra.owner || 'owner-a', extra.type || 'generate_story',
      extra.status || 'failed', sealed.encrypted, sealed.iv, extra.createdAt || '2026-10-08T13:00:00Z', null, extra.error ?? 'spaik_image_http_503');
  }
  async function payload(id) {
    const row = db.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(id);
    return hooks.decrypt(row.encrypted_payload, row.payload_iv);
  }
  return { db, hooks, retry, add, payload, envelopes, failQueue: () => { queueFails = true; } };
}

const retryJob = (retry, jobId, extra = {}) => retry.retry({ owner: 'owner-a', jobId, requestKey: 'owner-message-1', explicit: true, ...extra });

test('retry resumes the same encrypted document with verbatim source, original recipient and delivery type', async () => {
  const { db, retry, add, payload, envelopes } = await fixture();
  const original = { autonomyAgent: 'melodi', sourceText: 'NO ES SOLO EDITAR\r\n\r\nEscena 1 — “Texto exacto”\n$ y `literal`',
    fileType: 'pdf', emailDelivery: { to: 'explicit-recipient@example.net', subject: 'Mi documento' }, deliveryMode: 'private',
    autonomyOrigin: 'owner_request', documentRequest: { sections: ['Uno', 'Dos'] } };
  await add('document-1', original, { type: 'generate_document', error: 'model_http_503' });
  const result = await retryJob(retry, 'document-1', { agent: 'melodi' });
  assert.equal(result.status, 'queued');
  assert.equal(result.jobId, 'document-1');
  assert.equal(result.type, 'generate_document');
  assert.deepEqual(envelopes, [{ jobId: 'document-1' }]);
  const restored = await payload('document-1');
  for (const [name, value] of Object.entries(original)) assert.deepEqual(restored[name], value);
  assert.equal(restored.ownerRetryCount, 1);
  assert.equal(restored.ownerRetryRequestedAt, '2026-10-08T14:00:00.000Z');
  assert.equal(restored.ownerRetryRequestKeys.length, 1);
  assert.equal(restored.ownerRetryRequestKeys[0].includes('owner-message'), false);
  const row = db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.error_code, null);
  assert.equal(row.job_type, 'generate_document');
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 1);
  assert.equal(JSON.stringify(row).includes(original.sourceText), false);
  assert.equal(JSON.stringify(row).includes('explicit-recipient'), false);
});

test('all supported original job types can resume transient failures without reinterpretation', async () => {
  const { retry, add, envelopes, db } = await fixture();
  for (const type of RETRY_JOB_TYPES) {
    await add(type, { agent: 'melodi', to: 'original@example.net', sourceText: 'Original' }, { type, error: 'provider_http_503' });
    assert.equal((await retryJob(retry, type, { requestKey: `request-${type}` })).status, 'queued');
    assert.equal(db.sql.prepare('SELECT job_type FROM wa_owner_jobs WHERE id=?').get(type).job_type, type);
  }
  assert.equal(envelopes.length, RETRY_JOB_TYPES.length);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, RETRY_JOB_TYPES.length);
});

test('duplicate explicit requests and concurrent retries dispatch exactly once', async () => {
  const { retry, add, db, payload, envelopes } = await fixture();
  await add('same-job');
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => retryJob(retry, 'same-job')));
  assert.equal(outcomes.filter(item => item.status === 'queued').length, 1);
  assert.equal(envelopes.length, 1);
  db.sql.prepare("UPDATE wa_owner_jobs SET status='failed',error_code='network_failure' WHERE id=?").run('same-job');
  const replay = await retryJob(retry, 'same-job');
  assert.equal(replay.status, 'pending');
  assert.equal(replay.reason, 'request_already_applied');
  assert.equal(db.sql.prepare('SELECT status FROM wa_owner_jobs').get().status, 'failed');
  assert.equal(envelopes.length, 1);
  assert.equal((await retryJob(retry, 'same-job', { requestKey: 'new-owner-message' })).status, 'queued');
  assert.equal((await payload('same-job')).ownerRetryCount, 2);
  assert.equal(envelopes.length, 2);
});

test('selection uses encrypted original assignment, latest context and explicit ambiguity', async () => {
  const { retry, add } = await fixture();
  await add('melodi-old', { autonomyAgent: 'melodi', sourceText: 'private old' }, { createdAt: '2026-10-08T11:00:00Z' });
  await add('melodi-new', { autonomyAgent: 'melodi', sourceText: 'private new' }, { createdAt: '2026-10-08T13:00:00Z' });
  await add('melodi-new', { autonomyAgent: 'melodi', sourceText: 'private Melodi' }, { type: 'generate_document', createdAt: '2026-10-08T13:30:00Z' });
  await add('other-owner', { autonomyAgent: 'melodi' }, { owner: 'owner-b', createdAt: '2026-10-08T13:59:00Z' });
  assert.equal((await retry.select({ owner: 'owner-a', agent: 'melodi' })).status, 'ambiguous');
  assert.equal((await retry.select({ owner: 'owner-a', agent: 'melodi', latest: true })).jobId, 'melodi-new');
  assert.equal((await retry.select({ owner: 'owner-a', agent: 'melodi', recentIds: ['melodi-new', 'melodi-old'] })).jobId, 'melodi-old');
  assert.equal((await retry.select({ owner: 'owner-a', jobId: 'melodi-new', agent: 'melodi' })).status, 'missing');
  assert.equal((await retry.select({ owner: 'owner-b', jobId: 'melodi-new' })).status, 'missing');
  const visible = JSON.stringify(await retry.select({ owner: 'owner-a' }));
  assert.equal(visible.includes('private'), false);
  assert.equal(visible.includes('encrypted_payload'), false);
});

test('permanent failures, uncertain email delivery and unsupported task types cannot be retried', async () => {
  const { retry, add, envelopes } = await fixture();
  for (const [id, type, error, expected] of [
    ['no-credits', 'generate_story', 'spaik_image_http_402', 'permanent_failure'],
    ['bad-source', 'generate_document', 'invalid_document_input', 'permanent_failure'],
    ['missing-key', 'generate_story', 'spaik_missing_key', 'permanent_failure'],
    ['uncertain-email', 'send_email', 'provider_timeout', 'delivery_uncertain'],
    ['unknown-doc', 'generate_document', 'unexpected_error', 'failure_needs_review'],
  ]) {
    await add(id, { autonomyAgent: 'melodi' }, { type, error });
    const result = await retryJob(retry, id);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, expected);
  }
  await add('not-a-real-job', {}, { type: 'create_reminder', error: 'network' });
  assert.equal((await retryJob(retry, 'not-a-real-job')).status, 'missing');
  assert.equal(envelopes.length, 0);
});

test('existing pending, processing and completed jobs do not restart', async () => {
  const { retry, add, envelopes } = await fixture();
  for (const status of ['pending', 'processing', 'complete', 'rejected']) {
    await add(status, { autonomyAgent: 'melodi' }, { status });
    const result = await retryJob(retry, status);
    assert.equal(result.status, ['pending', 'processing'].includes(status) ? 'pending' : 'blocked');
  }
  assert.equal(envelopes.length, 0);
});

test('explicit owner authorization and request key are required before any mutation', async () => {
  const { retry, add, envelopes, db } = await fixture();
  await add('job-1');
  assert.equal((await retryJob(retry, 'job-1', { explicit: false })).reason, 'explicit_owner_retry_required');
  await assert.rejects(retryJob(retry, 'job-1', { requestKey: '' }), /explicit_retry_request_key_required/);
  assert.equal((await retryJob(retry, 'job-1', { owner: 'owner-b' })).status, 'missing');
  assert.equal(db.sql.prepare('SELECT status FROM wa_owner_jobs').get().status, 'failed');
  assert.equal(envelopes.length, 0);
});

test('queue failure leaves original job recoverable and never consumes an unrelated reminder session', async () => {
  const { retry, add, failQueue, db, payload } = await fixture();
  const pendingReminder = JSON.stringify({ stage: 'await_reminder', request: 'Unrelated reminder' });
  db.sql.prepare('INSERT INTO wa_owner_sessions VALUES(?,?)').run('owner-a', pendingReminder);
  await add('job-1', { autonomyAgent: 'melodi', sourceText: 'Exact original story' });
  failQueue();
  const result = await retryJob(retry, 'job-1');
  assert.equal(result.status, 'pending');
  assert.equal(result.jobId, 'job-1');
  assert.equal(result.reason, 'queue_dispatch_failed');
  const row = db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  assert.equal(row.status, 'waiting');
  assert.equal(row.error_code, 'queue_dispatch_failed');
  assert.equal((await payload('job-1')).sourceText, 'Exact original story');
  assert.equal(db.sql.prepare('SELECT state FROM wa_owner_sessions').get().state, pendingReminder);
  assert.equal((await retryJob(retry, 'job-1', { requestKey: 'request-2' })).status, 'pending');
});

test('waiting provider jobs respect retry_after and ready jobs resume their original payload', async () => {
  const { retry, add, envelopes } = await fixture();
  await add('later', { autonomyAgent: 'melodi' }, { status: 'waiting', error: 'retry_after:2026-10-08T14:05:00Z' });
  assert.equal((await retryJob(retry, 'later')).reason, 'retry_scheduled');
  await add('now', { autonomyAgent: 'melodi' }, { status: 'waiting', error: 'retry_after:2026-10-08T13:05:00Z' });
  assert.equal((await retryJob(retry, 'now')).status, 'queued');
  assert.deepEqual(envelopes, [{ jobId: 'now' }]);
});

test('malformed ciphertext cannot be retried or reassigned to a different kind of work', async () => {
  const { retry, add, db, envelopes } = await fixture();
  await add('damaged');
  db.sql.prepare('UPDATE wa_owner_jobs SET encrypted_payload=? WHERE id=?').run('corrupt', 'damaged');
  assert.equal((await retryJob(retry, 'damaged')).status, 'missing');
  assert.equal(envelopes.length, 0);
  assert.equal(db.sql.prepare('SELECT status FROM wa_owner_jobs').get().status, 'failed');
});

test('retry policy distinguishes transient, permanent and unknown provider errors', () => {
  for (const error of ['spaik_image_http_429', 'provider_http_500', 'fetch_failed', 'network_error', 'lease_expired', 'image_processing']) {
    assert.equal(ownerJobRetryPolicy({ job_type: 'generate_story', status: 'failed', error_code: error }).allowed, true, error);
  }
  for (const error of ['spaik_image_http_400', 'provider_http_401', 'insufficient_credits', 'access_forbidden']) {
    assert.equal(ownerJobRetryPolicy({ job_type: 'generate_story', status: 'failed', error_code: error }).reason, 'permanent_failure', error);
  }
  assert.equal(ownerJobRetryPolicy({ job_type: 'send_email', status: 'failed', error_code: 'connection_timed_out' }).reason, 'delivery_uncertain');
});
