import { ownerAutonomyServices } from './owner-features.js';
import { clockContext, DOMINICAN_TIME_ZONE, localDateTimeToUtc } from './event-time.js';
import { nextRoutineAt, nextRoutineCalendarOccurrence, routineMatchesLocal, routineWeekdays } from './melodi-routines.js';
import { weeklyRecurrenceWeekdays } from './google-calendar-client.js';
import { calendarHash } from './google-calendar-store.js';
import { calendarActivityPaused } from './google-calendar-guards.js';

export const GOOGLE_CALENDAR_SCHEDULE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS melodi_google_calendar_schedule_overrides (
    owner TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, agent TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
    last_start_at TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(owner,kind,source_id))`,
]);
const KINDS = ['melodi_calendar_events','agent_routine','cognira_report','story_slot','story_single'];
const AGENTS = ['melodi'];
const DAYS = ['SU','MO','TU','WE','TH','FR','SA'];
const TABLES = { melodi_calendar_events:'melodi_calendar_events', agent_routine:'wa_melodi_routines', cognira_report:'cognira_report_schedules',
  story_slot:'wa_story_slots', story_single:'wa_story_single_drafts' };
const time = value => typeof value === 'number' ? value : Date.parse(value);
const iso = value => new Date(time(value)).toISOString();
const changed = result => Number(result?.meta?.changes || 0) > 0;
const key = value => `${value.kind}:${value.id || value.source_id}`;
const cleanTitle = value => typeof value === 'string' && value.trim() && value.length <= 500 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
function scope(env, owner) {
  if (typeof owner !== 'string' || !owner || owner !== String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')) throw new Error('invalid_calendar_owner');
  if (!env.VETSA_CLOUD?.prepare) throw new Error('calendar_storage_unavailable');
}
export async function ensureScheduleSchema(env) {
  await env.VETSA_CLOUD.batch(GOOGLE_CALENDAR_SCHEDULE_SCHEMA.map(sql => env.VETSA_CLOUD.prepare(sql)));
}
const servicesFor = (env, options) => options.services || ownerAutonomyServices(env);
async function privateValue(services, row, encrypted = 'payload_encrypted', iv = 'payload_iv') {
  const value = await services.decrypt(row[encrypted],row[iv]);
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('calendar_payload_invalid');
  return parsed;
}
async function sealedValue(services, payload) {
  const sealed = await services.encrypt(JSON.stringify(payload));
  if (!sealed?.encrypted || !sealed?.iv) throw new Error('calendar_encryption_unavailable');
  return sealed;
}
async function tables(db) {
  return new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row => row.name));
}
function queryFor(kind, names) {
  if (kind === 'melodi_calendar_events' && names.has('melodi_screenshot_calendar_events')) return `SELECT e.*,s.end_at AS screenshot_end_at,
    s.lead_minutes AS screenshot_lead_minutes,s.deliver_at AS screenshot_deliver_at,s.source_time_zone AS screenshot_time_zone
    FROM melodi_calendar_events e LEFT JOIN (SELECT event_id,owner,end_at,lead_minutes,deliver_at,source_time_zone FROM melodi_screenshot_calendar_events) s ON s.event_id=e.id AND s.owner=e.phone`;
  if (kind === 'story_slot') return `SELECT s.*,c.status AS campaign_status FROM wa_story_slots s JOIN wa_story_campaigns c ON c.id=s.campaign_id AND c.owner_phone=s.owner_phone`;
  if (kind === 'story_single' && names.has('wa_melodi_artifact_tracking')) return `SELECT s.*,a.agent AS tracked_agent FROM wa_story_single_drafts s
    LEFT JOIN wa_melodi_artifact_tracking a ON a.job_id=s.id AND a.owner=s.owner_phone AND a.job_type='generate_story'`;
  if (kind === 'story_single') return 'SELECT s.* FROM wa_story_single_drafts s';
  return `SELECT * FROM ${TABLES[kind]}`;
}
function qualifier(kind) { return kind.startsWith('story_') ? 's.' : ''; }
function ownerColumn(kind) { return kind === 'melodi_calendar_events' ? 'phone' : kind === 'agent_routine' ? 'owner' : 'owner_phone'; }
function assigned(kind,row) { return kind === 'melodi_calendar_events' ? row.assigned_agent || 'melodi' : kind === 'agent_routine' ? row.agent : kind === 'story_single' ? row.tracked_agent || 'melodi' : 'melodi'; }
function sourceState(kind,row,override) {
  if (override?.status === 'cancelled') return 'cancelled';
  if (kind === 'agent_routine') return row.status === 'stopped' ? 'cancelled' : 'active';
  if (kind === 'melodi_calendar_events') return row.reminded_at ? 'completed' : 'active';
  if (kind === 'story_slot' && row.campaign_status !== 'active') return row.campaign_status === 'paused' ? 'cancelled' : 'completed';
  if (kind.startsWith('story_')) return row.error_code === 'calendar_cancelled' ? 'cancelled' : row.status === 'published' ? 'completed'
    : row.status === 'needs_review' ? 'inactive' : 'active';
  return 'active';
}
function versionStart(version) {
  const match = /^gc1:(\d+):[a-f0-9]{64}$/.exec(version || '');
  return match ? new Date(Number(match[1])).toISOString() : null;
}
async function expose(kind,row,owner,services,override,mapping) {
  const extra = override ? await privateValue(services,override) : {};
  const agent = assigned(kind,row);
  if (!AGENTS.includes(agent) || (override && override.agent !== agent) || (mapping && mapping.agent !== agent)) throw new Error('calendar_assignment_conflict');
  const status = sourceState(kind,row,override);
  let title, startAt, recurrence = [], routine;
  if (kind === 'melodi_calendar_events') { title = row.title; startAt = row.event_at; }
  if (kind === 'agent_routine') {
    routine = await privateValue(services,row);
    title = routine.title;
    startAt = routine.calendarStartAt || nextRoutineAt(row,routine,row.created_at);
    recurrence = routine.frequency === 'daily' ? ['RRULE:FREQ=DAILY'] : routine.frequency==='monthly'
      ? [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${routine.dayOfMonth}`] : [`RRULE:FREQ=WEEKLY;BYDAY=${routineWeekdays(row,routine).map(day=>DAYS[day]).join(',')}`];
  }
  if (kind === 'cognira_report') {
    title = 'Reporte de Cognira Desktop'; startAt = row.next_at;
    if (row.recurring) {
      const anchor = extra.calendarStartAt || versionStart(mapping?.source_version);
      if (anchor) {
        const day = clockContext(anchor,row.time_zone).now_local.slice(0,10);
        startAt = localDateTimeToUtc(`${day}T${row.local_hour}`,row.time_zone);
      }
      recurrence = ['RRULE:FREQ=DAILY'];
    }
  }
  if (kind === 'story_slot') { title = `Historia · ${row.stage}`; startAt = row.scheduled_at; }
  if (kind === 'story_single') { title = 'Publicación de historia'; startAt = row.scheduled_at; }
  title = cleanTitle(['melodi_calendar_events','agent_routine'].includes(kind) ? title : extra.title || title) || 'Actividad programada';
  startAt = iso(startAt);
  const endAt = extra.durationMinutes ? new Date(time(startAt)+extra.durationMinutes*60000).toISOString() : row.screenshot_end_at || undefined;
  const reminderMinutes = row.event_type === 'SCREENSHOT_EVENT' ? row.screenshot_lead_minutes : undefined;
  const version = await calendarHash(JSON.stringify({ kind,id:row.id,agent,title,startAt,endAt,reminderMinutes,recurrence,status,
    ...(kind === 'agent_routine' ? { calendarExceptions:routine.calendarExceptions || {} } : {}) }));
  return { kind,id:row.id,agent,title,startAt,...(endAt ? {endAt} : {}),...(Number.isInteger(reminderMinutes) ? {reminderMinutes} : {}),recurrence,status,
    sourceVersion:`gc1:${time(startAt)}:${version}` };
}

