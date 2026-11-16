import { workspaceSummaryRequest } from './owner-workspace-summary.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { autonomousArtifactJobId } from './melodi-artifact-tracking.js';

export const SUMMARY_REPAIR_MESSAGE='wamid.HBgLMTg0OTUyMDUyNDYVAgASGBQyQTk1NDUxQkU2QzFGMzk4NTlBRAA=';
export const SUMMARY_REPAIR_RECEIVED='2026-10-09T12:37:56.087Z';
export const SUMMARY_REPAIR_TEXT='Haz un resumen y envíamelo por email en 4 horas';
/** Exact reported request, verified against Melodi's own owner conversation. */
export async function repairWorkspaceSummary(env,{services,readRecent,prepare,now=Date.now()}={}) {
  if(env.TEAM_AUTONOMY_ENABLED!=='true' || env.REQUESTED_WORKSPACE_SUMMARY_REPAIR_REV!=='2026-10-09.1') return {status:'disabled'};
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''),db=env.VETSA_CLOUD,key=`workspace-summary-repair:${owner}:${SUMMARY_REPAIR_MESSAGE}`;
  if(owner!=='18495205246') return {status:'source_mismatch'};
  const marker=await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  if(marker?.state_value==='repaired' || marker?.state_value==='approval_required') return {status:'already_repaired'};
  const jobId=await autonomousArtifactJobId(owner,'generate_document',`owner-command:${SUMMARY_REPAIR_MESSAGE}:generate_document`);
  const existing=await db.prepare(`SELECT j.status,a.status AS artifact_status FROM wa_owner_jobs j
    LEFT JOIN wa_melodi_artifact_tracking a ON a.owner=j.owner_phone AND a.job_id=j.id WHERE j.id=? AND j.owner_phone=?`).bind(jobId,owner).first();
  if(existing?.status==='rejected' || existing?.artifact_status==='cancelled') return {status:'cancelled'};
  const received=await db.prepare('SELECT received_at FROM wa_messages WHERE message_id=?').bind(SUMMARY_REPAIR_MESSAGE).first();
  if(received?.received_at!==SUMMARY_REPAIR_RECEIVED) return {status:'source_mismatch'};
  if(now>=Date.parse(SUMMARY_REPAIR_RECEIVED)+4*3600000) return {status:'deadline_passed'};
  let interpretation;
  if(marker) {
    const sealed=JSON.parse(marker.state_value),saved=await services.decrypt(sealed.encrypted,sealed.iv);
    interpretation=typeof saved==='string' ? JSON.parse(saved) : saved;
  } else {
    const recent=await readRecent(owner,'melodi');
    const index=recent.findIndex(turn=>turn.role==='user' && String(turn.message).trim()===SUMMARY_REPAIR_TEXT
      && Math.abs(Date.parse(turn.at)-Date.parse(SUMMARY_REPAIR_RECEIVED))<120000);
    if(index<1) return {status:'source_unavailable'};
    interpretation=workspaceSummaryRequest(SUMMARY_REPAIR_TEXT,{agent:'melodi',recent:recent.slice(0,index),now:Date.parse(SUMMARY_REPAIR_RECEIVED)});
    if(!interpretation?.workspaceSummary) return {status:'source_mismatch'};
    const sealed=await services.encrypt(JSON.stringify(interpretation));
    await db.prepare('INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,?,?)').bind(key,JSON.stringify(sealed),new Date(now).toISOString()).run();
  }
  const notices=createDeliveryNotices(db,services);await notices.ensureSchema();
  await notices.enqueue({owner,agent:'melodi',key:`${key}:receipt`,ownerRequested:true,
    body:'Melodi: Tu pedido era preparar el resumen y enviarlo por correo en cuatro horas. Voy a retomarlo con los datos reales; la mención de Melodi no era una orden para actuar en tu PC.'});
  const result=await prepare({phone:owner,incoming:SUMMARY_REPAIR_TEXT,message:{id:SUMMARY_REPAIR_MESSAGE,type:'text'},interpretation,requestedAt:SUMMARY_REPAIR_RECEIVED,
    receiptSent:true,reply:body=>notices.enqueue({owner,agent:'melodi',key:`${key}:accepted`,ownerRequested:true,body})});
  if(!['accepted','approval_required'].includes(result.status)) throw Error('workspace_summary_repair_unconfirmed');
  await db.prepare('UPDATE worker_state SET state_value=?,updated_at=? WHERE state_key=?').bind(result.status==='accepted' ? 'repaired' : 'approval_required',new Date(now).toISOString(),key).run();
  return result;
}
