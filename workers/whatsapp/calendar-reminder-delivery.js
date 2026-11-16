import { createDeliveryNotices } from './delivery-notice.js';
import { calendarActivityPaused, calendarScheduleExclusion } from './google-calendar-guards.js';
import { validCalendarReminder } from './calendar-reminder-contract.js';
import { reminderDueMessage, reminderContextQuestion, contextualReminderDueMessage } from './reminder-language.js';
import { clockContext, localDateTimeToUtc } from './event-time.js';
import { routineMatchesLocal, routineCalendarOccurrence } from './melodi-routines.js';

const members = ['melodi'];
const snapshot = row => ({ id: row.id, title: row.title, eventAt: row.event_at,
  agent: row.assigned_agent ?? null, updatedAt: row.updated_at });

export async function calendarReminderCurrent(env, owner, reminder, now = Date.now()) {
  if (!validCalendarReminder(reminder)) return false;
  const row = await env.VETSA_CLOUD.prepare(`SELECT id FROM melodi_calendar_events
    WHERE id=? AND phone=? AND title=? AND event_at=? AND assigned_agent IS ? AND updated_at=?
      AND reminded_at IS NULL AND event_type!='DOCUMENT_DELIVERY' AND event_at<=?`)
    .bind(reminder.id, owner, reminder.title, reminder.eventAt, reminder.agent, reminder.updatedAt, new Date(now).toISOString()).first();
  return Boolean(row) && !await calendarActivityPaused(env.VETSA_CLOUD, owner, 'melodi_calendar_events', reminder.id);
}

export async function confirmCalendarReminder(env, owner, reminder, now = Date.now()) {
  if (!validCalendarReminder(reminder)) throw new TypeError('invalid_calendar_reminder');
  const at = new Date(now).toISOString();
  return env.VETSA_CLOUD.prepare(`UPDATE melodi_calendar_events SET reminded_at=?,updated_at=?
    WHERE id=? AND phone=? AND title=? AND event_at=? AND assigned_agent IS ? AND updated_at=? AND reminded_at IS NULL`)
    .bind(at, at, reminder.id, owner, reminder.title, reminder.eventAt, reminder.agent, reminder.updatedAt).run();
}

/** Render immediately before transport. A queued body is only a fallback:
 * current schedule edits, cancellation and the previous activity are reread.
 * null means the current reminder has become obsolete and must not be sent. */
export async function contextualCalendarReminderMessage(env, reminder, { now = Date.now(), services } = {}) {
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const db = typeof env.VETSA_CLOUD.withSession === 'function' ? env.VETSA_CLOUD.withSession('first-primary') : env.VETSA_CLOUD;
  if (!owner || !await calendarReminderCurrent({ ...env, VETSA_CLOUD: db }, owner, reminder, now)) return null;
  return contextualReminderAgendaMessage({ ...env, VETSA_CLOUD: db }, owner, { ...reminder, kind:'melodi_calendar_events' }, { now, services });
}

async function decodeRoutine(services,row) {
  if (typeof services?.decrypt !== 'function') throw Error('routine_context_decryption_unavailable');
  const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv);
  const payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw Error('routine_context_payload_invalid');
  return payload;
}

/** Revalidate a queued recurring reminder's actual occurrence before rendering.
 * Uses only persisted schedule sources; no model inference or runtime imports. */
export async function contextualRoutineReminderMessage(env, reminder, { now = Date.now(), services } = {}) {
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'');
  if (!owner || typeof reminder?.id!=='string' || typeof reminder?.runKey!=='string' || !reminder.runKey.startsWith(`routine:${reminder.id}:`)) return null;
  const original=reminder.runKey.slice(`routine:${reminder.id}:`.length);
  if (!/^\d{1,15}$/.test(original)) return null;
  const db=typeof env.VETSA_CLOUD.withSession==='function' ? env.VETSA_CLOUD.withSession('first-primary'):env.VETSA_CLOUD;
  const row=await db.prepare("SELECT * FROM wa_melodi_routines WHERE owner=? AND id=? AND status='active'").bind(owner,reminder.id).first();
  if (!row) return null;
  const payload=await decodeRoutine(services,row), originalAt=Number(original), occurrence=routineCalendarOccurrence(payload,originalAt);
  if (payload.kind!=='recurring_reminder' || occurrence.cancelled || occurrence.title!==reminder.title
    || occurrence.startAt!==new Date(reminder.startAt).toISOString() || Date.parse(occurrence.startAt)>Number(now)) return null;
  if (!payload.calendarExceptions?.[occurrence.originalAt] && (!routineMatchesLocal(row,payload,clockContext(originalAt,env.TIME_ZONE || 'America/Santo_Domingo').now_local)
    || payload.calendarStartAt && originalAt<Date.parse(payload.calendarStartAt))) return null;
  return contextualReminderAgendaMessage({ ...env,VETSA_CLOUD:db },owner,{id:row.id,title:occurrence.title,eventAt:occurrence.startAt,kind:'agent_routine'},{now,services});
}

