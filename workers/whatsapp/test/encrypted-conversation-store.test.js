import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createEncryptedConversationStore } from '../encrypted-conversation-store.js';
import worker, { askSpaik, refreshConversationMemory } from '../worker.js';

const OWNER = '18095550111', OTHER = '18095550222', AT = '2026-10-17T15:00:00.000Z';
class D1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:'); this.events = []; this.before = null; this.after = null;
    this.sql.exec(`CREATE TABLE wa_conversation(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE wa_memory(phone TEXT PRIMARY KEY,memory_text TEXT NOT NULL,summarized_through_id INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE wa_conversation_search USING fts5(phone UNINDEXED,role UNINDEXED,content,created_at UNINDEXED);`);
  }
  prepare(sql) {
    const db = this;
    const executeFor = values => kind => {
      const event = { sql, values, kind }; db.before?.(event); db.events.push(event);
      const prepared = db.sql.prepare(sql);
      const result = kind === 'run' ? { meta: { changes: Number(prepared.run(...values).changes) } }
        : kind === 'first' ? prepared.get(...values) || null : { results: prepared.all(...values) };
      db.after?.({ ...event, result }); return result;
    };
    // Each bind call has its own immutable arguments, as a D1 prepared statement.
    const bound = values => { const execute = executeFor(values); return {
      sql, values,
      bind: (...next) => bound(next), async run() { return execute('run'); },
      async first() { return execute('first'); }, async all() { return execute('all'); },
    }; };
    return bound([]);
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const result=statements.map(({sql,values})=>{
        const prepared=this.sql.prepare(sql);
        return prepared.columns().length ? {results:prepared.all(...values),meta:{changes:Number(this.sql.prepare('SELECT changes() AS n').get().n)}}
          : {results:[],meta:{changes:Number(prepared.run(...values).changes)}};
      });
      this.sql.exec('COMMIT'); return result;
    } catch(error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
async function fixture({ stringPayload = false, overrides = {} } = {}) {
  const db = new D1(), bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const hooks = {
    indexKey: Buffer.from(bytes).toString('base64'), now: () => AT,
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(value, iv) {
      const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(value, 'base64')));
      return stringPayload ? plain : JSON.parse(plain);
    },
  };
  const store = createEncryptedConversationStore(db, { ...hooks, ...overrides });
  return { db, store, hooks };
}
function legacy(db, { owner = OWNER, content = 'PRIVATE_ACUERDO cafetera presupuesto', role = 'user', at = AT } = {}) {
  const row = db.sql.prepare('INSERT INTO wa_conversation(phone,role,content,created_at) VALUES(?,?,?,?) RETURNING id').get(owner, role, content, at);
  // Original writer used a separate clock call, so FTS time need not match.
  db.sql.prepare('INSERT INTO wa_conversation_search(phone,role,content,created_at) VALUES(?,?,?,?)').run(owner, role, content, '2026-10-17T15:00:00.001Z');
  return Number(row.id);
}
const count = (db, table, where = '', values = []) => Number(db.sql.prepare(`SELECT COUNT(*) n FROM ${table} ${where}`).get(...values).n);
const orphan = (db, owner = OWNER, content = 'PRIVATE_ORPHAN contrato', role = 'user') =>
  Number(db.sql.prepare('INSERT INTO wa_conversation_search(phone,role,content,created_at) VALUES(?,?,?,?)').run(owner, role, content, AT).lastInsertRowid);

