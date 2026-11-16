import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOwnerTurnPlan, ownerTurnSystemPrompt } from '../owner-turn-planner.js';
import { renderOwnerActionResponse } from '../owner-turn-response.js';
import { ownerActionToolCatalog } from '../owner-action-plan-executor.js';
import { isHeardAudio, hearOwnerAudio, HEARD_AUDIO_LIMITS } from '../melodi-heard-audio.js';

const AT = '2026-11-16T12:00:00Z';
const context = { message: { id: 'm1', text: 'El viernes a las 6 p.m. grabación con Wilma y el sábado a las 8 a.m. otra con' } };
const base = {
  version: 1, route: 'execute', agent: 'melodi', contextRelation: 'new_topic',
  // Una acción simple basta: lo que se prueba es la pregunta pendiente.
  actions: [{ id: 'a1', tool: 'memory.save', input: { text: 'Grabación con Wilma el viernes a las 6 p.m.' },
    dependsOn: [], requestSource: { text: 'El viernes a las 6 p.m. grabación con Wilma' } }],
};
// El catálogo real del ejecutor, para validar contra el esquema de verdad.
const catalog = ownerActionToolCatalog({ env: {} },
  { storeExactMemory: () => {}, getMemoryItem: () => {} });

test('lo completo se agenda y la pregunta es sólo por lo que falta', () => {
  const plan = validateOwnerTurnPlan({ ...base, clarification: '¿Con quién es la grabación del sábado a las 8 a. m.?' }, context, catalog);
  assert.equal(plan.route, 'execute');
  assert.equal(plan.actions.length, 1, 'el viernes no se pierde por esperar el sábado');
  assert.equal(plan.answer, '', 'no afirma nada antes de los recibos');
  assert.equal(plan.clarification, '¿Con quién es la grabación del sábado a las 8 a. m.?');
  assert.match(ownerTurnSystemPrompt('melodi', {}), /usa execute con las acciones de los completos/);
});

test('la pregunta pendiente llega después de lo ya confirmado', async () => {
  const plan = validateOwnerTurnPlan({ ...base, clarification: '¿Con quién es la del sábado?' }, context, catalog);
  const answer = await renderOwnerActionResponse({}, {
    message: context.message, plan,
    outcome: { status: 'committed', results: [{ id: 'a1', tool: 'memory.save', state: 'committed', data: {},
      receipt: { tool: 'memory.save', status: 'persisted', operationId: 'ev-1', verified: true } }] },
    recent: [], referenceAt: AT, timeZone: 'America/Santo_Domingo',
  }, { infer: async () => { throw new Error('no hace falta otro modelo'); } });
  const [confirmation, question] = answer.split('\n\n');
  assert.match(confirmation, /Guardé la nota/i, 'primero lo que quedó hecho');
  assert.equal(question, '¿Con quién es la del sábado?', 'y al final lo que falta');
});

test('una pregunta pendiente no puede afirmar lo que aún no tiene recibo', () => {
  for (const invalid of ['Ya agendé las dos. ¿Algo más?', 'Sin pregunta', '¿Una? ¿Y dos?']) {
    assert.throws(() => validateOwnerTurnPlan({ ...base, clarification: invalid }, context, catalog), /owner_turn_/);
  }
  // Y sigue sin poder mezclarse con las rutas que no ejecutan nada.
  assert.throws(() => validateOwnerTurnPlan({ version: 1, route: 'reply', agent: 'melodi', contextRelation: 'new_topic',
    answer: 'Listo.', actions: [], clarification: '¿Y el sábado?' }, context, catalog), /mixed_routes/);
});

test('sin nada que preguntar el turno se comporta igual que antes', async () => {
  const plan = validateOwnerTurnPlan(base, context, catalog);
  assert.equal(plan.clarification, undefined);
  const answer = await renderOwnerActionResponse({}, {
    message: context.message, plan,
    outcome: { status: 'committed', results: [{ id: 'a1', tool: 'memory.save', state: 'committed', data: {},
      receipt: { tool: 'memory.save', status: 'persisted', operationId: 'ev-1', verified: true } }] },
    recent: [], referenceAt: AT, timeZone: 'America/Santo_Domingo',
  }, { infer: async () => { throw new Error('no hace falta'); } });
  assert.ok(!answer.includes('¿'), 'sin pregunta pendiente no se inventa ninguna');
});

test('una nota de voz se reconoce y se escucha antes de decidir el turno', async () => {
  assert.equal(isHeardAudio({ type: 'audio', audio: { id: 'a1' } }, ''), true);
  assert.equal(isHeardAudio({ type: 'audio', audio: { id: 'a1' } }, 'con texto'), false, 'con pie de foto manda el texto');
  assert.equal(isHeardAudio({ type: 'image', image: { id: 'i1' } }, ''), false);
  assert.equal(isHeardAudio(null, ''), false);

  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const env = { VETSA_MEDIA: { get: async () => ({ arrayBuffer: async () => bytes.buffer }) } };
  const calls = [];
  const heard = await hearOwnerAudio(env, { objectKey: 'k' }, { run: (model, input) => { calls.push({ model, input }); return { text: '  Agrega  grabación con Camilla \n a las 11:15  ' }; } });
  assert.equal(heard, 'Agrega grabación con Camilla a las 11:15', 'lo dicho entra limpio como texto del turno');
  assert.equal(calls[0].model, '@cf/openai/whisper-large-v3-turbo');
  assert.equal(calls[0].input.language, 'es');
});

test('un audio que no se puede escuchar no inventa contenido', async () => {
  const env = { VETSA_MEDIA: { get: async () => ({ arrayBuffer: async () => new Uint8Array(0).buffer }) } };
  assert.equal(await hearOwnerAudio(env, { objectKey: 'k' }, { run: () => ({ text: 'algo' }) }), '', 'un audio vacío no se transcribe');
  assert.equal(await hearOwnerAudio({ VETSA_MEDIA: { get: async () => null } }, { objectKey: 'k' }, { run: () => ({ text: 'algo' }) }), '');
  assert.equal(await hearOwnerAudio({}, { objectKey: 'k' }), '', 'sin transcriptor no hay texto');
  const big = { VETSA_MEDIA: { get: async () => ({ arrayBuffer: async () => new Uint8Array(HEARD_AUDIO_LIMITS.bytes + 1).buffer }) } };
  assert.equal(await hearOwnerAudio(big, { objectKey: 'k' }, { run: () => ({ text: 'algo' }) }), '', 'un audio enorme se descarta');
  const env2 = { VETSA_MEDIA: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) } };
  assert.equal(await hearOwnerAudio(env2, { objectKey: 'k' }, { run: () => ({ text: '   ' }) }), '');
});
