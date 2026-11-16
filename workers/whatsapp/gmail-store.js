import { calendarHash, calendarRandom } from './google-calendar-store.js';

export const GMAIL_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS gmail_connections(owner TEXT PRIMARY KEY,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,
    status TEXT NOT NULL,version INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER)`,
  `CREATE TABLE IF NOT EXISTS gmail_oauth(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,
    state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS gmail_mutations(owner TEXT NOT NULL,request_hash TEXT NOT NULL,body_hash TEXT NOT NULL,
    status TEXT NOT NULL,provider_id TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,request_hash))`,
]);
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function validOwner(value) { if (typeof value !== 'string' || !value || value.length > 160) throw Error('invalid_gmail_owner'); }
function kind(value) { if (!['link','consent'].includes(value)) throw Error('invalid_gmail_nonce_kind'); }

/** Gmail credentials use their own tables and authenticated encryption domain. */
export function createGmailStore(env, { now = () => Date.now() } = {}) {
  if (!env.VETSA_CLOUD?.prepare || !env.MEMORY_ENCRYPTION_KEY) throw Error('gmail_storage_unavailable');
  const db = env.VETSA_CLOUD;
  const stmt = (sql,...values) => db.prepare(sql).bind(...values);
  let keyPromise;
  const key = () => keyPromise ||= (async () => {
    const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MEMORY_ENCRYPTION_KEY),'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('vetsa-gmail-v1'),info:new TextEncoder().encode('private-google-mail')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  })();
  const aad = (owner,context) => new TextEncoder().encode(JSON.stringify(['gmail',owner,context]));
  async function seal(owner,value,context) {
    validOwner(owner); const iv = crypto.getRandomValues(new Uint8Array(12)), plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > 65536) throw Error('gmail_state_too_large');
    return {encrypted:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(owner,context)},await key(),plain))),iv:b64(iv)};
  }
  async function unseal(owner,row,context) {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.state_iv),additionalData:aad(owner,context)},await key(),bytes(row.state_encrypted))));
  }
  async function ensureSchema() { await db.batch(GMAIL_SCHEMA.map(sql => db.prepare(sql))); }
  async function getConnection(owner) {
    validOwner(owner); const row = await stmt('SELECT * FROM gmail_connections WHERE owner=?',owner).first();
    return row ? {...await unseal(owner,row,'connection'),status:row.status,version:row.version} : null;
  }
  async function putConnection(owner,value,{leaseToken,expectedVersion,consentToken}={}) {
    const state = await seal(owner,value,'connection'), at = now();
    if (leaseToken) {
      const result = await stmt(`UPDATE gmail_connections SET state_encrypted=?,state_iv=?,status=?,version=version+1
        WHERE owner=? AND lease_token=? AND lease_until>?`,state.encrypted,state.iv,value.status || 'connected',owner,leaseToken,at).run();
      if (!result.meta?.changes) throw Error('gmail_lease_lost');
      return;
    }
    if(consentToken!==undefined && !/^[a-f0-9]{64}$/.test(consentToken))throw Error('invalid_gmail_consent');
    const consent=consentToken===undefined ? {sql:'1',values:[]} : {sql:"EXISTS(SELECT 1 FROM gmail_oauth WHERE token_hash=? AND owner=? AND kind='consent' AND consumed_at IS NOT NULL AND expires_at>?)",values:[await calendarHash(consentToken),owner,at]};
    const result = await stmt(`INSERT INTO gmail_connections(owner,state_encrypted,state_iv,status,version) SELECT ?,?,?,?,1 WHERE ${consent.sql}
      ON CONFLICT(owner) DO UPDATE SET state_encrypted=excluded.state_encrypted,state_iv=excluded.state_iv,status=excluded.status,version=version+1
      WHERE (gmail_connections.lease_until IS NULL OR gmail_connections.lease_until<=?) AND (? IS NULL OR gmail_connections.version=?)`,
      owner,state.encrypted,state.iv,value.status || 'connected',...consent.values,at,expectedVersion ?? null,expectedVersion ?? null).run();
    if (!result.meta?.changes) throw Error('gmail_connection_busy');
  }
  async function acquireLease(owner) {
    validOwner(owner); const token=calendarRandom(), at=now();
    const result=await stmt(`UPDATE gmail_connections SET lease_token=?,lease_until=? WHERE owner=? AND status='connected'
      AND (lease_token IS NULL OR lease_until<=?)`,token,at+55000,owner,at).run();
    return result.meta?.changes ? token : null;
  }
  async function releaseLease(owner,token) { await stmt('UPDATE gmail_connections SET lease_token=NULL,lease_until=NULL WHERE owner=? AND lease_token=?',owner,token).run(); }
  async function createNonce(owner,type,value,expiresAt) {
    validOwner(owner); kind(type); const at=now();
    if (!Number.isFinite(expiresAt) || expiresAt<=at || expiresAt>at+24*3600000) throw Error('invalid_gmail_nonce_expiry');
    const token=calendarRandom(), hash=await calendarHash(token), sealed=await seal(owner,value,`oauth:${type}:${hash}`);
    await stmt('INSERT INTO gmail_oauth(token_hash,owner,kind,state_encrypted,state_iv,expires_at) VALUES(?,?,?,?,?,?)',hash,owner,type,sealed.encrypted,sealed.iv,expiresAt).run();
    return token;
  }
  async function peekNonce(token,type) {
    kind(type); if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const hash=await calendarHash(token), row=await stmt('SELECT * FROM gmail_oauth WHERE token_hash=? AND kind=? AND expires_at>? AND consumed_at IS NULL',hash,type,now()).first();
    return row ? {...await unseal(row.owner,row,`oauth:${type}:${hash}`),owner:row.owner} : null;
  }
  async function consumeNonce(token,type,{owner,browserHash}={}) {
    const value=await peekNonce(token,type);
    if (!value || owner!==undefined && value.owner!==owner || browserHash!==undefined && value.browserHash!==browserHash) return null;
    const result=await stmt('UPDATE gmail_oauth SET consumed_at=? WHERE token_hash=? AND owner=? AND kind=? AND consumed_at IS NULL AND expires_at>?',now(),await calendarHash(token),value.owner,type,now()).run();
    return result.meta?.changes ? value : null;
  }
  async function disconnect(owner) {
    validOwner(owner);
    await db.batch([stmt('DELETE FROM gmail_connections WHERE owner=?',owner),stmt('DELETE FROM gmail_oauth WHERE owner=?',owner)]);
  }
  async function claimMutation(owner,requestKey,fingerprint) {
    validOwner(owner); if (typeof requestKey!=='string' || !requestKey || requestKey.length>500) throw Error('gmail_send_request_required');
    const requestHash=await calendarHash(requestKey), bodyHash=await calendarHash(fingerprint), at=now();
    const result=await stmt(`INSERT INTO gmail_mutations(owner,request_hash,body_hash,status,updated_at) VALUES(?,?,?,'reserved',?)
      ON CONFLICT(owner,request_hash) DO UPDATE SET status='reserved',updated_at=excluded.updated_at
      WHERE gmail_mutations.status='rejected' AND gmail_mutations.body_hash=excluded.body_hash`,owner,requestHash,bodyHash,at).run();
    const row=await stmt('SELECT * FROM gmail_mutations WHERE owner=? AND request_hash=?',owner,requestHash).first();
    if (row.body_hash!==bodyHash) throw Error('gmail_request_replay_mismatch');
    return {claimed:Boolean(result.meta?.changes),status:row.status,messageId:row.provider_id};
  }
  async function finishMutation(owner,requestKey,{status,messageId}={}) {
    validOwner(owner); if (!['sent','rejected'].includes(status) || status==='sent' && (typeof messageId!=='string' || !messageId)) throw Error('invalid_gmail_send_receipt');
    await stmt("UPDATE gmail_mutations SET status=?,provider_id=?,updated_at=? WHERE owner=? AND request_hash=? AND status='reserved'",status,messageId || null,now(),owner,await calendarHash(requestKey)).run();
  }
  return {ensureSchema,getConnection,putConnection,acquireLease,releaseLease,createNonce,peekNonce,consumeNonce,disconnect,claimMutation,finishMutation};
}
