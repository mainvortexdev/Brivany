// Each sender's encrypted history shares the existing turn IDs so compaction
// checkpoints remain valid throughout bounded, sender-scoped legacy migration.
const schemaReady = new WeakSet();
const encoder = new TextEncoder();
const tokens = value => [...new Set(String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])];
// Palabras que aparecen en casi cualquier mensaje: como términos de búsqueda
// devuelven el historial entero y tapan lo que de verdad distingue la pregunta.
const COMMON_TERMS = new Set(['para', 'como', 'sobre', 'desde', 'hasta', 'esto', 'esta', 'este', 'estos', 'estas', 'eso', 'esa',
  'pero', 'porque', 'cuando', 'donde', 'quien', 'cual', 'cuales', 'tambien', 'entonces', 'ahora', 'luego', 'todo', 'toda',
  'quiero', 'quieres', 'puedo', 'puedes', 'tengo', 'tiene', 'hacer', 'dice', 'decir', 'favor', 'gracias', 'hola',
  'melodi', 'brivany', 'vetsa', 'usted', 'nosotros', 'mismo', 'misma', 'otra', 'otro', 'solo', 'bien', 'mas', 'muy']);
/**
 * Términos con los que merece la pena buscar: primero los que no son de uso
 * corriente y, entre ellos, los más largos, que son los que distinguen un tema.
 * Sólo afecta a la consulta; lo indexado no cambia.
 */
const searchTerms = (value, limit) => {
  const all = tokens(value);
  const distinctive = all.filter(term => !COMMON_TERMS.has(term));
  return (distinctive.length ? distinctive : all).sort((a, b) => b.length - a.length).slice(0, limit);
};
const bounded = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
const ownerId = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('invalid_private_conversation_owner');
  return value;
};
const jsonPayload = value => typeof value === 'string' ? JSON.parse(value) : value;
const privateText = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) throw new TypeError(`invalid_private_${label}`);
  return value;
};

