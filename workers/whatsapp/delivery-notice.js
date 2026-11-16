import { validCalendarReminder } from './calendar-reminder-contract.js';
import { validScreenshotReminder } from './screenshot-reminder-contract.js';

const LEASE_MS = 10 * 60000;
const MAX_ATTEMPTS = 3;
export const DELIVERY_NOTICE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_delivery_notices (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, notice_key TEXT NOT NULL, agent TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL, owner_requested INTEGER NOT NULL DEFAULT 0,
    artifact_job_id TEXT, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','leased','sent','uncertain','window_closed')),
    available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner,notice_key))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_delivery_notices_due ON wa_melodi_delivery_notices(owner,status,available_at)`,
]);

function timestamp(value) {
  const result = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(result) || result < 0) throw new TypeError('Invalid delivery notice time');
  return Math.trunc(result);
}
function validOwner(owner) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('Invalid delivery notice owner');
}
async function digest(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > 2000) throw new TypeError('Invalid delivery notice key');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Encrypt/decrypt hooks accept JSON text and return {encrypted,iv}/JSON text or an object. */
export function createDeliveryNotices(db, { encrypt, decrypt, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('Delivery notices require D1 and encryption hooks');
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  const time = value => timestamp(value ?? now());
  const publicRow = row => ({ id: row.id, owner: row.owner, agent: row.agent, status: row.status,
    ownerRequested: Boolean(row.owner_requested), artifactJobId: row.artifact_job_id, attempts: row.attempts });
  async function ensureSchema() { await db.batch(DELIVERY_NOTICE_SCHEMA.map(sql => db.prepare(sql))); }
  async function enqueue({ owner, key, agent, body, ownerRequested = false, artifactJobId = null, calendarReminder = null, screenshotReminder = null }) {
    validOwner(owner);
    if (!['melodi'].includes(agent) || typeof body !== 'string' || !body.trim() || body.length > 4000
      || typeof ownerRequested !== 'boolean' || (artifactJobId !== null && (typeof artifactJobId !== 'string' || artifactJobId.length > 200))
      || (calendarReminder !== null && (!ownerRequested || !validCalendarReminder(calendarReminder)))
      || (screenshotReminder !== null && (!ownerRequested || calendarReminder !== null || !validScreenshotReminder(screenshotReminder)))) throw new TypeError('Invalid delivery notice');
    const keyHash = await digest(key), at = time();
    const existing = await query('SELECT * FROM wa_melodi_delivery_notices WHERE owner=? AND notice_key=?', owner, keyHash).first();
    if (existing) return publicRow(existing);
    const sealed = await encrypt(JSON.stringify({ body, ...(calendarReminder ? { calendarReminder } : {}), ...(screenshotReminder ? {screenshotReminder} : {}) }));
    if (!sealed?.encrypted || !sealed?.iv) throw new Error('Delivery notice encryption failed');
    await query(`INSERT OR IGNORE INTO wa_melodi_delivery_notices
      (id,owner,notice_key,agent,payload_encrypted,payload_iv,owner_requested,artifact_job_id,available_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, uuid(), owner, keyHash, agent, sealed.encrypted, sealed.iv, Number(ownerRequested), artifactJobId, at, at, at).run();
    return publicRow(await query('SELECT * FROM wa_melodi_delivery_notices WHERE owner=? AND notice_key=?', owner, keyHash).first());
  }
  async function finish({ owner, id, token, status, now: atValue }) {
    validOwner(owner);
    if (typeof id !== 'string' || !id || typeof token !== 'string' || !token || !['sent', 'pending', 'uncertain', 'window_closed'].includes(status)) throw new TypeError('Invalid delivery notice completion');
    const at = time(atValue);
    // A stale worker may have sent its message: never automatically reclaim it.
    const result = await query(`UPDATE wa_melodi_delivery_notices SET status=CASE WHEN ?='pending' AND attempts>=? THEN 'uncertain' ELSE ? END,
      available_at=CASE WHEN ?='pending' THEN ? + (60000 * (1 << (attempts-1))) ELSE ? END,
      lease_token=NULL,lease_until=NULL,updated_at=? WHERE owner=? AND id=? AND status='leased' AND lease_token=? AND lease_until>?
      RETURNING id`, status, MAX_ATTEMPTS, status, status, at, at, at, owner, id, token, at).first();
    return Boolean(result);
  }
  async function reopenWindow({ owner, now: atValue }) {
    validOwner(owner); const at = time(atValue);
    const result = await query(`UPDATE wa_melodi_delivery_notices SET status='pending',available_at=?,updated_at=?
      WHERE owner=? AND status='window_closed'`, at, at, owner).run();
    return Number(result?.meta?.changes || 0);
  }
  async function recoverExpired({ owner, now: atValue }) {
    validOwner(owner); const at = time(atValue);
    const result = await query(`UPDATE wa_melodi_delivery_notices SET status='uncertain',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE owner=? AND status='leased' AND lease_until<=?`, at, owner, at).run();
    return Number(result?.meta?.changes || 0);
  }
  async function peek({ owner, now: atValue, limit = 10, id, agent, ownerRequested } = {}) {
    validOwner(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30
      || (id !== undefined && (typeof id !== 'string' || !id || id.length > 200))
      || (ownerRequested !== undefined && typeof ownerRequested !== 'boolean')
      || (agent !== undefined && !['melodi'].includes(agent))) throw new TypeError('Invalid delivery notice selection');
    await recoverExpired({ owner, now: atValue });
    const result = await query(`SELECT * FROM wa_melodi_delivery_notices WHERE owner=? AND status='pending' AND available_at<=?
      ${id === undefined ? '' : 'AND id=?'} ${agent === undefined ? '' : 'AND agent=?'} ${ownerRequested === undefined ? '' : 'AND owner_requested=?'} ORDER BY created_at,id LIMIT ?`,
      owner, time(atValue), ...(id === undefined ? [] : [id]), ...(agent === undefined ? [] : [agent]), ...(ownerRequested === undefined ? [] : [Number(ownerRequested)]), limit).all();
    return (result.results || []).map(publicRow);
  }
  async function claim({ owner, now: atValue, limit = 10, reopensWindow = false, id, agent }) {
    validOwner(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30 || typeof reopensWindow !== 'boolean') throw new TypeError('Invalid delivery notice claim');
    const at = time(atValue);
    if (reopensWindow) await reopenWindow({ owner, now: at });
    const candidates = await peek({ owner, now: at, limit, id, agent });
    const claimed = [];
    for (const candidate of candidates) {
      const token = uuid();
      const row = await query(`UPDATE wa_melodi_delivery_notices SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
        WHERE owner=? AND id=? AND status='pending' AND available_at<=? RETURNING *`, token, at + LEASE_MS, at, owner, candidate.id, at).first();
      if (!row) continue;
      try {
        const decoded = await decrypt(row.payload_encrypted, row.payload_iv);
        const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
        if (typeof payload?.body !== 'string' || !payload.body.trim()) throw new Error('Invalid notice payload');
        if (payload.calendarReminder && !validCalendarReminder(payload.calendarReminder)) throw new Error('Invalid reminder payload');
        if (payload.screenshotReminder && (!validScreenshotReminder(payload.screenshotReminder) || !row.owner_requested || payload.calendarReminder)) throw new Error('Invalid screenshot reminder payload');
        claimed.push({ ...publicRow(row), token, leaseUntil: row.lease_until, body: payload.body,
          ...(payload.calendarReminder ? { calendarReminder: payload.calendarReminder } : {}), ...(payload.screenshotReminder ? {screenshotReminder:payload.screenshotReminder} : {}) });
      } catch { await finish({ owner, id: row.id, token, status: 'uncertain', now: at }); }
    }
    return claimed;
  }
  return Object.freeze({ ensureSchema, enqueue, peek, claim, finish, reopenWindow, reopensWindow: reopenWindow, recoverExpired });
}
