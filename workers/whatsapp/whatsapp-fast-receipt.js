/** A lightweight receipt acknowledges durable inbound acceptance only. It has
 * its own ledger: sending it must never make the actual request resume-only. */
export const FAST_OWNER_RECEIPT_SCHEMA = `CREATE TABLE IF NOT EXISTS wa_fast_owner_receipts (
  owner TEXT NOT NULL,message_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','uncertain','skipped')),
  lease_token TEXT,lease_until INTEGER,body_encrypted TEXT,body_iv TEXT,
  receipt_encrypted TEXT,receipt_iv TEXT,reason TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner,message_hash))`;

const VARIANTS = Object.freeze({
  review: 'Vale, Daniel, ya tengo tu mensaje. Lo reviso y te respondo.',
  received: 'Ya tengo tu mensaje, Daniel. Lo reviso y te respondo.',
  on_it: 'Vale, Daniel. Revisaré tu mensaje y te respondo en cuanto tenga el resultado.',
});
const MAX_AGE_MS = 60000, LEASE_MS = 10000;
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

function source(env,envelope) {
  if(env.TEAM_CONVERSATION_LEADER!=='melodi' || env.VETSA_APP_CHAT)return null;
  if(envelope?.entry?.length!==1 || envelope.entry[0]?.changes?.length!==1)return null;
  const value=envelope.entry[0].changes[0].value,message=value?.messages?.[0];
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'');
  if(value?.messages?.length!==1 || !/^\d{8,15}$/.test(owner) || message?.from!==owner
    || value?.metadata?.phone_number_id!==env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_PHONE_NUMBER_ID
    || message.type!=='text' || message.context?.id || typeof message.text?.body!=='string' || !message.text.body.trim()
    || message.text.body.length>12000 || typeof message.id!=='string' || !message.id || message.id.length>300
    || /[\u0000-\u001f]/.test(message.id) || !/^\d{10,11}$/.test(message.timestamp || ''))return null;
  return {owner,messageId:message.id,receivedAt:Number(message.timestamp)*1000};
}
function selectedVariant(result) {
  try {
    const raw=result?.text ?? result?.response ?? result;
    const decoded=typeof raw==='string'?JSON.parse(raw):raw;
    return decoded && !Array.isArray(decoded) && Object.keys(decoded).length===1
      && typeof decoded.variant==='string' && Object.hasOwn(VARIANTS,decoded.variant) ? decoded.variant : 'review';
  } catch {return 'review';}
}
async function chooseVariant(generate,budgetMs) {
  if(typeof generate!=='function' || budgetMs<=0)return 'review';
  const controller=new AbortController();let timer;
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve('review');},budgetMs);});
  // The model sees no owner text or tool context. It can choose a known voice
  // variant, never compose a promise or claim that an action was executed.
  const generated=Promise.resolve().then(()=>generate({
    model:'spaik-flash',contents:JSON.stringify({variants:Object.keys(VARIANTS)}),
    options:{systemPrompt:'Elige una variante de acuse breve. Devuelve solo JSON con una propiedad variant: review, received u on_it.',max_tokens:24,jsonMode:true,temperature:0.3},
  },{signal:controller.signal,purpose:'fast_receipt',budgetMs})).then(selectedVariant,()=> 'review');
  try{return await Promise.race([generated,deadline]);}finally{clearTimeout(timer);}
}

/** Call only after MELODI_JOBS.send() has resolved for this exact envelope.
 * Root owns the candidate decision (e.g. omit simple reminders and greetings).
 * A failure here never changes the actual task's processing/effects tables.
 * now may be a timestamp or a test clock; budget bounds optional generation. */
