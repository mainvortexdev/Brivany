import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createPermissionStore, INITIAL_AGENT_LEVELS, PERMISSIONS_SCHEMA, permissionForTool, xpForNextLevel } from '../melodi-permissions.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const db = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      run: async () => db.execute(query, values), all: async () => db.execute(query, values),
      first: async () => db.execute(query, values).results[0] || null });
    return make([]);
  }
  execute(query, values) {
    const statement = this.sql.prepare(query);
    if (statement.columns().length) return { results: statement.all(...values).map(row => ({ ...row })),
      meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) } };
    return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const results = statements.map(({ query, values }) => this.execute(query, values)); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function harness() {
  const db = new SqliteD1();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'))));
    },
  };
  let at = Date.parse('2026-10-08T15:00:00Z'), ids = 0;
  const store = createPermissionStore(db, { ...hooks, now: () => at, uuid: () => `permission-${++ids}` });
  await store.ensureSchema();
  return { store, db, hooks, advance(ms) { at += ms; } };
}

const request = (store, extra = {}) => store.authorizeOrRequest({ owner: 'owner-a', agent: 'melodi', tool: 'prepare_story',
  input: { brief: 'private goal: prepare a scene' }, eventKey: 'task-1:step0', parentEventId: 'event-1', goalScope: 'personal', ...extra });
const approve = (store, id, extra = {}) => store.approve({ owner: 'owner-a', approvalId: id, approved: true, eventKey: `approve:${id}`, ...extra });
const claim = (store, id, extra = {}) => store.claimApproved({ owner: 'owner-a', approvalId: id, helper: 'melodi', eventKey: `execute:${id}`, ...extra });

test('migration matches actual schema and four default levels remain persistent', async () => {
  const { store } = await harness();
  const migration = readFileSync(new URL('../melodi-permissions.sql', import.meta.url), 'utf8');
  assert.equal(migration.split('\n').slice(1).join('\n').trim(), `${PERMISSIONS_SCHEMA.join(';\n\n')};`);
  const team = await store.getTeam('owner-a');
  assert.deepEqual(Object.fromEntries(team.map(({ agent, level }) => [agent, level])), INITIAL_AGENT_LEVELS);
  await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 1, eventKey: 'owner-downlevel' });
  assert.equal((await store.ensureAgent('owner-a', 'melodi')).level, 1);
});

test('explicit selection and praise give different XP exactly once per owner event', async () => {
  const { store } = await harness();
  const selected = await store.reward({ owner: 'owner-a', agent: 'melodi', kind: 'selected', eventKey: 'selected:message-1' });
  assert.equal(selected.xpAwarded, 1);
  const praised = await store.reward({ owner: 'owner-a', agent: 'melodi', kind: 'praised', eventKey: 'praised:message-1' });
  assert.equal(praised.xpAwarded, 3);
  assert.equal(praised.agent.xp, 4);
  const replay = await store.reward({ owner: 'owner-a', agent: 'melodi', kind: 'praised', eventKey: 'praised:message-1' });
  assert.equal(replay.applied, false);
  assert.equal(replay.xpAwarded, 0);
  assert.equal(replay.agent.xp, 0);
});

test('concurrent awards neither double-credit a repeated event nor lose independent awards', async () => {
  const { store } = await harness();
  const event = { owner: 'owner-a', agent: 'melodi', kind: 'praised', eventKey: 'praise-concurrent' };
  const repeated = await Promise.all([store.reward(event), store.reward(event), store.reward(event)]);
  assert.equal(repeated.filter(item => item.applied).length, 1);
  await Promise.all(['a', 'b'].map(eventKey => store.reward({ ...event, eventKey })));
  assert.equal((await store.ensureAgent('owner-a', 'melodi')).xp, 9);
});

test('growing level thresholds retain excess XP and explicit owner decreases take the exact requested level', async () => {
  const { store } = await harness();
  for (let n = 0; n < 7; n++) await store.reward({ owner: 'owner-a', agent: 'melodi', kind: 'praised', eventKey: `praise:${n}` });
  let level = await store.ensureAgent('owner-a', 'melodi');
  assert.equal(level.level, 2); assert.equal(level.xp, 1); assert.equal(level.nextLevelXp, 30);
  assert.equal(xpForNextLevel(3), 40); assert.equal(xpForNextLevel(10), null);
  const adjusted = await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 0, eventKey: 'owner:reduce-to-zero' });
  assert.equal(adjusted.agent.level, 0); assert.equal(adjusted.agent.xp, 0);
  assert.equal(adjusted.agent.permission_revision, 1);
  const replay = await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 8, eventKey: 'owner:reduce-to-zero' });
  assert.equal(replay.applied, false); assert.equal(replay.agent.level, 0);
  await assert.rejects(store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: -1, eventKey: 'bad' }), /invalid_agent_level/);
});

