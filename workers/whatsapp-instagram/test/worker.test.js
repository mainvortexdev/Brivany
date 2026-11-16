import assert from 'node:assert/strict';
import test from 'node:test';
import { __test } from '../src/worker.js';

test('normalizes direct-message and comment webhook envelopes without instructions', () => {
  const events = __test.normalizeWebhookEvents({
    entry: [{
      id: '17890000000000001',
      time: 1_789_000_000,
      messaging: [{
        sender: { id: '123' },
        timestamp: 1_789_000_001_000,
        message: { mid: 'mid.1', text: 'Necesito información' },
      }],
      changes: [{
        field: 'comments',
        value: { id: 'comment.1', from: { id: '456' }, media: { id: 'media.1' }, text: 'Envíamelo' },
      }],
    }],
  });

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.kind), ['direct_message', 'comment']);
  assert.equal(events[0].content, 'Necesito información');
  assert.equal(events[1].mediaId, 'media.1');
});

test('accepts only a valid Meta HMAC signature', async () => {
  const secret = 'test-secret';
  const rawBody = '{"object":"instagram"}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const signature = `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

  assert.equal(await __test.verifyMetaSignature(rawBody, signature, secret), true);
  assert.equal(await __test.verifyMetaSignature(rawBody, 'sha256=not-valid', secret), false);
});

test('matches required response phrases without accents or case sensitivity', () => {
  assert.equal(__test.normalizedMatchText('  Envíame   el CATÁLOGO '), 'enviame el catalogo');
  assert.equal(__test.normalizedMatchText('Quiero información').includes(__test.normalizedMatchText('informacion')), true);
});