export async function sendFastOwnerReceipt(env,envelope,{
  accepted=false,services,sendRaw,generate,now=()=>Date.now(),budgetMs=200,
}={}) {
  if(accepted!==true)return {status:'skipped',reason:'not_durably_accepted'};
  const identity=source(env,envelope);
  if(!identity)return {status:'skipped',reason:'ineligible_source'};
  if(!env.VETSA_CLOUD?.prepare || typeof services?.encrypt!=='function' || typeof services?.decrypt!=='function' || typeof sendRaw!=='function')return {status:'skipped',reason:'unavailable'};
  const clock=()=>{const value=typeof now==='function'?now():now;return value instanceof Date?value.getTime():Number(value);};
  const firstAt=clock();
  if(!Number.isSafeInteger(firstAt) || firstAt<0 || !Number.isFinite(identity.receivedAt))return {status:'skipped',reason:'invalid_clock'};
  const boundedBudget=Math.max(0,Math.min(200,Number.isFinite(budgetMs)?Math.trunc(budgetMs):200));
  const db=typeof env.VETSA_CLOUD.withSession==='function'?env.VETSA_CLOUD.withSession('first-primary'):env.VETSA_CLOUD;
  const query=(sql,...values)=>db.prepare(sql).bind(...values);
  const messageHash=await sha256(`${identity.owner}\u0000${identity.messageId}`);
  let token, sending=false;
  const setTerminal=async(status,reason,at)=>query(`UPDATE wa_fast_owner_receipts SET status=?,reason=?,lease_token=NULL,lease_until=NULL,updated_at=?
    WHERE owner=? AND message_hash=? AND lease_token=?`,status,reason,at,identity.owner,messageHash,token).run();
  async function lateReason() {
    const at=clock();
    if(at-identity.receivedAt>MAX_AGE_MS)return 'stale_source';
    if(identity.receivedAt-at>5*60000)return 'future_source';
    const exists=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='wa_message_processing'").first();
    if(!exists)return null;
    const processing=await query('SELECT status,response_encrypted FROM wa_message_processing WHERE owner=? AND message_id=?',identity.owner,identity.messageId).first();
    if(['done','uncertain'].includes(processing?.status))return 'request_already_settled';
    return processing?.response_encrypted ? 'response_already_prepared' : null;
  }
  try {
    await db.prepare(FAST_OWNER_RECEIPT_SCHEMA).run();
    await query(`INSERT OR IGNORE INTO wa_fast_owner_receipts(owner,message_hash,status,created_at,updated_at) VALUES(?,?,'pending',?,?)`,identity.owner,messageHash,firstAt,firstAt).run();
    // A worker may have died after provider acceptance. Expired transport
    // intent is quarantined, while an expired preparation is safe to claim.
    await query(`UPDATE wa_fast_owner_receipts SET status='uncertain',reason='transport_lease_expired',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE owner=? AND message_hash=? AND status='sending' AND lease_until<=?`,firstAt,identity.owner,messageHash,firstAt).run();
    token=crypto.randomUUID();
    const claimed=await query(`UPDATE wa_fast_owner_receipts SET lease_token=?,lease_until=?,updated_at=?
      WHERE owner=? AND message_hash=? AND status='pending' AND (lease_token IS NULL OR lease_until<=?) RETURNING status`,
      token,firstAt+LEASE_MS,firstAt,identity.owner,messageHash,firstAt).first();
    if(!claimed){const existing=await query('SELECT status FROM wa_fast_owner_receipts WHERE owner=? AND message_hash=?',identity.owner,messageHash).first();return {status:existing?.status || 'skipped',duplicate:true};}
    const before=await lateReason();
    if(before){await setTerminal('skipped',before,clock());return {status:'skipped',reason:before};}
    const variant=await chooseVariant(generate,boundedBudget),body=VARIANTS[variant];
    const sealed=await services.encrypt(JSON.stringify({owner:identity.owner,messageHash,variant,body}));
    if(typeof sealed?.encrypted!=='string' || !sealed.encrypted || typeof sealed.iv!=='string' || !sealed.iv)throw Error('receipt_encryption_failed');
    const decoded=await services.decrypt(sealed.encrypted,sealed.iv),verified=typeof decoded==='string'?JSON.parse(decoded):decoded;
    if(verified?.owner!==identity.owner || verified.messageHash!==messageHash || verified.body!==body || verified.variant!==variant)throw Error('receipt_encryption_mismatch');
    const after=await lateReason();
    if(after){await setTerminal('skipped',after,clock());return {status:'skipped',reason:after};}
    const at=clock();
    const ready=await query(`UPDATE wa_fast_owner_receipts SET status='sending',body_encrypted=?,body_iv=?,lease_until=?,updated_at=?
      WHERE owner=? AND message_hash=? AND status='pending' AND lease_token=? AND lease_until>? RETURNING status`,
      sealed.encrypted,sealed.iv,at+LEASE_MS,at,identity.owner,messageHash,token,at).first();
    if(!ready)return {status:'skipped',reason:'lease_lost'};
    sending=true;
    const receipt=await sendRaw(env,identity.owner,body,{agent:'melodi',purpose:'fast_receipt'});
    if(receipt?.status!=='sent' || typeof receipt.messageId!=='string' || !receipt.messageId)throw Error('fast_receipt_unconfirmed');
    const confirmed=await services.encrypt(JSON.stringify({owner:identity.owner,messageHash,status:'sent',messageId:receipt.messageId}));
    if(typeof confirmed?.encrypted!=='string' || !confirmed.encrypted || typeof confirmed.iv!=='string' || !confirmed.iv)throw Error('receipt_encryption_failed');
    const saved=await query(`UPDATE wa_fast_owner_receipts SET status='sent',receipt_encrypted=?,receipt_iv=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE owner=? AND message_hash=? AND status='sending' AND lease_token=? RETURNING status`,
      confirmed.encrypted,confirmed.iv,clock(),identity.owner,messageHash,token).first();
    return saved?{status:'sent',messageId:receipt.messageId}:{status:'uncertain',reason:'receipt_not_owned'};
  }catch{
    if(token)try{await setTerminal(sending?'uncertain':'skipped',sending?'transport_unconfirmed':'receipt_unavailable',clock());}catch{}
    return {status:sending?'uncertain':'skipped',reason:sending?'transport_unconfirmed':'receipt_unavailable'};
  }
}