test('owner turns and compact memory persist only ciphertext, with fresh IVs and both hook formats', async () => {
  for (const stringPayload of [false, true]) {
    const f = await fixture({ stringPayload });
    const first = await f.store.append({ owner: OWNER, role: 'user', content: 'PRIVATE_SECRET Café presupuesto' });
    await f.store.append({ owner: OWNER, role: 'assistant', content: 'PRIVATE_SECRET Café presupuesto' });
    await f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_MEMORY acuerdo', throughId: first.id, expectedThroughId: 0 });
    const rows = f.db.sql.prepare('SELECT * FROM wa_conversation').all();
    const memory = f.db.sql.prepare('SELECT * FROM wa_memory').get();
    assert.ok(rows.every(row => row.content === '' && row.encrypted_content && row.turn_key));
    assert.notEqual(rows[0].content_iv, rows[1].content_iv);
    assert.equal(memory.memory_text, '');
    assert.doesNotMatch(JSON.stringify([rows, memory, f.db.sql.prepare('SELECT * FROM wa_conversation_blind_index').all()]), /PRIVATE_SECRET|PRIVATE_MEMORY|Café|presupuesto/);
    assert.equal(count(f.db, 'wa_conversation_search'), 0);
    assert.equal((await f.store.history(OWNER)).length, 2);
    assert.equal((await f.store.memory(OWNER)).memory_text, 'PRIVATE_MEMORY acuerdo');
  }
});

test('bounded migration preserves IDs and other owners, authenticates persisted state before plaintext cleanup', async () => {
  const f = await fixture();
  const first = legacy(f.db), second = legacy(f.db, { content: 'PRIVATE_SECOND documento' });
  const other = legacy(f.db, { owner: OTHER, content: 'PRIVATE_OTHER acuerdo' });
  f.db.sql.prepare('INSERT INTO wa_memory VALUES(?,?,?,?)').run(OWNER, 'PRIVATE_SUMMARY acuerdos', 0, AT);
  f.db.sql.prepare('INSERT INTO wa_memory VALUES(?,?,?,?)').run(OTHER, 'OTHER_SUMMARY', other, AT);
  assert.equal((await f.store.migrate(OWNER, { limit: 1 })).migrated, 1);
  assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation WHERE id=?').get(first).content, 'PRIVATE_ACUERDO cafetera presupuesto');
  assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation WHERE id=?').get(second).content, '');
  assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation WHERE id=?').get(other).content, 'PRIVATE_OTHER acuerdo');
  assert.equal(count(f.db, 'wa_conversation_search', 'WHERE phone=?', [OWNER]), 1);
  assert.equal(f.db.sql.prepare('SELECT memory_text FROM wa_memory WHERE phone=?').get(OTHER).memory_text, 'OTHER_SUMMARY');
  const clearAt = f.db.events.findIndex(e => /UPDATE wa_conversation SET content=''/i.test(e.sql));
  assert.ok(f.db.events.slice(0, clearAt).some(e => /SELECT \* FROM wa_conversation WHERE phone=\? AND id=\?/.test(e.sql)));
  await f.store.migrate(OWNER, { limit: 1 });
  assert.deepEqual((await f.store.history(OWNER)).map(row => row.id), [first, second]);
  assert.equal(count(f.db, 'wa_conversation_search', 'WHERE phone=?', [OWNER]), 0);
  assert.equal(count(f.db, 'wa_conversation_search', 'WHERE phone=?', [OTHER]), 1);
  assert.equal((await f.store.memory(OWNER)).memory_text, 'PRIVATE_SUMMARY acuerdos');
});

test('ciphertext corruption during persistence never clears legacy turn or memory plaintext or FTS', async () => {
  for (const table of ['wa_conversation', 'wa_memory']) {
    const f = await fixture(); legacy(f.db);
    if (table === 'wa_memory') f.db.sql.prepare('INSERT INTO wa_memory VALUES(?,?,?,?)').run(OWNER, 'PRIVATE_SUMMARY', 0, AT);
    f.db.after = ({ sql }) => {
      if (table === 'wa_conversation' && /SET encrypted_content=\?/.test(sql)) f.db.sql.exec("UPDATE wa_conversation SET encrypted_content='broken'");
      if (table === 'wa_memory' && /SET encrypted_memory=\?/.test(sql)) f.db.sql.exec("UPDATE wa_memory SET encrypted_memory='broken'");
    };
    await assert.rejects(f.store.migrate(OWNER));
    assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation').get().content, 'PRIVATE_ACUERDO cafetera presupuesto');
    assert.equal(count(f.db, 'wa_conversation_search'), 1);
    if (table === 'wa_memory') assert.equal(f.db.sql.prepare('SELECT memory_text FROM wa_memory').get().memory_text, 'PRIVATE_SUMMARY');
  }
});