/** Scheduled user activities only; retry clocks and autonomous review queues are never calendar appointments. */
export async function listScheduledActivities(env,owner,options={}) {
  scope(env,owner); await ensureScheduleSchema(env);
  const db = env.VETSA_CLOUD, names = await tables(db), services = servicesFor(env,options), now = iso((options.now || Date.now)());
  const mappings = names.has('melodi_google_calendar_activity_map') ? (await db.prepare('SELECT * FROM melodi_google_calendar_activity_map WHERE owner=?').bind(owner).all()).results : [];
  const byKey = new Map(mappings.map(row => [key(row),row]));
  const overrides = (await db.prepare('SELECT * FROM melodi_google_calendar_schedule_overrides WHERE owner=?').bind(owner).all()).results;
  const overrideByKey = new Map(overrides.map(row => [key(row),row]));
  const found = new Map(), existing = new Set();
  for (const kind of KINDS) {
    if (!names.has(TABLES[kind]) || kind === 'story_slot' && !names.has('wa_story_campaigns')) continue;
    const q = qualifier(kind), ownerWhere = `${q}${ownerColumn(kind)}=?`, query = queryFor(kind,names);
    let condition, order;
    if (kind === 'melodi_calendar_events') { condition = "(event_at>=? OR (reminded_at IS NULL AND event_type!='SCREENSHOT_EVENT'))"; order = 'event_at'; }
    if (kind === 'agent_routine') { condition = "status='active'"; order = 'next_at'; }
    if (kind === 'cognira_report') { condition = 'next_at>=?'; order = 'next_at'; }
    if (kind.startsWith('story_')) { condition = `${q}scheduled_at>=? AND ${q}status IN ('pending','generating','ready','publishing')`; order = `${q}scheduled_at`; }
    const candidates = (await db.prepare(`${query} WHERE ${ownerWhere} AND ${condition} ORDER BY ${order} LIMIT 150`)
      .bind(owner,...(kind === 'agent_routine' ? [] : [now])).all()).results;
    // Read known mapped rows separately. A future window must never turn a
    // completed activity or a temporarily unlisted row into a deletion.
    const ids = mappings.filter(map => map.kind === kind).map(map => map.source_id);
    for (let at = 0; at < ids.length; at += 90) {
      const batch = ids.slice(at,at+90);
      candidates.push(...(await db.prepare(`${query} WHERE ${ownerWhere} AND ${q}id IN (${batch.map(() => '?').join(',')})`).bind(owner,...batch).all()).results);
    }
    const seen = new Set();
    for (const row of candidates) {
      if (seen.has(row.id)) continue; seen.add(row.id);
      const identity = `${kind}:${row.id}`, mapping = byKey.get(identity), override = overrideByKey.get(identity);
      existing.add(identity);
      const status = sourceState(kind,row,override);
      if (['completed','inactive'].includes(status)) continue;
      const activity = await expose(kind,row,owner,services,override,mapping);
      if (activity.status !== 'cancelled' || mapping) found.set(identity,activity);
    }
  }
  for (const map of mappings) {
    if (!KINDS.includes(map.kind) || existing.has(key(map))) continue;
    const override = overrideByKey.get(key(map)), priorStart = override?.last_start_at || versionStart(map.source_version);
    // Legacy one-shot Cognira schedules are removed after successful delivery.
    // Once due, their old calendar record is historical, not a cancellation.
    if (map.kind === 'cognira_report' && priorStart && time(priorStart) <= time(now) && override?.status !== 'cancelled') continue;
    found.set(key(map),{kind:map.kind,id:map.source_id,agent:map.agent,status:'cancelled',sourceVersion:map.source_version || 'deleted'});
  }
  const values = [...found.values()];
  const cancelled = values.filter(value => value.status === 'cancelled');
  return [...cancelled,...values.filter(value => value.status === 'active').sort((a,b) => time(a.startAt)-time(b.startAt) || key(a).localeCompare(key(b))).slice(0,150)];
}

