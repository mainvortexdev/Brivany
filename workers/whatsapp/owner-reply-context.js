// Una cita puede señalar un mensaje de Melodi o uno del propio titular: en los
// dos casos hace falta el texto exacto de aquel mensaje para saber de qué habla.
const MEMBERS=['melodi'];
export const OWNER_AUTHOR='owner';
const AUTHORS=[...MEMBERS,OWNER_AUTHOR];
export const REPLY_CONTEXT_SCHEMA=`CREATE TABLE IF NOT EXISTS wa_melodi_message_references (
  owner_phone TEXT NOT NULL,message_id TEXT NOT NULL,agent TEXT NOT NULL,
  encrypted_body TEXT NOT NULL,body_iv TEXT NOT NULL,sent_at TEXT NOT NULL,
  PRIMARY KEY(owner_phone,message_id))`;
const ownerNumber=env=>String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'');
const validId=id=>typeof id==='string' && id.length>0 && id.length<=500 && !/[\s\u0000]/.test(id);
export function messageAuthor(body,agent) {
  if(agent===OWNER_AUTHOR) return OWNER_AUTHOR;
  const prefix=String(body || '').match(/^(Melodi|Melodi|Melodi|Melodi):/i)?.[1]?.toLowerCase();
  if(agent && prefix && agent!==prefix) throw Error('reply_reference_author_mismatch');
  return MEMBERS.includes(agent || prefix) ? agent || prefix : null;
}
/** The provider id binds one visible message to its real author, within this owner. */
export async function recordOwnerMessageReference(env,{phone,messageId,body,agent,sentAt=new Date().toISOString(),encrypt}) {
  if(phone!==ownerNumber(env)) return {status:'not_owner'};
  const author=messageAuthor(body,agent);
  if(!author || !validId(messageId) || !String(body || '').trim()) return {status:'unavailable'};
  if(typeof encrypt!=='function') throw Error('reply_reference_encryption_unavailable');
  await env.VETSA_CLOUD.prepare(REPLY_CONTEXT_SCHEMA).run();
  const sealed=await encrypt({body:String(body).slice(0,4096)});
  await env.VETSA_CLOUD.prepare('INSERT OR IGNORE INTO wa_melodi_message_references(owner_phone,message_id,agent,encrypted_body,body_iv,sent_at) VALUES(?,?,?,?,?,?)')
    .bind(phone,messageId,author,sealed.encrypted,sealed.iv,sentAt).run();
  return {status:'recorded',agent:author};
}
export async function resolveOwnerReplyContext(env,phone,message,{decrypt}={}) {
  if(!message?.context?.id) return null;
  if(phone!==ownerNumber(env) || !validId(message.context.id) || typeof decrypt!=='function') throw Error('invalid_owner_reply_context');
  await env.VETSA_CLOUD.prepare(REPLY_CONTEXT_SCHEMA).run();
  const row=await env.VETSA_CLOUD.prepare('SELECT agent,encrypted_body,body_iv,sent_at FROM wa_melodi_message_references WHERE owner_phone=? AND message_id=?').bind(phone,message.context.id).first();
  if(!row || !AUTHORS.includes(row.agent)) return {status:'unavailable'};
  const decoded=await decrypt(row.encrypted_body,row.body_iv),payload=typeof decoded==='string' ? JSON.parse(decoded) : decoded;
  if(typeof payload?.body!=='string' || !payload.body.trim()) throw Error('invalid_owner_reply_context');
  return {status:'resolved',agent:row.agent,body:payload.body,sentAt:row.sent_at,messageId:message.context.id};
}