test('cleanup resumes after crashing between plaintext removal and FTS deletion', async () => {
  const f = await fixture(); legacy(f.db);
  let fail = true;
  f.db.before = ({ sql }) => { if (fail && /DELETE FROM wa_conversation_search/.test(sql)) { fail = false; throw new Error('injected_cleanup_interruption'); } };
  await assert.rejects(f.store.migrate(OWNER), /injected_cleanup_interruption/);
  assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation').get().content, '');
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  assert.equal(f.db.sql.prepare('SELECT legacy_cleanup_pending FROM wa_conversation').get().legacy_cleanup_pending, 1);
  assert.equal((await f.store.migrate(OWNER)).migrated, 1);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  assert.equal(f.db.sql.prepare('SELECT legacy_cleanup_pending FROM wa_conversation').get().legacy_cleanup_pending, 0);
  assert.equal((await f.store.history(OWNER))[0].content, 'PRIVATE_ACUERDO cafetera presupuesto');
});

test('duplicate legacy FTS snippets remain until every matching plaintext turn is safely migrated', async () => {
  const f = await fixture(); legacy(f.db); legacy(f.db);
  await f.store.migrate(OWNER, { limit: 1 });
  assert.equal(count(f.db, 'wa_conversation_search'), 2);
  await f.store.migrate(OWNER, { limit: 1 });
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  assert.equal((await f.store.history(OWNER)).length, 2);
});

test('blind search normalizes accents, ranks overlap and binds hashes and ciphertext to owners', async () => {
  const f = await fixture();
  await f.store.append({ owner: OWNER, role: 'user', content: 'PRIVATE_A café presupuesto' });
  await f.store.append({ owner: OWNER, role: 'assistant', content: 'PRIVATE_A2 café revisado' });
  await f.store.append({ owner: OTHER, role: 'user', content: 'PRIVATE_B café presupuesto' });
  const found = await f.store.search(OWNER, 'CAFÉ presupuesto');
  assert.equal(found[0].content, 'PRIVATE_A café presupuesto');
  assert.equal(found.length, 2);
  assert.equal((await f.store.search(OTHER, 'cafe'))[0].content, 'PRIVATE_B café presupuesto');
  const a = f.db.sql.prepare('SELECT term_hash FROM wa_conversation_blind_index WHERE owner_phone=?').all(OWNER).map(r => r.term_hash);
  const b = f.db.sql.prepare('SELECT term_hash FROM wa_conversation_blind_index WHERE owner_phone=?').all(OTHER).map(r => r.term_hash);
  assert.ok(a.every(hash => !b.includes(hash)));
  const row = f.db.sql.prepare('SELECT * FROM wa_conversation WHERE phone=? LIMIT 1').get(OWNER);
  f.db.sql.prepare('UPDATE wa_conversation SET encrypted_content=?,content_iv=? WHERE phone=?').run(row.encrypted_content, row.content_iv, OTHER);
  await assert.rejects(f.store.history(OTHER), /integrity_failed/);
});

test('concurrent migration and schema initialization are idempotent', async () => {
  const f = await fixture(); legacy(f.db); legacy(f.db, { content: 'PRIVATE_SECOND' });
  f.db.sql.prepare('INSERT INTO wa_memory VALUES(?,?,?,?)').run(OWNER, 'PRIVATE_SUMMARY', 0, AT);
  const another = createEncryptedConversationStore(f.db, f.hooks);
  await Promise.all([f.store.ensureSchema(), another.ensureSchema()]);
  await Promise.all([f.store.migrate(OWNER), another.migrate(OWNER)]);
  assert.equal((await f.store.history(OWNER)).length, 2);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  assert.equal((await f.store.migrate(OWNER)).migrated, 0);
});