function supportedRecurrence(kind,recurrence,weekday,frequency='weekly') {
  if (!Array.isArray(recurrence) || recurrence.length > 1) return false;
  if (!recurrence.length) return !['agent_routine'].includes(kind);
  const match = /^RRULE:(.+)$/.exec(recurrence[0]); if (!match) return false;
  const parts = match[1].split(';'), fields = Object.fromEntries(parts.map(part => part.split('=')));
  if (Object.keys(fields).length !== parts.length || Object.keys(fields).some(name => !['FREQ','INTERVAL','BYDAY','BYMONTHDAY','WKST'].includes(name))) return false;
  if (fields.INTERVAL !== undefined && fields.INTERVAL !== '1' || fields.WKST !== undefined && !DAYS.includes(fields.WKST)) return false;
  if (kind === 'agent_routine' && frequency==='monthly') return fields.FREQ==='MONTHLY' && fields.BYDAY===undefined && /^(?:[1-9]|[12]\d|3[01])$/.test(fields.BYMONTHDAY || '');
  if (fields.BYMONTHDAY!==undefined) return false;
  if (kind === 'agent_routine') return frequency==='daily' ? fields.FREQ==='DAILY' && fields.BYDAY===undefined
    : Boolean(weeklyRecurrenceWeekdays(recurrence,weekday)?.includes(weekday));
  if (kind === 'cognira_report') return fields.FREQ === 'DAILY' && fields.BYDAY === undefined;
  return false;
}

