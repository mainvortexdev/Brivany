export async function driveHash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))), byte => byte.toString(16).padStart(2,'0')).join(''); }
export function driveRandom() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,'0')).join(''); }

export const DRIVE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS drive_connections(owner TEXT PRIMARY KEY,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,
    status TEXT NOT NULL,version INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER)`,
  `CREATE TABLE IF NOT EXISTS drive_oauth(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,
    state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS drive_mutations(owner TEXT NOT NULL,request_hash TEXT NOT NULL,body_hash TEXT NOT NULL,
    status TEXT NOT NULL,provider_id TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,request_hash))`,
]);
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function validOwner(value) { if (typeof value !== 'string' || !value || value.length > 160) throw Error('invalid_drive_owner'); }
function kind(value) { if (!['link','consent'].includes(value)) throw Error('invalid_drive_nonce_kind'); }

/** Drive credentials use their own tables and authenticated encryption domain. */
export function createDriveStore(env, { now = () => Date.now() } = {}) {
  if (!env.VETSA_CLOUD?.prepare || !env.MEMORY_ENCRYPTION_KEY) throw Error('drive_storage_unavailable');
  const db = env.VETSA_CLOUD;
  const stmt = (sql,...values) => db.prepare(sql).bind(...values);
  let keyPromise;
  const key = () => keyPromise ||= (async () => {
    const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MEMORY_ENCRYPTION_KEY),'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('vetsa-drive-v1'),info:new TextEncoder().encode('private-google-drive')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  })();
  const aad = (owner,context) => new TextEncoder().encode(JSON.stringify(['drive',owner,context]));
  async function seal(owner,value,context) {
    validOwner(owner); const iv = crypto.getRandomValues(new Uint8Array(12)), plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > 65536) throw Error('drive_state_too_large');
    return {encrypted:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(owner,context)},await key(),plain))),iv:b64(iv)};
  }
  async function unseal(owner,row,context) {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.state_iv),additionalData:aad(owner,context)},await key(),bytes(row.state_encrypted))));
  }
  async function ensureSchema() { await db.batch(DRIVE_SCHEMA.map(sql => db.prepare(sql))); }
  async function getConnection(owner) {
    validOwner(owner); const row = await stmt('SELECT * FROM drive_connections WHERE owner=?',owner).first();
    return row ? {...await unseal(owner,row,'connection'),status:row.status,version:row.version} : null;
  }
  async function putConnection(owner,value,{leaseToken,expectedVersion,consentToken}={}) {
    const state = await seal(owner,value,'connection'), at = now();
    if (leaseToken) {
      const result = await stmt(`UPDATE drive_connections SET state_encrypted=?,state_iv=?,status=?,version=version+1
        WHERE owner=? AND lease_token=? AND lease_until>?`,state.encrypted,state.iv,value.status || 'connected',owner,leaseToken,at).run();
      if (!result.meta?.changes) throw Error('drive_lease_lost');
      return;
    }
    if(consentToken!==undefined && !/^[a-f0-9]{64}$/.test(consentToken))throw Error('invalid_drive_consent');
    const consent=consentToken===undefined ? {sql:'1',values:[]} : {sql:"EXISTS(SELECT 1 FROM drive_oauth WHERE token_hash=? AND owner=? AND kind='consent' AND consumed_at IS NOT NULL AND expires_at>?)",values:[await driveHash(consentToken),owner,at]};
    const result = await stmt(`INSERT INTO drive_connections(owner,state_encrypted,state_iv,status,version) SELECT ?,?,?,?,1 WHERE ${consent.sql}
      ON CONFLICT(owner) DO UPDATE SET state_encrypted=excluded.state_encrypted,state_iv=excluded.state_iv,status=excluded.status,version=version+1
      WHERE (drive_connections.lease_until IS NULL OR drive_connections.lease_until<=?) AND (? IS NULL OR drive_connections.version=?)`,
      owner,state.encrypted,state.iv,value.status || 'connected',...consent.values,at,expectedVersion ?? null,expectedVersion ?? null).run();
    if (!result.meta?.changes) throw Error('drive_connection_busy');
  }
  async function acquireLease(owner) {
    validOwner(owner); const token=driveRandom(), at=now();
    const result=await stmt(`UPDATE drive_connections SET lease_token=?,lease_until=? WHERE owner=? AND status='connected'
      AND (lease_token IS NULL OR lease_until<=?)`,token,at+55000,owner,at).run();
    return result.meta?.changes ? token : null;
  }
  async function releaseLease(owner,token) { await stmt('UPDATE drive_connections SET lease_token=NULL,lease_until=NULL WHERE owner=? AND lease_token=?',owner,token).run(); }
  async function assertLease(owner,token) {
    validOwner(owner);
    const row=await stmt("SELECT owner FROM drive_connections WHERE owner=? AND lease_token=? AND lease_until>? AND status='connected'",owner,token,now()).first();
    if(!row)throw Error('drive_lease_lost');
  }
  async function createNonce(owner,type,value,expiresAt) {
    validOwner(owner); kind(type); const at=now();
    if (!Number.isFinite(expiresAt) || expiresAt<=at || expiresAt>at+24*3600000) throw Error('invalid_drive_nonce_expiry');
    const token=driveRandom(), hash=await driveHash(token), sealed=await seal(owner,value,`oauth:${type}:${hash}`);
    await stmt('INSERT INTO drive_oauth(token_hash,owner,kind,state_encrypted,state_iv,expires_at) VALUES(?,?,?,?,?,?)',hash,owner,type,sealed.encrypted,sealed.iv,expiresAt).run();
    return token;
  }
  async function peekNonce(token,type) {
    kind(type); if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const hash=await driveHash(token), row=await stmt('SELECT * FROM drive_oauth WHERE token_hash=? AND kind=? AND expires_at>? AND consumed_at IS NULL',hash,type,now()).first();
    return row ? {...await unseal(row.owner,row,`oauth:${type}:${hash}`),owner:row.owner} : null;
  }
  async function consumeNonce(token,type,{owner,browserHash}={}) {
    const value=await peekNonce(token,type);
    if (!value || owner!==undefined && value.owner!==owner || browserHash!==undefined && value.browserHash!==browserHash) return null;
    const result=await stmt('UPDATE drive_oauth SET consumed_at=? WHERE token_hash=? AND owner=? AND kind=? AND consumed_at IS NULL AND expires_at>?',now(),await driveHash(token),value.owner,type,now()).run();
    return result.meta?.changes ? value : null;
  }
  async function disconnect(owner) {
    validOwner(owner);
    await db.batch([stmt('DELETE FROM drive_connections WHERE owner=?',owner),stmt('DELETE FROM drive_oauth WHERE owner=?',owner)]);
  }
  async function claimMutation(owner,requestKey,fingerprint) {
    validOwner(owner); if (typeof requestKey!=='string' || !requestKey || requestKey.length>500) throw Error('drive_create_request_required');
    const requestHash=await driveHash(requestKey), bodyHash=await driveHash(fingerprint), at=now();
    const result=await stmt(`INSERT INTO drive_mutations(owner,request_hash,body_hash,status,updated_at) VALUES(?,?,?,'reserved',?)
      ON CONFLICT(owner,request_hash) DO UPDATE SET status='reserved',updated_at=excluded.updated_at
      WHERE drive_mutations.status='rejected' AND drive_mutations.body_hash=excluded.body_hash`,owner,requestHash,bodyHash,at).run();
    const row=await stmt('SELECT * FROM drive_mutations WHERE owner=? AND request_hash=?',owner,requestHash).first();
    if (row.body_hash!==bodyHash) throw Error('drive_request_replay_mismatch');
    return {claimed:Boolean(result.meta?.changes),status:row.status,fileId:row.provider_id,requestHash};
  }
  /** Persist the Google-generated ID before any upload; never replace it after uncertainty. */
  async function setMutationFileId(owner,requestKey,fileId) {
    validOwner(owner); if(typeof fileId!=='string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(fileId))throw Error('invalid_drive_id');
    const requestHash=await driveHash(requestKey);
    await stmt("UPDATE drive_mutations SET provider_id=?,updated_at=? WHERE owner=? AND request_hash=? AND status='reserved' AND provider_id IS NULL",fileId,now(),owner,requestHash).run();
    const row=await stmt('SELECT * FROM drive_mutations WHERE owner=? AND request_hash=?',owner,requestHash).first();
    if(!row?.provider_id)throw Error('drive_mutation_unavailable');
    return row.provider_id;
  }
  async function finishMutation(owner,requestKey,{status='created',fileId}={}) {
    validOwner(owner); if (!['created','rejected'].includes(status) || status==='created' && (typeof fileId!=='string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(fileId))) throw Error('invalid_drive_create_receipt');
    const result=await stmt("UPDATE drive_mutations SET status=?,updated_at=? WHERE owner=? AND request_hash=? AND status='reserved' AND (? IS NULL OR provider_id=?)",status,now(),owner,await driveHash(requestKey),fileId ?? null,fileId ?? null).run();
    if(!result.meta?.changes)throw Error('drive_mutation_unavailable');
  }
  return {ensureSchema,getConnection,putConnection,acquireLease,releaseLease,assertLease,createNonce,peekNonce,consumeNonce,disconnect,claimMutation,setMutationFileId,finishMutation};
}

