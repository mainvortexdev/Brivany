import { clockContext, localDateTimeToUtc } from './event-time.js';
import { readAgendaPlanSnapshot } from './agenda-plan-store.js';
import { flexibleAgendaTask } from './agenda-scheduling.js';

export const SCREENSHOT_CALENDAR_SCHEMA=Object.freeze([
  `CREATE TABLE IF NOT EXISTS melodi_screenshot_calendar_events (
    event_id TEXT PRIMARY KEY,owner TEXT NOT NULL,end_at TEXT NOT NULL,source_time_zone TEXT NOT NULL,
    lead_minutes INTEGER NOT NULL CHECK(lead_minutes BETWEEN 1 AND 10080),deliver_at TEXT NOT NULL,
    reminded_at TEXT,updated_at TEXT NOT NULL,FOREIGN KEY(event_id) REFERENCES melodi_calendar_events(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS screenshot_calendar_due ON melodi_screenshot_calendar_events(owner,reminded_at,deliver_at)`,
  `CREATE TABLE IF NOT EXISTS screenshot_calendar_receipts (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,execution_key TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(owner,source_hash))`,
  `CREATE TRIGGER IF NOT EXISTS screenshot_calendar_retime AFTER UPDATE OF event_at ON melodi_calendar_events
    WHEN OLD.event_at IS NOT NEW.event_at BEGIN UPDATE melodi_screenshot_calendar_events
      SET end_at=strftime('%Y-%m-%dT%H:%M:%fZ',julianday(end_at)+julianday(NEW.event_at)-julianday(OLD.event_at)),
      deliver_at=strftime('%Y-%m-%dT%H:%M:%fZ',julianday(NEW.event_at)-lead_minutes/1440.0),
      reminded_at=NULL,updated_at=NEW.updated_at WHERE owner=NEW.phone AND event_id=NEW.id; END`,
  `CREATE TRIGGER IF NOT EXISTS screenshot_calendar_delete AFTER DELETE ON melodi_calendar_events
    BEGIN DELETE FROM melodi_screenshot_calendar_events WHERE owner=OLD.phone AND event_id=OLD.id; END`,
]);
const stamp=value=>typeof value==='number'?value:value instanceof Date?value.getTime():Date.parse(value);
const iso=value=>new Date(stamp(value)).toISOString();
const dayPlus=day=>new Date(Date.parse(`${day}T12:00:00Z`)+86400000).toISOString().slice(0,10);
const rows=result=>result?.results || [];
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const text=value=>typeof value==='string' && value.trim() && value.length<=240 && !/[\u0000-\u001f]/.test(value);
function scope(env,owner){
  if(!/^\d{8,15}$/.test(owner || '') || owner!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''))throw Error('invalid_screenshot_calendar_owner');
  if(!env.VETSA_CLOUD?.prepare || !env.VETSA_CLOUD?.batch)throw Error('screenshot_calendar_storage_unavailable');
}
const database=env=>typeof env.VETSA_CLOUD.withSession==='function'?env.VETSA_CLOUD.withSession('first-primary'):env.VETSA_CLOUD;
export async function ensureScreenshotCalendarSchema(env){
  await env.VETSA_CLOUD.batch(SCREENSHOT_CALENDAR_SCHEMA.map(sql=>env.VETSA_CLOUD.prepare(sql)));
}
async function unpack(services,row){
  const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv);
  const value=typeof decoded==='string'?JSON.parse(decoded):decoded;
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('screenshot_calendar_receipt_invalid');
  return value;
}
function normalizedEvent(value){
  if(!value || !text(value.title) || !Number.isFinite(stamp(value.startAt)) || !Number.isFinite(stamp(value.endAt))
    || stamp(value.endAt)<=stamp(value.startAt) || stamp(value.endAt)-stamp(value.startAt)>366*86400000
    || typeof value.sourceTimeZone!=='string' || !value.sourceTimeZone || value.sourceTimeZone.length>80
    || !Number.isInteger(value.remindBeforeMinutes) || value.remindBeforeMinutes<1 || value.remindBeforeMinutes>10080
    || typeof value.clearStartSlot!=='boolean')throw Error('invalid_screenshot_calendar_event');
  const event={title:value.title.trim(),startAt:iso(value.startAt),endAt:iso(value.endAt),sourceTimeZone:value.sourceTimeZone,
    remindBeforeMinutes:value.remindBeforeMinutes,clearStartSlot:value.clearStartSlot};
  event.reminderAt=iso(stamp(event.startAt)-event.remindBeforeMinutes*60000);
  if(value.reminderAt && iso(value.reminderAt)!==event.reminderAt)throw Error('invalid_screenshot_calendar_reminder');
  return event;
}
function guardFor(source){
  if(!source.rows.length)return{sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=0`,values:source.values};
  const columns=Object.keys(source.rows[0]),idColumn=columns.includes('id')?'id':columns.includes('job_id')?'job_id':columns.includes('event_id')?'event_id':null;
  const identity=idColumn?[`live.${idColumn}=json_extract(wanted.value,'$.${idColumn}')`]
    :['owner','owner_phone','kind','source_id'].filter(key=>columns.includes(key)).map(key=>`live.${key}=json_extract(wanted.value,'$.${key}')`);
  return{sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted
    LEFT JOIN ${source.table} live ON ${identity.join(' AND ')} WHERE ${columns.map(key=>`live.${key} IS NOT json_extract(wanted.value,'$.${key}')`).join(' OR ')})`,
    values:[...source.values,source.rows.length,JSON.stringify(source.rows)]};
}

