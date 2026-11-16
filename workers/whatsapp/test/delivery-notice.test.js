import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createDeliveryNotices } from '../delivery-notice.js';

class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(sql) {
    const execute = values => {
      const statement = this.sql.prepare(sql);
      return statement.columns().length ? { results: statement.all(...values).map(row => ({ ...row })) }
        : { results: [], meta: { changes: Number(statement.run(...values).changes) } };
    };
    const bound = values => ({ bind: (...next) => bound(next), run: async () => execute(values), all: async () => execute(values),
      first: async () => execute(values).results[0] ?? null });
    return bound([]);
  }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
}
async function harness() {
  const db = new D1(), at = { value: Date.parse('2026-10-08T13:00:00Z') };
  db.sql.exec(readFileSync(new URL('../delivery-notice.sql', import.meta.url), 'utf8'));
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(text) { const iv = crypto.getRandomValues(new Uint8Array(12)); return {
      encrypted: Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))).toString('base64'),
      iv: Buffer.from(iv).toString('base64') }; },
    async decrypt(text, iv) { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(text, 'base64'))); },
  };
  const notices = createDeliveryNotices(db, { ...hooks, now: () => at.value });
  await notices.ensureSchema();
  const enqueue = (extra = {}) => notices.enqueue({ owner: 'owner-a', key: 'verified-email:mail-1', agent: 'melodi',
    body: 'Melodi: Envié informe.pdf desde emily@vetsa.es a owner@example.com.', ownerRequested: true, artifactJobId: 'pdf-1', ...extra });
  return { db, notices, enqueue, at };
}

test('an encrypted durable notice remains idempotent after retry or a process restart', async () => {
  const { db, notices, enqueue } = await harness();
  const first = await enqueue(), repeated = await enqueue({ body: 'Contenido cambiado por un replay' });
  assert.equal(first.id, repeated.id); assert.equal(first.status, 'pending'); assert.equal(first.ownerRequested, true);
  const raw = db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  assert.equal(JSON.stringify(raw).includes('owner@example.com'), false);
  assert.equal(JSON.stringify(raw).includes('informe.pdf'), false);
  assert.equal(raw.notice_key.includes('verified-email'), false);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
  const [claimed] = await notices.claim({ owner: 'owner-a' });
  assert.equal(claimed.body, 'Melodi: Envié informe.pdf desde emily@vetsa.es a owner@example.com.');
  assert.equal(claimed.artifactJobId, 'pdf-1'); assert.equal(claimed.agent, 'melodi');
});

test('concurrent claimers get one lease and cannot finish another owner or token', async () => {
  const { notices, enqueue } = await harness(); await enqueue();
  const results = await Promise.all([notices.claim({ owner: 'owner-a' }), notices.claim({ owner: 'owner-a' })]);
  assert.equal(results.flat().length, 1);
  const claim = results.flat()[0];
  assert.deepEqual(await notices.claim({ owner: 'owner-b' }), []);
  assert.equal(await notices.finish({ owner: 'owner-b', id: claim.id, token: claim.token, status: 'sent' }), false);
  assert.equal(await notices.finish({ owner: 'owner-a', id: claim.id, token: 'invalid-token', status: 'sent' }), false);
  assert.equal(await notices.finish({ owner: 'owner-a', id: claim.id, token: claim.token, status: 'sent' }), true);
  assert.deepEqual(await notices.claim({ owner: 'owner-a' }), []);
  assert.equal(await notices.finish({ owner: 'owner-a', id: claim.id, token: claim.token, status: 'pending' }), false);
});

