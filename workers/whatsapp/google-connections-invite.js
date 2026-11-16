import {gmailConfigured,createGmailLink,gmailOwner} from './gmail-auth.js';
import {createGmailStore} from './gmail-store.js';
import {driveConfigured,createDriveLink} from './drive-auth.js';
import {createDriveStore} from './drive-store.js';
import {createDeliveryNotices} from './delivery-notice.js';

/** One invitation requested by the owner when the redesigned assistant is
 * ready. Consent remains interactive; creating a link grants no account access. */
export async function ensureRequestedGoogleConnectionsInvite(env,{services,now=Date.now()}={}){
  const revision=env.REQUESTED_GOOGLE_CONNECTIONS_INVITE_REV;
  if(!revision || !gmailConfigured(env) || !driveConfigured(env))return{status:'disabled'};
  const owner=gmailOwner(env),key=`requested-google-connections:${revision}`;
  if(await env.VETSA_CLOUD.prepare('SELECT state_key FROM worker_state WHERE state_key=?').bind(key).first())return{status:'already_invited'};
  const gmail=createGmailStore(env),drive=createDriveStore(env);await Promise.all([gmail.ensureSchema(),drive.ensureSchema()]);
  const [mailConnection,driveConnection]=await Promise.all([gmail.getConnection(owner),drive.getConnection(owner)]);
  const links=[];
  if(mailConnection?.status!=='connected')links.push(`Gmail: ${(await createGmailLink(env,{store:gmail,now})).url}`);
  if(driveConnection?.status!=='connected')links.push(`Drive: ${(await createDriveLink(env,{store:drive,now})).url}`);
  if(!links.length)return{status:'connected'};
  const notices=createDeliveryNotices(env.VETSA_CLOUD,{...services,now:()=>now});await notices.ensureSchema();
  const notice=await notices.enqueue({owner,agent:'melodi',key,ownerRequested:true,
    body:`Para que pueda usar tu correo y tus archivos, autoriza las conexiones aquí:\n\n${links.join('\n\n')}\n\nGoogle te mostrará los permisos antes de aceptar. Los enlaces son personales y duran 24 horas.`});
  await env.VETSA_CLOUD.prepare("INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,'invited',?)")
    .bind(key,new Date(now).toISOString()).run();
  await env.MELODI_JOBS?.send({type:'autonomy_outbox'});
  return{status:'invited',noticeId:notice.id};
}
