import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicMediaClient } from '../public-media-client.js';

const scope = { ownerPhone: '18495205246', agent: 'melodi', eventId: 'event-original-1', url: 'https://www.instagram.com/p/DeKDpi8gii8/?stkn=tracking==' };
const operationId = `pm-${'a'.repeat(64)}`;
const receipt = (status, overrides = {}) => ({ status, verified: true, ownerPhone: scope.ownerPhone, agent: scope.agent, eventId: scope.eventId, sourceUrl: scope.url, operationId, ...overrides });
const envFor = fetch => ({ OWNER_WHATSAPP_NUMBER: scope.ownerPhone, PUBLIC_MEDIA_ANALYSIS_ENABLED: 'true', VETSA_PUBLIC_MEDIA: { fetch } });

test('media client preserves the selected agent, original event, exact source and operation while polling', async () => {
  const inputs = [];
  const read = createPublicMediaClient(envFor(async request => { inputs.push(await request.json()); return Response.json(receipt(inputs.length === 1 ? 'pending' : 'ready', inputs.length === 1 ? {} : { media: [{ id: 'image-1' }] })); }));
  const pending = await read(scope);
  assert.equal(pending.operationId, operationId);
  const ready = await read({ ...scope, operationId });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(inputs, [scope, { ...scope, operationId }]);
});

test('media client rejects mismatched scope, source and operation before evidence can enter a report', async () => {
  for (const mismatch of [{ agent: 'melodi' }, { ownerPhone: '111' }, { eventId: 'other-event' }, { sourceUrl: 'https://www.instagram.com/p/other/' }, { operationId: `pm-${'b'.repeat(64)}` }]) {
    const read = createPublicMediaClient(envFor(async () => Response.json(receipt('pending', mismatch))));
    assert.equal((await read({ ...scope, operationId })).reason, 'media_scope_mismatch');
  }
});

test('media client requires verified operation and media and cancels oversized responses', async () => {
  for (const [result, reason] of [[receipt('pending', { operationId: 'uuid' }), 'media_operation_unverified'], [receipt('ready', { media: [] }), 'media_result_unverified'], [receipt('ready', { media: [{}], verified: false }), 'media_result_unverified']]) {
    assert.equal((await createPublicMediaClient(envFor(async () => Response.json(result)))(scope)).reason, reason);
  }
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel() { cancelled = true; } });
  const result = await createPublicMediaClient(envFor(async () => new Response(stream)))(scope);
  assert.equal(result.reason, 'media_backend_unavailable');
  assert.equal(cancelled, true);
});

test('only a disconnected backend permits the explicit text fallback', async () => {
  assert.equal((await createPublicMediaClient({ OWNER_WHATSAPP_NUMBER: scope.ownerPhone })(scope)).textFallbackAllowed, true);
  for (const reason of ['backend_not_connected', 'processor_auth_failed', 'public_media_unavailable']) {
    const result = await createPublicMediaClient(envFor(async () => Response.json(receipt('blocked', { reason, verified: false, textFallbackAllowed: true }))))(scope);
    assert.equal(result.textFallbackAllowed, reason === 'backend_not_connected');
  }
});

test('scope violations never call a backend even when connected', async () => {
  let calls = 0;
  const read = createPublicMediaClient(envFor(() => { calls++; throw new Error('unexpected'); }));
  for (const value of [{ ...scope, agent: 'unknown' }, { ...scope, ownerPhone: 'other' }, { ...scope, url: 'https://localhost/secret' }, { ...scope, eventId: '../bad' }]) {
    assert.equal((await read(value)).reason, 'media_scope_invalid');
  }
  assert.equal(calls, 0);
});
