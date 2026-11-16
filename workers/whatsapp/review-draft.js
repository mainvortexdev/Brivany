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

// A separate, explicit owner action sends the previously reviewed content.
// Creating or delivering a draft can never imply permission to send it.
export async function sendReviewedDraft(env,job,sendEmail,sendText,{useGmail=withGmailClient,fetcher=fetch}={}){
 const owner=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
 if(job.confirmed!==true||job.ownerPhone!==owner||job.from!=='daniel@vetsa.es'||job.to!=='hola@jonhernandez.education'||!/^demo-jon-\d{8}-[a-z0-9-]+$/.test(job.reviewRequestId)||!/^demo-jon-send-\d{8}-[a-z0-9-]+$/.test(job.requestId)||typeof sendEmail!=='function'||typeof sendText!=='function')throw Error('review_send_not_authorized');
 await env.VETSA_CLOUD.prepare(`CREATE TABLE IF NOT EXISTS brivany_review_sends(request_id TEXT PRIMARY KEY,review_id TEXT NOT NULL,state TEXT NOT NULL,email_id TEXT,whatsapp_id TEXT,error_code TEXT,updated_at INTEGER NOT NULL)`).run();
 const prior=await env.VETSA_CLOUD.prepare('SELECT state,email_id,whatsapp_id FROM brivany_review_sends WHERE request_id=?').bind(job.requestId).first();if(prior)return prior;
 const review=await env.VETSA_CLOUD.prepare('SELECT * FROM brivany_review_drafts WHERE request_id=?').bind(job.reviewRequestId).first();
 if(!review?.draft_id||review.state!=='delivered')throw Error('review_draft_not_ready');
 const claimed=await env.VETSA_CLOUD.prepare("INSERT OR IGNORE INTO brivany_review_sends VALUES(?,?,'checking',NULL,NULL,NULL,?)").bind(job.requestId,job.reviewRequestId,Date.now()).run();if(!claimed.meta?.changes)return {state:'already_claimed'};
 let attemptingEmail=false,emailAccepted=false;
 try{
  const message=await useGmail(env,owner,async(client,{email})=>{
   if(email.toLowerCase()!=='felixdanielluna40@gmail.com')throw Error('review_draft_wrong_account');
   const draft=await client.getDraft(review.draft_id),value=gmailMessageText(draft.message);
   value.subject=value.subject.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi,(_,v)=>new TextDecoder().decode(Uint8Array.from(atob(v),c=>c.charCodeAt(0))));
   value.body=value.body.replaceAll('\r\n','\n').trim();
   if(value.to!==job.to||await hash(JSON.stringify({to:value.to,subject:value.subject,body:value.body}))!==review.body_hash)throw Error('review_draft_content_changed');
   return value;
  });
  if(!env.BREVO_API_KEY)throw Error('review_mail_not_configured');
  const probe=async path=>{
   const response=await fetcher('https://api.brevo.com/v3/'+path,{headers:{'api-key':env.BREVO_API_KEY,accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(!response.ok){await response.body?.cancel();throw Error('review_sender_check_failed');}
   return response.json();
  };
  const [domain,listing]=await Promise.all([probe('senders/domains/vetsa.es'),probe('senders?domain=vetsa.es')]);
  if(domain.verified!==true||domain.authenticated!==true||!listing.senders?.some(s=>s.email?.toLowerCase()===job.from&&s.active===true))throw Error('review_sender_not_verified');
  attemptingEmail=true;
  const receipt=await sendEmail(env,owner,job.requestId,{to:job.to,from:job.from,subject:message.subject,body:message.body,senderName:'Daniel Luna',agent:'melodi'});
  if(receipt?.status!=='sent'||!receipt.messageId||receipt.sender!==job.from||receipt.recipient!==job.to)throw Error('review_email_unconfirmed');
  emailAccepted=true;
  await env.VETSA_CLOUD.prepare("UPDATE brivany_review_sends SET state='email_accepted',email_id=?,updated_at=? WHERE request_id=?").bind(receipt.messageId,Date.now(),job.requestId).run();
  const notification=await sendText(env,owner,'Daniel, ya envié el correo desde daniel@vetsa.es a hola@jonhernandez.education con el asunto «'+message.subject+'». Incluye la demo de YouTube, el instalador privado, la guía de prueba y el aviso de que revocaremos el acceso y las claves de demostración cuando terminen. El servicio de correo confirmó la aceptación del envío.',{agent:'melodi'});
  if(!notification?.messageId)throw Error('review_notification_unconfirmed');
  await env.VETSA_CLOUD.prepare("UPDATE brivany_review_sends SET state='notified',whatsapp_id=?,updated_at=? WHERE request_id=?").bind(notification.messageId,Date.now(),job.requestId).run();return {state:'notified',emailId:receipt.messageId,whatsappId:notification.messageId};
 }catch(error){
  const reason=String(error?.message||'review_send_failed');const code=/^review_[a-z_]+$/.test(reason)?reason:'review_send_failed';
  await env.VETSA_CLOUD.prepare('UPDATE brivany_review_sends SET state=?,error_code=?,updated_at=? WHERE request_id=?').bind(emailAccepted?'notification_uncertain':attemptingEmail?'email_uncertain':'preflight_failed',code,Date.now(),job.requestId).run();throw error;
 }
}
