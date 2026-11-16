import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardProcessorRequest } from '../private-forwarder.js';

const env = { MEDIA_PROCESSOR_TOKEN: 'test-only-token' };
const request = (path, options = {}) => new Request(`https://processor.internal${path}`, { headers: { authorization: 'Bearer test-only-token', ...options.headers }, ...options });
test('only authenticated processor routes forward to the same private container, dropping unrelated headers', async () => {
  let input;
  const result = await forwardProcessorRequest(request(`/v1/artifacts/pm-${'a'.repeat(64)}/m001-frame-1.jpg`, { headers: { authorization: 'Bearer test-only-token', 'x-secret': 'caller-secret' } }), env, { async fetch(value) { input = value; return new Response('ok'); } });
  assert.equal(result.status, 200); assert.equal(new URL(input.url).host, 'container');
  assert.equal(input.headers.get('x-secret'), null); assert.equal(input.headers.get('authorization'), 'Bearer test-only-token');
});
test('missing authentication, unknown routes, queries, traversal and oversized bodies never invoke the container', async () => {
  let calls = 0; const container = { async fetch() { calls++; throw new Error('unexpected'); } };
  for (const value of [request('/health', { headers: {} }), request('/secret'), request('/health?token=secret'),
    request(`/v1/artifacts/pm-${'a'.repeat(64)}/%2e%2e%2fsecret.jpg`), request('/v1/process', { method: 'POST', headers: { authorization: 'Bearer test-only-token', 'content-length': '9000' }, body: '{}' })])
    assert.ok((await forwardProcessorRequest(value, env, container)).status >= 400);
  assert.equal(calls, 0);
});
test('service binding JSON with no content length reaches the Python server with bounded bytes and explicit length', async () => {
  const source = JSON.stringify({ sourceUrl: 'https://www.instagram.com/p/EXACT/', requestId: `pm-${'a'.repeat(64)}` });
  let input;
  assert.equal((await forwardProcessorRequest(request('/v1/process', { method: 'POST', body: source }), env, { async fetch(value) { input = value; return Response.json({ status: 'partial' }); } })).status, 200);
  assert.equal(input.headers.get('content-length'), String(Buffer.byteLength(source)));
  assert.equal(await input.text(), source);
});
