import {projectDocumentRequest,resolveProjectDocument,cogniraImpactReport} from './project-document-context.js';
import {autonomousArtifactJobId} from './melodi-artifact-tracking.js';
import {createDeliveryNotices} from './delivery-notice.js';
import {ensureDocumentQuality} from './document-quality.js';

export const PROJECT_REPAIR_MESSAGE='wamid.HBgLMTg0OTUyMDUyNDYVAgASGBQyQTg5M0FDODY0MTlERjNGRUQ4MAA=';
export const PROJECT_REPAIR_RECEIVED='2026-10-09T16:15:03.498Z';
export const PROJECT_REPAIR_JOB='auto-aDpU9KzqRm9ehjOEGwIZFQX8wrM77Cshy8FkhaWi1b';
export const PROJECT_REPAIR_FILENAME='informe-de-impacto-del-proyecto-en-la-vida-de-las-personas-2026-10-09.docx';
export const PROJECT_REPAIR_TEXT='Investiga y crea un documento donde se contemple que tan impactante es el proyecto en la vida de una persona, para que sirve el proyecto';
const normalized=value=>String(value || '').replace(/\s+/g,' ').trim();
/** Only this reported, delivered artifact is superseded. Retrying never transfers ownership. */
export async function repairProjectDocument(env,{services,prepare,now=Date.now()}={}) {
  if(env.TEAM_AUTONOMY_ENABLED!=='true' || env.REQUESTED_PROJECT_DOCUMENT_REPAIR_REV!=='2026-10-09.1')return {status:'disabled'};
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''),db=env.VETSA_CLOUD;
  if(owner!=='18495205246')return {status:'source_mismatch'};
  const key=`project-document-repair:${owner}:${PROJECT_REPAIR_MESSAGE}`,messageId=`${PROJECT_REPAIR_MESSAGE}:project-context-repair-v1`;
  const marker=await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  if(['repaired','approval_required'].includes(marker?.state_value))return {status:'already_repaired'};
  const jobId=await autonomousArtifactJobId(owner,'generate_document',`owner-command:${messageId}:generate_document`);
  const replacement=await db.prepare(`SELECT j.status,a.status AS artifact_status FROM wa_owner_jobs j
    LEFT JOIN wa_melodi_artifact_tracking a ON a.owner=j.owner_phone AND a.job_id=j.id WHERE j.id=? AND j.owner_phone=?`).bind(jobId,owner).first();
  if(replacement?.status==='rejected' || replacement?.artifact_status==='cancelled')return {status:'cancelled'};
  const source=await db.prepare(`SELECT j.encrypted_payload,j.payload_iv,j.job_type,j.status,a.agent,a.status AS artifact_status,d.file_name
    FROM wa_owner_jobs j JOIN wa_melodi_artifact_tracking a ON a.job_id=j.id AND a.owner=j.owner_phone
    JOIN wa_owner_documents d ON d.id=j.id AND d.owner_phone=j.owner_phone WHERE j.id=? AND j.owner_phone=?`).bind(PROJECT_REPAIR_JOB,owner).first();
  const received=await db.prepare('SELECT received_at FROM wa_messages WHERE message_id=?').bind(PROJECT_REPAIR_MESSAGE).first();
  if(!source || source.job_type!=='generate_document' || source.status!=='complete' || source.agent!=='melodi' || source.artifact_status!=='delivered'
    || source.file_name!==PROJECT_REPAIR_FILENAME || received?.received_at!==PROJECT_REPAIR_RECEIVED)return {status:'source_mismatch'};
  const old=await services.decrypt(source.encrypted_payload,source.payload_iv),payload=typeof old==='string' ? JSON.parse(old) : old;
  if(normalized(payload.prompt)!==PROJECT_REPAIR_TEXT)return {status:'source_mismatch'};
  let interpretation;
  if(marker){const sealed=JSON.parse(marker.state_value),saved=await services.decrypt(sealed.encrypted,sealed.iv);interpretation=typeof saved==='string' ? JSON.parse(saved):saved;}
  else {
    // The subject and addressee are established by the owner's screenshot, not guessed from another private conversation.
    const resolved=await resolveProjectDocument(env,owner,'Crea un documento sobre Cognira Desktop',{agent:'melodi',decrypt:services.decrypt});
    if(!resolved.project)return {status:'source_unavailable'};
    interpretation={...projectDocumentRequest(PROJECT_REPAIR_TEXT),agent:'melodi',title:'Utilidad e impacto de Cognira Desktop',
      projectSubject:resolved.project.name,sourceContent:cogniraImpactReport(resolved.project),preserveSourceContent:true,authoredDocument:true};
    const sealed=await services.encrypt(JSON.stringify(interpretation));
    await db.prepare('INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,?,?)').bind(key,JSON.stringify(sealed),new Date(now).toISOString()).run();
  }
  await ensureDocumentQuality(db);
  await db.prepare(`INSERT OR IGNORE INTO wa_document_quality_reviews(owner_phone,document_id,status,reason,replacement_job_id,reviewed_at)
    VALUES(?,?,'invalid','wrong_project_and_request_owner',?,?)`).bind(owner,PROJECT_REPAIR_JOB,jobId,new Date(now).toISOString()).run();
  const notices=createDeliveryNotices(db,services);await notices.ensureSchema();
  await notices.enqueue({owner,agent:'melodi',key:`${key}:receipt`,ownerRequested:true,
    body:'Melodi: Tu respuesta era a mi mensaje sobre Cognira Desktop. Melodi recibió el encargo por un fallo de contexto y el documento que recibiste no describe ese proyecto. Lo marqué como incorrecto y retomaré tu solicitud con fuentes del proyecto; Melodi redactará el informe, conservando mi responsabilidad.'});
  let responseIndex=0;
  const result=await prepare({phone:owner,incoming:PROJECT_REPAIR_TEXT,message:{id:messageId,type:'text'},interpretation,
    requestedAt:PROJECT_REPAIR_RECEIVED,receiptSent:true,reply:body=>{
      const agent=String(body).match(/^(Melodi|Melodi|Melodi|Melodi):/i)?.[1]?.toLowerCase() || 'melodi';
      return notices.enqueue({owner,agent,key:`${key}:accepted:${responseIndex++}`,ownerRequested:true,body});
    }});
  if(!['accepted','approval_required'].includes(result.status))throw Error('project_document_repair_unconfirmed');
  await db.prepare('UPDATE worker_state SET state_value=?,updated_at=? WHERE state_key=?').bind(result.status==='accepted'?'repaired':'approval_required',new Date(now).toISOString(),key).run();
  return result;
}