test('source IDs make concurrent appends and crash retries idempotent without storing the source ID', async () => {
  const f = await fixture();
  const input = { owner: OWNER, role: 'user', content: 'PRIVATE_REQUEST contrato', sourceId: 'PRIVATE_WAMID_12345' };
  const rows = await Promise.all([f.store.append(input), f.store.append(input)]);
  assert.equal(rows[0].id, rows[1].id);
  assert.equal(count(f.db, 'wa_conversation'), 1);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM wa_conversation').get()), /PRIVATE_WAMID|PRIVATE_REQUEST/);
  await assert.rejects(f.store.append({ ...input, content: 'PRIVATE_CHANGED' }), /replay_conflict/);
  const assistant = await f.store.append({ ...input, role: 'assistant', content: 'PRIVATE_RESPONSE' });
  assert.notEqual(assistant.id, rows[0].id);
  const other = await f.store.append({ ...input, owner: OTHER }); assert.notEqual(other.id, rows[0].id);
  let fail = true;
  f.db.before = ({ sql }) => { if (fail && /INSERT OR IGNORE INTO wa_conversation_blind_index/.test(sql)) { fail = false; throw new Error('interrupted_index'); } };
  const retry = { ...input, sourceId: 'PRIVATE_RETRY' };
  await assert.rejects(f.store.append(retry), /interrupted_index/);
  const recovered = await f.store.append(retry);
  assert.equal((await f.store.search(OWNER, 'contrato')).filter(row => row.id === recovered.id).length, 1);
  assert.equal(count(f.db, 'wa_conversation'), 4);
});

test('memory CAS rejects a competing summary and a stale cursor without silently replacing text', async () => {
  const f = await fixture();
  const writes = await Promise.allSettled([
    f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_FIRST', throughId: 3, expectedThroughId: 0 }),
    f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_SECOND', throughId: 3, expectedThroughId: 0 }),
  ]);
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(writes.find(r => r.status === 'rejected').reason.message, /write_conflict/);
  const initial = await f.store.memory(OWNER);
  await assert.rejects(f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_STALE', throughId: 4, expectedThroughId: 0 }), /write_conflict/);
  const more = await Promise.allSettled([
    f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_THIRD', throughId: 5, expectedThroughId: 3 }),
    f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_FOURTH', throughId: 5, expectedThroughId: 3 }),
  ]);
  assert.equal(more.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await f.store.memory(OWNER)).summarized_through_id, 5);
  assert.equal(initial.summarized_through_id, 3);
});

