import {withGmailClient} from './gmail-auth.js';
import {gmailMessageText} from './gmail-client.js';
const TABLE=`CREATE TABLE IF NOT EXISTS brivany_review_drafts(request_id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,state TEXT NOT NULL,draft_id TEXT,message_id TEXT,updated_at INTEGER NOT NULL)`;
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function prepareReviewDraft(env,job,sendText,{useGmail=withGmailClient}={}){
 const owner=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
 if(job.confirmed!==true||job.ownerPhone!==owner||!/^\d{8,15}$/.test(owner)||job.to!=='hola@jonhernandez.education'||typeof job.subject!=='string'||job.subject.length>200||typeof job.body!=='string'||job.body.length>3000||!job.body.includes('https://youtu.be/iVE8Vx5Wseg')||!job.body.includes('https://demo.brivany.vetsa.es/download?ticket=')||!/^demo-jon-\d{8}-[a-z0-9-]+$/.test(job.requestId))throw Error('review_draft_invalid');
 await env.VETSA_CLOUD.prepare(TABLE).run();const bodyHash=await hash(JSON.stringify({to:job.to,subject:job.subject,body:job.body}));
 let row=await env.VETSA_CLOUD.prepare('SELECT * FROM brivany_review_drafts WHERE request_id=?').bind(job.requestId).first();
 if(row){if(row.body_hash!==bodyHash)throw Error('review_draft_content_changed');if(row.state==='delivered'||row.state==='uncertain')return {state:row.state,draftId:row.draft_id};}
 else{
  const claimed=await env.VETSA_CLOUD.prepare("INSERT OR IGNORE INTO brivany_review_drafts VALUES(?,?,'creating',NULL,NULL,?)").bind(job.requestId,bodyHash,Date.now()).run();if(!claimed.meta?.changes)return {state:'already_claimed'};
  try{
   const created=await useGmail(env,owner,async(client,{email})=>{
    if(email.toLowerCase()!=='felixdanielluna40@gmail.com')throw Error('review_draft_wrong_account');
    const draft=await client.createDraft({to:job.to,subject:job.subject,body:job.body});
    await env.VETSA_CLOUD.prepare("UPDATE brivany_review_drafts SET draft_id=?,state='created',updated_at=? WHERE request_id=? AND state='creating'").bind(draft.id,Date.now(),job.requestId).run();
    const observed=await client.getDraft(draft.id),message=gmailMessageText(observed.message);
    const decoded=message.subject.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi,(_,v)=>new TextDecoder().decode(Uint8Array.from(atob(v),c=>c.charCodeAt(0))));
    if(decoded!==job.subject||message.to!==job.to||message.body.replaceAll('\r\n','\n').trim()!==job.body.trim())throw Error('review_draft_readback_mismatch');
    return draft;
   });row={draft_id:created.id,state:'created'};
  }catch(error){await env.VETSA_CLOUD.prepare("UPDATE brivany_review_drafts SET state=CASE WHEN draft_id IS NULL THEN 'uncertain' ELSE 'created' END,updated_at=? WHERE request_id=?").bind(Date.now(),job.requestId).run();throw error;}
 }
 if(!row.draft_id||row.state!=='created')return {state:'already_claimed'};
 const claimed=await env.VETSA_CLOUD.prepare("UPDATE brivany_review_drafts SET state='notifying',updated_at=? WHERE request_id=? AND state='created'").bind(Date.now(),job.requestId).run();if(!claimed.meta?.changes)return {state:'already_claimed'};
 try{
  const text='Daniel, dejé este borrador guardado en tu Gmail para el equipo de Jon. No lo he enviado.\n\nPara: '+job.to+'\nAsunto: '+job.subject+'\n\n'+job.body+'\n\nLo encontrarás en Borradores de felixdanielluna40@gmail.com.';
  const receipt=await sendText(env,owner,text,{agent:'melodi'});if(!receipt?.messageId)throw Error('review_notification_unconfirmed');
  await env.VETSA_CLOUD.prepare("UPDATE brivany_review_drafts SET state='delivered',message_id=?,updated_at=? WHERE request_id=? AND state='notifying'").bind(receipt.messageId,Date.now(),job.requestId).run();return {state:'delivered',draftId:row.draft_id,messageId:receipt.messageId};
 }catch(error){await env.VETSA_CLOUD.prepare("UPDATE brivany_review_drafts SET state='uncertain',updated_at=? WHERE request_id=? AND state='notifying'").bind(Date.now(),job.requestId).run();throw error;}
}
