import test from 'node:test';
import assert from 'node:assert/strict';
import { completeStacyLink, parseStacyLinkMessage, isImageTextRequest, readTextFromStagedImage } from '../owner-features.js';

test('la lectura de texto de una imagen no se confunde con editarla', () => {
  assert.equal(isImageTextRequest('Dame el texto de esta imagen para copiarlo'), true);
  assert.equal(isImageTextRequest('Transcribe el texto de la foto'), true);
  assert.equal(isImageTextRequest('Edita esta imagen y agrega texto'), false);
});

test('la imagen privada se envía a Spaik Sight sin publicarla y devuelve solo la transcripción', async () => {
  let requestBody;
  const imageBytes = new Uint8Array([1, 2, 3]);
  const env = {
    VETSA_INTELLIGENCE_API_KEY: 'test-key',
    VETSA_MEDIA: { async get(key) {
      assert.equal(key, 'private/image');
      return { size: 3, async arrayBuffer() { return imageBytes.buffer; } };
    } },
    VETSA_INTELLIGENCE: { async fetch(request) {
      requestBody = await request.json();
      return Response.json({ text: 'Texto listo para copiar' });
    } },
  };
  const result = await readTextFromStagedImage(env, { objectKey: 'private/image', mimeType: 'image/jpeg', size: 3 });
  assert.equal(result, 'Texto listo para copiar');
  assert.equal(requestBody.model, 'spaik-sight');
  assert.equal(requestBody.options.image, 'data:image/jpeg;base64,AQID');
});

test('WhatsApp pairing accepts only an explicit six-character code and clear confirmation', () => {
  assert.deepEqual(parseStacyLinkMessage('vincular pc JQ6X2F'), { action: 'request', code: 'JQ6X2F' });
  assert.deepEqual(parseStacyLinkMessage('Sí'), { action: 'approve' });
  assert.deepEqual(parseStacyLinkMessage('No'), { action: 'reject' });
  assert.equal(parseStacyLinkMessage('vincular pc ABC123'), null, 'ambiguous characters are not generated');
  assert.equal(parseStacyLinkMessage('sí, abre una web'), null, 'approval must not execute another instruction');
});

test('pairing consumes a fresh, unused code atomically for the WhatsApp sender', async () => {
  let query;
  let args;
  const env = { VETSA_CLOUD: { prepare(sql) {
    query = sql;
    return { bind(...values) {
      args = values;
      return { async run() { return { meta: { changes: 1 } }; } };
    } };
  } } };
  assert.equal(await completeStacyLink(env, '18495205246', 'JQ6X2F'), true);
  assert.match(query, /user_id IS NULL AND link_code_created_at > \?/);
  assert.deepEqual(args.slice(0, 2), ['18495205246', 'JQ6X2F']);
  assert.ok(Date.now() - Date.parse(args[2]) >= 9 * 60_000);
});