test('compaction cannot advance its cursor across older legacy turns still awaiting migration', async () => {
  const f = await fixture(); const old = legacy(f.db), recent = legacy(f.db, { content: 'PRIVATE_RECENT' });
  await f.store.migrate(OWNER, { limit: 1 });
  await f.store.append({ owner: OWNER, role: 'assistant', content: 'PRIVATE_NEW' });
  assert.equal(await f.store.pendingMemory(OWNER, { minTurns: 1 }), null);
  await assert.rejects(f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_SKIP', throughId: recent, expectedThroughId: 0 }), /unmigrated_turns/);
  await f.store.migrate(OWNER, { limit: 1 });
  const candidate = await f.store.pendingMemory(OWNER, { minTurns: 1, limit: 2 });
  assert.equal(candidate.summarized_through_id, 0);
  assert.deepEqual(candidate.rows.map(row => row.id), [old, recent]);
  await f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_SUMMARY', throughId: recent, expectedThroughId: candidate.summarized_through_id });
  assert.equal((await f.store.pendingMemory(OWNER, { minTurns: 1 })).rows.length, 1);
});

test('invalid key or failed encryption never writes plaintext or new conversation rows', async () => {
  for (const overrides of [{ indexKey: '' }, { encrypt: async () => ({}) }, { encrypt: async () => { throw new Error('encryption_unavailable'); } }]) {
    const f = await fixture({ overrides });
    await assert.rejects(f.store.append({ owner: OWNER, role: 'user', content: 'PRIVATE_SECRET' }));
    assert.equal(count(f.db, 'wa_conversation'), 0);
    assert.equal(count(f.db, 'wa_conversation_search'), 0);
  }
  const f = await fixture();
  await assert.rejects(f.store.append({ owner: '', role: 'user', content: 'PRIVATE_SECRET' }), /owner/);
  await assert.rejects(f.store.append({ owner: OWNER, role: 'system', content: 'PRIVATE_SECRET' }), /turn/);
  await assert.rejects(f.store.append({ owner: OWNER, role: 'user', content: 'a'.repeat(12001) }), /turn/);
  await assert.rejects(f.store.saveMemory({ owner: OWNER, memoryText: 'PRIVATE_SECRET', throughId: -1 }), /memory/);
});

test('each store uses its own primary D1 session for durable verification and reads', async () => {
  const f = await fixture(); const primaryPrepare = f.db.prepare.bind(f.db), constraints = [];
  f.db.withSession = constraint => { constraints.push(constraint); return { prepare: primaryPrepare }; };
  f.db.prepare = () => { throw new Error('non_session_query_forbidden'); };
  const first = createEncryptedConversationStore(f.db, f.hooks), second = createEncryptedConversationStore(f.db, f.hooks);
  await first.append({ owner: OWNER, role: 'user', content: 'PRIVATE_SESSION' });
  assert.equal((await second.history(OWNER))[0].content, 'PRIVATE_SESSION');
  assert.deepEqual(constraints, ['first-primary', 'first-primary']);
});

async function workerFixture() {
  const f = await fixture();
  // The unchanged legacy tables also exercise bootstrap compatibility before
  // the store's lazy columns and index exist.
  f.db.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const requests = [], env = { VETSA_CLOUD: f.db, OWNER_WHATSAPP_NUMBER: '18095550111',
    MEMORY_ENCRYPTION_KEY: f.hooks.indexKey, WHATSAPP_PHONE_NUMBER_ID: 'business-test',
    VETSA_INTELLIGENCE: { async fetch(request) {
      const body = await request.json(); requests.push(body);
      return Response.json({ text: body.options?.systemPrompt?.includes('capa de memoria') ? 'PRIVATE_COMPACTED acuerdos vigentes.' : 'Respuesta breve.' });
    } },
  };
  return { ...f, env, requests };
}

test('actual public conversation reads encrypted recent turns, blind recall and memory only for that sender', async () => {
  const f = await workerFixture();
  legacy(f.db, { content: 'PRIVATE_OLD cafetera presupuesto' });
  for (let n = 0; n < 10; n++) legacy(f.db, { content: `PRIVATE_RECENT_${n}` });
  legacy(f.db, { owner: OTHER, content: 'PRIVATE_FOREIGN cafetera presupuesto' });
  f.db.sql.prepare('INSERT INTO wa_memory(phone,memory_text,summarized_through_id,updated_at) VALUES(?,?,?,?)').run(OWNER, 'PRIVATE_PREVIOUS preferencias', 0, AT);
  await askSpaik(f.env, OWNER, 'cafetera presupuesto', 'public');
  const contents = f.requests.at(-1).contents;
  assert.match(contents, /PRIVATE_OLD cafetera presupuesto/);
  assert.match(contents, /PRIVATE_RECENT_9/);
  assert.match(contents, /PRIVATE_PREVIOUS preferencias/);
  assert.doesNotMatch(contents, /PRIVATE_FOREIGN/);
  assert.equal(count(f.db, 'wa_conversation', "WHERE phone=? AND content<>''", [OWNER]), 0);
  assert.equal(count(f.db, 'wa_conversation_search', 'WHERE phone=?', [OWNER]), 0);
  assert.equal(count(f.db, 'wa_conversation_search', 'WHERE phone=?', [OTHER]), 1);
});

test('actual memory cron migrates only its current owner and at most forty turns without skipping legacy gaps', async () => {
  const f = await workerFixture();
  for (let phone = 0; phone < 4; phone++) for (let n = 0; n < 41; n++) legacy(f.db, { owner: phone===0?OWNER:`1809555030${phone}`, content: `PRIVATE_PENDING_${phone}_${n}` });
  await refreshConversationMemory(f.env);
  assert.equal(count(f.db, 'wa_conversation', 'WHERE encrypted_content IS NOT NULL'), 40);
  assert.equal(count(f.db, 'wa_conversation', 'WHERE encrypted_content IS NOT NULL AND phone<>?', [OWNER]), 0);
  assert.equal(count(f.db, 'wa_conversation', "WHERE content<>''"), 124);
  assert.equal(count(f.db, 'wa_conversation_search'), 124);
  assert.equal(f.requests.length, 0, 'oldest unmigrated rows block an invalid cursor advance');
  assert.equal(count(f.db, 'wa_memory'), 0);
});

test('actual memory cron compacts encrypted turns into sender-bound encrypted memory', async () => {
  const f = await workerFixture();
  f.env.ASSISTANT_NATIVE_AI_ENABLED='true';
  f.env.AI={async run(model,input){f.requests.push({model,contents:input.messages.at(-1).content});return{response:'PRIVATE_COMPACTED acuerdos vigentes.'};}};
  f.env.VETSA_INTELLIGENCE.fetch=async()=>assert.fail('Private memory cannot use a fallback processor');
  for (let n = 0; n < 16; n++) await f.store.append({ owner: OWNER, role: n % 2 ? 'assistant' : 'user', content: `PRIVATE_TURN_${n} acuerdos` });
  await refreshConversationMemory(f.env);
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].contents, /PRIVATE_TURN_0/);
  const row = f.db.sql.prepare('SELECT * FROM wa_memory WHERE phone=?').get(OWNER);
  assert.equal(row.memory_text, ''); assert.ok(row.encrypted_memory);
  assert.equal(row.summarized_through_id, 16);
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE_COMPACTED/);
  assert.equal((await f.store.memory(OWNER)).memory_text, 'PRIVATE_COMPACTED acuerdos vigentes.');
  await refreshConversationMemory(f.env);
  assert.equal(f.requests.length, 1);
});