test('metadata peeking does not consume an attempt and a claim is scoped to the selected agent and id', async () => {
  const { notices, enqueue, db } = await harness();
  const melodi = await enqueue(), melodi = await enqueue({ key: 'melodi-mail', agent: 'melodi' });
  const pending = await notices.peek({ owner: 'owner-a' });
  assert.equal(pending.length, 2); assert.equal(pending.every(row => row.attempts === 0), true);
  assert.equal(JSON.stringify(pending).includes('owner@example.com'), false);
  assert.equal(pending.some(row => Object.hasOwn(row, 'body')), false);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices WHERE status='leased'").get().n, 0);
  assert.deepEqual(await notices.claim({ owner: 'owner-a', id: melodi.id, agent: 'melodi' }), []);
  const [chosen] = await notices.claim({ owner: 'owner-a', id: melodi.id, agent: 'melodi' });
  assert.equal(chosen.id, melodi.id); assert.equal(chosen.agent, 'melodi');
  assert.equal((await notices.peek({ owner: 'owner-a' }))[0].id, melodi.id);
});

test('window 131047 is held until an explicit owner message reopens the window', async () => {
  const { notices, enqueue, at } = await harness(); await enqueue();
  const [claim] = await notices.claim({ owner: 'owner-a' });
  await notices.finish({ owner: 'owner-a', id: claim.id, token: claim.token, status: 'window_closed' });
  at.value += 7 * 86400000;
  assert.deepEqual(await notices.claim({ owner: 'owner-a' }), []);
  assert.deepEqual(await notices.claim({ owner: 'owner-b', reopensWindow: true }), []);
  assert.equal(await notices.reopenWindow({ owner: 'owner-a' }), 1);
  assert.equal((await notices.peek({ owner: 'owner-a' }))[0].attempts, 1);
  const [reopened] = await notices.claim({ owner: 'owner-a' });
  assert.equal(reopened.id, claim.id); assert.notEqual(reopened.token, claim.token);
  await notices.finish({ owner: 'owner-a', id: reopened.id, token: reopened.token, status: 'sent' });
  assert.deepEqual(await notices.claim({ owner: 'owner-a', reopensWindow: true }), []);
});

test('a timeout or abandoned lease never triggers an automatic duplicate notification', async () => {
  const { notices, enqueue, at, db } = await harness();
  await enqueue(); const [claim] = await notices.claim({ owner: 'owner-a' });
  await notices.finish({ owner: 'owner-a', id: claim.id, token: claim.token, status: 'uncertain' });
  await enqueue({ key: 'another-message' }); const [abandoned] = await notices.claim({ owner: 'owner-a' });
  at.value += 10 * 60000;
  assert.equal(await notices.finish({ owner: 'owner-a', id: abandoned.id, token: abandoned.token, status: 'sent' }), false);
  assert.deepEqual(await notices.peek({ owner: 'owner-a' }), []);
  assert.equal(db.sql.prepare('SELECT status FROM wa_melodi_delivery_notices WHERE id=?').get(abandoned.id).status, 'uncertain');
  assert.deepEqual(await notices.claim({ owner: 'owner-a', reopensWindow: true }), []);
  assert.deepEqual(db.sql.prepare('SELECT status FROM wa_melodi_delivery_notices ORDER BY id').all().map(row => row.status), ['uncertain', 'uncertain']);
});

test('definitive failures retry with bounded backoff and finish uncertain after three attempts', async () => {
  const { notices, enqueue, at, db } = await harness(); await enqueue();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [claim] = await notices.claim({ owner: 'owner-a' }); assert.ok(claim); assert.equal(claim.attempts, attempt);
    assert.equal(await notices.finish({ owner: 'owner-a', id: claim.id, token: claim.token, status: 'pending' }), true);
    assert.deepEqual(await notices.claim({ owner: 'owner-a' }), []);
    at.value += 60000 * 2 ** (attempt - 1);
  }
  assert.equal(db.sql.prepare('SELECT status FROM wa_melodi_delivery_notices').get().status, 'uncertain');
  assert.deepEqual(await notices.claim({ owner: 'owner-a', reopensWindow: true }), []);
});

test('failed decryption quarantines the notice and never exposes untrusted body content', async () => {
  const { notices, enqueue, db } = await harness(); await enqueue();
  db.sql.prepare("UPDATE wa_melodi_delivery_notices SET payload_encrypted='damaged'").run();
  assert.deepEqual(await notices.claim({ owner: 'owner-a' }), []);
  assert.equal(db.sql.prepare('SELECT status FROM wa_melodi_delivery_notices').get().status, 'uncertain');
});
