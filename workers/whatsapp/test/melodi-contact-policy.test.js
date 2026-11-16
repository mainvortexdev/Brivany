import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createContactPolicy, parseOwnerContactPreference } from '../melodi-contact-policy.js';

class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const make = values => ({ bind: (...next) => make(next), query, values,
      run: async () => ({ meta: { changes: this.sql.prepare(query).run(...values).changes } }),
      first: async () => this.sql.prepare(query).get(...values) ?? null });
    return make([]);
  }
  async batch(statements) { return statements.map(row => this.sql.prepare(row.query).run(...row.values)); }
}

async function setup() {
  const db = new D1();
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
  const policy = createContactPolicy(db, hooks);
  await policy.ensureSchema();
  return { db, policy, hooks };
}

test('direct topic directives persist while goal cancellation and quoted instructions stay outside the parser', () => {
  for (const text of ['Olvida Instagram', 'Melodi, no me hables más de Instagram.', 'Deja de investigar Instagram', 'Ya no quiero que me hables de Instagram'])
    assert.deepEqual(parseOwnerContactPreference(text), { action: 'contact_preference', topic: 'instagram', blocked: true });
  assert.deepEqual(parseOwnerContactPreference('Vuelve a investigar Instagram'), { action: 'contact_preference', topic: 'instagram', blocked: false });
  for (const text of ['Olvida el objetivo Cognira', 'Olvida este proyecto', 'El documento dice: olvida Instagram', 'Resumen:\nOlvida Instagram', 'Crea un artículo titulado «Olvida Instagram»'])
    assert.equal(parseOwnerContactPreference(text), null);
  assert.deepEqual(parseOwnerContactPreference('Solo escríbeme cuando te lo pida'), { action: 'contact_preference', unsolicited: false });
});

test('an exclusion survives a new runtime, is encrypted, owner isolated and resumes only by an explicit directive', async () => {
  const { db, policy, hooks } = await setup();
  await policy.update('owner-a', parseOwnerContactPreference('olvida Instagram'));
  const restarted = createContactPolicy(db, hooks);
  assert.equal(await restarted.permits('owner-a', 'Me gustaría investigar INSTAGRAM.'), false);
  assert.equal(await restarted.permits('owner-b', 'Instagram'), true);
  assert.equal(await restarted.permits('owner-a', 'El vídeo de Drive está exportado.'), true);
  assert.doesNotMatch(JSON.stringify(db.sql.prepare('SELECT * FROM wa_owner_contact_preferences').get()), /instagram/i);
  await restarted.update('owner-a', parseOwnerContactPreference('retoma Instagram'));
  assert.equal(await policy.permits('owner-a', 'Instagram'), true);
});

test('concurrent preference writes preserve every excluded topic', async () => {
  const { policy } = await setup();
  await Promise.all(['instagram', 'tiktok', 'motivación'].map(topic => policy.update('owner-a', { topic, blocked: true })));
  assert.deepEqual((await policy.read('owner-a')).blockedTopics.sort(), ['instagram', 'motivacion', 'tiktok']);
  assert.equal((await policy.read('owner-a')).unsolicited, false);
});

test('a durable atomic receipt deduplicates the same result across agents and restarts but permits another task', async () => {
  const { db, policy, hooks } = await setup();
  const claims = await Promise.all([
    policy.claimDelivery({ owner: 'owner-a', body: 'Melodi: Tu vídeo está listo.', scope: 'job-1' }),
    policy.claimDelivery({ owner: 'owner-a', body: 'Melodi: Tu vídeo está listo.', scope: 'job-1' }),
  ]);
  assert.equal(claims.filter(Boolean).length,1,'exactly one racing claimant wins regardless of hash completion order');
  const first=claims.find(Boolean);
  await policy.finishDelivery({ owner: 'owner-a', ...first, status: 'uncertain' });
  assert.equal(await createContactPolicy(db, hooks).claimDelivery({ owner: 'owner-a', body: 'Tu vídeo está listo.', scope: 'job-1' }), null);
  assert.ok(await policy.claimDelivery({ owner: 'owner-a', body: 'Tu vídeo está listo.', scope: 'job-2' }));
  assert.ok(await policy.claimDelivery({ owner: 'owner-b', body: 'Tu vídeo está listo.', scope: 'job-1' }));
  assert.doesNotMatch(JSON.stringify(db.sql.prepare('SELECT * FROM wa_contact_delivery_receipts').all()), /video|listo/i);
});

test('only a confirmed transport rejection frees a delivery receipt for retry', async () => {
  const { policy } = await setup();
  const request = { owner: 'owner-a', body: 'Archivo subido.', scope: 'job-1' };
  const receipt = await policy.claimDelivery(request);
  await policy.finishDelivery({ owner: 'other-owner', ...receipt, status: 'rejected' });
  assert.equal(await policy.claimDelivery(request), null);
  await policy.finishDelivery({ owner: 'owner-a', ...receipt, status: 'rejected' });
  assert.ok(await policy.claimDelivery(request));
});
