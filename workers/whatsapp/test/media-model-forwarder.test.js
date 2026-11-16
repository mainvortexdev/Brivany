import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardPublicMediaModel } from '../media-model-forwarder.js';
import { PUBLIC_VISUAL_PROMPT } from '../public-media-analysis.js';

const image = `data:image/png;base64,${Buffer.from('\x89PNG\r\n\x1a\n123456789', 'latin1').toString('base64')}`;
const body = { model: 'spaik-sight', contents: '{"frames":[{"index":0,"timestampMs":0}]}', options: { image, systemPrompt: 'caller prompt', max_tokens: 1800 } };
const request = value => new Request('https://media.internal/v1/generate', { method: 'POST', headers: { 'x-api-key': 'untrusted-caller' }, body: JSON.stringify(value) });

test('private model forwarder uses the existing provider secret and fixed visual evidence prompt', async () => {
  let received;
  const env = { VETSA_INTELLIGENCE_API_KEY: 'provider-secret', VETSA_INTELLIGENCE: { async fetch(req) { received = req; return Response.json({ text: '{}' }); } } };
  const response = await forwardPublicMediaModel(request(body), env);
  assert.equal(response.status, 200);
  assert.equal(received.headers.get('x-api-key'), 'provider-secret');
  const payload = await received.json();
  assert.equal(payload.options.systemPrompt, PUBLIC_VISUAL_PROMPT);
  assert.equal(payload.options.jsonMode, true);
  assert.equal(payload.options.temperature, 0);
  assert.equal(payload.options.image, image);
  assert.equal(response.headers.get('x-api-key'), null);
});

test('model forwarder rejects remote downloads, audio, other models and invalid image bytes before effects', async () => {
  let calls = 0;
  const env = { VETSA_INTELLIGENCE_API_KEY: 'secret', VETSA_INTELLIGENCE: { fetch() { calls++; throw new Error('unexpected'); } } };
  for (const value of [
    { ...body, model: 'spaik-v1' },
    { ...body, options: { image: 'https://internal.invalid/secret' } },
    { ...body, options: { image, audio: 'data:audio/wav;base64,AAAA' } },
    { ...body, options: { image: 'data:image/png;base64,QUFBQUFBQUFBQUFB' } },
    { ...body, options: { image, max_tokens: 10000 } },
    { ...body, contents: 'a'.repeat(32001) },
  ]) assert.equal((await forwardPublicMediaModel(request(value), env)).status, 400);
  assert.equal(calls, 0);
});

test('forwarder does not return provider errors or secrets and bounds streamed output', async () => {
  for (const output of [new Response('secret upstream error', { status: 401 }), new Response('x'.repeat(1_000_001))]) {
    const response = await forwardPublicMediaModel(request(body), { VETSA_INTELLIGENCE_API_KEY: 'secret', VETSA_INTELLIGENCE: { async fetch() { return output; } } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'media_models_unavailable' });
  }
});

test('forwarder accepts only the private model method and path', async () => {
  assert.equal((await forwardPublicMediaModel(new Request('https://media.internal/v1/generate'), {})).status, 404);
  assert.equal((await forwardPublicMediaModel(new Request('https://media.internal/v1/other', { method: 'POST' }), {})).status, 404);
});
