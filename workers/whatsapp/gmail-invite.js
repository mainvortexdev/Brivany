import { gmailConfigured, createGmailLink, gmailOwner } from './gmail-auth.js';
import { createGmailStore } from './gmail-store.js';
import { createDeliveryNotices } from './delivery-notice.js';

/** One private invitation for the owner's explicit request to connect Gmail.
 * This offers consent; it cannot itself grant access to the account. */
export async function ensureRequestedGmailInvite(env,{services,now=Date.now()}={}) {
  if (!gmailConfigured(env) || !env.REQUESTED_GMAIL_INVITE_REV) return {status:'unconfigured'};
  const owner=gmailOwner(env),store=createGmailStore(env);
  await store.ensureSchema();
  if ((await store.getConnection(owner))?.status==='connected') return {status:'connected'};
  const key=`gmail-owner-invite:${env.REQUESTED_GMAIL_INVITE_REV}`;
  if (await env.VETSA_CLOUD.prepare('SELECT state_key FROM worker_state WHERE state_key=?').bind(key).first()) return {status:'already_invited'};
  const link=await createGmailLink(env,{store,now});
  if (!link.configured) return {status:'unconfigured'};
  const notices=createDeliveryNotices(env.VETSA_CLOUD,{...services,now:()=>now}); await notices.ensureSchema();
  const notice=await notices.enqueue({owner,agent:'melodi',key,ownerRequested:true,
    body:`Daniel, aquí puedes conectar tu Gmail: ${link.url}\nGoogle te mostrará el acceso completo antes de aceptar. Este enlace es personal y vence en 24 horas.`});
  await env.VETSA_CLOUD.prepare("INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,'invited',?)")
    .bind(key,new Date(now).toISOString()).run();
  if (env.MELODI_JOBS?.send) await env.MELODI_JOBS.send({type:'autonomy_outbox'});
  return {status:'invited',noticeId:notice.id};
}
