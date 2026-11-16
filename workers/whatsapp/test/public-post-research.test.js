import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicInstagramSource } from '../public-post-research.js';

const url = 'https://www.instagram.com/p/POST/?igsh=abc';
const env = { EXA_API_KEY: 'test-api-key' };
const success = { statuses: [{ id: url, status: 'success', source: 'cached' }], results: [{ url, title: 'Formatos', text: 'Comparativa y tutorial: dos formatos de contenido.' }] };

test('known post retrieval requests the exact URL and full bounded text with a per-URL success receipt', async () => {
  let call;
  const result = await readPublicInstagramSource(env, { url }, async (endpoint, options) => {
    call = { endpoint, options, body: JSON.parse(options.body) }; return Response.json(success);
  });
  assert.equal(call.endpoint, 'https://api.exa.ai/contents');
  assert.deepEqual(call.body.urls, [url]);
  assert.equal(call.body.text.maxCharacters, 12000);
  assert.equal(call.body.contents, undefined);
  assert.equal(call.body.highlights, undefined);
  assert.equal(result.results[0].text, success.results[0].text);
  assert.equal(result.results[0].mediaVerified, false);
  assert.equal(result.results[0].complete, false);
  assert.equal(result.results[0].cached, true);
});

test('HTTP success cannot substitute a different post or an unsuccessful extraction', async () => {
  for (const data of [
    { ...success, statuses: [{ id: url, status: 'error', error: { tag: 'SOURCE_NOT_FOUND' } }] },
    { ...success, statuses: [] },
    { ...success, results: [{ ...success.results[0], url: 'https://instagram.com/p/OTHER/' }] },
    { ...success, results: [{ url, highlights: ['Comparativa y tutorial'] }] },
    { ...success, results: [{ url, text: 'Log in' }] },
    { ...success, results: [{ url, text: 'Log in to see photos and videos. Reels and photos on Instagram.' }] },
  ]) assert.deepEqual((await readPublicInstagramSource(env, { url }, async () => Response.json(data))).results, []);
});

test('invalid source, missing credentials, provider rejection and timeout remain honest empty reads', async () => {
  let calls = 0;
  const request = async () => { calls++; throw Error('Timeout'); };
  assert.equal((await readPublicInstagramSource({}, { url }, request)).configured, false);
  assert.deepEqual((await readPublicInstagramSource(env, { url: 'https://evil.test/' }, request)).results, []);
  assert.equal(calls, 0);
  assert.match((await readPublicInstagramSource(env, { url }, async () => Response.json({}, { status: 429 }))).reason, /429/);
  assert.match((await readPublicInstagramSource(env, { url }, request)).reason, /no respondió/);
});
