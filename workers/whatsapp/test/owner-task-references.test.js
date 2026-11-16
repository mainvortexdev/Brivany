import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { TASK_REFERENCE_SCHEMA, createTaskReferences } from '../owner-task-references.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const database = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
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
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = statements.map(statement => this.execute(statement.query, statement.values)); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function fixture() {
  const db = new SqliteD1();
  let current = Date.parse('2026-10-08T14:00:00Z');
  const references = createTaskReferences(db, { now: () => current });
  await references.ensureSchema();
  return { db, references, advance: ms => { current += ms; } };
}

const register = (references, id, extra = {}) => references.register({ owner: 'owner-a', type: 'job', id, agent: 'melodi', ...extra });

test('reference migration matches actual schema and stores no private labels', async () => {
  const migration = readFileSync(new URL('../owner-task-references.sql', import.meta.url), 'utf8');
  assert.equal(migration.split('\n').slice(1).join('\n').trim(), `${TASK_REFERENCE_SCHEMA.join(';\n\n')};`);
  const { references, db } = await fixture();
  const saved = await register(references, 'private-job', { label: 'Sensitive personal goal and document title' });
  assert.equal(saved.shortRef, 'T1');
  const stored = JSON.stringify(db.sql.prepare('SELECT * FROM wa_melodi_task_references').all());
  assert.equal(stored.includes('Sensitive'), false);
  assert.equal('label' in saved, false);
});

test('registration is persistent, concurrent and idempotent without consuming additional references', async () => {
  const { references, db } = await fixture();
  const same = await Promise.all(Array.from({ length: 12 }, () => register(references, 'same-job')));
  assert.deepEqual(new Set(same.map(item => item.shortRef)), new Set(['T1']));
  const distinct = await Promise.all(Array.from({ length: 10 }, (_, index) => register(references, `job-${index}`)));
  assert.equal(new Set(distinct.map(item => item.shortRef)).size, 10);
  assert.equal(db.sql.prepare('SELECT next_value FROM wa_owner_task_reference_counters').get().next_value, 11);
  const reloaded = createTaskReferences(db);
  assert.equal((await reloaded.resolve({ owner: 'owner-a', type: 'job', reference: 'T1' })).id, 'same-job');
});

test('completed and deleted records never recycle references', async () => {
  const { references, db } = await fixture();
  await register(references, 'old-job');
  assert.equal(await references.setStatus({ owner: 'owner-a', type: 'job', id: 'old-job', status: 'complete' }), true);
  assert.equal((await register(references, 'new-job')).shortRef, 'T2');
  db.sql.prepare('DELETE FROM wa_melodi_task_references WHERE task_id=?').run('old-job');
  assert.equal((await register(references, 'old-job')).shortRef, 'T3');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T1' })).status, 'missing');
});

test('owners, reference types and agent assignments remain isolated', async () => {
  const { references } = await fixture();
  await register(references, 'melodi-job');
  assert.equal((await register(references, 'melodi-job', { agent: 'melodi' })).shortRef, 'T2');
  assert.equal((await register(references, 'other-owner-job', { owner: 'owner-b' })).shortRef, 'T1');
  assert.equal((await register(references, 'approval-1', { type: 'approval' })).shortRef, 'C1');
  assert.equal((await register(references, 'routine-1', { type: 'routine' })).shortRef, 'R1');
  assert.equal((await references.resolve({ owner: 'owner-b', type: 'job', reference: 'T2' })).status, 'missing');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'approval', reference: 'T1' })).status, 'missing');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T1', agent: 'melodi' })).status, 'missing');
  assert.deepEqual((await references.list({ owner: 'owner-a', type: 'job', agent: 'melodi' })).map(item => item.id), ['melodi-job']);
  await assert.rejects(register(references, 'melodi-job', { agent: 'melodi' }), /reference_assignment_conflict/);
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T1' })).agent, 'melodi');
});

test('natural short references normalize spaces and case and report ambiguous choices', async () => {
  const { references } = await fixture();
  await register(references, 'job-1');
  await register(references, 'job-2');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'Melodi, reanuda el trabajo t 01 por favor' })).id, 'job-1');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T1 y T1' })).status, 'resolved');
  const ambiguous = await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T1 o T2' });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'T999' })).status, 'missing');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job' })).status, 'ambiguous');
});

