import {clockContext,localDateTimeToUtc,DOMINICAN_TIME_ZONE} from './event-time.js';
import {readAgendaPlanSnapshot} from './agenda-plan-store.js';
import {ensureScreenshotCalendarSchema} from './screenshot-calendar-store.js';
import {requestGoogleCalendarSync} from './google-calendar-sync-queue.js';
import {routineMatchesLocal,routineCalendarOccurrence,routineWeekdays,nextRoutineCalendarOccurrence} from './melodi-routines.js';

export const OWNER_CALENDAR_MUTATION_SCHEMA=`CREATE TABLE IF NOT EXISTS owner_calendar_mutation_receipts (
  id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,
  payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,execution_key TEXT NOT NULL,created_at TEXT NOT NULL,
  UNIQUE(owner,source_hash))`;
const stamp=value=>typeof value==='number'?value:Date.parse(value);
const iso=value=>new Date(stamp(value)).toISOString();
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const validText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const database=env=>typeof env.VETSA_CLOUD.withSession==='function'?env.VETSA_CLOUD.withSession('first-primary'):env.VETSA_CLOUD;
function guardFor(source){
  if(!source.rows.length)return{sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=0`,values:source.values};
  const columns=Object.keys(source.rows[0]),idColumn=columns.includes('id')?'id':columns.includes('job_id')?'job_id':columns.includes('event_id')?'event_id':null;
  const identity=idColumn?[`live.${idColumn}=json_extract(wanted.value,'$.${idColumn}')`]
    :['owner','owner_phone','phone','kind','source_id'].filter(key=>columns.includes(key)).map(key=>`live.${key}=json_extract(wanted.value,'$.${key}')`);
  return{sql:`(SELECT COUNT(*) FROM ${source.table} WHERE ${source.where})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted
    LEFT JOIN ${source.table} live ON ${identity.join(' AND ')} WHERE ${columns.map(key=>`live.${key} IS NOT json_extract(wanted.value,'$.${key}')`).join(' OR ')})`,
    values:[...source.values,source.rows.length,JSON.stringify(source.rows)]};
}
async function unpack(services,row){const value=await services.decrypt(row.payload_encrypted,row.payload_iv);return typeof value==='string'?JSON.parse(value):value;}
async function sync(env,result,now){
  try{const queued=await requestGoogleCalendarSync(env,{now});return{...result,syncPending:['queued','coalesced'].includes(queued?.status)};}
  catch{return{...result,syncPending:true};}
}
function clarify(reason,question,extra={}){return{status:'clarification',reason,clarification:question,...extra};}

const OPTIONAL_SCHEDULES=['wa_owner_session','melodi_google_calendar_schedule_overrides','melodi_google_calendar_activity_map','wa_melodi_document_delivery_schedules','wa_melodi_routines','cognira_report_schedules','wa_story_slots','wa_story_campaigns','wa_story_single_drafts'];
const busyDuration=duration=>Number.isFinite(duration)&&duration>0?(duration>86400000?30*60000:duration):15*60000;
async function destinationConflicts(env,owner,{db,services,at,timeZone,eventAt,duration,excludeId,excludeRoutine}){
  await ensureScreenshotCalendarSchema({...env,VETSA_CLOUD:db});
  const day=clockContext(eventAt,timeZone).today_local,lastDay=clockContext(stamp(eventAt)+busyDuration(duration),timeZone).today_local,
    dayBefore=new Date(Date.parse(`${day}T12:00:00Z`)-86400000).toISOString().slice(0,10),dayAfter=new Date(Date.parse(`${lastDay}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  const snapshot=await readAgendaPlanSnapshot({...env,VETSA_CLOUD:db},owner,{start:localDateTimeToUtc(`${dayBefore}T00:00`,timeZone),end:localDateTimeToUtc(`${dayAfter}T00:00`,timeZone),now:at,timeZone,services});
  if(snapshot.hasMore||snapshot.unsupported.some(item=>!item.eventAt))return{unverified:true};
  const metadata=(await db.prepare('SELECT * FROM melodi_screenshot_calendar_events WHERE owner=? ORDER BY event_id LIMIT 301').bind(owner).all()).results;
  if(metadata.length>300)return{unverified:true};
  const overrides=new Map();
  for(const row of snapshot._state.sources.find(source=>source.table==='melodi_google_calendar_schedule_overrides')?.rows||[]){
    const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv),payload=typeof decoded==='string'?JSON.parse(decoded):decoded;overrides.set(`${row.kind}:${row.source_id}`,{...payload,status:row.status});
  }
  const events=[...snapshot.events];
  // Include a real source that is already in progress. Agenda listings normally
  // omit sent reminders, but their still-running duration can occupy this slot.
  for(const row of snapshot._state.sources[0].rows){
    if(events.some(event=>event.id===row.id)||overrides.get(`melodi_calendar_events:${row.id}`)?.status==='cancelled')continue;
    events.push({id:row.id,kind:'melodi_calendar_events',title:row.title,eventAt:row.event_at});
  }
  const start=stamp(eventAt),end=start+busyDuration(duration),conflicts=events.filter(event=>{
    if(event.id===excludeId||excludeRoutine&&event.id.startsWith(`routine:${excludeRoutine}:`))return false;
    const extra=overrides.get(`${event.kind}:${event.sourceId||event.id}`),meta=event.kind==='melodi_calendar_events'?metadata.find(item=>item.event_id===event.id):null;
    const occupied=busyDuration(meta?stamp(meta.end_at)-stamp(event.eventAt):Number(extra?.durationMinutes)*60000);
    return stamp(event.eventAt)<end&&start<stamp(event.eventAt)+occupied;
  });
  const guards=[...snapshot._state.sources.map(guardFor),guardFor({table:'melodi_screenshot_calendar_events',where:'owner=?',values:[owner],rows:metadata}),
    {sql:`(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN (${OPTIONAL_SCHEDULES.map(()=>'?').join(',')}))=?`,values:[...OPTIONAL_SCHEDULES,snapshot._state.names.length]}];
  return{conflicts,guards};
}

