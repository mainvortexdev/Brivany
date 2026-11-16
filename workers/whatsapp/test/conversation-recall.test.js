import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceD1, OWNER } from './finance-fixture.js';
import { createEncryptedConversationStore } from '../encrypted-conversation-store.js';

async function store() {
  const db = new FinanceD1();
  // Las tablas base existen en el esquema del Worker; el almacén sólo añade sus
  // columnas cifradas y su índice ciego sobre ellas.
  db.sql.exec('CREATE TABLE wa_conversation(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);'
    + 'CREATE TABLE wa_memory(phone TEXT PRIMARY KEY,memory_text TEXT NOT NULL,summarized_through_id INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const services = {
    // El almacén sella objetos y textos; se serializa igual que en el Worker.
    async encrypt(value) {
      const plain = typeof value === 'string' ? value : JSON.stringify(value);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { encrypted: Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))).toString('base64'),
        iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(value, iv) {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(value, 'base64')));
    },
    indexKey: Buffer.alloc(32, 7).toString('base64'),
  };
  return createEncryptedConversationStore(db, services);
}

/** Una conversación larga con un tema concreto enterrado al principio. */
async function longThread(conversation) {
  await conversation.append({ owner: OWNER, role: 'user', content: 'El cliente de la cotización de Falcondo se llama Ramírez y paga en febrero.', sourceId: 'm1' });
  await conversation.append({ owner: OWNER, role: 'assistant', content: 'Anotado: Ramírez, cotización de Falcondo, pago en febrero.', sourceId: 'm2' });
  for (let turn = 0; turn < 30; turn++) {
    await conversation.append({ owner: OWNER, role: 'user', content: `Charla corriente número ${turn} sobre cosas del día.`, sourceId: `u${turn}` });
    await conversation.append({ owner: OWNER, role: 'assistant', content: `Respuesta corriente número ${turn}.`, sourceId: `a${turn}` });
  }
}

test('una ventana amplia conserva los últimos turnos en orden', async () => {
  const conversation = await store();
  await longThread(conversation);
  const recent = await conversation.history(OWNER, { limit: 24 });
  assert.equal(recent.length, 24);
  assert.match(recent.at(-1).content, /Respuesta corriente número 29/);
  assert.equal(recent[0].role, 'user', 'la ventana empieza en un turno completo del hilo');
});

test('recupera un tema antiguo por sus palabras distintivas, no por las corrientes', async () => {
  const conversation = await store();
  await longThread(conversation);
  // La pregunta llega 60 turnos después y fuera de la ventana reciente.
  const found = await conversation.search(OWNER, '¿Cómo se llamaba el cliente de la cotización de Falcondo?', { limit: 6 });
  const texts = found.map(turn => turn.content).join('\n');
  assert.match(texts, /Ramírez/, 'debe encontrar el turno con el nombre del cliente');
  assert.match(texts, /Falcondo/);
});

test('encuentra el tema aunque la palabra que lo distingue llegue al final', async () => {
  const conversation = await store();
  await longThread(conversation);
  // Caso que fallaba antes: la búsqueda tomaba los cinco primeros términos del
  // mensaje —quiero, saber, sobre, aquello, hablamos—, ninguno presente en el
  // turno buscado, y devolvía charla. «Ramírez» llega el último y es el único
  // término que de verdad identifica el tema.
  const found = await conversation.search(OWNER, 'Quiero saber sobre aquello que hablamos antes, cuando mencionaste al cliente Ramírez', { limit: 6 });
  assert.ok(found.some(turn => /Ramírez/.test(turn.content)), 'el término final debe pesar más que los corrientes');
  assert.ok(!found.every(turn => /Charla corriente/.test(turn.content)));
});

test('las palabras de uso corriente no arrastran la conversación entera', async () => {
  const conversation = await store();
  await longThread(conversation);
  // «quiero», «sobre», «cosas» aparecen por todas partes: sin selección de
  // términos, una pregunta así devolvía charla en lugar del tema buscado.
  const noisy = await conversation.search(OWNER, 'quiero saber sobre la cotización', { limit: 6 });
  assert.ok(noisy.length > 0);
  assert.ok(noisy.some(turn => /cotización/i.test(turn.content)), 'el término distintivo manda');
  assert.ok(!noisy.every(turn => /Charla corriente/.test(turn.content)), 'no devuelve sólo charla');
});

test('la compaction avanza su marca y conserva lo pendiente', async () => {
  const conversation = await store();
  await longThread(conversation);
  const pending = await conversation.pendingMemory(OWNER, { minTurns: 10, limit: 40 });
  assert.ok(pending, 'con 62 turnos hay material que compactar');
  assert.equal(pending.memory_text, '');
  assert.ok(pending.rows.length >= 10);

  const through = pending.rows.at(-1).id;
  await conversation.saveMemory({ owner: OWNER, memoryText: 'Cliente Ramírez, cotización de Falcondo, pago en febrero.', throughId: through });
  const saved = await conversation.memory(OWNER);
  assert.match(saved.memory_text, /Ramírez/);
  assert.equal(saved.summarized_through_id, through);

  // Lo ya resumido no se vuelve a compactar; sólo lo posterior queda pendiente.
  const next = await conversation.pendingMemory(OWNER, { minTurns: 10, limit: 40 });
  assert.ok(next === null || next.rows.every(row => row.id > through));
});