/** The invitation's real duration is stored separately from its arrival slot.
 * Clearing changes only verified flexible work whose start is within the first
 * 30 minutes; the remaining nine days of a hackathon are never cleared. */
export async function createScreenshotCalendarEvent(env,owner,messageId,value,{now=Date.now(),timeZone=env.TIME_ZONE || 'America/Santo_Domingo',services,snapshot,conflictMoves=[],allowLateNotice=false}={}){
  scope(env,owner);
  if(typeof messageId!=='string' || !messageId || messageId.length>500 || /[\u0000-\u001f]/.test(messageId))throw Error('invalid_screenshot_calendar_message');
  if(typeof services?.encrypt!=='function' || typeof services?.decrypt!=='function')throw Error('screenshot_calendar_encryption_unavailable');
  const event=normalizedEvent(value),at=stamp(now);
  if(!Array.isArray(conflictMoves) || conflictMoves.length>1 || conflictMoves.some(item=>!item || typeof item.id!=='string' || !item.id || item.id.length>200
    || !Number.isFinite(stamp(item.previousEventAt)) || !Number.isFinite(stamp(item.eventAt))))throw Error('invalid_screenshot_conflict_move');
  conflictMoves=conflictMoves.map(item=>({id:item.id,previousEventAt:iso(item.previousEventAt),eventAt:iso(item.eventAt)}));
  if(!Number.isFinite(at))throw Error('invalid_screenshot_calendar_clock');
  await ensureScreenshotCalendarSchema(env);const db=database(env),scoped={...env,VETSA_CLOUD:db};
  const sourceHash=await digest(`${owner}\u0000${messageId}`),id=`screenshot-${sourceHash}`,fingerprint=await digest(JSON.stringify({event,timeZone,conflictMoves}));
  const prior=await db.prepare('SELECT * FROM screenshot_calendar_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if(prior)return prior.fingerprint===fingerprint?{...await unpack(services,prior),status:'replayed'}:{status:'conflict',reason:'request_replay_mismatch'};
  if(stamp(event.startAt)<=at)return{status:'clarification',reason:'event_already_started',clarification:'El inicio del evento ya pasó. Dime qué fecha quieres agendar.'};
  if(stamp(event.reminderAt)<=at && allowLateNotice!==true)return{status:'clarification',reason:'advance_notice_elapsed',clarification:'Ya pasó la hora del aviso anticipado. ¿Quieres que lo agende y te avise ahora?'};
  const day=clockContext(event.startAt,timeZone).today_local,start=localDateTimeToUtc(`${day}T00:00`,timeZone),end=localDateTimeToUtc(`${dayPlus(day)}T00:00`,timeZone);
  snapshot ||= await readAgendaPlanSnapshot(scoped,owner,{start,end,now:at,timeZone,services});
  const state=snapshot?._state;
  if(!state || state.owner!==owner || state.timeZone!==timeZone || snapshot.token!==await digest(JSON.stringify(state)))throw Error('invalid_screenshot_calendar_snapshot');
  if(snapshot.hasMore || stamp(snapshot.start)>stamp(start) || stamp(snapshot.end)<stamp(end))return{status:'conflict',reason:'calendar_snapshot_incomplete'};
  const metadata=rows(await db.prepare('SELECT * FROM melodi_screenshot_calendar_events WHERE owner=? ORDER BY event_id LIMIT 301').bind(owner).all());
  if(metadata.length>300)return{status:'conflict',reason:'calendar_snapshot_incomplete'};
  const slotEnd=stamp(event.startAt)+30*60000;
  const conflicts=state.events.filter(item=>stamp(item.eventAt)>=stamp(event.startAt) && stamp(item.eventAt)<slotEnd);
  for(const resolution of conflictMoves){
    const matching=conflicts.find(item=>item.id===resolution.id && item.kind==='melodi_calendar_events' && item.movable && item.eventAt===resolution.previousEventAt);
    if(!matching || stamp(resolution.eventAt)<=at || stamp(resolution.eventAt)<stamp(start) || stamp(resolution.eventAt)>=stamp(end)
      || stamp(resolution.eventAt)>=stamp(event.startAt) && stamp(resolution.eventAt)<slotEnd)return{status:'conflict',reason:'conflict_move_invalid'};
  }
  const fixed=conflicts.filter(item=>!conflictMoves.some(resolution=>resolution.id===item.id) && (!event.clearStartSlot || !item.movable || !flexibleAgendaTask(item)));
  if(fixed.length)return{status:'conflict',reason:'fixed_start_conflict',eventAt:event.startAt,events:fixed.map(item=>({id:item.id,title:item.title,eventAt:item.eventAt}))};
  const moved=[],occupied=new Set(state.events.filter(item=>!conflicts.some(conflict=>conflict.id===item.id)).map(item=>item.eventAt));
  for(const task of conflicts){
    const explicit=conflictMoves.find(item=>item.id===task.id);
    if(explicit){
      if(occupied.has(explicit.eventAt))return{status:'conflict',reason:'fixed_target_conflict',events:state.events.filter(item=>item.eventAt===explicit.eventAt).map(item=>({id:item.id,title:item.title,eventAt:item.eventAt}))};
      moved.push({...task,previousEventAt:task.eventAt,eventAt:explicit.eventAt});occupied.add(explicit.eventAt);continue;
    }
    const candidates=[];const preferred=clockContext(task.eventAt,timeZone).now_local.slice(11,16),minutes=Number(preferred.slice(0,2))*60+Number(preferred.slice(3));
    for(let minute=9*60;minute<=18*60;minute+=30)candidates.push(minute);
    candidates.sort((a,b)=>Math.abs(a-minutes)-Math.abs(b-minutes)||b-a);
    let selected;
    for(const minute of candidates){
      const candidate=localDateTimeToUtc(`${day}T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,timeZone);
      if(candidate && stamp(candidate)>at && (stamp(candidate)<stamp(event.startAt) || stamp(candidate)>=slotEnd) && !occupied.has(candidate)){selected=candidate;break;}
    }
    if(!selected)return{status:'conflict',reason:'no_free_start_slot',events:[{id:task.id,title:task.title,eventAt:task.eventAt}]};
    moved.push({...task,previousEventAt:task.eventAt,eventAt:selected});occupied.add(selected);
  }
  if(moved.length>20)return{status:'conflict',reason:'too_many_start_conflicts'};
  const advance={id:`advance-${id}`,eventId:id,title:event.title,startAt:event.startAt,endAt:event.endAt,deliverAt:event.reminderAt,
    sourceTimeZone:event.sourceTimeZone,leadMinutes:event.remindBeforeMinutes};
  const result={status:'applied',event:{id,...event},advance,moved};
  const sealed=await services.encrypt(JSON.stringify(result));
  if(!sealed?.encrypted || !sealed?.iv)throw Error('screenshot_calendar_encryption_unavailable');
  const executionKey=crypto.randomUUID(),updatedAt=iso(at),guards=state.sources.map(guardFor);
  const optional=['wa_owner_session','melodi_google_calendar_schedule_overrides','melodi_google_calendar_activity_map','wa_melodi_document_delivery_schedules',
    'wa_melodi_routines','cognira_report_schedules','wa_story_slots','wa_story_campaigns','wa_story_single_drafts'];
  guards.unshift({sql:`(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN (${optional.map(()=>'?').join(',')}))=?`,values:[...optional,state.names.length]});
  guards.push(guardFor({table:'melodi_screenshot_calendar_events',where:'owner=?',values:[owner],rows:metadata}));
  const owns='EXISTS(SELECT 1 FROM screenshot_calendar_receipts WHERE id=? AND owner=? AND execution_key=?)',ownsValues=[id,owner,executionKey];
  const expected=[...moved.map(item=>({id:item.id,title:item.title,eventAt:item.eventAt})),{id,title:event.title,eventAt:event.startAt}];
  try{
    await db.batch([
      db.prepare(`INSERT INTO screenshot_calendar_receipts(id,owner,source_hash,fingerprint,payload_encrypted,payload_iv,execution_key,created_at)
        SELECT ?,?,?,CASE WHEN ${guards.map(guard=>`(${guard.sql})`).join(' AND ')} THEN ? ELSE NULL END,?,?,?,?
        WHERE NOT EXISTS(SELECT 1 FROM screenshot_calendar_receipts WHERE id=?) ON CONFLICT(id) DO NOTHING`)
        .bind(id,owner,sourceHash,...guards.flatMap(guard=>guard.values),fingerprint,sealed.encrypted,sealed.iv,executionKey,updatedAt,id),
      ...moved.map(item=>db.prepare(`UPDATE melodi_calendar_events SET event_at=?,updated_at=?,emily_prepared_at=NULL WHERE id=? AND phone=? AND reminded_at IS NULL AND ${owns}`)
        .bind(item.eventAt,updatedAt,item.id,owner,...ownsValues)),
      db.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
        SELECT ?,?,?,?,'SCREENSHOT_EVENT','melodi',?,? WHERE ${owns}`).bind(id,owner,event.title,event.startAt,updatedAt,updatedAt,...ownsValues),
      db.prepare(`INSERT INTO melodi_screenshot_calendar_events(event_id,owner,end_at,source_time_zone,lead_minutes,deliver_at,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE ${owns}`).bind(id,owner,event.endAt,event.sourceTimeZone,event.remindBeforeMinutes,event.reminderAt,updatedAt,...ownsValues),
      db.prepare(`UPDATE screenshot_calendar_receipts SET fingerprint=CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?) wanted
        LEFT JOIN melodi_calendar_events e ON e.id=json_extract(wanted.value,'$.id') AND e.phone=?
        WHERE e.id IS NULL OR e.title IS NOT json_extract(wanted.value,'$.title') OR e.event_at IS NOT json_extract(wanted.value,'$.eventAt') OR e.reminded_at IS NOT NULL)
        AND EXISTS(SELECT 1 FROM melodi_screenshot_calendar_events WHERE event_id=? AND owner=? AND end_at=? AND deliver_at=?) THEN fingerprint ELSE NULL END
        WHERE id=? AND owner=? AND execution_key=?`).bind(JSON.stringify(expected),owner,id,owner,event.endAt,event.reminderAt,...ownsValues),
    ]);
  }catch(error){if(/NOT NULL constraint failed:\s*screenshot_calendar_receipts\.fingerprint/i.test(`${error?.message} ${error?.cause?.message || ''}`))return{status:'conflict',reason:'agenda_changed'};throw error;}
  const saved=await db.prepare('SELECT * FROM screenshot_calendar_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if(!saved || saved.fingerprint!==fingerprint)return{status:'conflict',reason:'request_replay_mismatch'};
  return{...await unpack(services,saved),status:saved.execution_key===executionKey?'applied':'replayed'};
}

function reminderFrom(row){
  return{id:`advance-${row.event_id}`,eventId:row.event_id,title:row.title,startAt:row.event_at,endAt:row.end_at,
    deliverAt:iso(stamp(row.event_at)-row.lead_minutes*60000),sourceTimeZone:row.source_time_zone,leadMinutes:row.lead_minutes,
    updatedAt:row.event_updated_at,scheduleUpdatedAt:row.schedule_updated_at,agent:row.assigned_agent || 'melodi'};
}
async function activeSource(db,owner,eventId){
  const names=new Set(rows(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('melodi_google_calendar_schedule_overrides','melodi_google_calendar_activity_map')").all()).map(row=>row.name));
  if(names.has('melodi_google_calendar_schedule_overrides') && await db.prepare("SELECT source_id FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind='melodi_calendar_events' AND source_id=? AND status='cancelled'").bind(owner,eventId).first())return false;
  return !names.has('melodi_google_calendar_activity_map') || !await db.prepare("SELECT source_id FROM melodi_google_calendar_activity_map WHERE owner=? AND kind='melodi_calendar_events' AND source_id=? AND status IN ('cancelled','unsupported')").bind(owner,eventId).first();
}
async function reminderRow(db,owner,eventId){
  return db.prepare(`SELECT s.*,e.title,e.event_at,e.assigned_agent,e.updated_at AS event_updated_at,s.updated_at AS schedule_updated_at
    FROM melodi_screenshot_calendar_events s JOIN melodi_calendar_events e ON e.id=s.event_id AND e.phone=s.owner
    WHERE s.owner=? AND s.event_id=? AND e.event_type='SCREENSHOT_EVENT' AND s.reminded_at IS NULL`).bind(owner,eventId).first();
}
export async function listDueScreenshotReminders(env,owner,{now=Date.now(),limit=25}={}){
  scope(env,owner);if(!Number.isInteger(limit) || limit<1 || limit>50)throw Error('invalid_screenshot_reminder_limit');
  await ensureScreenshotCalendarSchema(env);const db=database(env),at=iso(now);
  const due=rows(await db.prepare(`SELECT s.*,e.title,e.event_at,e.assigned_agent,e.updated_at AS event_updated_at,s.updated_at AS schedule_updated_at
    FROM melodi_screenshot_calendar_events s JOIN melodi_calendar_events e ON e.id=s.event_id AND e.phone=s.owner
    WHERE s.owner=? AND s.reminded_at IS NULL AND e.event_type='SCREENSHOT_EVENT' AND e.event_at>?
    AND julianday(e.event_at)<=julianday(?)+s.lead_minutes/1440.0 ORDER BY e.event_at,s.event_id LIMIT ?`).bind(owner,at,at,limit).all());
  const reminders=[];for(const row of due)if(await activeSource(db,owner,row.event_id))reminders.push(reminderFrom(row));return reminders;
}
export async function screenshotReminderCurrent(env,owner,reminder,{now=Date.now()}={}){
  scope(env,owner);if(typeof reminder?.eventId!=='string')return false;
  const db=database(env),row=await reminderRow(db,owner,reminder.eventId);
  if(!row || !await activeSource(db,owner,reminder.eventId))return false;
  const current=reminderFrom(row),fields=['id','eventId','title','startAt','endAt','deliverAt','sourceTimeZone','leadMinutes','updatedAt','scheduleUpdatedAt'];
  return fields.every(key=>current[key]===reminder[key]) && stamp(current.deliverAt)<=stamp(now) && stamp(current.startAt)>stamp(now);
}
export async function confirmScreenshotReminder(env,owner,reminder,{now=Date.now()}={}){
  scope(env,owner);if(!await screenshotReminderCurrent(env,owner,reminder,{now}))return{confirmed:false};
  const result=await env.VETSA_CLOUD.prepare(`UPDATE melodi_screenshot_calendar_events SET reminded_at=?,updated_at=?
    WHERE owner=? AND event_id=? AND updated_at=? AND reminded_at IS NULL AND end_at=? AND lead_minutes=?
    AND EXISTS(SELECT 1 FROM melodi_calendar_events WHERE id=? AND phone=? AND title=? AND event_at=? AND updated_at=? AND event_type='SCREENSHOT_EVENT')`)
    .bind(iso(now),iso(now),owner,reminder.eventId,reminder.scheduleUpdatedAt,reminder.endAt,reminder.leadMinutes,
      reminder.eventId,owner,reminder.title,reminder.startAt,reminder.updatedAt).run();
  return{confirmed:Number(result?.meta?.changes || 0)===1};
}