async function saveOverride(db,services,owner,mapping,payload,status,startAt,at,{predicates,guards,old}={}) {
  const encrypted = await sealedValue(services,payload);
  const overridePredicate = old ? 'EXISTS(SELECT 1 FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=? AND payload_encrypted=? AND payload_iv=?)'
    : 'NOT EXISTS(SELECT 1 FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=?)';
  const overrideGuards = [owner,mapping.kind,mapping.id,...(old ? [old.payload_encrypted,old.payload_iv] : [])];
  const statement = db.prepare(`INSERT INTO melodi_google_calendar_schedule_overrides(owner,kind,source_id,agent,payload_encrypted,payload_iv,status,last_start_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${TABLES[mapping.kind]} WHERE ${predicates.join(' AND ')}) AND ${overridePredicate}
    ON CONFLICT(owner,kind,source_id) DO UPDATE SET payload_encrypted=excluded.payload_encrypted,payload_iv=excluded.payload_iv,
    status=excluded.status,last_start_at=excluded.last_start_at,updated_at=excluded.updated_at WHERE melodi_google_calendar_schedule_overrides.agent=excluded.agent`)
    .bind(owner,mapping.kind,mapping.id,mapping.agent,encrypted.encrypted,encrypted.iv,status,startAt,at,...guards,...overrideGuards);
  return {statement,encrypted};
}