export function createEncryptedConversationStore(database, { encrypt, decrypt, indexKey, now = () => new Date().toISOString() } = {}) {
  if (!database?.prepare || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('private_conversation_requires_encryption');
  // This request-local primary session authenticates the state actually written
  // before legacy cleanup, even when the binding has read replicas enabled.
  const db = typeof database.withSession === 'function' ? database.withSession('first-primary') : database;
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  let hmacKey, schemaPromise;
  async function hashValue(value) {
    if (!hmacKey) {
      if (typeof indexKey !== 'string') throw new Error('private_conversation_index_key_missing');
      let bytes;
      try { bytes = Uint8Array.from(atob(indexKey), char => char.charCodeAt(0)); }
      catch { throw new Error('private_conversation_index_key_invalid'); }
      if (bytes.length !== 32) throw new Error('private_conversation_index_key_invalid');
      hmacKey = crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    const digest = await crypto.subtle.sign('HMAC', await hmacKey, encoder.encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function termHashes(owner, text, limit = 2400, select = false) {
    const terms = select ? searchTerms(text, limit) : tokens(text).slice(0, limit);
    return Promise.all(terms.map(term => hashValue(`wa-private-history:v1\u0000${owner}\u0000${term}`)));
  }
  async function ensureSchema() {
    if (schemaReady.has(database)) return;
    if (!schemaPromise) schemaPromise = (async () => {
      for (const [table, columns] of [
        ['wa_conversation', [['encrypted_content', 'TEXT'], ['content_iv', 'TEXT'], ['legacy_cleanup_pending', 'INTEGER NOT NULL DEFAULT 0'], ['turn_key', 'TEXT']]],
        ['wa_memory', [['encrypted_memory', 'TEXT'], ['memory_iv', 'TEXT']]],
      ]) {
        const found = await db.prepare(`PRAGMA table_info(${table})`).all();
        const names = new Set((found.results || []).map(row => row.name));
        for (const [column, type] of columns) if (!names.has(column)) {
          try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run(); }
          catch (error) { if (!/duplicate column name/i.test(`${error?.message} ${error?.cause?.message || ''}`)) throw error; }
        }
      }
      await db.prepare(`CREATE TABLE IF NOT EXISTS wa_conversation_blind_index (
        owner_phone TEXT NOT NULL, turn_id INTEGER NOT NULL, term_hash TEXT NOT NULL,
        PRIMARY KEY(owner_phone,term_hash,turn_id))`).run();
      await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conversation_turn_key ON wa_conversation(phone,turn_key)').run();
      await db.prepare(`CREATE TABLE IF NOT EXISTS wa_conversation_legacy_recovery (
        owner_phone TEXT NOT NULL, source_key TEXT NOT NULL, source_rowid INTEGER NOT NULL,
        payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL, recovered_at TEXT NOT NULL,
        PRIMARY KEY(owner_phone,source_key))`).run();
      // Share only a completed fact across requests. Pending D1 I/O belongs to
      // this store's request and must never escape into a global promise cache.
      schemaReady.add(database);
    })().catch(error => { schemaPromise = null; throw error; });
    return schemaPromise;
  }
  async function seal(value) {
    const sealed = await encrypt(value);
    if (typeof sealed?.encrypted !== 'string' || !sealed.encrypted || typeof sealed?.iv !== 'string' || !sealed.iv) throw new Error('private_conversation_encryption_failed');
    return sealed;
  }
  async function openTurn(row) {
    if (!row) throw new Error('private_conversation_missing');
    const payload = jsonPayload(await decrypt(row.encrypted_content, row.content_iv));
    if (payload?.kind !== 'owner_conversation_v1' || payload.owner !== row.phone || payload.role !== row.role
      || payload.createdAt !== row.created_at || typeof payload.content !== 'string' || payload.content.length > 12000
      || (payload.sourceKey ?? null) !== (row.turn_key ?? null)
      || (payload.turnId != null && payload.turnId !== row.id)) throw new Error('private_conversation_integrity_failed');
    return { id: row.id, role: payload.role, content: payload.content, created_at: payload.createdAt };
  }
  async function openMemory(row) {
    if (!row) return null;
    const payload = jsonPayload(await decrypt(row.encrypted_memory, row.memory_iv));
    if (payload?.kind !== 'owner_memory_v1' || payload.owner !== row.phone || payload.throughId !== row.summarized_through_id
      || payload.updatedAt !== row.updated_at || typeof payload.memoryText !== 'string' || payload.memoryText.length > 12000) throw new Error('private_memory_integrity_failed');
    return { memory_text: payload.memoryText, summarized_through_id: payload.throughId };
  }
  async function indexTurn(owner, turn) {
    const hashes = await termHashes(owner, turn.content);
    if (hashes.length) await query(`INSERT OR IGNORE INTO wa_conversation_blind_index (owner_phone,turn_id,term_hash)
      SELECT ?,?,value FROM json_each(?)`, owner, turn.id, JSON.stringify(hashes)).run();
  }
  async function append({ owner, role, content, sourceId = null }) {
    ownerId(owner);
    privateText(content, 12000, 'conversation_turn');
    if (!['user', 'assistant'].includes(role)) throw new TypeError('invalid_private_conversation_turn');
    if (sourceId != null && (typeof sourceId !== 'string' || !sourceId || sourceId.length > 1024 || /[\u0000-\u001f]/.test(sourceId))) throw new TypeError('invalid_private_conversation_source');
    await ensureSchema();
    const sourceKey = await hashValue(`wa-private-source:v1\u0000${owner}\u0000${role}\u0000${sourceId ?? crypto.randomUUID()}`);
    let row = await query('SELECT * FROM wa_conversation WHERE phone=? AND turn_key=?', owner, sourceKey).first();
    if (!row) {
      const createdAt = now(), sealed = await seal({ kind: 'owner_conversation_v1', owner, role, content, createdAt, sourceKey });
      row = await query(`INSERT INTO wa_conversation (phone,role,content,created_at,encrypted_content,content_iv,legacy_cleanup_pending,turn_key)
        VALUES(?,?,'',?,?,?,1,?) ON CONFLICT(phone,turn_key) DO NOTHING RETURNING *`, owner, role, createdAt, sealed.encrypted, sealed.iv, sourceKey).first();
      if (!row) row = await query('SELECT * FROM wa_conversation WHERE phone=? AND turn_key=?', owner, sourceKey).first();
    }
    if (!row) throw new Error('private_conversation_write_failed');
    const stored = await openTurn(row);
    if (stored.role !== role || stored.content !== content) throw new Error('private_conversation_replay_conflict');
    await indexTurn(owner, stored);
    await query('UPDATE wa_conversation SET legacy_cleanup_pending=0 WHERE phone=? AND id=?', owner, row.id).run();
    return stored;
  }
  async function migrateMemory(owner) {
    let row = await query('SELECT * FROM wa_memory WHERE phone=?', owner).first();
    if (!row) return;
    if (!row.encrypted_memory) {
      privateText(row.memory_text, 12000, 'memory');
      const sealed = await seal({ kind: 'owner_memory_v1', owner, memoryText: row.memory_text,
        throughId: row.summarized_through_id, updatedAt: row.updated_at });
      await query(`UPDATE wa_memory SET encrypted_memory=?,memory_iv=?
        WHERE phone=? AND encrypted_memory IS NULL AND memory_text=? AND summarized_through_id=? AND updated_at=?`,
      sealed.encrypted, sealed.iv, owner, row.memory_text, row.summarized_through_id, row.updated_at).run();
    }
    row = await query('SELECT * FROM wa_memory WHERE phone=?', owner).first();
    const opened = await openMemory(row);
    if (row.memory_text && row.memory_text !== opened.memory_text) throw new Error('private_memory_migration_conflict');
    // Read back and authenticate the durable ciphertext before removing legacy text.
    await query(`UPDATE wa_memory SET memory_text='' WHERE phone=? AND encrypted_memory=? AND memory_iv=? AND memory_text=?`,
      owner, row.encrypted_memory, row.memory_iv, row.memory_text).run();
  }
  async function migrate(owner, { limit = 40 } = {}) {
    ownerId(owner); await ensureSchema();
    await migrateMemory(owner);
    const rows = await query(`SELECT * FROM wa_conversation WHERE phone=?
      AND (encrypted_content IS NULL OR content<>'' OR legacy_cleanup_pending=1) ORDER BY id DESC LIMIT ?`,
    owner, bounded(limit, 40, 100)).all();
    let migrated = 0;
    for (const row of rows.results || []) {
      if (!row.encrypted_content) {
        privateText(row.content, 12000, 'conversation_turn');
        const sealed = await seal({ kind: 'owner_conversation_v1', owner, role: row.role, content: row.content,
          createdAt: row.created_at, sourceKey: row.turn_key ?? null, turnId: row.id });
        await query(`UPDATE wa_conversation SET encrypted_content=?,content_iv=?,legacy_cleanup_pending=1
          WHERE phone=? AND id=? AND encrypted_content IS NULL AND content=?`, sealed.encrypted, sealed.iv, owner, row.id, row.content).run();
      }
      const persisted = await query('SELECT * FROM wa_conversation WHERE phone=? AND id=?', owner, row.id).first();
      const opened = await openTurn(persisted);
      if (persisted.content && persisted.content !== opened.content) throw new Error('private_conversation_migration_conflict');
      await indexTurn(owner, opened);
      await query(`UPDATE wa_conversation SET content='' WHERE phone=? AND id=? AND encrypted_content=? AND content_iv=? AND content=?`,
        owner, row.id, persisted.encrypted_content, persisted.content_iv, persisted.content).run();
      // Legacy FTS has no turn ID and its timestamp can differ from the turn.
      // Keep duplicate snippets until every matching legacy turn is encrypted.
      // The pending flag makes cleanup resumable after any interrupted write.
      await query(`DELETE FROM wa_conversation_search WHERE phone=? AND role=? AND content=?
        AND NOT EXISTS(SELECT 1 FROM wa_conversation c WHERE c.phone=? AND c.role=? AND c.content=?)`,
      owner, opened.role, opened.content, owner, opened.role, opened.content).run();
      await query('UPDATE wa_conversation SET legacy_cleanup_pending=0 WHERE phone=? AND id=?', owner, row.id).run();
      migrated++;
    }
    const { recovered } = await recoverLegacySearch(owner, { limit });
    return { migrated, recovered };
  }
  async function recoverySourceKey(owner, row) {
    return hashValue(`wa-private-legacy-search:v1\u0000${JSON.stringify([owner,row.source_rowid,row.role,row.created_at,row.content])}`);
  }
  async function openRecovery(row) {
    if (!row) throw new Error('private_legacy_recovery_missing');
    const payload = jsonPayload(await decrypt(row.payload_encrypted, row.payload_iv));
    if (payload?.kind !== 'owner_legacy_search_v1' || payload.owner !== row.owner_phone
      || payload.sourceKey !== row.source_key || payload.sourceRowId !== row.source_rowid
      || payload.recoveredAt !== row.recovered_at || typeof payload.content !== 'string'
      || payload.content.length > 12000 || !['user','assistant'].includes(payload.role)
      || typeof payload.createdAt !== 'string' || payload.sourceKey !== await recoverySourceKey(row.owner_phone,
        { source_rowid: payload.sourceRowId, role: payload.role, created_at: payload.createdAt, content: payload.content })) {
      throw new Error('private_legacy_recovery_integrity_failed');
    }
    return payload;
  }
  async function recoverLegacySearch(owner, { limit = 40 } = {}) {
    ownerId(owner); await ensureSchema();
    const unfinished = await query(`SELECT id FROM wa_conversation WHERE phone=? AND
      (encrypted_content IS NULL OR content<>'' OR legacy_cleanup_pending=1) LIMIT 1`, owner).first();
    if (unfinished) return { recovered: 0 };
    const rows = await query(`SELECT rowid AS source_rowid,phone,role,content,created_at
      FROM wa_conversation_search WHERE phone=? ORDER BY rowid ASC LIMIT ?`, owner, bounded(limit, 40, 100)).all();
    let recovered = 0;
    for (const source of rows.results || []) {
      privateText(source.content, 12000, 'legacy_recovery');
      if (!['user','assistant'].includes(source.role) || typeof source.created_at !== 'string') throw new Error('invalid_private_legacy_source');
      const sourceKey = await recoverySourceKey(owner, source);
      let persisted = await query('SELECT * FROM wa_conversation_legacy_recovery WHERE owner_phone=? AND source_key=?', owner, sourceKey).first();
      if (!persisted) {
        const recoveredAt = now(), sealed = await seal({ kind: 'owner_legacy_search_v1', owner, sourceKey,
          sourceRowId: source.source_rowid, role: source.role, content: source.content, createdAt: source.created_at, recoveredAt });
        await query(`INSERT INTO wa_conversation_legacy_recovery
          (owner_phone,source_key,source_rowid,payload_encrypted,payload_iv,recovered_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(owner_phone,source_key) DO NOTHING`, owner, sourceKey, source.source_rowid,
        sealed.encrypted, sealed.iv, recoveredAt).run();
        persisted = await query('SELECT * FROM wa_conversation_legacy_recovery WHERE owner_phone=? AND source_key=?', owner, sourceKey).first();
      }
      const verified = await openRecovery(persisted);
      if (verified.content !== source.content || verified.role !== source.role || verified.createdAt !== source.created_at) throw new Error('private_legacy_recovery_conflict');
      // Preserve an encrypted, authenticated copy before a row-specific CAS.
      // This separate archive never changes turn order or compaction cursors.
      const cleared = await query(`DELETE FROM wa_conversation_search WHERE rowid=? AND phone=? AND role=? AND content=? AND created_at=?
        AND NOT EXISTS(SELECT 1 FROM wa_conversation WHERE phone=? AND
          (encrypted_content IS NULL OR content<>'' OR legacy_cleanup_pending=1))`,
      source.source_rowid, owner, source.role, source.content, source.created_at, owner).run();
      recovered += Number(cleared.meta?.changes || 0);
    }
    return { recovered };
  }
  async function recoveredLegacy(owner, { limit = 40 } = {}) {
    ownerId(owner); await ensureSchema();
    const rows = await query(`SELECT * FROM wa_conversation_legacy_recovery WHERE owner_phone=?
      ORDER BY source_rowid ASC LIMIT ?`, owner, bounded(limit, 40, 100)).all();
    return Promise.all((rows.results || []).map(openRecovery));
  }
  async function history(owner, { limit = 14 } = {}) {
    ownerId(owner); await ensureSchema();
    const rows = await query(`SELECT * FROM wa_conversation WHERE phone=? AND encrypted_content IS NOT NULL ORDER BY id DESC LIMIT ?`,
      owner, bounded(limit, 14, 100)).all();
    return Promise.all((rows.results || []).reverse().map(openTurn));
  }
  async function memory(owner) {
    ownerId(owner); await ensureSchema();
    const row = await query('SELECT * FROM wa_memory WHERE phone=? AND encrypted_memory IS NOT NULL', owner).first();
    return openMemory(row);
  }
  async function search(owner, text, { limit = 6 } = {}) {
    ownerId(owner); await ensureSchema();
    privateText(text, 12000, 'conversation_query');
    const hashes = await termHashes(owner, text, 8, true);
    if (!hashes.length) return [];
    const rows = await query(`SELECT c.* FROM wa_conversation c JOIN wa_conversation_blind_index b ON b.turn_id=c.id AND b.owner_phone=c.phone
      WHERE c.phone=? AND b.term_hash IN (${hashes.map(() => '?').join(',')}) AND c.encrypted_content IS NOT NULL
      GROUP BY c.id ORDER BY COUNT(*) DESC,c.id DESC LIMIT ?`, owner, ...hashes, bounded(limit, 6, 30)).all();
    return Promise.all((rows.results || []).map(openTurn));
  }
  async function pendingMemory(owner, { minTurns = 18, limit = 40 } = {}) {
    ownerId(owner); await ensureSchema();
    const previous = await memory(owner), throughId = previous?.summarized_through_id || 0;
    // Do not advance past unconverted legacy rows while migration is in flight.
    const rows = await query(`SELECT * FROM wa_conversation c WHERE c.phone=? AND c.id>? AND c.encrypted_content IS NOT NULL
      AND c.id<COALESCE((SELECT MIN(p.id) FROM wa_conversation p WHERE p.phone=? AND p.id>? AND p.encrypted_content IS NULL),9223372036854775807)
      ORDER BY c.id ASC LIMIT ?`, owner, throughId, owner, throughId, bounded(limit, 40, 100)).all();
    if ((rows.results || []).length < bounded(minTurns, 18, 100)) return null;
    return { phone: owner, memory_text: previous?.memory_text || '', summarized_through_id: throughId,
      rows: await Promise.all(rows.results.map(openTurn)) };
  }
  async function saveMemory({ owner, memoryText, throughId, expectedThroughId }) {
    ownerId(owner);
    privateText(memoryText, 12000, 'memory');
    if (!Number.isSafeInteger(throughId) || throughId < 0) throw new TypeError('invalid_private_memory');
    await ensureSchema();
    const previous = await query('SELECT * FROM wa_memory WHERE phone=?', owner).first();
    const expected = expectedThroughId ?? previous?.summarized_through_id ?? 0;
    if (!Number.isSafeInteger(expected) || expected < 0 || throughId < expected) throw new TypeError('invalid_private_memory_cursor');
    if (previous && (!previous.encrypted_memory || previous.memory_text)) throw new Error('private_memory_migration_required');
    if (previous) await openMemory(previous);
    if ((previous?.summarized_through_id ?? 0) !== expected) throw new Error('private_memory_write_conflict');
    const unmigrated = await query(`SELECT id FROM wa_conversation WHERE phone=? AND id>? AND id<=? AND encrypted_content IS NULL LIMIT 1`,
      owner, expected, throughId).first();
    if (unmigrated) throw new Error('private_memory_unmigrated_turns');
    const updatedAt = now(), sealed = await seal({ kind: 'owner_memory_v1', owner, memoryText, throughId, updatedAt });
    // Compare the ciphertext too: two writers at the same cursor cannot silently
    // replace each other, including a same-cursor correction.
    const written = previous ? await query(`UPDATE wa_memory SET memory_text='',summarized_through_id=?,updated_at=?,encrypted_memory=?,memory_iv=?
      WHERE phone=? AND summarized_through_id=? AND encrypted_memory=? AND memory_iv=? RETURNING *`, throughId, updatedAt,
      sealed.encrypted, sealed.iv, owner, expected, previous.encrypted_memory, previous.memory_iv).first()
      : await query(`INSERT INTO wa_memory (phone,memory_text,summarized_through_id,updated_at,encrypted_memory,memory_iv) VALUES(?,'',?,?,?,?)
        ON CONFLICT(phone) DO NOTHING RETURNING *`, owner, throughId, updatedAt, sealed.encrypted, sealed.iv).first();
    if (!written) throw new Error('private_memory_write_conflict');
    return openMemory(written);
  }
  return Object.freeze({ ensureSchema, append, migrate, recoverLegacySearch, recoveredLegacy, history, memory, search, pendingMemory, saveMemory });
}
