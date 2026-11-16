import { AGENT_EMAIL_SENDERS, agentForEmail } from './melodi-email-identity.js';
const DAY_MS = 86400000;
const DOMAIN = 'vetsa.es';
export const EMAIL_SENDER_STATUS_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_email_sender_audit (id TEXT PRIMARY KEY,checked_at INTEGER NOT NULL,next_refresh_at INTEGER NOT NULL,status TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_email_sender_status (
    email TEXT PRIMARY KEY,agent TEXT NOT NULL,status TEXT NOT NULL,registered INTEGER,provider_active INTEGER,
    domain_verified INTEGER,domain_authenticated INTEGER,provider_name TEXT,checked_at INTEGER NOT NULL)`
]);
const flag = value => typeof value === 'boolean' ? Number(value) : null;
const boolean = value => value === null ? null : Boolean(value);
const dbFor = env => env?.VETSA_CLOUD;
async function ensureSchema(db) { await db.batch(EMAIL_SENDER_STATUS_SCHEMA.map(sql => db.prepare(sql))); }
export async function readEmailSenderStatus(env) {
  const db = dbFor(env);
  if (!db?.prepare) return [];
  const rows = (await db.prepare('SELECT * FROM wa_melodi_email_sender_status ORDER BY email').all()).results || [];
  return rows.map(row => ({ email: row.email, agent: row.agent, status: row.status,
    registered: boolean(row.registered), providerActive: boolean(row.provider_active),
    domainVerified: boolean(row.domain_verified), domainAuthenticated: boolean(row.domain_authenticated),
    providerName: row.provider_name, checkedAt: new Date(row.checked_at).toISOString() }));
}
async function readProbe(fetchImpl, url, key) {
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', 'api-key': key }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); return null; }
    // Do not persist provider diagnostics, DNS values or arbitrary account data.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 512000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/** Read-only GET audit, shared daily cache; a probe failure never blocks a send. */
export async function refreshEmailSenders(env, { now = Date.now(), force = false, fetchImpl = fetch } = {}) {
  const db = dbFor(env), at = typeof now === 'string' ? Date.parse(now) : now instanceof Date ? now.getTime() : Number(now);
  if (!db?.prepare || !db?.batch || !Number.isFinite(at)) return { status: 'unavailable', senders: [] };
  try {
    await ensureSchema(db);
    await db.prepare("INSERT OR IGNORE INTO wa_email_sender_audit VALUES ('brevo',0,0,'unknown')").run();
    const claimed = await db.prepare(`UPDATE wa_email_sender_audit SET next_refresh_at=?,status='refreshing'
      WHERE id='brevo' AND (next_refresh_at<=? OR ?=1) RETURNING id`).bind(at + DAY_MS, at, Number(force)).first();
    if (!claimed) return { status: 'cached', senders: await readEmailSenderStatus(env) };
    const [listing, domain] = env.BREVO_API_KEY ? await Promise.all([
      readProbe(fetchImpl, `https://api.brevo.com/v3/senders?domain=${DOMAIN}`, env.BREVO_API_KEY),
      readProbe(fetchImpl, `https://api.brevo.com/v3/senders/domains/${DOMAIN}`, env.BREVO_API_KEY),
    ]) : [null, null];
    const list = Array.isArray(listing?.senders) ? listing.senders : null;
    const validDomain = domain && (domain.domain || domain.domain_name) === DOMAIN ? domain : null;
    const verified = flag(validDomain?.verified), authenticated = flag(validDomain?.authenticated);
    const domainReady = verified === 1 && authenticated === 1;
    const status = !env.BREVO_API_KEY ? 'not_configured' : list || validDomain ? 'updated' : 'unavailable';
    const statements = AGENT_EMAIL_SENDERS.map(email => {
      const sender = list?.find(item => typeof item?.email === 'string' && item.email.toLowerCase() === email);
      const active = flag(sender?.active), registered = list ? Number(Boolean(sender)) : null;
      // Domain authentication alone does not prove this alias was registered or delivered.
      const senderStatus = active === 1 ? 'active' : active === 0 ? 'inactive' : domainReady ? 'domain_verified' : list ? 'missing' : status === 'not_configured' ? status : 'unavailable';
      return db.prepare(`INSERT INTO wa_melodi_email_sender_status VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET agent=excluded.agent,status=excluded.status,registered=excluded.registered,
        provider_active=excluded.provider_active,domain_verified=excluded.domain_verified,domain_authenticated=excluded.domain_authenticated,
        provider_name=excluded.provider_name,checked_at=excluded.checked_at`).bind(email, agentForEmail(email), senderStatus, registered,
        active, verified, authenticated, typeof sender?.name === 'string' ? sender.name.slice(0, 120) : null, at);
    });
    statements.push(db.prepare("UPDATE wa_email_sender_audit SET checked_at=?,status=? WHERE id='brevo'").bind(at, status));
    await db.batch(statements);
    return { status, checkedAt: new Date(at).toISOString(), senders: await readEmailSenderStatus(env) };
  } catch { return { status: 'unavailable', senders: [] }; }
}