/** Calendar edits change this existing schedule only. Titles are data and never become new agent instructions. */
export async function applyCalendarChange(env,owner,mapping,change,options={}) {
  scope(env,owner);
  if (!mapping || mapping.owner !== owner || !KINDS.includes(mapping.kind) || !AGENTS.includes(mapping.agent) || typeof mapping.id !== 'string'
    || change?.owner !== owner || change.kind !== mapping.kind || change.id !== mapping.id || change.agent !== mapping.agent
    || change.googleEventId !== mapping.googleEventId || !['updated','cancelled'].includes(change.status)) return {applied:false,reason:'scope_mismatch'};
  await ensureScheduleSchema(env);
  const db = env.VETSA_CLOUD, services = servicesFor(env,options), names = await tables(db), kind = mapping.kind, q = qualifier(kind);
  if (!names.has(TABLES[kind])) return {applied:false,reason:'source_missing'};
  const row = await db.prepare(`${queryFor(kind,names)} WHERE ${q}${ownerColumn(kind)}=? AND ${q}id=?`).bind(owner,mapping.id).first();
  if (!row) return change.status === 'cancelled' ? {applied:true,sourceVersion:'deleted'} : {applied:false,reason:'source_missing'};
  if (assigned(kind,row) !== mapping.agent) return {applied:false,reason:'assignment_mismatch'};
  const override = await db.prepare('SELECT * FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=?').bind(owner,kind,row.id).first();
  const current = await expose(kind,row,owner,services,override,{...mapping,source_version:options.expectedVersion});
  if (current.status === 'cancelled') return change.status === 'cancelled' ? {applied:true,sourceVersion:current.sourceVersion}
    : {applied:false,reason:'source_cancelled'};
  if (current.status !== 'active') return {applied:false,reason:'source_completed'};
  const at = (options.now || Date.now)();
  if (options.expectedVersion && current.sourceVersion !== options.expectedVersion && !change.recurringEventId
    && (!Number.isFinite(time(change.updatedAt)) || time(row.updated_at) > time(change.updatedAt))) return {applied:false,conflict:true,sourceVersion:current.sourceVersion};
  const title = change.status === 'updated' ? cleanTitle(change.title) : current.title;
  const startAt = change.status === 'updated' && Number.isFinite(time(change.startAt)) ? iso(change.startAt) : current.startAt;
  if (change.status === 'updated' && (!title || !Number.isFinite(time(change.startAt)))) return {applied:false,reason:'future_schedule_required'};
  if (change.status === 'updated' && (!Number.isFinite(time(change.endAt)) || time(change.endAt) <= time(startAt)
    || time(change.endAt)-time(startAt)>(row.event_type === 'SCREENSHOT_EVENT' ? 366*86400000 : 86400000))) return {applied:false,reason:'invalid_duration'};
  const local = change.status === 'updated' ? clockContext(startAt,DOMINICAN_TIME_ZONE).now_local : null;
  const weekday = local ? new Date(`${local.slice(0,10)}T12:00:00Z`).getUTCDay() : null;
  const routinePayload=kind==='agent_routine' ? await privateValue(services,row) : null;
  if (!change.recurringEventId && change.status === 'updated' && !supportedRecurrence(kind,change.recurrence || [],weekday,routinePayload?.frequency)) return {applied:false,reason:'unsupported_recurrence'};
  const monthlyDay=routinePayload?.frequency==='monthly' && change.status==='updated' && !change.recurringEventId
    ? Number(change.recurrence[0].match(/BYMONTHDAY=(\d+)/)?.[1]) : undefined;
  const weeklyDays=kind==='agent_routine' && (!routinePayload?.frequency || routinePayload.frequency==='weekly') && change.status==='updated' && !change.recurringEventId
    ? weeklyRecurrenceWeekdays(change.recurrence,weekday) : undefined;
  if (monthlyDay!==undefined && monthlyDay!==Number(local.slice(8,10))) return {applied:false,reason:'monthly_start_mismatch'};
  const recurringSeries = !change.recurringEventId && change.recurrence?.length>0 && ['agent_routine','cognira_report'].includes(kind);
  if (change.status==='updated' && time(startAt)<=at && !recurringSeries) return {applied:false,reason:'future_schedule_required'};
  let scheduledAt=startAt;
  if (change.status==='updated' && recurringSeries && time(startAt)<=at) {
    if (kind==='agent_routine') scheduledAt=nextRoutineAt({weekday,hour:local.slice(11,16)},{...routinePayload,...(monthlyDay ? {dayOfMonth:monthlyDay}:{}),...(weeklyDays ? {weekdays:weeklyDays}: {})},at);
    else {
      const today=clockContext(at,DOMINICAN_TIME_ZONE).today_local;
      scheduledAt=localDateTimeToUtc(`${today}T${local.slice(11,16)}`,DOMINICAN_TIME_ZONE);
      if (time(scheduledAt)<=at) scheduledAt=iso(time(scheduledAt)+86400000);
    }
  }
  const extra = override ? await privateValue(services,override) : {};
  const payload = { ...extra,title,durationMinutes:change.status === 'updated' ? (time(change.endAt)-time(startAt))/60000 : extra.durationMinutes || 15 };
  const assignments = [], values = [], predicates = [`${ownerColumn(kind)}=?`,'id=?'], guards = [owner,row.id];
  if (options.leaseToken !== undefined) {
    if (typeof options.leaseToken !== 'string' || !options.leaseToken || !names.has('google_calendar_connections')) return {applied:false,reason:'calendar_lease_lost'};
    predicates.push("EXISTS(SELECT 1 FROM google_calendar_connections WHERE owner=? AND status='connected' AND lease_token=? AND lease_until>?)");
    guards.push(owner,options.leaseToken,at);
  }
  const add = (column,value) => { assignments.push(`${column}=?`); values.push(value); };
  const guard = (column,value) => { predicates.push(`${column} IS ?`); guards.push(value ?? null); };
  const cancelled = change.status === 'cancelled';
  if (change.recurringEventId) {
    if (kind !== 'agent_routine') return {applied:false,reason:'unsupported_recurrence_instance'};
    const parentMap = names.has('melodi_google_calendar_activity_map') ? await db.prepare('SELECT google_event_id FROM melodi_google_calendar_activity_map WHERE owner=? AND kind=? AND source_id=?').bind(owner,kind,row.id).first() : null;
    if (parentMap?.google_event_id !== change.recurringEventId || !Number.isFinite(time(change.originalStartAt))) return {applied:false,reason:'recurrence_scope_mismatch'};
    const original = iso(change.originalStartAt), oldLocal = clockContext(original,DOMINICAN_TIME_ZONE).now_local;
    if (!routineMatchesLocal(row,routinePayload,oldLocal)
      || time(original) < row.created_at || time(original)>at+366*86400000) return {applied:false,reason:'invalid_recurrence_instance'};
    const interval=routinePayload.frequency==='daily' ? 86400000 : routinePayload.frequency==='monthly' ? 28*86400000 : 7*86400000;
    if (!cancelled && (time(startAt) <= time(original)-interval || time(startAt)>=time(original)+interval)) return {applied:false,reason:'instance_outside_week'};
    const routine = await privateValue(services,row), exceptions = {...(routine.calendarExceptions || {})};
    if (!Object.hasOwn(exceptions,original) && Object.keys(exceptions).length >= 100) return {applied:false,reason:'recurrence_exception_limit'};
    exceptions[original] = cancelled ? {status:'cancelled'} : {status:'updated',startAt,title};
    const encrypted = await sealedValue(services,{...routine,calendarExceptions:exceptions});
    add('payload_encrypted',encrypted.encrypted); add('payload_iv',encrypted.iv);
    guard('payload_encrypted',row.payload_encrypted); guard('payload_iv',row.payload_iv); guard('next_at',row.next_at); guard('status',row.status);
    if (time(original) === row.next_at) {
      const next = cancelled ? nextRoutineCalendarOccurrence(row,{...routine,calendarExceptions:exceptions},row.next_at) : {nextAt:row.next_at,availableAt:time(startAt)};
      add('next_at',next.nextAt); add('available_at',next.availableAt); add('attempts',0);
    }
    add('lease_token',null); add('lease_until',null); add('updated_at',at);
    const result = await db.prepare(`UPDATE wa_melodi_routines SET ${assignments.join(',')} WHERE ${predicates.join(' AND ')}`).bind(...values,...guards).run();
    return changed(result) ? {applied:true,sourceVersion:current.sourceVersion,occurrence:true} : {applied:false,conflict:true};
  }
  if (kind === 'melodi_calendar_events') {
    guard('title',row.title); guard('event_at',row.event_at); guard('assigned_agent',row.assigned_agent); guard('reminded_at',row.reminded_at);
    if (cancelled) {
      const result = await db.prepare(`DELETE FROM melodi_calendar_events WHERE ${predicates.join(' AND ')}`).bind(...guards).run();
      return changed(result) ? {applied:true,sourceVersion:'deleted'} : {applied:false,conflict:true};
    }
    add('title',title); add('event_at',startAt); add('emily_prepared_at',null); add('updated_at',iso(at));
  }
  if (kind === 'agent_routine') {
    const routine = await privateValue(services,row);
    guard('payload_encrypted',row.payload_encrypted); guard('payload_iv',row.payload_iv); guard('next_at',row.next_at); guard('status',row.status);
    if (cancelled) add('status','stopped');
    else {
      const encrypted = await sealedValue(services,{...routine,title,calendarStartAt:startAt,calendarExceptions:{},
        ...(monthlyDay ? {dayOfMonth:monthlyDay}:{}),...(weeklyDays ? {weekdays:weeklyDays}: {})});
      add('payload_encrypted',encrypted.encrypted); add('payload_iv',encrypted.iv); add('weekday',weekday); add('hour',local.slice(11,16));
      add('next_at',time(scheduledAt)); add('available_at',time(scheduledAt)); add('attempts',0);
    }
    add('lease_token',null); add('lease_until',null); add('updated_at',at);
  }
  if (kind === 'cognira_report') {
    guard('next_at',row.next_at); guard('local_hour',row.local_hour); guard('recurring',row.recurring); guard('channel',row.channel); guard('target',row.target);
    if (cancelled) {
      const saved = await saveOverride(db,services,owner,mapping,payload,'cancelled',current.startAt,at,{predicates,guards,old:override});
      const results = await db.batch([saved.statement,db.prepare(`DELETE FROM cognira_report_schedules WHERE ${predicates.join(' AND ')}
        AND EXISTS(SELECT 1 FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=? AND payload_encrypted=?)`)
        .bind(...guards,owner,kind,row.id,saved.encrypted.encrypted)]);
      if (!changed(results[1])) return {applied:false,conflict:true};
      return {applied:true,sourceVersion:'deleted'};
    }
    add('next_at',scheduledAt); add('recurring',change.recurrence?.length ? 1 : 0); add('time_zone',DOMINICAN_TIME_ZONE); add('local_hour',local.slice(11,16)); add('lease_until',null);
    payload.calendarStartAt = startAt;
  }
  if (kind.startsWith('story_')) {
    guard('scheduled_at',row.scheduled_at); guard('status',row.status); guard('operation_id',row.operation_id);
    if (row.status === 'publishing') return {applied:false,reason:'publication_already_started'};
    if (cancelled) { add('status','needs_review'); add('error_code','calendar_cancelled'); add('approved_at',null); }
    else add('scheduled_at',startAt);
    add('updated_at',iso(at));
  }
  const saved = await saveOverride(db,services,owner,mapping,payload,cancelled ? 'cancelled' : 'active',startAt,at,{predicates,guards,old:override});
  const statements = [saved.statement,db.prepare(`UPDATE ${TABLES[kind]} SET ${assignments.join(',')} WHERE ${predicates.join(' AND ')}
    AND EXISTS(SELECT 1 FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=? AND payload_encrypted=?)`)
    .bind(...values,...guards,owner,kind,row.id,saved.encrypted.encrypted)];
  // Keep the independently delivered advance notice on the edited event clock.
  // Both changes commit together; the source and fresh override guard stale edits.
  if (kind === 'melodi_calendar_events' && row.event_type === 'SCREENSHOT_EVENT' && names.has('melodi_screenshot_calendar_events')) {
    statements.push(db.prepare(`UPDATE melodi_screenshot_calendar_events SET end_at=?,deliver_at=?,reminded_at=NULL,updated_at=?
      WHERE owner=? AND event_id=? AND EXISTS(SELECT 1 FROM melodi_calendar_events WHERE phone=? AND id=? AND title=? AND event_at=? AND updated_at=?)
      AND EXISTS(SELECT 1 FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=? AND payload_encrypted=?)`)
      .bind(iso(change.endAt),iso(time(startAt)-row.screenshot_lead_minutes*60000),iso(at),owner,row.id,
        owner,row.id,title,startAt,iso(at),owner,kind,row.id,saved.encrypted.encrypted));
  }
  const results = await db.batch(statements);
  if (!changed(results[1])) return {applied:false,conflict:true};
  const updated = await db.prepare(`${queryFor(kind,names)} WHERE ${q}${ownerColumn(kind)}=? AND ${q}id=?`).bind(owner,row.id).first();
  const latestOverride = await db.prepare('SELECT * FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind=? AND source_id=?').bind(owner,kind,row.id).first();
  return {applied:true,sourceVersion:(await expose(kind,updated,owner,services,latestOverride)).sourceVersion};
}

