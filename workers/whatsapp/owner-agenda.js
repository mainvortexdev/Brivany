import { clockContext, localDateTimeToUtc, localEventTime, DOMINICAN_TIME_ZONE } from './event-time.js';
import { stripAgentAddress } from './melodi-address.js';
import { nextRoutineCalendarOccurrence, routineCalendarOccurrence } from './melodi-routines.js';

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
const MEMBERS = { melodi:'Melodi' };
const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const dayAfter = (day, count = 1) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0,10);
function dayRange(day, days = 1) {
  const start = localDateTimeToUtc(`${day}T00:00`, DOMINICAN_TIME_ZONE);
  if (!start) return { clarification:'Esa fecha no existe. Dime qué día quieres consultar.' };
  return { start, end:localDateTimeToUtc(`${dayAfter(day,days)}T00:00`, DOMINICAN_TIME_ZONE), dateLabel:days === 1
    ? new Intl.DateTimeFormat('es-DO',{timeZone:DOMINICAN_TIME_ZONE,dateStyle:'long'}).format(new Date(start)) : 'los próximos siete días' };
}

/** Read-only questions take precedence over the generative intent classifier. */
export function parseOwnerAgendaQuery(text, { now = new Date() } = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 700 || /[\n\r]|https?:\/\/|["“”«»]/i.test(raw)) return null;
  const t = fold(stripAgentAddress(raw)).replace(/^[¿¡\s]+/,'');
  if (!/^(?:que|cual(?:es)?|cuando|a que hora|dime|consulta|revisa|muestra(?:me)?|ver|lista)\b/.test(t)
    || !/\b(?:programad[oa]s?|agendad[oa]s?|calendario|agenda|citas?|eventos?|actividades|recordatorios?)\b|^(?:que (?:tengo|tenemos|hay|tiene (?:melodi)))\b/.test(t)) return null;
  // Do not silently swallow an independent write or a quoted drafting request.
  if (/\b(?:crea|crear|programa|programar|cambia(?:lo|la)?|modifica|mueve|cancela|elimina|borra|envia(?:me)?|manda(?:me)?|recuerda(?:me)?|redacta|escribe)\b|\by\s+agenda(?:me)?\b/.test(t)) return null;
  const today = clockContext(now,DOMINICAN_TIME_ZONE).today_local;
  const targetAgent=t.match(/\b(?:tiene|de)\s+(melodi)\b/)?.[1];
  let day;
  const iso = t.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  const named = t.match(new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + MONTHS.join('|') + ')(?:\\s+(?:de\\s+)?(\\d{4}))?\\b'));
  if (iso) day = iso;
  else if (numeric) day = `${numeric[3] || today.slice(0,4)}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;
  else if (named) day = `${named[3] || today.slice(0,4)}-${String(MONTHS.indexOf(named[2])+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;
  else if (/\bpasado manana\b/.test(t)) day = dayAfter(today,2);
  else if (/\bmanana\b/.test(t)) day = dayAfter(today);
  else if (/\bhoy\b/.test(t)) day = today;
  else {
    const numbered = t.match(/\b(?:el|dia)\s+(\d{1,2})\b/);
    const weekday = DAYS.find(name => new RegExp(`\\b${name}\\b`).test(t));
    if (numbered) {
      const number = Number(numbered[1]);
      if (number < 1 || number > 31) return {clarification:'Dime una fecha válida para consultar la agenda.'};
      const fixedMonth = /\b(?:este|actual|presente) mes\b/.test(t);
      for (let offset = 0; offset <= (fixedMonth ? 0 : 12); offset++) {
        const month = new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1+offset,1));
        const candidate = `${month.toISOString().slice(0,7)}-${String(number).padStart(2,'0')}`;
        if (localDateTimeToUtc(`${candidate}T00:00`,DOMINICAN_TIME_ZONE) && (fixedMonth || candidate >= today)) { day=candidate; break; }
      }
    } else if (weekday) {
      let offset = (DAYS.indexOf(weekday)-new Date(`${today}T12:00:00Z`).getUTCDay()+7)%7;
      if (!offset && /\bproximo\b/.test(t)) offset=7;
      day=dayAfter(today,offset);
    }
  }
  if (day) return {...dayRange(day),...(targetAgent ? {targetAgent}: {})};
  if (/\b(?:ese dia|esa fecha|para el|el dia)\b/.test(t)) return {clarification:'Dime qué fecha quieres consultar en la agenda.'};
  return {...dayRange(today,7),...(targetAgent ? {targetAgent}: {})};
}

