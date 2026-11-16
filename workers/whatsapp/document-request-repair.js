import { autonomousArtifactJobId, createArtifactTracker } from './melodi-artifact-tracking.js';
import { registerDocumentSchedule } from './document-schedules.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { documentRequestLine } from './document-timing.js';
import { localEventTime } from './event-time.js';
import { REQUESTED_DOCUMENT_CONTENT } from './document-request-repair-content.js';

// This bounded repair addresses the exact owner-reported document, never a model-selected job.
export const DOCUMENT_REPAIR_SOURCE='auto-Cmh2lcdFom7ogJKgzRku2OfysturdxogNTswxqIcMo';
export const DOCUMENT_REPAIR_EVENT='295f197a-50d6-4da1-8f9d-82681e60c7ef';
export async function repairRequestedDocument(env,{services,now=Date.now()}={}) {
  if(env.TEAM_AUTONOMY_ENABLED!=='true' || env.REQUESTED_DOCUMENT_REPAIR_REV!=='2026-10-08.1') return {status:'disabled'};
  const owner=String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),db=env.VETSA_CLOUD;
  if(!owner) return {status:'disabled'};
  const key=`document-repair:${owner}:${DOCUMENT_REPAIR_SOURCE}:${env.REQUESTED_DOCUMENT_REPAIR_REV}`;
  const marker=await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  if(marker) return {status:'already_repaired',jobId:marker.state_value};
  const source=await db.prepare(`SELECT j.* FROM wa_owner_jobs j JOIN wa_owner_documents d ON d.id=j.id AND d.owner_phone=j.owner_phone
    WHERE j.id=? AND j.owner_phone=? AND j.job_type='generate_document' AND j.status='complete' AND d.file_name=?`)
    .bind(DOCUMENT_REPAIR_SOURCE,owner,'documento-2026-10-08-auto-Cmh.docx').first();
  if(!source) return {status:'source_unavailable'};
  let payload=await services.decrypt(source.encrypted_payload,source.payload_iv);
  if(typeof payload==='string') payload=JSON.parse(payload);
  const command=documentRequestLine(payload?.prompt).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  if(payload?.deliveryMode!=='private' || payload.autonomyAgent!=='melodi' || payload.kind!=='document' || payload.format!=='docx'
    || !/\bpara ese mismo dia\b/.test(command) || !/\bdocumento\b/.test(command)) return {status:'source_mismatch'};
  const event=await db.prepare(`SELECT id,title,event_at FROM melodi_calendar_events WHERE id=? AND phone=? AND assigned_agent='melodi' AND reminded_at IS NULL`)
    .bind(DOCUMENT_REPAIR_EVENT,owner).first();
  if(!event || !/^terminar toda la integración de Alexa AI en el ecosistema de Electro Wisly\.?$/i.test(event.title)
    || !Number.isFinite(Date.parse(event.event_at)) || Date.parse(event.event_at)<=Number(now)) return {status:'date_unavailable'};
  const jobId=await autonomousArtifactJobId(owner,'generate_document',key),tracker=createArtifactTracker(db);
  await tracker.ensureSchema();
  await tracker.register({jobId,owner,agent:'melodi',jobType:'generate_document',channel:'auto'});
  await registerDocumentSchedule(env,{owner,agent:'melodi',jobId,dueAt:event.event_at,title:'Funcionalidades de Alexa AI para Electro Wisly',now});
  await services.enqueue(owner,'generate_document',{
    prompt:payload.prompt,sourceContent:REQUESTED_DOCUMENT_CONTENT,preserveSourceContent:true,authoredDocument:true,
    kind:'document',format:'docx',authorAgent:'melodi',documentContext:event.title,deliveryAt:event.event_at,
    deliveryMode:'private',autonomyAgent:'melodi',autonomyOrigin:'owner_request',autonomyChannel:'auto',emailDelivery:null,
  },{idempotencyKey:key});
  const notices=createDeliveryNotices(db,services);await notices.ensureSchema();
  await notices.enqueue({owner,key,agent:'melodi',ownerRequested:true,
    body:`Melodi: Corregí el encargo de Electro Wisly. Melodi preparará el documento con formato profesional y su firma de Secretaria Ejecutiva. La entrega quedó programada para ${localEventTime(event.event_at)}, hora de República Dominicana. Puedes cambiarla o cancelarla desde «Vetsa · Equipo» en Google Calendar.`});
  await db.prepare('INSERT OR IGNORE INTO worker_state (state_key,state_value,updated_at) VALUES (?,?,?)').bind(key,jobId,new Date(now).toISOString()).run();
  return {status:'repaired',jobId};
}
