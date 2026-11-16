import { clockContext, localDateTimeToUtc, DOMINICAN_TIME_ZONE } from './event-time.js';
import { nextRoutineCalendarOccurrence, routineCalendarOccurrence } from './melodi-routines.js';
import { agendaDayMoves } from './agenda-scheduling.js';

export const AGENDA_PLAN_SCHEMA = `CREATE TABLE IF NOT EXISTS agenda_plan_receipts (
  id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,
  payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,execution_key TEXT NOT NULL,created_at TEXT NOT NULL,
  UNIQUE(owner,source_hash))`;
const AGENTS = ['melodi'];
const OPTIONAL = {
  wa_owner_session:'owner_phone',
  melodi_google_calendar_schedule_overrides:'owner', melodi_google_calendar_activity_map:'owner',
  wa_melodi_document_delivery_schedules:'owner', wa_melodi_routines:'owner', cognira_report_schedules:'owner_phone',
  wa_story_slots:'owner_phone', wa_story_campaigns:'owner_phone', wa_story_single_drafts:'owner_phone',
};
const stamp = value => typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
const dayPlus = (day,count=1) => new Date(Date.parse(`${day}T12:00:00Z`)+count*86400000).toISOString().slice(0,10);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const rows = result => result?.results || [];
function scope(env,owner) {
  if (!/^\d{8,15}$/.test(owner || '') || owner!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')) throw Error('invalid_agenda_plan_owner');
  if (!env.VETSA_CLOUD?.prepare || !env.VETSA_CLOUD?.batch) throw Error('agenda_plan_storage_unavailable');
}
function windowFor({start,end,now,timeZone}) {
  const at=stamp(now);
  if (!Number.isFinite(at)) throw Error('invalid_agenda_plan_clock');
  const today=clockContext(at,timeZone).today_local;
  start ||= localDateTimeToUtc(`${today}T00:00`,timeZone);
  end ||= localDateTimeToUtc(`${dayPlus(today,14)}T00:00`,timeZone);
  if (!Number.isFinite(stamp(start)) || !Number.isFinite(stamp(end)) || stamp(end)<=stamp(start) || stamp(end)-stamp(start)>32*86400000) throw Error('invalid_agenda_plan_window');
  return {start:new Date(stamp(start)).toISOString(),end:new Date(stamp(end)).toISOString(),now:at};
}
async function unpack(services,row) {
  if (typeof services?.decrypt!=='function') throw Error('agenda_plan_decryption_unavailable');
  const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv);
  const value=typeof decoded==='string' ? JSON.parse(decoded) : decoded;
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('invalid_agenda_plan_payload');
  return value;
}

/** Read before planning. Pass the original snapshot back to applyAgendaPlan;
 * only events/start/end/token belong in a model prompt, never _state. All
 * optional source rows are guarded, so new or edited activities cannot become
 * invisible phantom conflicts between planning and the atomic commit. */
