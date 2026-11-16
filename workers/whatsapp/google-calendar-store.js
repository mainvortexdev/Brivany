const AGENTS = ['melodi'];
export const GOOGLE_CALENDAR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS google_calendar_connections (owner TEXT PRIMARY KEY, state_encrypted TEXT NOT NULL, state_iv TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', lease_token TEXT, lease_until INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS google_calendar_oauth (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, state_encrypted TEXT NOT NULL, state_iv TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS melodi_google_calendar_activity_map (owner TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, agent TEXT NOT NULL, google_event_id TEXT NOT NULL, google_etag TEXT, local_hash TEXT, remote_hash TEXT, source_version TEXT, status TEXT NOT NULL DEFAULT 'active', updated_at INTEGER NOT NULL, PRIMARY KEY(owner,kind,source_id), UNIQUE(owner,google_event_id))`,
  `CREATE INDEX IF NOT EXISTS google_calendar_oauth_expiry ON google_calendar_oauth(expires_at)`,
  `CREATE TABLE IF NOT EXISTS melodi_google_calendar_ignored_changes (owner TEXT NOT NULL,event_id TEXT NOT NULL,remote_hash TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,agent TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,event_id,remote_hash))`,
];
export async function calendarHash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}
export function calendarRandom() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join(''); }
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function validOwner(owner) { if (typeof owner !== 'string' || !owner.trim() || owner.length>160) throw new Error('invalid_calendar_owner'); }
function validKind(kind) { if (!['link','consent'].includes(kind)) throw new Error('invalid_calendar_nonce_kind'); }
export function createGoogleCalendarStore(env, { now = () => Date.now() } = {}) {
  const db = env.VETSA_CLOUD;
  if (!db || !env.MEMORY_ENCRYPTION_KEY) throw new Error('google_calendar_storage_unavailable');
  let keyPromise;
  const key = () => keyPromise ||= (async () => {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MEMORY_ENCRYPTION_KEY), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'HKDF', hash:'SHA-256', salt:new TextEncoder().encode('vetsa-calendar-v1'), info:new TextEncoder().encode('oauth-state') }, material, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  })();
  async function seal(owner, value, context='connection') {
    validOwner(owner);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > 131072) throw new Error('google_calendar_state_too_large');
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(JSON.stringify([owner,context]))}, await key(), plain);
    return { encrypted:b64(new Uint8Array(encrypted)), iv:b64(iv) };
  }
  async function unseal(owner, row, context='connection') {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes(row.state_iv), additionalData:new TextEncoder().encode(JSON.stringify([owner,context]))}, await key(), bytes(row.state_encrypted))));
  }
  const stmt = (sql,...args) => db.prepare(sql).bind(...args);
  async function ensureSchema() { await db.batch(GOOGLE_CALENDAR_SCHEMA.map(sql => db.prepare(sql))); }
  async function getConnection(owner) {
    validOwner(owner);
    const row = await stmt('SELECT * FROM google_calendar_connections WHERE owner=?',owner).first();
    return row ? { ...await unseal(owner,row), status:row.status, version:row.updated_at } : null;
  }
  async function putConnection(owner, value, {leaseToken,consentToken} = {}) {
    const state = await seal(owner,value), at = now();
    if (leaseToken) {
      const result = await stmt(`UPDATE google_calendar_connections SET state_encrypted=?,state_iv=?,status=?,updated_at=MAX(updated_at+1,?) WHERE owner=? AND lease_token=? AND lease_until>?`,state.encrypted,state.iv,value.status || 'connected',at,owner,leaseToken,at).run();
      if (!result.meta?.changes) throw new Error('google_calendar_lease_lost');
    } else {
      let predicate='',args=[];
      if (consentToken!==undefined) {
        if (!/^[a-f0-9]{64}$/.test(consentToken)) throw new Error('invalid_calendar_consent');
        predicate=" WHERE EXISTS(SELECT 1 FROM google_calendar_oauth WHERE token_hash=? AND owner=? AND kind='consent' AND consumed_at IS NOT NULL AND expires_at>?)";
        args=[await calendarHash(consentToken),owner,at];
      }
      const result=await stmt(`INSERT INTO google_calendar_connections(owner,state_encrypted,state_iv,status,updated_at) SELECT ?,?,?,?,?${predicate || ' WHERE 1'} ON CONFLICT(owner) DO UPDATE SET state_encrypted=excluded.state_encrypted,state_iv=excluded.state_iv,status=excluded.status,lease_token=NULL,lease_until=NULL,updated_at=MAX(google_calendar_connections.updated_at+1,excluded.updated_at) WHERE google_calendar_connections.lease_until IS NULL OR google_calendar_connections.lease_until<=?`,owner,state.encrypted,state.iv,value.status || 'connected',at,...args,at).run();
      if (!result.meta?.changes) throw new Error('google_calendar_connection_busy');
    }
  }
  async function createNonce(owner,kind,value,expiresAt) {
    validOwner(owner); validKind(kind);
    if (!Number.isFinite(expiresAt) || expiresAt<=now() || expiresAt>now()+48*3600000) throw new Error('invalid_calendar_nonce_expiry');
    const token = calendarRandom(), hash=await calendarHash(token), state = await seal(owner,value,`oauth:${kind}:${hash}`);
    await stmt('INSERT INTO google_calendar_oauth(token_hash,owner,kind,state_encrypted,state_iv,expires_at) VALUES(?,?,?,?,?,?)',hash,owner,kind,state.encrypted,state.iv,expiresAt).run();
    return token;
  }
  async function peekNonce(token,kind) {
    validKind(kind);
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const hash = await calendarHash(token), at = now();
    const row = await stmt('SELECT * FROM google_calendar_oauth WHERE token_hash=? AND kind=? AND expires_at>? AND consumed_at IS NULL',hash,kind,at).first();
    if (!row) return null;
    return {...await unseal(row.owner,row,`oauth:${kind}:${hash}`),owner:row.owner};
  }
  async function consumeNonce(token,kind,{owner:expectedOwner,browserHash}={}) {
    const value=await peekNonce(token,kind);
    if (!value || (expectedOwner!==undefined && value.owner!==expectedOwner) || (browserHash!==undefined && value.browserHash!==browserHash)) return null;
    const hash=await calendarHash(token),at=now();
    const result = await stmt('UPDATE google_calendar_oauth SET consumed_at=? WHERE token_hash=? AND kind=? AND owner=? AND consumed_at IS NULL AND expires_at>?',at,hash,kind,value.owner,at).run();
    return result.meta?.changes ? value : null;
  }
  async function acquireLease(owner) {
    validOwner(owner);
    const at=now(), token=calendarRandom();
    const result=await stmt(`UPDATE google_calendar_connections SET lease_token=?,lease_until=? WHERE owner=? AND status='connected' AND (lease_until IS NULL OR lease_until<=?)`,token,at+55000,owner,at).run();
    return result.meta?.changes ? token : null;
  }
  async function releaseLease(owner,token) { await stmt('UPDATE google_calendar_connections SET lease_token=NULL,lease_until=NULL WHERE owner=? AND lease_token=?',owner,token).run(); }
  async function listMappings(owner) { return (await stmt('SELECT * FROM melodi_google_calendar_activity_map WHERE owner=?',owner).all()).results || []; }
  async function assertLease(owner,leaseToken) {
    validOwner(owner);
    if (!leaseToken || !await stmt("SELECT owner FROM google_calendar_connections WHERE owner=? AND status='connected' AND lease_token=? AND lease_until>?",owner,leaseToken,now()).first()) throw new Error('google_calendar_lease_lost');
  }
  async function putMapping(owner,map,{leaseToken}={}) {
    validOwner(owner);
    if (!AGENTS.includes(map.agent)) throw new Error('invalid_calendar_agent');
    const guard=leaseToken ? " WHERE EXISTS(SELECT 1 FROM google_calendar_connections WHERE owner=? AND status='connected' AND lease_token=? AND lease_until>?)" : ' WHERE 1';
    const at=now();
    const result=await stmt(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,google_etag,local_hash,remote_hash,source_version,status,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?${guard} ON CONFLICT(owner,kind,source_id) DO UPDATE SET google_etag=excluded.google_etag,local_hash=excluded.local_hash,remote_hash=excluded.remote_hash,source_version=excluded.source_version,status=excluded.status,updated_at=excluded.updated_at WHERE melodi_google_calendar_activity_map.agent=excluded.agent AND melodi_google_calendar_activity_map.google_event_id=excluded.google_event_id`,owner,map.kind,map.id || map.source_id,map.agent,map.googleEventId || map.google_event_id,map.etag || map.google_etag || null,map.localHash || null,map.remoteHash || null,String(map.sourceVersion ?? ''),map.status || 'active',at,...(leaseToken ? [owner,leaseToken,at] : [])).run();
    if (!result.meta?.changes) throw new Error('google_calendar_mapping_conflict');
  }
  async function hasIgnoredChange(owner,eventId,remoteHash) {
    validOwner(owner);
    return Boolean(await stmt('SELECT event_id FROM melodi_google_calendar_ignored_changes WHERE owner=? AND event_id=? AND remote_hash=?',owner,eventId,remoteHash).first());
  }
  async function putIgnoredChange(owner,{eventId,remoteHash,kind,id,agent,reason},{leaseToken}={}) {
    validOwner(owner);
    if (!AGENTS.includes(agent) || !leaseToken || !/^[a-f0-9]{64}$/.test(remoteHash)
      || typeof eventId!=='string' || !eventId || eventId.length>1024 || typeof reason!=='string' || !/^[a-z_]{1,80}$/.test(reason)) throw new Error('invalid_calendar_ignored_receipt');
    const at=now();
    const result=await stmt(`INSERT OR IGNORE INTO melodi_google_calendar_ignored_changes(owner,event_id,remote_hash,kind,source_id,agent,reason,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM google_calendar_connections WHERE owner=? AND status='connected' AND lease_token=? AND lease_until>?)`,
      owner,eventId,remoteHash,kind,id,agent,reason,at,owner,leaseToken,at).run();
    if (!result.meta?.changes) { await assertLease(owner,leaseToken); if (!await hasIgnoredChange(owner,eventId,remoteHash)) throw new Error('google_calendar_ignored_receipt_failed'); }
  }
  async function disconnect(owner) {
    const connection = await getConnection(owner);
    await db.batch([stmt('DELETE FROM google_calendar_connections WHERE owner=?',owner),stmt('DELETE FROM google_calendar_oauth WHERE owner=?',owner),stmt('DELETE FROM melodi_google_calendar_activity_map WHERE owner=?',owner),stmt('DELETE FROM melodi_google_calendar_ignored_changes WHERE owner=?',owner)]);
    return connection;
  }
  return { ensureSchema,getConnection,putConnection,createNonce,peekNonce,consumeNonce,acquireLease,releaseLease,assertLease,listMappings,putMapping,hasIgnoredChange,putIgnoredChange,disconnect };
}