/** Only the authenticated owner's shared schedules; no private goals or chats. */
export async function readOwnerAgenda(env, phone, { start, end, limit = 12, decrypt, targetAgent,searchIndex=false } = {}) {
  if (!phone || String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'') !== phone) throw new Error('invalid_agenda_owner');
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || start >= end
    || !Number.isInteger(limit) || limit < 1 || limit > (searchIndex===true?350:50)) throw new Error('invalid_agenda_range');
  if (targetAgent!==undefined && !Object.hasOwn(MEMBERS,targetAgent)) throw new Error('invalid_agenda_agent');
  const db = env.VETSA_CLOUD;
  const names=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row=>row.name));
  const rows = await db.prepare(`SELECT id,title,event_at,assigned_agent FROM melodi_calendar_events
    WHERE phone=? AND event_at>=? AND event_at<? AND reminded_at IS NULL${targetAgent ? " AND COALESCE(assigned_agent,'melodi')=?" : ''} ORDER BY event_at,id LIMIT ?`)
    .bind(phone,start,end,...(targetAgent ? [targetAgent]:[]),limit+1).all();
  const events=[...(rows.results || [])];
  let sourceLimited=searchIndex===true && events.length>limit;
  if (names.has('wa_melodi_routines')) {
    const routines=(await db.prepare(`SELECT * FROM wa_melodi_routines WHERE owner=? AND status='active'${targetAgent ? ' AND agent=?' : ''} ORDER BY next_at LIMIT 151`).bind(phone,...(targetAgent ? [targetAgent]:[])).all()).results;
    if (routines.length>150) throw new Error('agenda_routine_limit');
    if (routines.length && typeof decrypt!=='function') throw new Error('agenda_decryption_unavailable');
    for (const row of routines) {
      const decoded=await decrypt(row.payload_encrypted,row.payload_iv), payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
      let at=Math.max(Date.parse(start)-1,row.next_at-1);
      for (let count=0;count<(searchIndex===true?1:limit+2);count++) {
        const occurrence=nextRoutineCalendarOccurrence(row,payload,at);
        if (occurrence.nextAt>=Date.parse(end)+7*86400000) break;
        at=occurrence.nextAt;
        if (occurrence.availableAt>=Date.parse(start) && occurrence.availableAt<Date.parse(end)) events.push({id:`routine:${row.id}:${at}`,
          title:routineCalendarOccurrence(payload,at).title,event_at:new Date(occurrence.availableAt).toISOString(),assigned_agent:row.agent});
      }
    }
  }
  if (names.has('cognira_report_schedules') && (!targetAgent || targetAgent==='melodi')) {
    const reports=(await db.prepare('SELECT id,next_at,recurring FROM cognira_report_schedules WHERE owner_phone=? AND next_at<? ORDER BY next_at LIMIT 151').bind(phone,end).all()).results;
    if (reports.length>150) throw new Error('agenda_report_limit');
    for (const row of reports) {
      let at=Date.parse(row.next_at);
      if (row.recurring && at<Date.parse(start)) at+=Math.ceil((Date.parse(start)-at)/86400000)*86400000;
      for (let count=0;count<(searchIndex===true?1:limit+1) && at<Date.parse(end);count++,at+=86400000) {
        if (at>=Date.parse(start)) events.push({id:`cognira_report:${row.id}:${at}`,title:'Reporte de Cognira Desktop',event_at:new Date(at).toISOString(),assigned_agent:'melodi'});
        if (!row.recurring) break;
      }
    }
  }
  if (names.has('wa_story_slots') && names.has('wa_story_campaigns') && (!targetAgent || targetAgent==='melodi')) {
    const stories=(await db.prepare(`SELECT s.id,s.scheduled_at,s.stage FROM wa_story_slots s JOIN wa_story_campaigns c ON c.id=s.campaign_id AND c.owner_phone=s.owner_phone
      WHERE s.owner_phone=? AND c.status='active' AND s.status IN ('pending','generating','ready','publishing') AND s.scheduled_at>=? AND s.scheduled_at<? ORDER BY s.scheduled_at LIMIT ?`)
      .bind(phone,start,end,limit+1).all()).results;
    events.push(...stories.map(row=>({id:`story_slot:${row.id}`,title:`Historia · ${row.stage}`,event_at:row.scheduled_at,assigned_agent:'melodi'})));
    sourceLimited ||= searchIndex===true&&stories.length>limit;
  }
  if (names.has('wa_story_single_drafts')) {
    const join=names.has('wa_melodi_artifact_tracking') ? " LEFT JOIN wa_melodi_artifact_tracking a ON a.owner=s.owner_phone AND a.job_id=s.id AND a.job_type='generate_story'" : '';
    const agent=join ? "COALESCE(a.agent,'melodi')" : "'melodi'";
    const stories=(await db.prepare(`SELECT s.id,s.scheduled_at,${agent} AS assigned_agent FROM wa_story_single_drafts s${join}
      WHERE s.owner_phone=? AND s.status IN ('pending','generating','ready','publishing') AND s.scheduled_at>=? AND s.scheduled_at<?${targetAgent ? ` AND ${agent}=?`:''} ORDER BY s.scheduled_at LIMIT ?`)
      .bind(phone,start,end,...(targetAgent ? [targetAgent]:[]),limit+1).all()).results;
    events.push(...stories.map(row=>({id:`story_single:${row.id}`,title:'Publicación de historia',event_at:row.scheduled_at,assigned_agent:row.assigned_agent})));
    sourceLimited ||= searchIndex===true&&stories.length>limit;
  }
  const sourceKey=event=>{
    const [kind,id]=event.id.split(':');
    return ['routine','cognira_report','story_slot','story_single'].includes(kind) ? `${kind==='routine' ? 'agent_routine':kind}:${id}` : `melodi_calendar_events:${event.id}`;
  };
  if (names.has('melodi_google_calendar_schedule_overrides')) {
    const overrides=(await db.prepare('SELECT kind,source_id,status,payload_encrypted,payload_iv FROM melodi_google_calendar_schedule_overrides WHERE owner=?').bind(phone).all()).results;
    for (const row of overrides) {
      const key=`${row.kind}:${row.source_id}`, matches=events.filter(event=>sourceKey(event)===key);
      if (!matches.length) continue;
      if (row.status==='cancelled') { for (const event of matches) event.cancelled=true; continue; }
      if (typeof decrypt!=='function') throw new Error('agenda_decryption_unavailable');
      const value=await decrypt(row.payload_encrypted,row.payload_iv),payload=typeof value==='string' ? JSON.parse(value):value;
      if (typeof payload.title==='string' && !['agent_routine','melodi_calendar_events'].includes(row.kind)) for (const event of matches) event.title=payload.title;
    }
  }
  if (names.has('melodi_google_calendar_activity_map')) {
    const paused=(await db.prepare("SELECT kind,source_id FROM melodi_google_calendar_activity_map WHERE owner=? AND status='unsupported'").bind(phone).all()).results;
    for (const event of events) event.paused=paused.some(row=>sourceKey(event)===`${row.kind}:${row.source_id}`);
  }
  const pending=events.filter(event=>!event.cancelled).sort((a,b)=>a.event_at.localeCompare(b.event_at)||a.id.localeCompare(b.id));
  return { events:pending.slice(0,limit), hasMore:pending.length > limit || sourceLimited };
}

export function ownerAgendaAnswer(snapshot, { dateLabel = 'la fecha consultada' } = {}) {
  if (!snapshot.events.length) return `No hay actividades pendientes para ${dateLabel}.`;
  const lines = snapshot.events.map(event => `• ${localEventTime(event.event_at,DOMINICAN_TIME_ZONE)}: ${String(event.title).replace(/[\r\n\u0000]/g,' ').slice(0,240)}${event.paused ? ' (en pausa; requiere corregir su fecha en Calendar)' : ''}`);
  return `Esto está programado para ${dateLabel}, hora de República Dominicana:\n${lines.join('\n')}${snapshot.hasMore ? '\nHay más actividades para esa fecha; puedes verlas en «Vetsa · Equipo».' : ''}`;
}
