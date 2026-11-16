import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnerConversationTurn, pendingAfterTurn } from '../owner-turn-runtime.js';
import { ownerTurnSystemPrompt } from '../owner-turn-planner.js';

const OWNER = '18095550101';
const AT = '2026-11-16T12:57:00Z';
const ORIGINAL = 'Para el viernes a las 6 p.m tengo una grabación con Wilma y el sábado a las 8 a.m otra con';

/** Turno mínimo: almacén en memoria y un planificador controlado por la prueba. */
function harness({ plan, pending = null, incoming = ORIGINAL }) {
  const sessions = [], cleared = [], replies = [];
  const saved = new Map();
  const store = {
    load: async (_owner, messageId) => saved.get(messageId) || null,
    savePlan: async (_owner, messageId, _text, storedPlan) => { saved.set(messageId, { plan: storedPlan, answer: '' }); return { plan: storedPlan }; },
    saveAnswer: async () => {},
    actions: () => ({ load: async () => null, save: async () => {}, reserve: async () => true }),
  };
  const services = {
    setOwnerSession: async (_env, phone, type, state) => { sessions.push({ phone, type, state }); },
    clearOwnerSession: async (_env, phone) => { cleared.push(phone); },
  };
  const run = () => runOwnerConversationTurn({ OWNER_WHATSAPP_NUMBER: OWNER, TIME_ZONE: 'America/Santo_Domingo' },
    { phone: OWNER, message: { id: 'm1' }, incoming, referenceAt: AT, recent: [], pending },
    { store, services, reply: body => { replies.push(body); },
      planner: async () => plan,
      render: async () => 'Grabación con Wilma guardada.' });
  return { run, sessions, cleared, replies };
}

test('al preguntar algo conserva el encargo, para que la respuesta se ejecute', async () => {
  const h = harness({ plan: { version: 1, route: 'clarify', agent: 'melodi', contextRelation: 'new_topic',
    answer: '¿Con quién es la grabación del sábado a las 8 a. m.?', actions: [] } });
  await h.run();
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].type, 'await_owner_turn');
  assert.match(h.sessions[0].state.question, /¿Con quién es la grabación del sábado/);
  assert.equal(h.sessions[0].state.originalRequest.text, ORIGINAL, 'el encargo entero sigue vivo');
  assert.equal(h.sessions[0].state.originalRequest.messageId, 'm1');
});

test('una pregunta pendiente junto a acciones también deja el encargo esperando', () => {
  const next = pendingAfterTurn({ plan: { route: 'execute', clarification: '¿Con quién es la del sábado?' }, answer: 'Guardado.', pending: null });
  assert.deepEqual(next, { question: '¿Con quién es la del sábado?', clear: false });
});

test('cuando se ejecuta sin preguntas pendientes, deja de esperar', () => {
  const pendiente = { type: 'await_owner_turn', question: '¿Con quién es la del sábado?' };
  assert.deepEqual(pendingAfterTurn({ plan: { route: 'execute' }, answer: 'Listo.', pending: pendiente }), { question: '', clear: true });
  assert.deepEqual(pendingAfterTurn({ plan: { route: 'reply' }, answer: 'Un sector es un barrio.', pending: pendiente }), { question: '', clear: true });
  // Sin nada esperando no hay que limpiar nada.
  assert.deepEqual(pendingAfterTurn({ plan: { route: 'execute' }, answer: 'Listo.', pending: null }), { question: '', clear: false });
  // Y una aclaración pura mantiene su pregunta viva.
  assert.deepEqual(pendingAfterTurn({ plan: { route: 'clarify' }, answer: '  ¿A qué hora?  ', pending: null }), { question: '¿A qué hora?', clear: false });
});

test('la aclaración se suma al encargo, no lo reemplaza', async () => {
  const pending = { type: 'await_owner_turn', question: '¿Con quién es la del sábado?',
    originalRequest: { text: ORIGINAL, messageId: 'm0', referenceAt: AT } };
  const h = harness({ incoming: 'es con Wilma', pending,
    plan: { version: 1, route: 'clarify', agent: 'melodi', contextRelation: 'continuation',
      answer: '¿A qué hora exactamente?', actions: [] } });
  await h.run();
  const saved = h.sessions.at(-1).state.originalRequest.text;
  assert.ok(saved.includes(ORIGINAL), 'conserva la petición inicial');
  assert.ok(saved.includes('es con Wilma'), 'y le añade el dato aclarado');
});

test('el planificador tiene prohibido volver a pedir permiso con el dato en mano', () => {
  const prompt = ownerTurnSystemPrompt('melodi', {});
  assert.match(prompt, /El dato que faltaba llega para ACTUAR/);
  assert.match(prompt, /no vuelvas a pedir permiso/);
  assert.match(prompt, /pedirlo dos veces es un fallo/);
});
