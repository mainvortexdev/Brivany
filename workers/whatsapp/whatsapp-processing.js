/**
 * Durable inbox receipts. Keep these separate from legacy wa_messages: a seen
 * message is not a completed message. There is deliberately no automatic replay
 * after an external effect may have happened. Call started BEFORE the effect.
 * All response/receipt content is encrypted; this module never logs content.
 */
export const WHATSAPP_PROCESSING_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_message_processing (
    owner TEXT NOT NULL, message_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','done','retryable','uncertain')),
    attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, resume_only INTEGER NOT NULL DEFAULT 0,
    response_encrypted TEXT, response_iv TEXT, error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,message_id))`,
  `CREATE TABLE IF NOT EXISTS wa_message_effects (
    owner TEXT NOT NULL, message_id TEXT NOT NULL, effect_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('action','response')),
    status TEXT NOT NULL CHECK(status IN ('started','confirmed','rejected')),
    attempt_token TEXT NOT NULL, receipt_encrypted TEXT, receipt_iv TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,message_id,effect_key),
    FOREIGN KEY(owner,message_id) REFERENCES wa_message_processing(owner,message_id))`,
  `CREATE INDEX IF NOT EXISTS wa_message_processing_lease ON wa_message_processing(status,lease_until)`,
]);

const textId = (value,max,label) => {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value)) throw new TypeError('invalid_'+label);
  return value;
};
const timestamp = value => {
  const number = value instanceof Date ? value.getTime() : Number(value);
  if(!Number.isSafeInteger(number)||number<0) throw new TypeError('invalid_processing_time');
  return number;
};
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
}

export function createWhatsAppProcessing(database,{encrypt,decrypt,now=()=>Date.now(),uuid=()=>crypto.randomUUID(),leaseMs=180000,maxAttempts=5}={}) {
  if(!database?.prepare||!database?.batch||typeof encrypt!=='function'||typeof decrypt!=='function') throw new TypeError('processing_requires_database_and_encryption');
  if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>15*60000||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>20) throw new TypeError('invalid_processing_limits');
  // A per-request primary session preserves read-after-write if replicas are
  // enabled. Never share this session or a claim across owners/requests.
  const db = typeof database.withSession==='function' ? database.withSession('first-primary') : database;
  const query=(sql,...args)=>db.prepare(sql).bind(...args);
  const scope=({owner,messageId,token},needsToken=false)=>{
    textId(owner,160,'processing_owner');textId(messageId,300,'processing_message');
    if(needsToken) textId(token,100,'processing_token');
  };
  const live='owner=? AND message_id=? AND status=\'processing\' AND lease_token=? AND lease_until>?';
  const seal=async value=>{
    const json=JSON.stringify(value);
    if(!json||json.length>24000) throw new TypeError('invalid_processing_payload');
    const sealed=await encrypt(json);
    if(typeof sealed?.encrypted!=='string'||!sealed.encrypted||typeof sealed?.iv!=='string'||!sealed.iv) throw new Error('processing_encryption_failed');
    return sealed;
  };
  const unseal=async(encrypted,iv)=>{
    const value=await decrypt(encrypted,iv);
    return typeof value==='string'?JSON.parse(value):value;
  };
  const record=({owner,messageId})=>query('SELECT * FROM wa_message_processing WHERE owner=? AND message_id=?',owner,messageId).first();
  async function ensureSchema(){await db.batch(WHATSAPP_PROCESSING_SCHEMA.map(sql=>db.prepare(sql)));}
  async function effects({owner,messageId}){
    const rows=(await query('SELECT * FROM wa_message_effects WHERE owner=? AND message_id=? ORDER BY created_at,effect_key',owner,messageId).all()).results||[];
    return Promise.all(rows.map(async row=>({key:row.effect_key,kind:row.kind,status:row.status,
      receipt:row.receipt_encrypted?await unseal(row.receipt_encrypted,row.receipt_iv):null})));
  }
  async function begin(input){
    scope(input);const {owner,messageId}=input,at=timestamp(now());
    let row=await record(input);
    if(!row){
      const legacy=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='wa_messages'").first();
      if(legacy&&await query('SELECT message_id FROM wa_messages WHERE message_id=?',messageId).first()) return {action:'legacy',status:'uncertain',retry:false};
      await query(`INSERT OR IGNORE INTO wa_message_processing(owner,message_id,created_at,updated_at) VALUES(?,?,?,?)`,owner,messageId,at,at).run();
    }
    // An expired operation with an effect intent may have succeeded remotely.
    // Confirmed effects can resume delivery/status only, never the model/tools.
    await query(`UPDATE wa_message_processing SET status=CASE WHEN attempts>=? OR EXISTS(
      SELECT 1 FROM wa_message_effects e WHERE e.owner=wa_message_processing.owner AND e.message_id=wa_message_processing.message_id AND e.status='started')
      THEN 'uncertain' ELSE 'retryable' END,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE owner=? AND message_id=? AND status='processing' AND lease_until<=?`,maxAttempts,at,owner,messageId,at).run();
    const token=uuid();
    row=await query(`UPDATE wa_message_processing SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?,
      resume_only=CASE WHEN response_encrypted IS NOT NULL OR EXISTS(SELECT 1 FROM wa_message_effects e WHERE e.owner=wa_message_processing.owner AND e.message_id=wa_message_processing.message_id AND e.status='confirmed') THEN 1 ELSE 0 END
      WHERE owner=? AND message_id=? AND status IN ('received','retryable') AND attempts<?
      AND (?=0 OR NOT EXISTS(SELECT 1 FROM wa_message_processing other WHERE other.owner=? AND other.message_id<>?
        AND other.status='processing' AND other.lease_until>?)) RETURNING *`,token,at+leaseMs,at,owner,messageId,maxAttempts,Number(input.serializeOwner===true),owner,messageId,at).first();
    if(!row&&input.serializeOwner===true&&await query("SELECT message_id FROM wa_message_processing WHERE owner=? AND message_id<>? AND status='processing' AND lease_until>? LIMIT 1",owner,messageId,at).first())return{action:'busy',status:'waiting_for_owner_turn',retry:true,retryAfterMs:1000};
    if(!row){row=await record(input);return {action:row?.status==='processing'?'busy':row?.status==='done'?'done':'uncertain',status:row?.status||'uncertain',retry:row?.status==='processing',retryAfterMs:Math.max(1000,(row?.lease_until||at+1000)-at)};}
    try{
      const receipts=await effects(input),response=row.response_encrypted?await unseal(row.response_encrypted,row.response_iv):null;
      return {action:row.resume_only?'resume':'process',status:'processing',owner,messageId,token,
        leaseUntil:row.lease_until,attempts:row.attempts,response,effects:receipts,retry:false};
    }catch{
      await query(`UPDATE wa_message_processing SET status='uncertain',error_code='receipt_decryption_failed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE ${live}`,at,owner,messageId,token,at).run();
      return {action:'uncertain',status:'uncertain',retry:false};
    }
  }
  async function heartbeat(input){
    scope(input,true);const at=timestamp(now()),{owner,messageId,token}=input;
    return Boolean(await query(`UPDATE wa_message_processing SET lease_until=?,updated_at=? WHERE ${live} RETURNING message_id`,at+leaseMs,at,owner,messageId,token,at).first());
  }
  async function saveResponse(input){
    scope(input,true);const {owner,messageId,token,response}=input,sealed=await seal(response),at=timestamp(now());
    // Save once. A retry cannot replace a response prepared by the first run.
    return Boolean(await query(`UPDATE wa_message_processing SET response_encrypted=?,response_iv=?,updated_at=? WHERE ${live}
      AND response_encrypted IS NULL RETURNING message_id`,sealed.encrypted,sealed.iv,at,owner,messageId,token,at).first());
  }
  async function markExternalEffect(input){
    scope(input,true);const {owner,messageId,token,phase='started',kind='action',receipt}=input,key=await digest(textId(input.effectKey,500,'processing_effect')),at=timestamp(now());
    if(!['started','confirmed','rejected'].includes(phase)||!['action','response'].includes(kind))throw new TypeError('invalid_effect_phase');
    if(phase==='started'){
      const inserted=await query(`INSERT OR IGNORE INTO wa_message_effects(owner,message_id,effect_key,kind,status,attempt_token,created_at,updated_at)
        SELECT owner,message_id,?,?,'started',?,?,? FROM wa_message_processing WHERE ${live} AND (resume_only=0 OR ?='response') RETURNING effect_key`,key,kind,token,at,at,owner,messageId,token,at,kind).first();
      if(inserted)return {allowed:true,status:'started'};
      const restarted=await query(`UPDATE wa_message_effects SET status='started',attempt_token=?,receipt_encrypted=NULL,receipt_iv=NULL,updated_at=?
        WHERE owner=? AND message_id=? AND effect_key=? AND kind=? AND status='rejected'
        AND EXISTS(SELECT 1 FROM wa_message_processing WHERE ${live} AND (resume_only=0 OR ?='response')) RETURNING effect_key`,token,at,owner,messageId,key,kind,owner,messageId,token,at,kind).first();
      if(restarted)return {allowed:true,status:'started'};
      const existing=await query('SELECT status FROM wa_message_effects WHERE owner=? AND message_id=? AND effect_key=?',owner,messageId,key).first();
      return {allowed:false,status:existing?.status||'lease_lost'};
    }
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw new TypeError('effect_requires_receipt');
    const sealed=await seal(receipt);
    const changed=await query(`UPDATE wa_message_effects SET status=?,receipt_encrypted=?,receipt_iv=?,updated_at=?
      WHERE owner=? AND message_id=? AND effect_key=? AND kind=? AND status='started' AND attempt_token=?
      AND EXISTS(SELECT 1 FROM wa_message_processing WHERE ${live}) RETURNING effect_key`,phase,sealed.encrypted,sealed.iv,at,owner,messageId,key,kind,token,owner,messageId,token,at).first();
    return {allowed:Boolean(changed),status:changed?phase:'lease_lost'};
  }
  async function finish(input){
    scope(input,true);const {owner,messageId,token}=input,at=timestamp(now());
    return Boolean(await query(`UPDATE wa_message_processing SET status='done',lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=?
      WHERE ${live} AND NOT EXISTS(SELECT 1 FROM wa_message_effects e WHERE e.owner=? AND e.message_id=? AND e.status='started') RETURNING message_id`,at,owner,messageId,token,at,owner,messageId).first());
  }
  async function fail(input){
    scope(input,true);const {owner,messageId,token,retryable=true,code='processing_failed'}=input,at=timestamp(now());
    if(typeof retryable!=='boolean'||typeof code!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(code))throw new TypeError('invalid_processing_failure');
    const row=await query(`UPDATE wa_message_processing SET status=CASE WHEN ?=1 AND attempts<? AND NOT EXISTS(
      SELECT 1 FROM wa_message_effects e WHERE e.owner=? AND e.message_id=? AND e.status='started') THEN 'retryable' ELSE 'uncertain' END,
      error_code=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE ${live} RETURNING status`,Number(retryable),maxAttempts,owner,messageId,code,at,owner,messageId,token,at).first();
    // A stale worker must not ACK away the only Queue delivery. A retry goes
    // through begin(), which either waits for the rightful worker or safely
    // recovers/quarantines the expired claim before any model/tool can run.
    return {updated:Boolean(row),status:row?.status||'lease_lost',retry:!row||row.status==='retryable'};
  }
  async function handoff(input){
    scope(input,true);const {owner,messageId,token}=input,at=timestamp(now());
    // Transfer only a frozen plan with zero external effects or prepared sends.
    // It is not a failed attempt; a stale inline worker loses its token here.
    return Boolean(await query(`UPDATE wa_message_processing SET status='retryable',attempts=MAX(0,attempts-1),
      lease_token=NULL,lease_until=NULL,error_code='plan_handoff',updated_at=? WHERE ${live}
      AND resume_only=0 AND response_encrypted IS NULL AND NOT EXISTS(SELECT 1 FROM wa_message_effects e WHERE e.owner=? AND e.message_id=?) RETURNING message_id`,
      at,owner,messageId,token,at,owner,messageId).first());
  }
  return Object.freeze({ensureSchema,begin,heartbeat,saveResponse,markExternalEffect,finish,fail,handoff});
}
