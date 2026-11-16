import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readEmailSenderStatus, refreshEmailSenders } from '../email-sender-status.js';

function harness() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../email-sender-status.sql', import.meta.url), 'utf8'));
  const db = { prepare(query) {
    const statement = sql.prepare(query);
    const execute = values => statement.columns().length ? { results: statement.all(...values).map(row => ({ ...row })) }
      : { results: [], meta: { changes: Number(statement.run(...values).changes) } };
    const bound = values => ({ bind: (...next) => bound(next), first: async () => execute(values).results[0] ?? null,
      all: async () => execute(values), run: async () => execute(values) });
    return bound([]);
  }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  return { sql, env: { VETSA_CLOUD: db, BREVO_API_KEY: 'test-secret-key' } };
}
const at = Date.parse('2026-10-08T13:00:00Z');

test('read-only daily audit distinguishes active, inactive and unlisted alias with verified domain', async () => {
  const { env, sql } = harness(), calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    assert.equal(init.headers['api-key'], 'test-secret-key');
    return Response.json(url.includes('/domains/')
      ? { domain: 'vetsa.es', verified: true, authenticated: true, dns_records: { private_value: 'NEVER_STORE_DNS' } }
      : { senders: [{ email: 'emily@vetsa.es', name: 'Melodi · Brivany', active: true },
        { email: 'other@vetsa.es', active: true }] });
  };
  const result = await refreshEmailSenders(env, { now: at, fetchImpl });
  assert.equal(result.status, 'updated'); assert.equal(result.senders.length, 1);
  const sender = agent => result.senders.find(row => row.agent === agent);
  assert.equal(sender('melodi').status, 'active'); assert.equal(sender('melodi').registered, true); assert.equal(sender('melodi').providerActive, true);
  assert.equal(sender('melodi').domainAuthenticated, true); assert.equal(sender('melodi').domainVerified, true);
  assert.equal(calls.length, 2); assert.equal(calls.every(call => call.method === 'GET'), true);
  const stored = JSON.stringify(sql.prepare('SELECT * FROM wa_melodi_email_sender_status').all());
  assert.equal(stored.includes('test-secret-key'), false); assert.equal(stored.includes('NEVER_STORE_DNS'), false);
  assert.equal(stored.includes('other@vetsa.es'), false);
  const replay = await refreshEmailSenders(env, { now: at + 86399999, fetchImpl });
  assert.equal(replay.status, 'cached'); assert.equal(calls.length, 2);
  await refreshEmailSenders(env, { now: at + 86400000, fetchImpl }); assert.equal(calls.length, 4);
  assert.equal((await readEmailSenderStatus(env)).length, 1);
});

test('an unavailable or malformed GET probe reports unknown data without blocking a later real send', async () => {
  const { env } = harness(); let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({ message: 'not allowed' }, { status: 401 }); };
  const result = await refreshEmailSenders(env, { now: at, fetchImpl });
  assert.equal(result.status, 'unavailable'); assert.equal(result.senders.length, 1);
  assert.equal(result.senders.every(row => row.status === 'unavailable' && row.registered === null && row.providerActive === null), true);
  assert.equal((await refreshEmailSenders(env, { now: at + 60000, fetchImpl })).status, 'cached'); assert.equal(calls, 2);
  const malformed = await refreshEmailSenders(env, { now: at + 86400000, fetchImpl: async () => Response.json({ domain: 'unrelated.es', authenticated: true, verified: true }) });
  assert.equal(malformed.senders.length, 1);
  assert.equal(malformed.senders.every(row => row.status === 'unavailable' && row.domainVerified === null), true);
});

test('unverified domains never imply that an absent agent sender exists or can deliver', async () => {
  const { env } = harness();
  const result = await refreshEmailSenders(env, { now: at, fetchImpl: async url => Response.json(url.includes('/domains/')
    ? { domain: 'vetsa.es', authenticated: false, verified: true } : { senders: [] }) });
  assert.equal(result.senders.length, 1);
  assert.equal(result.senders.every(row => row.status === 'missing' && row.registered === false && row.providerActive === null), true);
});

test('concurrent runtimes share the daily audit lease and a missing API key causes no outbound calls', async () => {
  const { env } = harness(); let calls = 0;
  const fetchImpl = async url => { calls++; return Response.json(url.includes('/domains/')
    ? { domain: 'vetsa.es', authenticated: true, verified: true } : { senders: [] }); };
  await Promise.all([refreshEmailSenders(env, { now: at, fetchImpl }), refreshEmailSenders(env, { now: at, fetchImpl })]);
  assert.equal(calls, 2);
  const noKey = await refreshEmailSenders({ ...env, BREVO_API_KEY: '' }, { now: at + 86400000, fetchImpl });
  assert.equal(noKey.status, 'not_configured'); assert.equal(calls, 2);
  assert.equal(noKey.senders.every(row => row.status === 'not_configured'), true);
});