async function contextualReminderAgendaMessage(env, owner, reminder, { now, services }) {
  const db=env.VETSA_CLOUD;
  const timeZone = env.TIME_ZONE || 'America/Santo_Domingo';
  const fallback = reminderDueMessage(reminder.title, { eventAt: reminder.eventAt, now, timeZone });
  try {
    const optional = new Set((await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('melodi_calendar_events','wa_melodi_routines','melodi_google_calendar_activity_map','melodi_google_calendar_schedule_overrides')`).all()).results.map(row => row.name));
    const cancelled = async (id,kind) => {
      if (optional.has('melodi_google_calendar_activity_map') && await db.prepare(`SELECT source_id FROM melodi_google_calendar_activity_map
        WHERE owner=? AND kind=? AND source_id=? AND status IN ('cancelled','unsupported')`).bind(owner,kind,id).first()) return true;
      return optional.has('melodi_google_calendar_schedule_overrides') && Boolean(await db.prepare(`SELECT source_id FROM melodi_google_calendar_schedule_overrides
        WHERE owner=? AND kind=? AND source_id=? AND status='cancelled'`).bind(owner,kind,id).first());
    };
    if (await cancelled(reminder.id,reminder.kind)) return null;
    const today = clockContext(now, timeZone).today_local;
    const eventDay = clockContext(reminder.eventAt, timeZone).today_local;
    if (today !== eventDay) return fallback;
    const eventTime = Date.parse(reminder.eventAt);
    const candidates = optional.has('melodi_calendar_events') ? (await db.prepare(`SELECT id,title,event_at FROM melodi_calendar_events
      WHERE phone=? AND id!=? AND event_type='REMINDER' AND event_at>=? AND event_at<=?
      ORDER BY event_at DESC,id LIMIT 12`).bind(owner, reminder.id, new Date(eventTime - 4 * 3600000).toISOString(), new Date(eventTime - 30 * 60000).toISOString()).all()).results.map(row=>({...row,kind:'melodi_calendar_events'})) : [];
    if (optional.has('wa_melodi_routines') && typeof services?.decrypt==='function') {
      const routines=await db.prepare("SELECT * FROM wa_melodi_routines WHERE owner=? AND id!=? AND status='active' ORDER BY next_at,id LIMIT 101").bind(owner,reminder.id).all();
      if (routines.results.length<=100) for (const row of routines.results) {
        const payload=await decodeRoutine(services,row), local=`${eventDay}T${row.hour}`;
        if (payload.kind!=='recurring_reminder' || !routineMatchesLocal(row,payload,local)) continue;
        const originalAt=localDateTimeToUtc(local,timeZone);
        if (payload.calendarStartAt && Date.parse(originalAt)<Date.parse(payload.calendarStartAt)) continue;
        const occurrence=routineCalendarOccurrence(payload,originalAt), priorAt=Date.parse(occurrence.startAt);
        if (occurrence.cancelled || priorAt<eventTime-4*3600000 || priorAt>eventTime-30*60000) continue;
        candidates.push({id:row.id,title:occurrence.title,event_at:occurrence.startAt,kind:'agent_routine'});
      }
    }
    candidates.sort((a,b)=>b.event_at.localeCompare(a.event_at)||a.id.localeCompare(b.id));
    for (const prior of candidates) {
      if (clockContext(prior.event_at, timeZone).today_local !== eventDay || !reminderContextQuestion(prior.title) || await cancelled(prior.id,prior.kind)) continue;
      return contextualReminderDueMessage(reminder.title, prior.title, { eventAt: reminder.eventAt, now, timeZone });
    }
  } catch {
    // Optional context must never invent a prior event or suppress the actual
    // requested reminder if its lookup is unavailable.
  }
  return fallback;
}

/** Only the due requested reminder creates contact. A clock tick never creates an AI preparation. */
export async function enqueueCalendarReminders(env, { services, now = Date.now() } = {}) {
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  if (!owner) return { queued: 0 };
  const notices = createDeliveryNotices(env.VETSA_CLOUD, { ...services, now: () => now });
  await notices.ensureSchema();
  const filter = await calendarScheduleExclusion(env.VETSA_CLOUD, { kind: 'melodi_calendar_events', ownerColumn: 'phone', idColumn: 'id' });
  const rows = await env.VETSA_CLOUD.prepare(`SELECT id,phone,title,event_at,assigned_agent,updated_at FROM melodi_calendar_events
    WHERE phone=? AND reminded_at IS NULL AND event_type NOT IN ('DOCUMENT_DELIVERY','SCREENSHOT_EVENT') AND event_at<=?${filter}
    ORDER BY event_at,id LIMIT 25`).bind(owner, new Date(now).toISOString()).all();
  let queued = 0;
  for (const row of rows.results || []) {
    const reminder = snapshot(row);
    if (!await calendarReminderCurrent(env, owner, reminder, now)) continue;
    const agent = members.includes(row.assigned_agent) ? row.assigned_agent : 'melodi';
    const notice = await notices.enqueue({ owner, agent, key: `calendar-reminder:${JSON.stringify(reminder)}`,
      body: reminderDueMessage(row.title), ownerRequested: true, calendarReminder: reminder });
    // Reconcile a confirmed notice if the first worker stopped before the calendar update.
    if (notice.status === 'sent') await confirmCalendarReminder(env, owner, reminder, now);
    queued++;
  }
  return { queued };
}