test('actual queued public messages persist encrypted turns with hashed source idempotency', async t => {
  const f = await workerFixture(), sends = [];
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    if (body.text) sends.push(body);
    return Response.json({ success: true, messages: [{ id: `provider-test-${sends.length}` }] });
  });
  let acknowledgements = 0, retries = 0;
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'business-test' },
    messages: [{ id: 'PRIVATE_SOURCE_INCOMING', from: '18095550222', type: 'text', text: { body: 'PRIVATE_PUBLIC_QUESTION' } }],
  } }] }] };
  const batch = { messages: [{ body: { type: 'incoming_whatsapp', payload }, ack() { acknowledgements++; }, retry() { retries++; } }] };
  const background = [], ctx = { waitUntil(work) { background.push(work); } };
  await worker.queue(batch, f.env, ctx);
  await Promise.all(background);
  assert.equal(acknowledgements, 1); assert.equal(retries, 0); assert.equal(sends.length, 1);
  const rows = f.db.sql.prepare('SELECT * FROM wa_conversation').all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.content === '' && row.encrypted_content && row.turn_key));
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_PUBLIC_QUESTION|PRIVATE_SOURCE_INCOMING/);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  await worker.queue(batch, f.env, ctx);
  assert.equal(count(f.db, 'wa_conversation'), 2); assert.equal(sends.length, 1);
});

