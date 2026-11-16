import { calendarActivityPaused } from './google-calendar-guards.js';

export const DOCUMENT_SCHEDULE_SCHEMA = `CREATE TABLE IF NOT EXISTS wa_melodi_document_delivery_schedules (
  job_id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, delivered_at TEXT)`;
export async function registerDocumentSchedule(env, { owner, agent, jobId, dueAt, title, now=Date.now() }) {
  if (owner !== String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')) throw Error('invalid_document_owner');
  if (!['melodi'].includes(agent) || !Number.isFinite(Number(now)) || !Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Number(now)) throw Error('invalid_document_schedule');
  await env.VETSA_CLOUD.prepare(DOCUMENT_SCHEDULE_SCHEMA).run();
  const eventId = `document-${jobId}`, created = new Date(now).toISOString();
  const prior = await env.VETSA_CLOUD.prepare('SELECT owner,agent,event_id FROM wa_melodi_document_delivery_schedules WHERE job_id=?').bind(jobId).first();
  if (prior) {
    if (prior.owner !== owner || prior.agent !== agent || prior.event_id !== eventId) throw Error('document_schedule_conflict');
    return eventId; // A replay must not recreate a cancelled Calendar delivery.
  }
  await env.VETSA_CLOUD.batch([
    env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO melodi_calendar_events (id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
      VALUES (?,?,?,?,'DOCUMENT_DELIVERY',?,?,?)`).bind(eventId,owner,`Entrega de documento · ${String(title || 'Documento solicitado').slice(0,200)}`,new Date(dueAt).toISOString(),agent,created,created),
    env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO wa_melodi_document_delivery_schedules (job_id,owner,agent,event_id,created_at) VALUES (?,?,?,?,?)`)
      .bind(jobId,owner,agent,eventId,created),
  ]);
  const row = await env.VETSA_CLOUD.prepare('SELECT owner,agent,event_id FROM wa_melodi_document_delivery_schedules WHERE job_id=?').bind(jobId).first();
  if (row?.owner !== owner || row?.agent !== agent || row?.event_id !== eventId) throw Error('document_schedule_conflict');
  return eventId;
}
export async function documentDeliveryState(env, owner, jobId, now = Date.now(), required = false) {
  const table = await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wa_melodi_document_delivery_schedules'").first();
  if (!table) { if (required) throw Error('document_schedule_missing'); return { active: true, status: 'ready' }; }
  const row = await env.VETSA_CLOUD.prepare(`SELECT s.*,e.phone,e.event_at,e.assigned_agent,e.reminded_at,e.event_type FROM wa_melodi_document_delivery_schedules s
    LEFT JOIN melodi_calendar_events e ON e.id=s.event_id WHERE s.job_id=? AND s.owner=?`).bind(jobId,owner).first();
  if (!row) { if (required) throw Error('document_schedule_missing'); return { active: true, status: 'ready' }; }
  if (!row.phone || row.phone !== owner || row.assigned_agent !== row.agent || row.event_type !== 'DOCUMENT_DELIVERY' || row.delivered_at || row.reminded_at)
    return { active: false, status: 'cancelled' };
  if (await calendarActivityPaused(env.VETSA_CLOUD,owner,'melodi_calendar_events',row.event_id)) return { active: true, status:'paused', retryAt: Number(now)+60000 };
  return { active: true, status: Date.parse(row.event_at) <= Number(now) ? 'ready' : 'waiting', retryAt: Date.parse(row.event_at), eventId: row.event_id };
}
export async function completeDocumentSchedule(env, owner, jobId) {
  const state = await documentDeliveryState(env,owner,jobId,Date.now(),true);
  if (!state.eventId) return;
  const delivered = new Date().toISOString();
  await env.VETSA_CLOUD.batch([
    env.VETSA_CLOUD.prepare('UPDATE wa_melodi_document_delivery_schedules SET delivered_at=? WHERE job_id=? AND owner=? AND delivered_at IS NULL').bind(delivered,jobId,owner),
    env.VETSA_CLOUD.prepare('UPDATE melodi_calendar_events SET reminded_at=?,updated_at=? WHERE id=? AND phone=? AND reminded_at IS NULL').bind(delivered,delivered,state.eventId,owner),
  ]);
}
