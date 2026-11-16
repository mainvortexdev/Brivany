import { executeFinanceRequest } from './finance-workflow.js';
import { parseFinanceRequest } from './finance-request.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { createFinanceStore } from './personal-finance.js';
import { createRoutineStore } from './melodi-routines.js';

// Exact owner-reported request only. No model can select a record for this migration.
export const SUBSCRIPTION_REPAIR_EVENT='1f10608e-365c-454c-9b61-6cc3be29ee69';
export const SUBSCRIPTION_REPAIR_TEXT='Oye Melodi, tengo la suscripción mensual de Google One de 1.99 dólares y la de ChatGPT Plus de 20 dólares, necesito que me recuerdes el día 7 de cada mes que debo renovarlas';
export async function repairSubscriptionRequest(env,{services,now=Date.now()}={}) {
  if(env.REQUESTED_SUBSCRIPTION_REPAIR_REV!=='2026-10-08.1') return {status:'disabled'};
  const db=env.VETSA_CLOUD,owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''),key=`subscription-repair:${owner}:${SUBSCRIPTION_REPAIR_EVENT}`;
  const marker=await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  if(marker?.state_value==='repaired') return {status:'already_repaired'};
  const source=await db.prepare(`SELECT * FROM melodi_calendar_events WHERE id=? AND phone=? AND assigned_agent='melodi' AND reminded_at IS NULL
    AND title=? AND event_at=?`).bind(SUBSCRIPTION_REPAIR_EVENT,owner,'Renovar suscripciones de Google One y ChatGPT Pulse','2026-11-07T13:00:00.000Z').first();
  if(!marker && (!source || Date.parse(source.event_at)<=now)) return {status:'source_unavailable'};
  const response=await executeFinanceRequest(env,{owner,agent:'melodi',request:parseFinanceRequest(SUBSCRIPTION_REPAIR_TEXT,now),requestId:key,services,now});
  const records=await createFinanceStore(db,services).list(owner),routines=await createRoutineStore(db,services).list(owner);
  const pair=records.filter(r=>r.kind==='subscription' && r.status==='active' && r.data.currency==='USD'
    && (r.data.name==='Google One' && r.data.amount===199 || r.data.name==='ChatGPT Plus' && r.data.amount===2000));
  if(pair.length!==2 || !pair[0].data.routineId || pair[0].data.routineId!==pair[1].data.routineId
    || !routines.some(r=>r.id===pair[0].data.routineId && r.agent==='melodi' && r.status==='active' && r.frequency==='monthly' && r.dayOfMonth===7)) return {status:'repair_unconfirmed'};
  if(!marker) {
    const results=await db.batch([
    db.prepare('INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM melodi_calendar_events WHERE id=? AND phone=? AND title=? AND event_at=? AND reminded_at IS NULL)')
      .bind(key,'prepared',new Date(now).toISOString(),source.id,owner,source.title,source.event_at),
    db.prepare('DELETE FROM melodi_calendar_events WHERE id=? AND phone=? AND title=? AND event_at=? AND reminded_at IS NULL AND EXISTS(SELECT 1 FROM worker_state WHERE state_key=?)')
      .bind(source.id,owner,source.title,source.event_at,key),
    ]);
    if(!results[1]?.meta?.changes) return {status:'source_changed'};
  }
  const notices=createDeliveryNotices(db,services);await notices.ensureSchema();
  await notices.enqueue({owner,agent:'melodi',key,ownerRequested:true,body:response.replace(/^Melodi: /,'Melodi: Corregí tu petición: ahora se repetirá cada mes y conservé «ChatGPT Plus». ')});
  await db.prepare('UPDATE worker_state SET state_value=?,updated_at=? WHERE state_key=?').bind('repaired',new Date(now).toISOString(),key).run();
  return {status:'repaired'};
}