test('orphan recovery waits for all sender turns to be clean, preserves exact source metadata and never creates turns', async () => {
  const f = await fixture({ stringPayload: true }); const first = legacy(f.db), second = legacy(f.db, { content: 'PRIVATE_SECOND' });
  const orphanId = orphan(f.db), otherId = orphan(f.db, OTHER, 'PRIVATE_OTHER_ORPHAN');
  await f.store.ensureSchema();
  assert.equal((await f.store.recoverLegacySearch(OWNER)).recovered, 0);
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 0);
  await f.store.migrate(OWNER, { limit: 1 });
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 0);
  const done = await f.store.migrate(OWNER, { limit: 1 });
  assert.equal(done.recovered, 1);
  const recovered = await f.store.recoveredLegacy(OWNER);
  assert.equal(recovered[0].owner, OWNER); assert.equal(recovered[0].sourceRowId, orphanId);
  assert.equal(recovered[0].createdAt, AT); assert.equal(recovered[0].role, 'user');
  assert.equal(recovered[0].content, 'PRIVATE_ORPHAN contrato');
  assert.deepEqual((await f.store.history(OWNER)).map(row => row.id), [first, second]);
  assert.equal(count(f.db, 'wa_conversation'), 2);
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  assert.equal(f.db.sql.prepare('SELECT rowid FROM wa_conversation_search').get().rowid, otherId);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM wa_conversation_legacy_recovery').all()), /PRIVATE_ORPHAN|contrato/);
  assert.deepEqual(await f.store.recoveredLegacy(OTHER), []);
});

test('orphan recovery resumes after archive persistence and before FTS cleanup without duplicate archives', async () => {
  const f = await fixture(); orphan(f.db); let crash = true;
  f.db.before = ({ sql }) => { if (crash && /DELETE FROM wa_conversation_search WHERE rowid=/.test(sql)) { crash = false; throw Error('injected_orphan_cleanup_interruption'); } };
  await assert.rejects(f.store.recoverLegacySearch(OWNER), /injected_orphan_cleanup_interruption/);
  const before = f.db.sql.prepare('SELECT * FROM wa_conversation_legacy_recovery').get();
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  const result = await f.store.recoverLegacySearch(OWNER);
  assert.equal(result.recovered, 1);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 1);
  assert.equal(f.db.sql.prepare('SELECT payload_encrypted FROM wa_conversation_legacy_recovery').get().payload_encrypted, before.payload_encrypted);
});

test('orphan recovery refuses to clear FTS when persisted ciphertext cannot authenticate', async () => {
  const f = await fixture(); orphan(f.db);
  f.db.after = ({ sql }) => { if (/INSERT INTO wa_conversation_legacy_recovery/.test(sql)) f.db.sql.exec("UPDATE wa_conversation_legacy_recovery SET payload_encrypted='corrupt'"); };
  await assert.rejects(f.store.recoverLegacySearch(OWNER));
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  assert.equal(f.db.sql.prepare('SELECT content FROM wa_conversation_search').get().content, 'PRIVATE_ORPHAN contrato');
  await assert.rejects(f.store.recoverLegacySearch(OWNER));
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
});

test('recovered archive ciphertext is bound to owner, source row and immutable source metadata', async () => {
  const f = await fixture(); orphan(f.db); await f.store.recoverLegacySearch(OWNER);
  const row = f.db.sql.prepare('SELECT * FROM wa_conversation_legacy_recovery').get();
  f.db.sql.prepare('INSERT INTO wa_conversation_legacy_recovery VALUES(?,?,?,?,?,?)')
    .run(OTHER, row.source_key, row.source_rowid, row.payload_encrypted, row.payload_iv, row.recovered_at);
  await assert.rejects(f.store.recoveredLegacy(OTHER), /integrity_failed/);
  f.db.sql.prepare('UPDATE wa_conversation_legacy_recovery SET source_rowid=source_rowid+1 WHERE owner_phone=?').run(OWNER);
  await assert.rejects(f.store.recoveredLegacy(OWNER), /integrity_failed/);
});

