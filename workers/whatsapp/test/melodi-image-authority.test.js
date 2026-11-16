import test from 'node:test';
import assert from 'node:assert/strict';
import { continueImageEdit, editStagedImage, edit_image } from '../executors/creative.js';

test('image edit continuations request authority before media, clearing state or queue writes', async () => {
  const effects = [], grants = [];
  const services = { cleanText: value => value, storeIncomingMedia: async () => effects.push('media'),
    clearOwnerSession: async () => effects.push('clear'), enqueueOwnerJob: async () => effects.push('queue'),
    classifyAttachedImageEdit: async () => ({ edit: true, prompt: 'different model paraphrase', mode: 'edit' }) };
  const context = { env: {}, phone: 'owner', reply: async () => effects.push('reply'),
    authorizeImageEdit: async input => { grants.push(input); return false; } };
  assert.equal(await continueImageEdit({ ...context, descriptor: { kind: 'image' }, session: {
    type: 'await_image_edit', state: { prompt: 'Texto original ñ', mode: 'edit' } } }, services), true);
  assert.equal(await editStagedImage({ ...context, stagedImage: { objectKey: 'private/image' }, normalized: 'Edita el título literal ñ' }, services), true);
  assert.deepEqual(effects, []);
  assert.equal(grants[0].prompt, 'Texto original ñ');
  assert.equal(grants[1].prompt, 'Edita el título literal ñ');
  assert.equal(grants[1].source.objectKey, 'private/image');
});

test('approved image edit uses the original staged source and literal prompt', async () => {
  const jobs = [];
  const source = { objectKey: 'owner/original.png', mimeType: 'image/png' };
  const handled = await edit_image({ interpretation: { intent: 'edit_image', agent: 'melodi', imageEditMode: 'edit' },
    stagedImage: source, normalized: 'Cambia «Melodi» por «Melodi» con los acentos exactos ñ', env: {}, phone: 'owner', reply: async () => {} }, {
    cleanText: value => value, enqueueOwnerJob: async (_env, _phone, type, payload) => jobs.push({ type, payload }),
    storeIncomingMedia: async () => assert.fail('Do not replace the approved source'),
    setOwnerSession: async () => assert.fail('Source is already available'),
  });
  assert.equal(handled, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, 'edit_image');
  assert.deepEqual(jobs[0].payload.source, source);
  assert.match(jobs[0].payload.prompt, /Cambia «Melodi» por «Melodi»/);
});
