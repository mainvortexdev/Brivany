import test from 'node:test';
import assert from 'node:assert/strict';
import { job_generate_image } from '../executors/jobs/creative.js';
import { edit_image } from '../executors/creative.js';

const OWNER = '18095550101';
const IMAGE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** Entorno mínimo con el almacén de medios y la sesión del titular en memoria. */
function harness() {
  const media = new Map();
  const sessions = new Map();
  const sent = [], replies = [], jobs = [];
  return {
    media, sessions, sent, replies, jobs,
    env: { VETSA_MEDIA: { put: async (key, bytes, meta) => { media.set(key, { bytes, meta }); } }, MEMORY_ENCRYPTION_KEY: 'x' },
    services: {
      base64ToBytes: () => IMAGE,
      callVetsa: async () => ({ imageBase64: 'zzz', mimeType: 'image/jpeg' }),
      ownerImageGenerationReferences: async () => ({}),
      sendWhatsAppMedia: async (_env, phone, kind, bytes, mimeType, name, caption) => { sent.push({ phone, kind, mimeType, name, caption, size: bytes.length }); return { status: 'sent', messageId: 'wamid.img' }; },
      rememberGeneratedImage: async (_env, phone, bytes, mimeType) => {
        const objectKey = `melodi-private/${phone}/generada`;
        media.set(objectKey, { bytes, meta: { mimeType } });
        const reference = { kind: 'image', objectKey, mimeType, name: 'melodi-imagen.jpg', generated: true };
        sessions.set(phone, { type: 'staging', state: { refs: [reference], sourceMessageId: `generated-${objectKey}` } });
        return reference;
      },
      cleanText: value => String(value || ''),
      setOwnerSession: async (_env, phone, type, state) => { sessions.set(phone, { type, state }); },
      storeIncomingMedia: async () => ({ kind: 'image', objectKey: 'entrante', mimeType: 'image/jpeg' }),
      enqueueOwnerJob: async (_env, phone, type, payload) => { jobs.push({ phone, type, payload }); },
    },
  };
}

const reply = harness => body => { harness.replies.push(body); };

test('la imagen generada se entrega y además queda guardada para seguir sobre ella', async () => {
  const h = harness();
  await job_generate_image({ env: h.env, row: { owner_phone: OWNER }, payload: { prompt: 'un colmado de Bonao al atardecer' }, jobId: 'job-1' }, h.services);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].kind, 'image');
  const staged = h.sessions.get(OWNER);
  assert.equal(staged.type, 'staging', 'queda como imagen en curso');
  assert.equal(staged.state.refs[0].kind, 'image');
  assert.equal(staged.state.refs[0].generated, true);
  assert.ok(h.media.has(staged.state.refs[0].objectKey), 'la imagen está guardada, no sólo enviada');
});

test('un cambio pedido después trabaja sobre esa imagen sin pedir que la reenvíe', async () => {
  const h = harness();
  await job_generate_image({ env: h.env, row: { owner_phone: OWNER }, payload: { prompt: 'un colmado' }, jobId: 'job-1' }, h.services);
  const stagedImage = h.sessions.get(OWNER).state.refs.find(ref => ref.kind === 'image' && ref.objectKey);

  await edit_image({ interpretation: { intent: 'edit_image' }, descriptor: null, stagedImage,
    reply: reply(h), normalized: 'ponle el cielo más anaranjado', env: h.env, phone: OWNER, message: { id: 'm2' } }, h.services);

  assert.equal(h.jobs.length, 1, 'el cambio se encola');
  assert.equal(h.jobs[0].type, 'edit_image');
  assert.equal(h.jobs[0].payload.source.objectKey, stagedImage.objectKey, 'trabaja sobre la imagen que ella generó');
  assert.match(h.jobs[0].payload.prompt, /cielo más anaranjado/);
  assert.ok(!h.replies.some(body => /Envíame la imagen/.test(body)), 'no debe pedir que la reenvíe');
});

test('sin ninguna imagen sí pide que le envíe una', async () => {
  const h = harness();
  await edit_image({ interpretation: { intent: 'edit_image' }, descriptor: null, stagedImage: null,
    reply: reply(h), normalized: 'hazla más clara', env: h.env, phone: OWNER, message: { id: 'm1' } }, h.services);
  assert.equal(h.jobs.length, 0);
  assert.match(h.replies.at(-1), /Envíame la imagen/);
  assert.equal(h.sessions.get(OWNER).type, 'await_image_edit', 'conserva la petición mientras espera');
});