test('UUID hexadecimal segments are never mistaken for short references', async () => {
  const { references } = await fixture();
  const id = '034c72a7-25cb-4040-c123-a2d931d66aa4';
  await register(references, id, { type: 'approval' });
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'approval', reference: `Aprueba ${id}` })).id, id);
  await register(references, 'other-approval', { type: 'approval' });
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'approval', reference: `C2 o ${id}` })).status, 'ambiguous');
});

test('concurrent completion of legacy assignment never silently reassigns a task', async () => {
  const { references } = await fixture();
  await references.register({ owner: 'owner-a', type: 'job', id: 'legacy-job' });
  const updates = await Promise.allSettled([
    register(references, 'legacy-job', { agent: 'melodi' }), register(references, 'legacy-job', { agent: 'melodi' }),
  ]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(updates.find(result => result.status === 'rejected').reason.message, /reference_assignment_conflict/);
});

test('latest and recent conversation context select within owner and original assignment', async () => {
  const { references, advance } = await fixture();
  await register(references, 'old-melodi');
  advance(1000);
  await register(references, 'new-melodi');
  advance(1000);
  await register(references, 'new-melodi', { agent: 'melodi' });
  assert.equal((await references.latest({ owner: 'owner-a', type: 'job', agent: 'melodi' })).id, 'new-melodi');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', agent: 'melodi', latest: true, recentIds: ['other-owner', 'new-melodi', 'old-melodi'] })).id, 'old-melodi');
  await references.setStatus({ owner: 'owner-a', type: 'job', id: 'new-melodi', status: 'complete' });
  assert.equal((await references.latest({ owner: 'owner-a', type: 'job', agent: 'melodi', statuses: ['active'] })).id, 'old-melodi');
  assert.equal(await references.setStatus({ owner: 'owner-b', type: 'job', id: 'old-melodi', status: 'failed' }), false);
});

test('old UUID and automatic job IDs require original owner records before lazy registration', async () => {
  const { db, references } = await fixture();
  db.sql.exec(`CREATE TABLE wa_owner_jobs(id TEXT PRIMARY KEY,owner_phone TEXT,status TEXT);
    CREATE TABLE wa_melodi_permission_requests(id TEXT PRIMARY KEY,owner_phone TEXT,requester TEXT,status TEXT);
    CREATE TABLE wa_melodi_routines(id TEXT PRIMARY KEY,owner TEXT,agent TEXT,status TEXT)`);
  const uuid = '034c72a7-25cb-4040-b86e-a2d931d66aa4';
  db.sql.prepare('INSERT INTO wa_melodi_permission_requests VALUES(?,?,?,?)').run(uuid, 'owner-a', 'melodi', 'pending');
  const recovered = await references.resolve({ owner: 'owner-a', type: 'approval', reference: `Aprueba ${uuid}`, agent: 'melodi' });
  assert.equal(recovered.id, uuid);
  assert.equal(recovered.shortRef, 'C1');
  assert.equal((await references.resolve({ owner: 'owner-b', type: 'approval', reference: uuid })).status, 'missing');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'approval', reference: uuid, agent: 'melodi' })).status, 'missing');
  db.sql.prepare('INSERT INTO wa_owner_jobs VALUES(?,?,?)').run('auto-abcd1234567890', 'owner-a', 'failed');
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: 'auto-abcd1234567890', agent: 'melodi' })).status, 'missing');
  const legacyJob = await references.resolve({ owner: 'owner-a', type: 'job', reference: 'reanuda auto-abcd1234567890' });
  assert.equal(legacyJob.id, 'auto-abcd1234567890');
  await register(references, legacyJob.id);
  assert.equal((await references.resolve({ owner: 'owner-a', type: 'job', reference: legacyJob.shortRef, agent: 'melodi' })).id, legacyJob.id);
});

test('malformed scope cannot register or query task references', async () => {
  const { references } = await fixture();
  await assert.rejects(references.register({ owner: 'owner-a', id: 'x' }), /invalid_reference_type/);
  await assert.rejects(references.resolve({ owner: 'owner-a', reference: 'T1' }), /invalid_reference_type/);
  await assert.rejects(register(references, 'unsafe id'), /invalid_reference_task/);
  await assert.rejects(register(references, 'x', { type: 'unknown' }), /invalid_reference_type/);
  await assert.rejects(register(references, 'x', { agent: 'stranger' }), /invalid_reference_agent/);
  await assert.rejects(references.list({ owner: 'owner-a', statuses: ["active'); DROP TABLE anything"] }), /invalid_reference_status/);
});