async function mutateRoutine(env,owner,wanted,observed,{db,services,at,timeZone,id,sourceHash,fingerprint}){
  if(wanted.scope==='occurrence')return{status:'unsupported',reason:'routine_occurrence_unsupported',notice:'Para cambiar solo esa ocasión, edítala en Google Calendar. Desde este chat puedo cambiar la rutina completa.'};
  if(wanted.scope!=='series')return clarify('recurring_scope_required',`¿Quieres cambiar toda la rutina de «${observed.title||'esa actividad'}»?`);
  const match=/^routine:(.+):(\d+)$/.exec(wanted.eventId);
  const row=match?await db.prepare('SELECT * FROM wa_melodi_routines WHERE owner=? AND id=?').bind(owner,match[1]).first():null;
  if(!row||row.status!=='active')return{status:'unsupported',reason:'routine_inactive',notice:'Esa rutina está cancelada o ya no está disponible. No la he reactivado.'};
  if(Number(row.lease_until)>at)return{status:'unsupported',reason:'routine_running',notice:'Esa rutina se está ejecutando ahora. Espera a que termine para cambiarla.'};
  const decoded=await services.decrypt(row.payload_encrypted,row.payload_iv),payload=typeof decoded==='string'?JSON.parse(decoded):decoded;
  const originalAt=Number(match[2]),shown=routineCalendarOccurrence(payload,originalAt);
  if(!routineMatchesLocal(row,payload,clockContext(originalAt,DOMINICAN_TIME_ZONE).now_local)||shown.cancelled||stamp(shown.startAt)!==stamp(wanted.expectedEventAt)||originalAt<row.created_at
    ||originalAt>at+366*86400000||stamp(shown.startAt)<=at||typeof observed.title==='string'&&shown.title!==observed.title)return clarify('event_changed','La rutina cambió desde la consulta. ¿Quieres que revise su horario actual?');
  const names=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(item=>item.name));
  const override=names.has('melodi_google_calendar_schedule_overrides')?await db.prepare("SELECT * FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind='agent_routine' AND source_id=?").bind(owner,row.id).first():null;
  const mapping=names.has('melodi_google_calendar_activity_map')?await db.prepare("SELECT * FROM melodi_google_calendar_activity_map WHERE owner=? AND kind='agent_routine' AND source_id=?").bind(owner,row.id).first():null;
  if(override?.status==='cancelled'||mapping&&['cancelled','completed','unsupported'].includes(mapping.status))return{status:'unsupported',reason:'routine_inactive',notice:'Esa rutina está cancelada o en pausa. No la he reactivado.'};
  let nextPayload={...payload,...(wanted.title!==undefined?{title:wanted.title}:{})},hour=row.hour,weekday=row.weekday,nextAt=row.next_at,availableAt=row.available_at;
  const guards=[guardFor({table:'wa_melodi_routines',where:'owner=? AND id=?',values:[owner,row.id],rows:[row]})];
  if(wanted.operation==='update'&&wanted.eventAt!==undefined){
    if(stamp(wanted.eventAt)<=at)return clarify('event_in_past','Esa fecha u hora ya pasó. ¿Para cuándo quieres dejar la rutina?');
    const target=clockContext(wanted.eventAt,DOMINICAN_TIME_ZONE).now_local,oldLocal=clockContext(shown.startAt,DOMINICAN_TIME_ZONE).now_local;
    hour=target.slice(11,16);weekday=new Date(`${target.slice(0,10)}T12:00:00Z`).getUTCDay();
    if(!payload.frequency||payload.frequency==='weekly'){
      const days=routineWeekdays(row,payload);
      if(days.length>1&&!days.includes(weekday))return{status:'unsupported',reason:'routine_pattern_unsupported',notice:'Esa rutina tiene varios días por semana. Para cambiar los días de toda la serie, ajusta su repetición en Google Calendar; no cambié el patrón.'};
      nextPayload={...nextPayload,...(days.length===1?{weekdays:[weekday]}:{weekdays:days})};
    }else if(payload.frequency==='monthly')nextPayload={...nextPayload,dayOfMonth:Number(target.slice(8,10))};
    // Preserve existing explicitly cancelled/moved occurrences when only the
    // recurring hour changes. More complex pattern changes need Calendar UI.
    const futureExceptions=Object.entries(payload.calendarExceptions||{}).filter(([key])=>stamp(key)>at);
    const dayShift=Date.parse(`${target.slice(0,10)}T12:00:00Z`)-Date.parse(`${oldLocal.slice(0,10)}T12:00:00Z`);
    if(futureExceptions.length&&dayShift!==0)return{status:'unsupported',reason:'routine_exceptions_pattern',notice:'La rutina tiene ocasiones modificadas individualmente. Cambia su patrón en Google Calendar para conservar esas excepciones.'};
    const exceptions={};for(const[key,value]of Object.entries(payload.calendarExceptions||{})){
      const day=clockContext(key,DOMINICAN_TIME_ZONE).today_local;
      const shifted=stamp(key)>at&&hour!==row.hour?localDateTimeToUtc(`${day}T${hour}`,DOMINICAN_TIME_ZONE):key;
      exceptions[shifted]=value;
    }
    nextPayload={...nextPayload,calendarStartAt:wanted.eventAt,calendarExceptions:exceptions};
    const occurrence=nextRoutineCalendarOccurrence({...row,hour,weekday},nextPayload,Math.max(at,stamp(wanted.eventAt)-1));nextAt=occurrence.nextAt;availableAt=occurrence.availableAt;
    const destination=await destinationConflicts(env,owner,{db,services,at,timeZone,eventAt:iso(availableAt),duration:15*60000,excludeRoutine:row.id});
    if(destination.unverified)return{status:'unsupported',reason:'destination_unverified',notice:'No pude revisar todos los compromisos de ese día. La rutina conserva su horario anterior.'};
    const {conflicts}=destination;
    if(conflicts.length)return clarify('time_conflict',`A esa hora tienes «${conflicts.map(event=>event.title).join('», «')}». ¿A qué hora quieres dejar la rutina?`,{events:conflicts.map(event=>({id:event.id,title:event.title,eventAt:event.eventAt}))});
    guards.push(...destination.guards);
  }
  if(names.has('melodi_google_calendar_schedule_overrides'))guards.push(guardFor({table:'melodi_google_calendar_schedule_overrides',where:"owner=? AND kind='agent_routine' AND source_id=?",values:[owner,row.id],rows:override?[override]:[]}));
  if(names.has('melodi_google_calendar_activity_map'))guards.push(guardFor({table:'melodi_google_calendar_activity_map',where:"owner=? AND kind='agent_routine' AND source_id=?",values:[owner,row.id],rows:mapping?[mapping]:[]}));
  const encrypted=await services.encrypt(JSON.stringify(nextPayload));if(!encrypted?.encrypted||!encrypted?.iv)throw Error('calendar_mutation_crypto_required');
  const result={status:'applied',id,operation:wanted.operation,scope:'series',event:{id:`routine:${row.id}:${nextAt}`,title:nextPayload.title,eventAt:iso(availableAt)},previous:{id:wanted.eventId,title:shown.title,eventAt:shown.startAt}};
  const sealed=await services.encrypt(JSON.stringify(result));if(!sealed?.encrypted||!sealed?.iv)throw Error('calendar_mutation_crypto_required');
  const executionKey=crypto.randomUUID(),createdAt=iso(at),status=wanted.operation==='cancel'?'stopped':'active',owns='EXISTS(SELECT 1 FROM owner_calendar_mutation_receipts WHERE id=? AND owner=? AND execution_key=?)',ownsValues=[id,owner,executionKey];
  try{await db.batch([
    db.prepare(`INSERT INTO owner_calendar_mutation_receipts(id,owner,source_hash,fingerprint,payload_encrypted,payload_iv,execution_key,created_at)
      SELECT ?,?,?,CASE WHEN ${guards.map(guard=>`(${guard.sql})`).join(' AND ')} THEN ? ELSE NULL END,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM owner_calendar_mutation_receipts WHERE id=?) ON CONFLICT(id) DO NOTHING`)
      .bind(id,owner,sourceHash,...guards.flatMap(guard=>guard.values),fingerprint,sealed.encrypted,sealed.iv,executionKey,createdAt,id),
    db.prepare(`UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=?,hour=?,weekday=?,next_at=?,available_at=?,status=?,attempts=0,lease_token=NULL,lease_until=NULL,updated_at=? WHERE owner=? AND id=? AND ${owns}`)
      .bind(encrypted.encrypted,encrypted.iv,hour,weekday,nextAt,availableAt,status,at,owner,row.id,...ownsValues),
    db.prepare(`UPDATE owner_calendar_mutation_receipts SET fingerprint=CASE WHEN EXISTS(SELECT 1 FROM wa_melodi_routines WHERE owner=? AND id=? AND payload_encrypted=? AND payload_iv=? AND hour=? AND weekday=? AND next_at=? AND available_at=? AND status=? AND updated_at=? AND lease_token IS NULL AND lease_until IS NULL) THEN fingerprint ELSE NULL END WHERE id=? AND owner=? AND execution_key=?`)
      .bind(owner,row.id,encrypted.encrypted,encrypted.iv,hour,weekday,nextAt,availableAt,status,at,...ownsValues),
  ]);}catch(error){if(/NOT NULL constraint failed:\s*owner_calendar_mutation_receipts\.fingerprint/i.test(`${error?.message} ${error?.cause?.message||''}`))return clarify('event_changed','La rutina cambió mientras la actualizaba. ¿Quieres que revise su horario actual?');throw error;}
  const saved=await db.prepare('SELECT * FROM owner_calendar_mutation_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if(!saved||saved.fingerprint!==fingerprint)return{status:'conflict',reason:'request_replay_mismatch'};
  return sync(env,{...await unpack(services,saved),status:saved.execution_key===executionKey?'applied':'replayed'},at);
}

