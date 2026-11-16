import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { contactWindow, createTeamCoordinator } from '../melodi-team-coordination.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const db = this;
    const make = values => ({
      query, values,
      bind: (...next) => make(next),
      async run() { return db.execute(query, values); },
      async all() { return db.execute(query, values); },
      async first() { return db.execute(query, values).results[0] ?? null; },
    });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) return { results: prepared.all(...values).map(row => ({ ...row })), meta: { changes: 0 } };
    const result = prepared.run(...values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const output = statements.map(statement => this.execute(statement.query, statement.values));
      this.sql.exec('COMMIT');
      return output;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

const MORNING = '2026-10-08T12:00:00.000Z'; // 08:00 in the Dominican Republic.
const at = minutes => new Date(Date.parse(MORNING) + minutes * 60000).toISOString();

async function harness() {
  const database = new SqliteD1();
  database.sql.exec(readFileSync(new URL('../melodi-team-coordination.sql', import.meta.url), 'utf8'));
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const coordinator = createTeamCoordinator(database, {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(ciphertext).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return JSON.parse(new TextDecoder().decode(plaintext));
    },
  });
  await coordinator.init('owner-a', MORNING);
  return { coordinator, database };
}

test('proactive contact uses the Dominican 08:00 inclusive to 22:00 exclusive window', async () => {
  assert.equal(contactWindow('2026-10-08T11:59:59.999Z'), false);
  assert.equal(contactWindow('2026-10-08T12:00:00.000Z'), true);
  assert.equal(contactWindow('2026-10-09T01:59:59.999Z'), true);
  assert.equal(contactWindow('2026-10-09T02:00:00.000Z'), false);
  assert.equal(contactWindow('2026-10-09T03:59:59.999Z'), false);
  assert.equal(contactWindow('2026-10-09T12:00:00.000Z'), true);
  const { coordinator } = await harness();
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', '2026-10-08T11:59:59.999Z'), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', MORNING));
});

test('verified requested replies bypass quiet hours and cooldown while retaining the global contact lease', async () => {
  const { coordinator } = await harness();
  const night = '2026-10-09T03:00:00.000Z';
  const first = await coordinator.claimContact('owner-a', 'melodi', night, { requestedReply: true });
  assert.ok(first);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', night, { requestedReply: true }), null);
  await coordinator.finishContact('owner-a', first, { delivered: true, now: night });
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', night), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', night, { requestedReply: true }));
});

test('owners have independent focus, settings and contact claims', async () => {
  const { coordinator } = await harness();
  await coordinator.init('owner-b', MORNING);
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Goal for Melodi only' }, MORNING);
  await coordinator.enable('owner-a', false, MORNING);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', MORNING), null);
  assert.ok(await coordinator.claimContact('owner-b', 'melodi', MORNING));
  assert.equal((await coordinator.settings('owner-b')).focus_agent, null);
  assert.equal(await coordinator.goal('owner-b', 'melodi'), null);
  assert.equal(await coordinator.settings('unknown-owner'), null);
});

test('personal goals are encrypted and visible only to their assigned owner and agent', async () => {
  const { coordinator, database } = await harness();
  const title = 'Private detailed personal objective';
  const description = 'Sensitive details that only Melodi should use';
  await coordinator.setGoal('owner-a', 'melodi', { title, description }, MORNING);
  const goal = await coordinator.goal('owner-a', 'melodi');
  assert.equal(goal.title, title);
  assert.equal(goal.description, description);
  assert.equal(goal.scope, 'personal');
  assert.equal(goal.agent, 'melodi');
  assert.equal(goal.status, 'active');
  assert.equal(await coordinator.goal('owner-a', 'melodi'), null);
  assert.equal(await coordinator.goal('owner-b', 'melodi'), null);
  const persisted = JSON.stringify(database.sql.prepare('SELECT * FROM wa_melodi_personal_goals').all());
  assert.equal(persisted.includes(title), false);
  assert.equal(persisted.includes(description), false);
  assert.equal(JSON.stringify(await coordinator.settings('owner-a')).includes(title), false);
});

test('focus on a personal goal excludes the other three agents from proactive contact', async () => {
  const { coordinator } = await harness();
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Organizar mis estudios' }, MORNING);
  for (const agent of ['melodi']) assert.equal(await coordinator.claimContact('owner-a', agent, MORNING), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', MORNING));
});

test('contact claims are atomic for concurrent agents and for two calls by the same agent', async () => {
  const { coordinator } = await harness();
  const sameAgent = await Promise.all(Array.from({ length: 5 }, () => coordinator.claimContact('owner-a', 'melodi', MORNING)));
  assert.equal(sameAgent.filter(Boolean).length, 1);
  await coordinator.finishContact('owner-a', sameAgent.find(Boolean), { delivered: false, now: MORNING });
  const team = await Promise.all(['melodi'].map(agent => coordinator.claimContact('owner-a', agent, MORNING)));
  assert.equal(team.filter(Boolean).length, 1);
});

test('a question reserves the conversation for its agent for 90 minutes', async () => {
  const { coordinator } = await harness();
  const token = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  await coordinator.finishContact('owner-a', token, { delivered: true, needsReply: true, now: MORNING });
  assert.equal((await coordinator.settings('owner-a')).conversation_agent, 'melodi');
  assert.equal((await coordinator.settings('owner-a')).conversation_until, at(90));
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(44)), null);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(89)), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(90)));
});

test('the same agent may follow up after cooldown while a reply is pending', async () => {
  const { coordinator } = await harness();
  const token = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  await coordinator.finishContact('owner-a', token, { delivered: true, needsReply: true, now: MORNING });
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(44)), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(45)));
});