test('tools are available to every persona when her verified level permits the action', async () => {
  const { store } = await harness();
  assert.deepEqual(permissionForTool('prepare_document').agents, ['melodi']);
  assert.equal(permissionForTool('arbitrary_external_email'), null);
  assert.equal((await request(store, { agent: 'melodi' })).allowed, true);
  assert.equal((await request(store, { agent: 'melodi', tool: 'prepare_document' })).allowed, true);
  assert.equal((await request(store, { agent: 'melodi', tool: 'inspect_workspace', goalScope: 'team' })).allowed, true);
  const blocked = await request(store, { tool: 'publish_to_stranger' });
  assert.equal(blocked.reason, 'unknown_permission_tool');
});

test('direct owner skills use explicit level requirements and publication requires a higher level', async () => {
  const minimums = { manage_memory: 1, manage_calendar: 1, manage_projects: 1,
    read_owner_email: 2, send_owner_email: 3, manage_social: 3,
    publish_social: 5, desktop_action: 4, generate_media: 3, retrieve_private_document: 2 };
  for (const [tool, minimumLevel] of Object.entries(minimums)) {
    assert.equal(permissionForTool(tool).minimumLevel, minimumLevel);
    assert.deepEqual(permissionForTool(tool).agents, ['melodi']);
  }
  const { store } = await harness();
  assert.equal((await request(store, { agent: 'melodi', tool: 'send_owner_email', goalScope: 'team' })).allowed, true);
  assert.equal((await request(store, { agent: 'melodi', tool: 'publish_social', goalScope: 'team' })).reason, 'no_higher_level_helper');
  await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 5, eventKey: 'owner-authorized-level-five' });
  const escalation = await request(store, { agent: 'melodi', tool: 'publish_social', goalScope: 'team' });
  assert.equal(escalation.waitingApproval.helper, 'melodi');
  assert.equal(escalation.waitingApproval.required_level, 5);
});

test('missing authority requests the highest-level helper and waits for an explicit owner decision', async () => {
  const { store } = await harness();
  const result = await request(store);
  assert.equal(result.allowed, false); assert.equal(result.status, 'waiting_approval');
  assert.equal(result.waitingApproval.requester, 'melodi'); assert.equal(result.waitingApproval.helper, 'melodi');
  assert.equal(result.waitingApproval.required_level, 3);
  assert.equal(result.waitingApproval.goal_scope, 'personal');
  assert.equal((await claim(store, result.waitingApproval.id)).allowed, false);
  const accepted = await approve(store, result.waitingApproval.id);
  assert.equal(accepted.status, 'approved');
  assert.deepEqual(accepted.request.input, { brief: 'private goal: prepare a scene' });
  assert.equal((await store.ensureAgent('owner-a', 'melodi')).level, 1);
});

test('pending helper notifications and database metadata reveal no private objective or action input', async () => {
  const { store, db } = await harness();
  const result = await request(store, { eventKey: 'sensitive goal text too' });
  const pending = await store.listPending('owner-a');
  assert.equal(pending.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private goal|sensitive goal|input_encrypted|input_iv/);
  assert.doesNotMatch(JSON.stringify(pending), /private goal|sensitive goal|input_encrypted|input_iv/);
  assert.doesNotMatch(JSON.stringify(db.sql.prepare('SELECT * FROM wa_melodi_permission_requests').all()), /private goal|sensitive goal/);
});

test('a denied escalation cannot execute or reopen through replay or later XP elevation', async () => {
  const { store } = await harness();
  const created = await request(store);
  const id = created.waitingApproval.id;
  const denied = await approve(store, id, { approved: false });
  assert.equal(denied.status, 'denied'); assert.equal(denied.request.input, undefined);
  assert.equal((await claim(store, id)).allowed, false);
  // A later legitimate level change still does not authorize the denied task.
  await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 5, eventKey: 'owner-upgrade' });
  assert.equal((await request(store)).status, 'denied');
  assert.equal((await approve(store, id, { eventKey: 'second-approval' })).applied, false);
});

test('wrong owner and wrong helper cannot approve, decrypt or claim another team action', async () => {
  const { store } = await harness();
  const id = (await request(store)).waitingApproval.id;
  assert.equal((await approve(store, id, { owner: 'owner-b' })).status, 'not_found');
  assert.deepEqual(await store.listPending('owner-b'), []);
  await approve(store, id);
  assert.equal((await claim(store, id, { helper: 'melodi' })).allowed, false);
  assert.equal((await claim(store, id, { owner: 'owner-b' })).allowed, false);
  assert.equal((await claim(store, id)).allowed, true);
});