/** A mutation must refer to a real observation from this authenticated turn.
 * The immutable receipt and all source writes commit together. A retry returns
 * the first receipt and cannot recreate, delete, or move the source a second time.
 * Unmentioned time, title, duration and advance notice are retained. */
export async function mutateOwnerCalendarEvent(env,owner,messageId,input,{now=Date.now(),timeZone=env.TIME_ZONE||DOMINICAN_TIME_ZONE,services,observedEvents=[]}={}){
  if(!/^\d{8,15}$/.test(owner||'')||owner!==String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''))throw Error('calendar_mutation_owner_required');
  if(!env.VETSA_CLOUD?.prepare||!env.VETSA_CLOUD?.batch)throw Error('calendar_mutation_storage_unavailable');
  if(!validText(messageId,500)||!Number.isFinite(stamp(now)))throw Error('calendar_mutation_context_invalid');
  if(typeof services?.encrypt!=='function'||typeof services?.decrypt!=='function')throw Error('calendar_mutation_crypto_required');
  if(!input||!['update','cancel'].includes(input.operation)||!validText(input.eventId,200)||!Number.isFinite(stamp(input.expectedEventAt)))throw Error('calendar_mutation_input_invalid');
  if(input.scope!==undefined&&!['series','occurrence'].includes(input.scope))throw Error('calendar_mutation_scope_invalid');
  if(input.operation==='cancel'&&(input.eventAt!==undefined||input.title!==undefined))throw Error('calendar_mutation_cancel_fields_invalid');
  if(input.operation==='update'&&(input.eventAt===undefined&&input.title===undefined||input.eventAt!==undefined&&!Number.isFinite(stamp(input.eventAt))||input.title!==undefined&&!validText(input.title,240)))throw Error('calendar_mutation_update_fields_invalid');
  const wanted={operation:input.operation,eventId:input.eventId,expectedEventAt:iso(input.expectedEventAt),...(input.eventAt!==undefined?{eventAt:iso(input.eventAt)}:{}),...(input.title!==undefined?{title:input.title.trim()}:{} ),...(input.scope?{scope:input.scope}:{})};
  const sourceHash=await digest(`${owner}\u0000${messageId}`),id=`calendar-mutation-${sourceHash}`,fingerprint=await digest(JSON.stringify({timeZone,...wanted}));
  const db=database(env),scoped={...env,VETSA_CLOUD:db},at=stamp(now);
  await db.prepare(OWNER_CALENDAR_MUTATION_SCHEMA).run();
  const prior=await db.prepare('SELECT * FROM owner_calendar_mutation_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if(prior)return prior.fingerprint===fingerprint?sync(env,{...await unpack(services,prior),status:'replayed'},at):{status:'conflict',reason:'request_replay_mismatch'};
  const observed=observedEvents.find(event=>event?.id===wanted.eventId&&stamp(event.eventAt??event.event_at)===stamp(wanted.expectedEventAt));
  if(!observed)return clarify('event_observation_required','Necesito localizar ese compromiso en tu agenda antes de cambiarlo. ¿Cuál es?');
  if(wanted.eventId.startsWith('routine:'))return mutateRoutine(env,owner,wanted,observed,{db,services,at,timeZone,id,sourceHash,fingerprint});
  if(/^(?:cognira_report|story_slot|story_single):/.test(wanted.eventId))return{status:'unsupported',reason:'linked_schedule_unsupported',notice:'Esa actividad depende de una publicación o entrega automática. Ajusta su programación en Google Calendar; no cambié la tarea vinculada.'};
  const row=await db.prepare('SELECT * FROM melodi_calendar_events WHERE id=? AND phone=?').bind(wanted.eventId,owner).first();
  if(!row)return clarify('event_missing','Ese compromiso ya no aparece en tu agenda. ¿Quieres que busque otro?');
  if(stamp(row.event_at)!==stamp(wanted.expectedEventAt)||typeof observed.title==='string'&&row.title!==observed.title)return clarify('event_changed',`«${row.title}» cambió desde la consulta. ¿Quieres que revise su fecha actual antes de modificarlo?`);
  if(row.reminded_at||stamp(row.event_at)<=at)return clarify('event_completed',`«${row.title}» ya pasó o su aviso ya fue enviado. ¿Quieres crear otro recordatorio?`);
  if(!['REMINDER','SCREENSHOT_EVENT'].includes(row.event_type))return{status:'unsupported',reason:'linked_schedule_unsupported',notice:`«${row.title}» está vinculado a una entrega automática. Cambia su programación en Google Calendar para mantener la entrega coordinada.`};
  const next={id:row.id,title:wanted.title??row.title,eventAt:wanted.eventAt??row.event_at};
  if(wanted.operation==='update'&&stamp(next.eventAt)<=at)return clarify('event_in_past','Esa fecha u hora ya pasó. ¿Para cuándo quieres dejarlo?');
  const names=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(item=>item.name));
  const override=names.has('melodi_google_calendar_schedule_overrides')?await db.prepare("SELECT * FROM melodi_google_calendar_schedule_overrides WHERE owner=? AND kind='melodi_calendar_events' AND source_id=?").bind(owner,row.id).first():null;
  const mapping=names.has('melodi_google_calendar_activity_map')?await db.prepare("SELECT * FROM melodi_google_calendar_activity_map WHERE owner=? AND kind='melodi_calendar_events' AND source_id=?").bind(owner,row.id).first():null;
  if(override?.status==='cancelled'||mapping&&['cancelled','completed','unsupported'].includes(mapping.status))return clarify('event_inactive',`«${row.title}» está cancelado o en pausa. ¿Quieres crear un compromiso nuevo?`);
  // Install the existing metadata triggers before taking the optimistic snapshot.
  // They preserve a screenshot's duration and move its independently sent notice.
  await ensureScreenshotCalendarSchema(scoped);
  const metadata=await db.prepare('SELECT * FROM melodi_screenshot_calendar_events WHERE owner=? AND event_id=?').bind(owner,row.id).first();
  if(row.event_type==='SCREENSHOT_EVENT'&&!metadata)return clarify('event_metadata_missing','No pude verificar la duración y el aviso de ese evento. ¿Quieres que revise los datos antes de cambiarlo?');
  if(wanted.operation==='update'&&metadata&&stamp(next.eventAt)-metadata.lead_minutes*60000<=at)return clarify('advance_notice_elapsed','La hora del aviso anticipado ya pasó para esa nueva fecha. ¿Para cuándo quieres dejar el evento?');
  const guards=[];
  if(wanted.operation==='update'&&next.eventAt!==row.event_at){
    let duration=metadata?stamp(metadata.end_at)-stamp(row.event_at):15*60000;
    if(!metadata&&override){const decoded=await services.decrypt(override.payload_encrypted,override.payload_iv),payload=typeof decoded==='string'?JSON.parse(decoded):decoded;if(Number.isFinite(payload.durationMinutes)&&payload.durationMinutes>0)duration=payload.durationMinutes*60000;}
    const target=await destinationConflicts(env,owner,{db,services,at,timeZone,eventAt:next.eventAt,duration,excludeId:row.id});
    if(target.unverified)return clarify('destination_unverified','No pude revisar todos los compromisos de ese día. ¿Quieres elegir otra hora?');
    const {conflicts}=target;
    if(conflicts.length)return clarify('time_conflict',`A esa hora tienes «${conflicts.map(event=>event.title).join('», «')}». ¿A qué hora quieres dejar «${row.title}»?`,{events:conflicts.map(event=>({id:event.id,title:event.title,eventAt:event.eventAt}))});
    guards.push(...target.guards);
  }
  guards.push(guardFor({table:'melodi_calendar_events',where:'id=? AND phone=?',values:[row.id,owner],rows:[row]}));
  guards.push(guardFor({table:'melodi_screenshot_calendar_events',where:'event_id=? AND owner=?',values:[row.id,owner],rows:metadata?[metadata]:[]}));
  if(names.has('melodi_google_calendar_schedule_overrides'))guards.push(guardFor({table:'melodi_google_calendar_schedule_overrides',where:"owner=? AND kind='melodi_calendar_events' AND source_id=?",values:[owner,row.id],rows:override?[override]:[]}));
  if(names.has('melodi_google_calendar_activity_map'))guards.push(guardFor({table:'melodi_google_calendar_activity_map',where:"owner=? AND kind='melodi_calendar_events' AND source_id=?",values:[owner,row.id],rows:mapping?[mapping]:[]}));
  const result={status:'applied',id,operation:wanted.operation,event:next,previous:{id:row.id,title:row.title,eventAt:row.event_at}};
  const sealed=await services.encrypt(JSON.stringify(result));if(!sealed?.encrypted||!sealed?.iv)throw Error('calendar_mutation_crypto_required');
  const executionKey=crypto.randomUUID(),createdAt=iso(at),owns='EXISTS(SELECT 1 FROM owner_calendar_mutation_receipts WHERE id=? AND owner=? AND execution_key=?)',ownsValues=[id,owner,executionKey];
  let verify=wanted.operation==='cancel'?'NOT EXISTS(SELECT 1 FROM melodi_calendar_events WHERE id=? AND phone=?)':'EXISTS(SELECT 1 FROM melodi_calendar_events WHERE id=? AND phone=? AND title=? AND event_at=? AND reminded_at IS NULL AND updated_at=?)';
  const verifyValues=wanted.operation==='cancel'?[row.id,owner]:[row.id,owner,next.title,next.eventAt,createdAt];
  if(wanted.operation==='cancel'){verify+=' AND NOT EXISTS(SELECT 1 FROM melodi_screenshot_calendar_events WHERE event_id=? AND owner=?)';verifyValues.push(row.id,owner);}
  else if(metadata&&next.eventAt!==row.event_at){
    verify+=' AND EXISTS(SELECT 1 FROM melodi_screenshot_calendar_events WHERE event_id=? AND owner=? AND end_at=? AND deliver_at=? AND lead_minutes=? AND source_time_zone=? AND reminded_at IS NULL AND updated_at=?)';
    verifyValues.push(row.id,owner,iso(stamp(metadata.end_at)+stamp(next.eventAt)-stamp(row.event_at)),iso(stamp(next.eventAt)-metadata.lead_minutes*60000),metadata.lead_minutes,metadata.source_time_zone,createdAt);
  }
  // A NOT NULL failure aborts the entire D1 transaction, including its receipt.
  // The final verification also catches BEFORE UPDATE/DELETE RAISE(IGNORE).
  try{await db.batch([
    db.prepare(`INSERT INTO owner_calendar_mutation_receipts(id,owner,source_hash,fingerprint,payload_encrypted,payload_iv,execution_key,created_at)
      SELECT ?,?,?,CASE WHEN ${guards.map(guard=>`(${guard.sql})`).join(' AND ')} THEN ? ELSE NULL END,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM owner_calendar_mutation_receipts WHERE id=?) ON CONFLICT(id) DO NOTHING`)
      .bind(id,owner,sourceHash,...guards.flatMap(guard=>guard.values),fingerprint,sealed.encrypted,sealed.iv,executionKey,createdAt,id),
    wanted.operation==='cancel'?db.prepare(`DELETE FROM melodi_calendar_events WHERE id=? AND phone=? AND ${owns}`).bind(row.id,owner,...ownsValues)
      :db.prepare(`UPDATE melodi_calendar_events SET title=?,event_at=?,updated_at=?,emily_prepared_at=NULL WHERE id=? AND phone=? AND ${owns}`).bind(next.title,next.eventAt,createdAt,row.id,owner,...ownsValues),
    db.prepare(`UPDATE owner_calendar_mutation_receipts SET fingerprint=CASE WHEN ${verify} THEN fingerprint ELSE NULL END WHERE id=? AND owner=? AND execution_key=?`).bind(...verifyValues,...ownsValues),
  ]);}catch(error){if(/NOT NULL constraint failed:\s*owner_calendar_mutation_receipts\.fingerprint/i.test(`${error?.message} ${error?.cause?.message||''}`))return clarify('event_changed',`«${row.title}» cambió mientras lo actualizaba. ¿Quieres que lo revise de nuevo?`);throw error;}
  const saved=await db.prepare('SELECT * FROM owner_calendar_mutation_receipts WHERE id=? AND owner=?').bind(id,owner).first();
  if(!saved||saved.fingerprint!==fingerprint)return{status:'conflict',reason:'request_replay_mismatch'};
  return sync(env,{...await unpack(services,saved),status:saved.execution_key===executionKey?'applied':'replayed'},at);
}
