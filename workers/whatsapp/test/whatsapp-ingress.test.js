import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptWhatsAppMessages } from '../whatsapp-ingress.js';
import worker from '../worker.js';

const OWNER = '18095550101';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(message = {}) {
  const work = [], calls = [];
  const env = { OWNER_WHATSAPP_NUMBER: OWNER, WHATSAPP_PHONE_NUMBER_ID: 'official', TEAM_CONVERSATION_LEADER: 'melodi',
    MELODI_JOBS: { async send() { calls.push('queued'); } } };
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'official' }, messages: [
    { id: 'wa-1', from: OWNER, type: 'text', text: { body: 'Recuérdame mañana a las 7 imprimir' }, ...message },
  ] } }] }] };
  const ctx = { waitUntil(promise) { work.push(promise); } };
  const hooks = { markRead: async () => { calls.push('read'); }, isFast: () => true,
    processFast: async () => { calls.push('fast'); } };
  return { env, payload, ctx, hooks, work, calls };
}

test('read starts while durable enqueue is still pending; execution waits for durable acceptance', async () => {
  const f = fixture(), queued = deferred(), read = deferred();
  f.env.MELODI_JOBS.send = async () => { await queued.promise; f.calls.push('queued'); };
  f.hooks.markRead = async () => { f.calls.push('read'); await read.promise; };
  const accepted = acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks);
  await Promise.resolve();
  assert.deepEqual(f.calls, ['read']);
  queued.resolve();
  await accepted;
  assert.deepEqual(f.calls, ['read', 'queued', 'fast']);
  read.resolve();
  await Promise.all(f.work);
});

test('every valid inbound message is read immediately, including public senders and non-text media', async () => {
  for (const change of [{ from: '18095559999' }, { type: 'audio', text: undefined }]) {
    const f = fixture(change);
    await acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks);
    await Promise.all(f.work);
    assert.ok(f.calls.includes('read'));
    assert.ok(f.calls.includes('queued'));
    assert.ok(!f.calls.includes('fast'));
  }
});

test('complex, quoted and non-leader requests keep the durable consumer route', async () => {
  for (const kind of ['complex', 'quoted', 'legacy']) {
    const f = fixture(kind === 'quoted' ? { context: { id: 'older' } } : {});
    if (kind === 'complex') f.hooks.isFast = () => false;
    if (kind === 'legacy') f.env.TEAM_CONVERSATION_LEADER = '';
    await acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks);
    await Promise.all(f.work);
    assert.deepEqual([...f.calls].sort(), ['queued', 'read']);
  }
});

test('a failed read receipt does not delay or drop the queued request', async () => {
  const f = fixture();
  f.hooks.markRead = async () => { throw Error('Meta unavailable'); };
  await acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks);
  await Promise.all(f.work);
  assert.deepEqual(f.calls, ['queued', 'fast']);
});

test('enqueue rejection never starts an unprotected action', async () => {
  const f = fixture();
  f.env.MELODI_JOBS.send = async () => { throw Error('queue unavailable'); };
  await assert.rejects(acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks), /queue unavailable/);
  await Promise.all(f.work);
  assert.deepEqual(f.calls, ['read']);
});

test('status callbacks, malformed messages and other business phones do not trigger read or work', async () => {
  const f = fixture();
  f.payload.entry[0].changes[0].value.metadata.phone_number_id = 'foreign';
  await acceptWhatsAppMessages(f.env, f.payload, f.ctx, f.hooks);
  await acceptWhatsAppMessages(f.env, { entry: [{ changes: [{ value: { statuses: [{ id: 'wa-1' }] } }] }] }, f.ctx, f.hooks);
  assert.deepEqual(f.calls, []);
});

test('the real authenticated webhook requests read before enqueue completes, without waiting for Meta', async t => {
  const f = fixture({ text: { body: 'Hola' } }), queued = deferred(), readResponse = deferred(), readStarted = deferred();
  f.env.META_APP_SECRET = 'synthetic-test-secret';
  f.env.MELODI_JOBS.send = () => queued.promise;
  const raw = JSON.stringify(f.payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.META_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const signature = 'sha256=' + Buffer.from(signed).toString('hex');
  const graphCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /^https:\/\/graph\.facebook\.com\//);
    const body = JSON.parse(options.body); graphCalls.push(body); readStarted.resolve();
    return readResponse.promise;
  });
  const request = () => new Request('https://ia.vetsa.es/webhook', { method: 'POST', body: raw,
    headers: { 'x-hub-signature-256': signature } });
  const response = worker.fetch(request(), f.env, f.ctx);
  await readStarted.promise;
  assert.equal(graphCalls[0].status, 'read');
  assert.equal(graphCalls[0].message_id, 'wa-1');
  assert.equal(graphCalls[0].typing_indicator, undefined);
  queued.resolve();
  assert.equal((await response).status, 200, 'Meta read response does not hold the webhook open');
  readResponse.resolve(Response.json({ success: true }));
  await Promise.all(f.work);
  assert.equal(graphCalls.length, 1);
});

test('a forged webhook never reads messages or enqueues work', async t => {
  const f = fixture();
  f.env.META_APP_SECRET = 'synthetic-test-secret';
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('forged webhook reached Meta'); });
  const response = await worker.fetch(new Request('https://ia.vetsa.es/webhook', {
    method: 'POST', body: JSON.stringify(f.payload), headers: { 'x-hub-signature-256': 'sha256=forged' },
  }), f.env, f.ctx);
  assert.equal(response.status, 401);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.work, []);
});