test('competing owner approvals and helper executions produce only one decrypted execution grant', async () => {
  const { store } = await harness();
  const id = (await request(store)).waitingApproval.id;
  const approvals = await Promise.all([approve(store, id), approve(store, id)]);
  assert.equal(approvals.filter(item => item.applied).length, 1);
  const claims = await Promise.all([claim(store, id), claim(store, id)]);
  assert.equal(claims.filter(item => item.allowed).length, 1);
  const grant = claims.find(item => item.allowed);
  assert.equal(grant.grant.idempotencyKey, `approved:${id}`);
  assert.equal(grant.request.helper, 'melodi');
  assert.equal(grant.request.requester, 'melodi');
  assert.equal(await store.finishApproval({ owner: 'owner-a', approvalId: id, token: 'wrong-token', status: 'complete' }), false);
  assert.equal(await store.finishApproval({ owner: 'owner-a', approvalId: id, token: grant.grant.token, status: 'complete', receiptCode: 'queued' }), true);
  assert.equal((await claim(store, id)).allowed, false);
});

test('changing either participant level revokes unconsumed and claimed approvals', async () => {
  for (const agent of ['melodi']) {
    const { store } = await harness();
    const id = (await request(store)).waitingApproval.id;
    await approve(store, id);
    await store.adjustLevel({ owner: 'owner-a', agent, level: 0, eventKey: `downlevel:${agent}` });
    assert.equal((await claim(store, id)).allowed, false);
    assert.deepEqual(await store.listPending('owner-a'), []);
  }
  const { store } = await harness();
  const id = (await request(store)).waitingApproval.id;
  await approve(store, id);
  const grant = await claim(store, id);
  await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 2, eventKey: 'lower-after-claim' });
  assert.equal(await store.finishApproval({ owner: 'owner-a', approvalId: id, token: grant.grant.token, status: 'complete' }), false);
});

test('expired approvals cannot execute and corrupt encrypted work fails closed', async () => {
  const { store, db, advance } = await harness();
  let id = (await request(store)).waitingApproval.id;
  advance(24 * 60 * 60_000 + 1);
  assert.equal((await approve(store, id)).status, 'expired');
  assert.equal((await claim(store, id)).allowed, false);
  id = (await request(store, { eventKey: 'new-task' })).waitingApproval.id;
  db.sql.prepare('UPDATE wa_melodi_permission_requests SET input_encrypted=? WHERE id=?').run('corrupt', id);
  await assert.rejects(approve(store, id));
  assert.equal((await store.listPending('owner-a'))[0].status, 'pending');
});

test('a private objective cannot silently delegate or persist without encryption', async () => {
  const { store, db } = await harness();
  assert.equal((await request(store, { tool: 'delegate_agent_event' })).reason, 'personal_goal_cannot_be_delegated');
  const noHooks = createPermissionStore(db);
  await assert.rejects(request(noHooks, { eventKey: 'unencrypted-request' }), /permission_encryption_required/);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM wa_melodi_permission_requests').get().count, 0);
});

test('request replay keeps the immutable original input and rejects another requester under the same event', async () => {
  const { store } = await harness();
  const created = await request(store);
  const replay = await request(store, { input: { brief: 'replacement must never be persisted' } });
  assert.equal(replay.waitingApproval.id, created.waitingApproval.id);
  assert.equal((await request(store, { agent: 'melodi' })).reason, 'permission_request_conflict');
  const accepted = await approve(store, created.waitingApproval.id);
  assert.deepEqual(accepted.request.input, { brief: 'private goal: prepare a scene' });
});

test('no eligible higher-level teammate means a blocked task, never automatic self-promotion', async () => {
  const { store } = await harness();
  for (const agent of ['melodi']) await store.adjustLevel({ owner: 'owner-a', agent, level: 1, eventKey: `lower:${agent}` });
  assert.equal((await request(store)).reason, 'no_higher_level_helper');
  assert.equal((await store.ensureAgent('owner-a', 'melodi')).level, 1);
});

test('one owner decision cannot be replayed to approve multiple competing requests', async () => {
  const { store } = await harness();
  const first = (await request(store)).waitingApproval.id;
  const second = (await request(store, { eventKey: 'task-2:step0' })).waitingApproval.id;
  const decisions = await Promise.all([approve(store, first, { eventKey: 'one-owner-message' }), approve(store, second, { eventKey: 'one-owner-message' })]);
  assert.equal(decisions.filter(item => item.applied).length, 1);
  assert.equal(decisions.filter(item => item.status === 'decision_conflict').length, 1);
});

test('a level change during input encryption cannot create a stale authorization request', async () => {
  const { store, db, hooks } = await harness();
  const raced = createPermissionStore(db, {
    ...hooks,
    async encrypt(input) {
      await store.adjustLevel({ owner: 'owner-a', agent: 'melodi', level: 0, eventKey: 'race-downlevel' });
      return hooks.encrypt(input);
    },
  });
  assert.equal((await request(raced)).reason, 'permission_state_changed');
  assert.deepEqual(await store.listPending('owner-a'), []);
});