/** Resolve a queued occurrence without disclosing its private brief or profile. */
export async function routineCalendarRunState(env,owner,id,runKey,options={}) {
  scope(env,owner);
  const row = await env.VETSA_CLOUD.prepare('SELECT * FROM wa_melodi_routines WHERE owner=? AND id=?').bind(owner,id).first();
  if (!row || row.status !== 'active') return {active:false,status:'cancelled'};
  const payload = await privateValue(servicesFor(env,options),row);
  const paused = await calendarActivityPaused(env.VETSA_CLOUD,owner,'agent_routine',id);
  if (!runKey) return {active:true,status:paused ? 'paused':'ready',startAt:null,title:payload.title,agent:row.agent};
  const prefix = `routine:${id}:`;
  if (typeof runKey !== 'string' || !runKey.startsWith(prefix) || !/^\d{1,15}$/.test(runKey.slice(prefix.length))) return {active:false,status:'cancelled'};
  const originalAt=Number(runKey.slice(prefix.length));
  if (!Number.isFinite(new Date(originalAt).getTime())) return {active:false,status:'cancelled'};
  const original=iso(originalAt),exception=payload.calendarExceptions?.[original];
  if (exception?.status==='cancelled') return {active:false,status:'cancelled',agent:row.agent};
  // A changed series owns its new schedule. An old queued occurrence must not
  // survive that replacement unless Google explicitly retimed this instance.
  if (!exception) {
    const local=clockContext(original,DOMINICAN_TIME_ZONE).now_local;
    if (!routineMatchesLocal(row,payload,local)
      || (payload.calendarStartAt && originalAt<time(payload.calendarStartAt))) return {active:false,status:'cancelled',agent:row.agent};
  }
  const startAt=exception?.status==='updated' ? iso(exception.startAt):original;
  const title=exception?.status==='updated' ? cleanTitle(exception.title) || payload.title:payload.title;
  const at=(options.now || Date.now)();
  return {active:true,status:paused ? 'paused':time(startAt)>time(at) ? 'waiting':'ready',startAt,title,agent:row.agent};
}

/** Existing callers ask about cancellation; readiness is a separate decision. */
export async function routineCalendarRunActive(env,owner,id,runKey,options={}) {
  return (await routineCalendarRunState(env,owner,id,runKey,options)).active;
}
