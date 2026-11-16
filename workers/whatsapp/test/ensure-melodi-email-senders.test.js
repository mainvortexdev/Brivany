import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureAgentEmailSenders, AGENT_EMAIL_SETUP_VERSION } from '../ensure-melodi-email-senders.js';
import { AGENT_EMAIL_SENDERS, agentEmailIdentity, agentForEmail } from '../melodi-email-identity.js';

const at = Date.parse('2026-10-08T18:00:00Z');
function harness({ authenticated = true, verified = true, active = true, post, listing = true } = {}) {
  const sql = new DatabaseSync(':memory:'), calls = [], aliases = [{ email: 'emily@vetsa.es', name: 'Melodi', active: true }];
  const db = { prepare(query) {
    const execute = values => { const statement = sql.prepare(query); return statement.columns().length
      ? { results: statement.all(...values).map(row => ({ ...row })) } : { results: [], meta: { changes: Number(statement.run(...values).changes) } }; };
    const bound = values => ({ bind: (...next) => bound(next), first: async () => execute(values).results[0] ?? null,
      all: async () => execute(values), run: async () => execute(values) });
    return bound([]);
  }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  const env = { VETSA_CLOUD: db, BREVO_API_KEY: 'fixture-only-key', TEAM_AGENT_EMAIL_SETUP: AGENT_EMAIL_SETUP_VERSION };
  const fetchImpl = async (url, init) => {
    assert.equal(url.startsWith('https://api.brevo.com/v3/senders'), true);
    assert.equal(url.includes('/smtp/'), false);
    calls.push({ url, method: init.method, payload: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET') return Response.json(url.includes('/domains/')
      ? { domain: 'vetsa.es', verified, authenticated } : listing ? { senders: aliases } : {}, { status: listing || url.includes('/domains/') ? 200 : 503 });
    const payload = JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload).sort(), ['email', 'name']); assert.ok(AGENT_EMAIL_SENDERS.includes(payload.email));
    assert.equal(payload.name, agentEmailIdentity(agentForEmail(payload.email)).senderName);
    if (post) return post(payload, aliases);
    aliases.push({ ...payload, active }); return Response.json({ id: aliases.length }, { status: 201 });
  };
  return { env, sql, calls, aliases, fetchImpl };
}

test('registers only four missing owned aliases after authenticated preflight and persists active read-back', async () => {
  const context = harness();
  const result = await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl });
  assert.equal(result.status, 'complete'); assert.equal(result.created.length, 4);
  assert.deepEqual(context.calls.filter(call => call.method === 'POST').map(call => call.payload.email), AGENT_EMAIL_SENDERS.slice(1));
  assert.equal(result.senders.every(row => row.registered && row.providerActive), true);
  assert.equal(context.sql.prepare("SELECT status FROM wa_email_sender_audit WHERE id LIKE 'agentsetup:%' AND id NOT LIKE '%@%'").get().status, 'complete');
  const count = context.calls.length;
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 86400000, fetchImpl: context.fetchImpl })).status, 'complete');
  assert.equal(context.calls.length, count);
  assert.equal(JSON.stringify(context.sql.prepare('SELECT * FROM wa_email_sender_audit').all()).includes('fixture-only-key'), false);
});

test('configuration gate and incomplete domain verification prevent all POST calls', async () => {
  const disabled = harness(); disabled.env.TEAM_AGENT_EMAIL_SETUP = 'unexpected-version';
  assert.equal((await ensureAgentEmailSenders(disabled.env, { now: at, fetchImpl: disabled.fetchImpl })).status, 'disabled');
  assert.deepEqual(disabled.calls, []);
  for (const options of [{ authenticated: false }, { verified: false }, { listing: false }]) {
    const context = harness(options);
    const result = await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl });
    assert.equal(['blocked', 'retry'].includes(result.status), true);
    assert.equal(context.calls.some(call => call.method === 'POST'), false);
  }
});

test('concurrent runtime ticks claim one setup lease and never create duplicate aliases', async () => {
  const context = harness();
  const results = await Promise.all([ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl }),
    ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl })]);
  assert.equal(results.some(row => row.status === 'complete'), true);
  assert.equal(context.calls.filter(call => call.method === 'POST').length, 4);
  assert.equal(new Set(context.aliases.map(row => row.email)).size, 5);
});

test('a successful registration response without active read-back stays pending and never repeats the POST', async () => {
  const context = harness({ active: false });
  const first = await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl });
  assert.equal(first.status, 'retry'); assert.equal(first.reason, 'awaiting_provider_confirmation');
  assert.equal(context.calls.filter(call => call.method === 'POST').length, 4);
  await ensureAgentEmailSenders(context.env, { now: at + 3600000, fetchImpl: context.fetchImpl });
  assert.equal(context.calls.filter(call => call.method === 'POST').length, 4);
  for (const alias of context.aliases) alias.active = true;
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 7200000, fetchImpl: context.fetchImpl })).status, 'complete');
});

test('transient rejections wait one hour and retries only the genuinely missing alias', async () => {
  let failures = 1;
  const context = harness({ post: (payload, aliases) => {
    if (failures > 0) { failures--; return Response.json({ message: 'unavailable' }, { status: 503 }); }
    aliases.push({ ...payload, active: true }); return Response.json({ id: aliases.length }, { status: 201 });
  } });
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl })).status, 'retry');
  const count = context.calls.length;
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 3599999, fetchImpl: context.fetchImpl })).status, 'deferred');
  assert.equal(context.calls.length, count);
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 3600000, fetchImpl: context.fetchImpl })).status, 'complete');
});

test('ambiguous POST responses are read back before any retry and cannot trigger repeat registration', async () => {
  for (const response of ['timeout', 'invalid-id']) {
    const context = harness({ post: () => response === 'timeout' ? Promise.reject(Error('timeout')) : Response.json({ id: 'untrusted' }, { status: 201 }) });
    await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl });
    await ensureAgentEmailSenders(context.env, { now: at + 3600000, fetchImpl: context.fetchImpl });
    await ensureAgentEmailSenders(context.env, { now: at + 7200000, fetchImpl: context.fetchImpl });
    assert.equal(context.calls.filter(call => call.method === 'POST' && call.payload.email === 'emily@vetsa.es').length, 1);
    assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 10800000, fetchImpl: context.fetchImpl })).status, 'failed');
  }
});

test('permanent provider rejection leaves a truthful blocked receipt and never switches to Melodi', async () => {
  const context = harness({ post: () => Response.json({ message: 'forbidden' }, { status: 403 }) });
  const result = await ensureAgentEmailSenders(context.env, { now: at, fetchImpl: context.fetchImpl });
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'provider_rejected');
  assert.deepEqual(context.calls.filter(call => call.method === 'POST').map(call => call.payload.email), ['emily@vetsa.es']);
  const count = context.calls.length;
  assert.equal((await ensureAgentEmailSenders(context.env, { now: at + 86400000, fetchImpl: context.fetchImpl })).status, 'blocked');
  assert.equal(context.calls.length, count);
});