export async function readAgendaPlanSnapshot(env,owner,{start,end,now=Date.now(),timeZone=env.TIME_ZONE || DOMINICAN_TIME_ZONE,services}={}) {
  scope(env,owner);
  const window=windowFor({start,end,now,timeZone}), db=typeof env.VETSA_CLOUD.withSession==='function' ? env.VETSA_CLOUD.withSession('first-primary') : env.VETSA_CLOUD;
  const known=Object.keys(OPTIONAL);
  const names=rows(await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${known.map(()=>'?').join(',')}) ORDER BY name`).bind(...known).all()).map(row=>row.name);
  const sources=[{table:'melodi_calendar_events',where:'phone=? AND event_at>=? AND event_at<?',values:[owner,window.start,window.end],
    rows:rows(await db.prepare('SELECT * FROM melodi_calendar_events WHERE phone=? AND event_at>=? AND event_at<? ORDER BY id LIMIT 301').bind(owner,window.start,window.end).all())}];
  for (const table of names) sources.push({table,where:`${OPTIONAL[table]}=?`,values:[owner],
    rows:rows(await db.prepare(`SELECT * FROM ${table} WHERE ${OPTIONAL[table]}=? ORDER BY rowid LIMIT 301`).bind(owner).all())});
  const state={owner,timeZone,start:window.start,end:window.end,names,sources};
  const events=[], unsupported=[];
  const source=table=>sources.find(item=>item.table===table)?.rows || [];
  const overrides=source('melodi_google_calendar_schedule_overrides'), mappings=source('melodi_google_calendar_activity_map');
  const status=(kind,id)=>({cancelled:overrides.some(row=>row.kind===kind && row.source_id===id && row.status==='cancelled'),
    paused:mappings.some(row=>row.kind===kind && row.source_id===id && row.status==='unsupported')});
  const add=(item,{movable=false,reason='unsupported_schedule'}={})=>{
    const at=stamp(item.eventAt);
    if (!Number.isFinite(at) || at<=window.now || at<stamp(window.start) || at>=stamp(window.end)) return;
    const flags=status(item.kind,item.sourceId || item.id);
    if (flags.cancelled) return;
    const event={...item,movable:movable && !flags.paused};
    events.push(event);
    if (!event.movable) unsupported.push({id:item.id,kind:item.kind,eventAt:item.eventAt,reason:flags.paused ? 'paused_schedule' : reason});
  };
  if (sources.some(item=>item.rows.length>300)) unsupported.push({kind:'snapshot',reason:'agenda_window_limit'});
  for (const row of source('melodi_calendar_events')) {
    if (row.reminded_at) continue;
    let movable=['REMINDER','DOCUMENT_DELIVERY'].includes(row.event_type), reason='unsupported_event_type';
    if (row.event_type==='DOCUMENT_DELIVERY') {
      const link=source('wa_melodi_document_delivery_schedules').find(item=>item.event_id===row.id && item.owner===owner);
      if (link?.delivered_at) continue;
      if (!link || link.agent!==row.assigned_agent) {movable=false;reason='document_schedule_unverified';}
    }
    add({kind:'melodi_calendar_events',id:row.id,title:row.title,eventAt:row.event_at,agent:row.assigned_agent || 'melodi',eventType:row.event_type,
      version:await digest(JSON.stringify(row))},{movable,reason});
  }
  for (const row of source('wa_melodi_routines').filter(item=>item.status==='active')) {
    if (status('agent_routine',row.id).cancelled) continue;
    try {
      const payload=await unpack(services,row);
      let after=Math.max(window.now,stamp(window.start)-1,Number(row.next_at)-1);
      for (let count=0;count<50;count++) {
        const occurrence=nextRoutineCalendarOccurrence(row,payload,after);
        if (occurrence.nextAt>=stamp(window.end)+32*86400000) break;
        after=occurrence.nextAt;
        if (occurrence.availableAt>=stamp(window.end)) continue;
        const shown=routineCalendarOccurrence(payload,occurrence.nextAt);
        add({kind:'agent_routine',sourceId:row.id,id:`routine:${row.id}:${occurrence.nextAt}`,title:shown.title || 'Actividad periódica',eventAt:new Date(occurrence.availableAt).toISOString(),agent:row.agent});
      }
    } catch {unsupported.push({kind:'agent_routine',id:row.id,reason:'routine_occurrences_unavailable'});}
  }
  for (const row of source('cognira_report_schedules')) {
    if (status('cognira_report',row.id).cancelled) continue;
    let at=stamp(row.next_at);
    for (let count=0;count<34 && Number.isFinite(at) && at<stamp(window.end);count++) {
      add({kind:'cognira_report',sourceId:row.id,id:`cognira_report:${row.id}:${at}`,title:'Reporte programado',eventAt:new Date(at).toISOString(),agent:'melodi'});
      if (!row.recurring) break;
      const nextDay=dayPlus(clockContext(at,row.time_zone || timeZone).today_local);
      at=stamp(localDateTimeToUtc(`${nextDay}T${row.local_hour}`,row.time_zone || timeZone));
    }
  }
  for (const [table,kind] of [['wa_story_slots','story_slot'],['wa_story_single_drafts','story_single']]) {
    for (const row of source(table).filter(item=>['pending','generating','ready','publishing'].includes(item.status))) {
      if (kind==='story_slot' && !source('wa_story_campaigns').some(item=>item.id===row.campaign_id && item.status==='active')) continue;
      add({kind,id:row.id,title:kind==='story_slot' ? `Historia · ${row.stage}` : 'Publicación programada',eventAt:row.scheduled_at,agent:'melodi'});
    }
  }
  events.sort((a,b)=>a.eventAt.localeCompare(b.eventAt)||a.id.localeCompare(b.id));
  state.events=events;
  state.unsupported=unsupported;
  return {owner,timeZone,start:window.start,end:window.end,now:new Date(window.now).toISOString(),events,unsupported,
    hasMore:sources.some(item=>item.rows.length>300),token:await digest(JSON.stringify(state)),_state:state};
}

function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.createEvents) || plan.createEvents.length>30) throw Error('invalid_agenda_plan');
  const createEvents=plan.createEvents.map(item=>{
    const title=typeof item?.title==='string' ? item.title.trim() : '',at=stamp(item?.eventAt),agent=item?.agent || 'melodi';
    if (!title || title.length>240 || /[\u0000-\u001f]/.test(title) || !Number.isFinite(at) || !AGENTS.includes(agent)) throw Error('invalid_agenda_plan_event');
    return {title,eventAt:new Date(at).toISOString(),agent};
  });
  let moveDay=null;
  if (plan.moveDay) {
    const {fromDate,toDate,onlyCalendarEvents=false,resolveWorkConflicts=false}=plan.moveDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toDate || '') || fromDate===toDate) throw Error('invalid_agenda_move_day');
    if (typeof onlyCalendarEvents!=='boolean' || typeof resolveWorkConflicts!=='boolean') throw Error('invalid_agenda_move_scope');
    moveDay={fromDate,toDate,onlyCalendarEvents,resolveWorkConflicts};
  }
  let eventMoves;
  if(plan.eventMoves!==undefined){
    if(!Array.isArray(plan.eventMoves)||!plan.eventMoves.length||plan.eventMoves.length>12||new Set(plan.eventMoves.map(item=>item.id)).size!==plan.eventMoves.length)throw Error('invalid_agenda_explicit_moves');
    eventMoves=plan.eventMoves.map(item=>{
      if(typeof item.id!=='string'||!item.id||item.id.length>200||!Number.isFinite(stamp(item.eventAt))||!Number.isFinite(stamp(item.previousEventAt)))throw Error('invalid_agenda_explicit_move');
      return{id:item.id,eventAt:new Date(stamp(item.eventAt)).toISOString(),previousEventAt:new Date(stamp(item.previousEventAt)).toISOString()};
    });
  }
  if (!createEvents.length && !moveDay&&!eventMoves?.length) throw Error('empty_agenda_plan');
  return {createEvents,moveDay,...(eventMoves?{eventMoves}:{})};
}

function guardFor(source) {
  // Table names and predicate identifiers come exclusively from this module.
  // JSON keeps a large snapshot below D1's bound-parameter limit.
  const columns=Object.keys(source.rows[0] || {}),idColumn=columns.includes('id') ? 'id' : columns.includes('job_id') ? 'job_id' : null;
  const identity=idColumn ? [`live.${idColumn}=json_extract(wanted.value,'$.${idColumn}')`]
    : ['owner','owner_phone','phone','kind','source_id'].filter(key=>columns.includes(key)).map(key=>`live.${key}=json_extract(wanted.value,'$.${key}')`);
  if (!source.rows.length) return {sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=0`,values:source.values};
  const compare=columns.map(key=>`live.${key} IS NOT json_extract(wanted.value,'$.${key}')`).join(' OR ');
  return {sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=? AND NOT EXISTS(
    SELECT 1 FROM json_each(?) wanted LEFT JOIN ${source.table} live ON ${identity.join(' AND ')} WHERE ${compare})`,
    values:[...source.values,source.rows.length,JSON.stringify(source.rows)]};
}

/** One owner-authorized plan, all-or-none. This updates local source schedules;
 * the existing Google Calendar sync propagates the committed result. Receipts
 * contain no plaintext titles and replays return the first immutable result. */
export async function applyAgendaPlan(env,owner,messageId,plan,{snapshot,now=Date.now(),timeZone=env.TIME_ZONE || DOMINICAN_TIME_ZONE,services}={}) {
  scope(env,owner);
  if (typeof messageId!=='string' || !messageId || messageId.length>500 || /[\u0000-\u001f]/.test(messageId)) throw Error('invalid_agenda_plan_message');
  if (typeof services?.encrypt!=='function' || typeof services?.decrypt!=='function') throw Error('agenda_plan_encryption_unavailable');
  const normalized=normalizePlan(plan),sourceHash=await digest(`${owner}\u0000${messageId}`),id=`agenda-${sourceHash}`;
  const fingerprint=await digest(JSON.stringify({timeZone,...normalized})),db=typeof env.VETSA_CLOUD.withSession==='function' ? env.VETSA_CLOUD.withSession('first-primary') : env.VETSA_CLOUD;
  await db.prepare(AGENDA_PLAN_SCHEMA).run();
  const prior=await db.prepare('SELECT * FROM agenda_plan_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if (prior) return prior.fingerprint!==fingerprint ? {status:'conflict',reason:'request_replay_mismatch'}
    : {...await unpack(services,prior),status:'replayed'};
  const at=stamp(now),state=snapshot?._state;
  if (!Number.isFinite(at) || !state || snapshot.owner!==owner || state.owner!==owner || state.timeZone!==timeZone
    || snapshot.token!==await digest(JSON.stringify(state))) throw Error('invalid_agenda_plan_snapshot');
  if (state.sources.some(source=>source.rows.length>300)) return {status:'unsupported',reason:'agenda_window_limit',unsupported:state.unsupported};
  const moved=[], blocked=[];
  if (normalized.moveDay) {
    const {fromDate,toDate}=normalized.moveDay;
    const from=localDateTimeToUtc(`${fromDate}T00:00`,timeZone),to=localDateTimeToUtc(`${toDate}T00:00`,timeZone);
    if (!from || !to || stamp(from)<stamp(state.start) || stamp(localDateTimeToUtc(`${dayPlus(fromDate)}T00:00`,timeZone))>stamp(state.end)
      || stamp(to)<stamp(state.start) || stamp(localDateTimeToUtc(`${dayPlus(toDate)}T00:00`,timeZone))>stamp(state.end)) return {status:'unsupported',reason:'move_outside_snapshot'};
    // This exception is accepted only after the caller obtained the owner's
    // explicit narrower scope. It is part of the immutable request hash.
    blocked.push(...state.unsupported.filter(item=>(!normalized.moveDay.onlyCalendarEvents || !['agent_routine','cognira_report','story_slot','story_single'].includes(item.kind))
      && (!item.eventAt || clockContext(item.eventAt,timeZone).today_local===fromDate)));
  }
  if (blocked.length) return {status:'unsupported',reason:'unsupported_day_activities',unsupported:blocked};
  if(normalized.eventMoves?.some(move=>stamp(move.eventAt)<stamp(state.start)||stamp(move.eventAt)>=stamp(state.end)))return{status:'unsupported',reason:'move_outside_snapshot'};
  const changes = agendaDayMoves(state.events, normalized.moveDay, { now: at, timeZone, created: normalized.createEvents,explicitMoves:normalized.eventMoves||[] });
  if (changes.conflicts.length) {
    const conflict = changes.conflicts[0];
    if (conflict.reason === 'target_wall_time_unavailable') return { status: 'unsupported', reason: 'unsupported_day_activities',
      unsupported: changes.conflicts.map(item => ({ id: item.event.id, kind: item.event.kind, reason: item.reason })) };
    return { status: 'conflict', reason: conflict.reason, eventAt: conflict.eventAt,
      events: [conflict.event, ...(conflict.conflicting || [])] };
  }
  moved.push(...changes.moved);
  const created=normalized.createEvents.map((item,index)=>({...item,id:`${id}-${index+1}`}));
  if (created.some(item=>stamp(item.eventAt)<=at || stamp(item.eventAt)<stamp(state.start) || stamp(item.eventAt)>=stamp(state.end))) return {status:'unsupported',reason:'event_outside_snapshot_or_past'};
  const retained=state.events.filter(item=>!moved.some(move=>move.id===item.id));
  const requested=[...moved,...created],seen=new Set(retained.map(item=>item.eventAt));
  // Keep one atomic plan bounded, including when an owner has an unusually
  // dense day. The caller may request a smaller explicit scope afterward.
  if (requested.length>30) return {status:'unsupported',reason:'agenda_mutation_limit',requestedCount:requested.length};
  for (const event of requested) {
    if (seen.has(event.eventAt)) return {status:'conflict',reason:'time_conflict',eventAt:event.eventAt,
      events: [event, ...[...retained, ...requested.filter(item => item.id !== event.id)].filter(item => item.eventAt === event.eventAt)]};
    seen.add(event.eventAt);
  }
  const result={status:'applied',id,created,moved,adjustments:changes.adjustments,movedCount:moved.length,createdCount:created.length};
  const sealed=await services.encrypt(JSON.stringify(result));
  if (!sealed?.encrypted || !sealed?.iv) throw Error('agenda_plan_encryption_unavailable');
  const executionKey=crypto.randomUUID(),createdAt=new Date(at).toISOString();
  const guards=state.sources.map(guardFor);
  const names=Object.keys(OPTIONAL);
  guards.unshift({sql:`(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN (${names.map(()=>'?').join(',')}))=?`,values:[...names,state.names.length]});
  const owns=`EXISTS(SELECT 1 FROM agenda_plan_receipts WHERE id=? AND owner=? AND execution_key=?)`;
  const ownsValues=[id,owner,executionKey];
  const expected=[...moved.map(event=>({...event,storedAgent:state.sources[0].rows.find(row=>row.id===event.id).assigned_agent})),
    ...created.map(event=>({...event,storedAgent:event.agent,eventType:'REMINDER'}))];
  try {
    await db.batch([
      db.prepare(`INSERT INTO agenda_plan_receipts(id,owner,source_hash,fingerprint,payload_encrypted,payload_iv,execution_key,created_at)
        SELECT ?,?,?,CASE WHEN ${guards.map(guard=>`(${guard.sql})`).join(' AND ')} THEN ? ELSE NULL END,?,?,?,?
        WHERE NOT EXISTS(SELECT 1 FROM agenda_plan_receipts WHERE id=?) ON CONFLICT(id) DO NOTHING`)
        .bind(id,owner,sourceHash,...guards.flatMap(guard=>guard.values),fingerprint,sealed.encrypted,sealed.iv,executionKey,createdAt,id),
      ...moved.map(event=>db.prepare(`UPDATE melodi_calendar_events SET event_at=?,updated_at=?,emily_prepared_at=NULL WHERE id=? AND phone=? AND reminded_at IS NULL AND ${owns}`)
        .bind(event.eventAt,createdAt,event.id,owner,...ownsValues)),
      ...created.map(event=>db.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
        SELECT ?,?,?,?,'REMINDER',?,?,? WHERE ${owns}`).bind(event.id,owner,event.title,event.eventAt,event.agent,createdAt,createdAt,...ownsValues)),
      // Verification is part of the same transaction. A trigger that ignores a
      // write must roll back every earlier change and its success receipt.
      db.prepare(`UPDATE agenda_plan_receipts SET fingerprint=CASE WHEN NOT EXISTS(
        SELECT 1 FROM json_each(?) wanted LEFT JOIN melodi_calendar_events e ON e.id=json_extract(wanted.value,'$.id') AND e.phone=?
        WHERE e.id IS NULL OR e.title IS NOT json_extract(wanted.value,'$.title') OR e.event_at IS NOT json_extract(wanted.value,'$.eventAt')
        OR e.assigned_agent IS NOT json_extract(wanted.value,'$.storedAgent') OR e.event_type IS NOT json_extract(wanted.value,'$.eventType')
        OR e.reminded_at IS NOT NULL OR e.updated_at IS NOT ?) THEN fingerprint ELSE NULL END WHERE id=? AND owner=? AND execution_key=?`)
        .bind(JSON.stringify(expected),owner,createdAt,...ownsValues),
    ]);
  } catch (error) {
    // Only our explicit NOT NULL guard identifies a stale snapshot. Other D1
    // failures propagate for durable retry instead of being called a conflict.
    if (/NOT NULL constraint failed:\s*agenda_plan_receipts\.fingerprint/i.test(`${error?.message} ${error?.cause?.message || ''}`)) return {status:'conflict',reason:'agenda_changed'};
    throw error;
  }
  const saved=await db.prepare('SELECT * FROM agenda_plan_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if (!saved || saved.fingerprint!==fingerprint) return {status:'conflict',reason:'request_replay_mismatch'};
  return {...await unpack(services,saved),status:saved.execution_key===executionKey ? 'applied' : 'replayed'};
}