test('one global 45 minute cooldown applies even when the next agent differs', async () => {
  const { coordinator } = await harness();
  const token = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  await coordinator.finishContact('owner-a', token, { delivered: true, now: MORNING });
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(44)), null);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(44)), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(45)));
});

test('pausing the whole team blocks notification claims until explicitly enabled', async () => {
  const { coordinator } = await harness();
  await coordinator.enable('owner-a', false, MORNING);
  for (const agent of ['melodi']) assert.equal(await coordinator.claimContact('owner-a', agent, MORNING), null);
  await coordinator.enable('owner-a', true, MORNING);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', MORNING));
});

test('an owner reply updates the conversation but preserves the personal goal and focus', async () => {
  const { coordinator } = await harness();
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Goal kept only by Melodi' }, MORNING);
  await coordinator.recordOwnerReply('owner-a', 'melodi', at(10));
  assert.equal((await coordinator.goal('owner-a', 'melodi')).title, 'Goal kept only by Melodi');
  const settings = await coordinator.settings('owner-a');
  assert.equal(settings.focus_agent, 'melodi');
  assert.equal(settings.conversation_agent, 'melodi');
  assert.equal(settings.conversation_until, at(100));
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(100)), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(10)));
});

test('completing or pausing a personal goal clears its focus without sharing the goal', async () => {
  const { coordinator } = await harness();
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Melodi private goal' }, MORNING);
  await coordinator.changeGoal('owner-a', 'melodi', 'paused', MORNING);
  assert.equal((await coordinator.settings('owner-a')).focus_agent, null);
  assert.equal((await coordinator.goal('owner-a', 'melodi')).status, 'paused');
  assert.equal(await coordinator.goal('owner-a', 'melodi'), null);
  await coordinator.changeGoal('owner-a', 'melodi', 'active', MORNING);
  assert.equal((await coordinator.settings('owner-a')).focus_agent, 'melodi');
  await coordinator.changeGoal('owner-a', 'melodi', 'complete', MORNING);
  assert.equal((await coordinator.settings('owner-a')).focus_agent, null);
  assert.equal((await coordinator.goal('owner-a', 'melodi')).status, 'complete');
});

test('another agent goal change cannot clear the currently focused goal', async () => {
  const { coordinator } = await harness();
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Melodi goal' }, MORNING);
  await coordinator.setGoal('owner-a', 'melodi', { title: 'Current Melodi goal' }, MORNING);
  await coordinator.changeGoal('owner-a', 'melodi', 'complete', MORNING);
  assert.equal((await coordinator.settings('owner-a')).focus_agent, 'melodi');
  assert.equal((await coordinator.goal('owner-a', 'melodi')).status, 'active');
});

test('contact lease expiry allows recovery and fences out the former token', async () => {
  const { coordinator } = await harness();
  const first = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(4)), null);
  const recovered = await coordinator.claimContact('owner-a', 'melodi', at(5));
  assert.ok(recovered);
  assert.notEqual(recovered, first);
  await coordinator.finishContact('owner-a', first, { delivered: true, now: at(5) });
  assert.equal((await coordinator.settings('owner-a')).contact_token, recovered);
  assert.equal((await coordinator.settings('owner-a')).last_contact_at, null);
  await coordinator.finishContact('owner-a', recovered, { delivered: false, now: at(5) });
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(5)));
});

test('failed same-agent follow-up preserves the original unanswered conversation deadline', async () => {
  const { coordinator } = await harness();
  const first = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  await coordinator.finishContact('owner-a', first, { delivered: true, needsReply: true, now: MORNING });
  const followup = await coordinator.claimContact('owner-a', 'melodi', at(45));
  assert.ok(followup);
  await coordinator.finishContact('owner-a', followup, { delivered: false, now: at(45) });
  assert.equal((await coordinator.settings('owner-a')).conversation_until, at(90));
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(45)), null);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(89)), null);
  assert.ok(await coordinator.claimContact('owner-a', 'melodi', at(90)));
});

test('an owner reply preserves an in-flight contact lease and cannot allow a parallel send', async () => {
  const { coordinator } = await harness();
  const token = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  await coordinator.recordOwnerReply('owner-a', 'melodi', at(1));
  assert.equal((await coordinator.settings('owner-a')).contact_token, token);
  assert.equal(await coordinator.claimContact('owner-a', 'melodi', at(1)), null);
});

test('a contact token cannot release another owner lease', async () => {
  const { coordinator } = await harness();
  await coordinator.init('owner-b', MORNING);
  const tokenA = await coordinator.claimContact('owner-a', 'melodi', MORNING);
  const tokenB = await coordinator.claimContact('owner-b', 'melodi', MORNING);
  await coordinator.finishContact('owner-b', tokenA, { delivered: true, now: MORNING });
  assert.equal((await coordinator.settings('owner-b')).contact_token, tokenB);
  assert.equal((await coordinator.settings('owner-b')).last_contact_at, null);
});

test('unknown agents and empty personal goals fail before changing durable state', async () => {
  const { coordinator } = await harness();
  await assert.rejects(coordinator.claimContact('owner-a', 'melodi', MORNING), /unknown_team_agent/);
  await assert.rejects(coordinator.setGoal('owner-a', 'melodi', { title: '' }, MORNING), /invalid_personal_goal/);
  await assert.rejects(coordinator.changeGoal('owner-a', 'melodi', 'unknown', MORNING), /invalid_goal_status/);
  assert.equal(await coordinator.goal('owner-a', 'melodi'), null);
  assert.equal((await coordinator.settings('owner-a')).focus_agent, null);
});
