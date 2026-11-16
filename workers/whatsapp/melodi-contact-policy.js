// Preferences come only from a direct owner message. Retrieved documents,
// model output and tool results must never be passed to this parser.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const stripAddress = value => normalize(value).replace(/^(?:oye\s+)?(?:melodi)[,:]?\s+/, '');

export function parseOwnerContactPreference(message) {
  const raw = String(message || '').trim();
  if (!raw || raw.includes('\n') || raw.length > 700) return null;
  const text = stripAddress(raw).replace(/[.!]+$/, '');
  if (/^(?:no me (?:escribas|contactes) (?:por iniciativa propia|sin que te lo pida)|(?:solo|solamente) (?:escribe|escribeme|contactame) cuando te lo pida|desactiva (?:los )?mensajes (?:proactivos|espontaneos))$/.test(text))
    return { action: 'contact_preference', unsolicited: false };
  const blocked = text.match(/^(?:olvida(?:te de)?|no (?:me hables|me escribas|investigues)(?: (?:mas|nunca))?(?: (?:sobre|de))?|deja de (?:hablarme|escribirme|investigar)(?: (?:sobre|de))?|no vuelvas a (?:hablarme|escribirme|investigar)(?: (?:sobre|de))?|ya no quiero que me (?:hables|escribas)(?: (?:sobre|de))?)\s+(.+)$/);
  const restored = text.match(/^(?:vuelve a (?:hablarme|investigar)(?: (?:sobre|de))?|retoma(?: el tema de)?|permite (?:el tema|hablar) de)\s+(.+)$/);
  const match = blocked || restored;
  if (!match) return null;
  const topic = match[1].replace(/^(?:el tema (?:de|del)|todo (?:lo relacionado con|sobre)|lo de)\s+/, '').replace(/[,;].*$/, '').trim();
  // Goal/job cancellation belongs to its own workflow; never silently turn it
  // into a topic preference or destroy the user's work.
  if (!topic || topic.length > 120 || /^(?:el |la |este |esta |ese |esa |mi )?(?:objetivo|trabajo|tarea|encargo|proyecto|rutina|recordatorio)\b/.test(topic)) return null;
  return { action: 'contact_preference', topic, blocked: Boolean(blocked) };
}

export const CONTACT_POLICY_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_owner_contact_preferences (owner TEXT PRIMARY KEY, payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wa_contact_delivery_receipts (owner TEXT NOT NULL, fingerprint TEXT NOT NULL, token TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','sent','uncertain')), created_at INTEGER NOT NULL, PRIMARY KEY(owner,fingerprint))`,
]);

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createContactPolicy(db, { encrypt, decrypt, now = () => Date.now() } = {}) {
  if (!db?.prepare || !db?.batch || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('Contact policy requires encrypted storage');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const ownerId = value => { if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError('Invalid contact policy owner'); return value; };
  async function ensureSchema() { await db.batch(CONTACT_POLICY_SCHEMA.map(sql => db.prepare(sql))); }
  async function read(owner) {
    ownerId(owner);
    const row = await statement('SELECT * FROM wa_owner_contact_preferences WHERE owner=?', owner).first();
    if (!row) return { blockedTopics: [], unsolicited: false, revision: 0 };
    const decoded = await decrypt(row.payload_encrypted, row.payload_iv);
    const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    if (!Array.isArray(payload?.blockedTopics)) throw new Error('Invalid encrypted contact preference');
    return { ...payload, unsolicited: false, revision: row.revision };
  }
  async function update(owner, preference) {
    ownerId(owner);
    const topic = normalize(preference?.topic);
    if (preference?.unsolicited !== false && (!topic || topic.length > 120 || typeof preference?.blocked !== 'boolean')) throw new TypeError('Invalid contact preference');
    for (let attempt = 0; attempt < 8; attempt++) {
      const prior = await read(owner);
      const blockedTopics = prior.blockedTopics.filter(value => value !== topic);
      if (topic && preference.blocked) blockedTopics.push(topic);
      if (blockedTopics.length > 100) throw new Error('Contact preference limit');
      const sealed = await encrypt({ unsolicited: false, blockedTopics });
      if (!sealed?.encrypted || !sealed?.iv) throw new Error('Contact preference encryption failed');
      const result = await statement(`INSERT INTO wa_owner_contact_preferences(owner,payload_encrypted,payload_iv,revision,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(owner) DO UPDATE SET payload_encrypted=excluded.payload_encrypted,payload_iv=excluded.payload_iv,revision=excluded.revision,updated_at=excluded.updated_at
        WHERE wa_owner_contact_preferences.revision=?`, owner, sealed.encrypted, sealed.iv, prior.revision + 1, now(), prior.revision).run();
      if (result?.meta?.changes) return { ...preference, blockedTopics, unsolicited: false, revision: prior.revision + 1 };
    }
    throw new Error('Contact preference update conflict');
  }
  async function permits(owner, text) {
    const preferences = await read(owner);
    const normalized = normalize(text);
    return !preferences.blockedTopics.some(topic => normalized.includes(topic));
  }
  async function claimDelivery({ owner, body, scope = '' }) {
    ownerId(owner);
    const content = normalize(body).replace(/^(?:melodi):\s*/, '');
    if (!content || content.length > 6000 || String(scope).length > 200) throw new TypeError('Invalid contact delivery');
    const fingerprint = await digest(`${scope}\n${content}`), token = crypto.randomUUID();
    const result = await statement(`INSERT OR IGNORE INTO wa_contact_delivery_receipts(owner,fingerprint,token,status,created_at) VALUES(?,?,?,'reserved',?)`, owner, fingerprint, token, now()).run();
    return result?.meta?.changes ? { fingerprint, token } : null;
  }
  async function finishDelivery({ owner, fingerprint, token, status }) {
    ownerId(owner);
    if (!['sent', 'uncertain', 'rejected'].includes(status)) throw new TypeError('Invalid contact receipt');
    return status === 'rejected'
      ? statement("DELETE FROM wa_contact_delivery_receipts WHERE owner=? AND fingerprint=? AND token=? AND status='reserved'", owner, fingerprint, token).run()
      : statement("UPDATE wa_contact_delivery_receipts SET status=? WHERE owner=? AND fingerprint=? AND token=? AND status='reserved'", status, owner, fingerprint, token).run();
  }
  return Object.freeze({ ensureSchema, read, update, permits, claimDelivery, finishDelivery });
}