test('row-specific orphan cleanup CAS preserves concurrent source changes and archives each distinct version', async () => {
  const f = await fixture(); orphan(f.db); let change = true;
  f.db.after = ({ sql }) => {
    if (change && /SELECT \* FROM wa_conversation_legacy_recovery/.test(sql) && count(f.db, 'wa_conversation_legacy_recovery')) {
      change = false; f.db.sql.exec("UPDATE wa_conversation_search SET content='PRIVATE_ORPHAN_CHANGED'");
    }
  };
  assert.equal((await f.store.recoverLegacySearch(OWNER)).recovered, 0);
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  assert.equal((await f.store.recoverLegacySearch(OWNER)).recovered, 1);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
  assert.deepEqual((await f.store.recoveredLegacy(OWNER)).map(row => row.content).sort(), ['PRIVATE_ORPHAN contrato', 'PRIVATE_ORPHAN_CHANGED'].sort());
});

test('concurrent orphan recovery is bounded and idempotent with an owner-specific source identity', async () => {
  const f = await fixture(); for (let n = 0; n < 3; n++) orphan(f.db, OWNER, `PRIVATE_ORPHAN_${n}`);
  const other = createEncryptedConversationStore(f.db, f.hooks);
  const results = await Promise.all([f.store.recoverLegacySearch(OWNER, { limit: 1 }), other.recoverLegacySearch(OWNER, { limit: 1 })]);
  assert.equal(results.reduce((sum, result) => sum + result.recovered, 0), 1);
  assert.equal(count(f.db, 'wa_conversation_search'), 2);
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 1);
  assert.equal((await f.store.recoverLegacySearch(OWNER, { limit: 1 })).recovered, 1);
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
});

test('actual memory cron finds sender-only residual FTS and recovers at most forty orphan rows', async () => {
  const f = await workerFixture(); for (let n = 0; n < 41; n++) orphan(f.db, OWNER, `PRIVATE_RESIDUAL_${n}`);
  await refreshConversationMemory(f.env);
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 40);
  assert.equal(count(f.db, 'wa_conversation_search'), 1);
  assert.equal(count(f.db, 'wa_conversation'), 0); assert.equal(count(f.db, 'wa_memory'), 0);
  assert.equal(f.requests.length, 0);
  await refreshConversationMemory(f.env);
  assert.equal(count(f.db, 'wa_conversation_legacy_recovery'), 41);
  assert.equal(count(f.db, 'wa_conversation_search'), 0);
});


test('private memory fails closed without native inference and never sends its turns to a fallback',async()=>{
  for(const enabled of [false,true]){
    const f=await workerFixture();
    f.env.ASSISTANT_NATIVE_AI_ENABLED=String(enabled);
    let fallbackCalls=0;
    f.env.VETSA_INTELLIGENCE.fetch=async()=>{fallbackCalls++;throw Error('forbidden_private_memory_fallback');};
    f.env.AI={async run(){throw Error('synthetic_ai_unavailable');}};
    for(let n=0;n<16;n++)await f.store.append({owner:OWNER,role:n%2?'assistant':'user',content:`PRIVATE_GOOGLE_DERIVED_${n}`});
    await assert.rejects(refreshConversationMemory(f.env),/private_memory_inference_unavailable|synthetic_ai_unavailable/);
    assert.equal(fallbackCalls,0);assert.equal(count(f.db,'wa_memory'),0);
    assert.equal(count(f.db,'wa_conversation'),16);
  }
});
