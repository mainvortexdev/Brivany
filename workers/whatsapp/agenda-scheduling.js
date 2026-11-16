import { clockContext, localDateTimeToUtc } from './event-time.js';

const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Only a work task can receive a proposed start under a request to reorganize
 * the day. Appointments, transport, medication and named meetings keep time. */
export function flexibleAgendaTask(event) {
  return event?.kind === 'melodi_calendar_events' && event.eventType === 'REMINDER'
    && /^(?:implementar|terminar|mejorar|avanzar|desarrollar|configurar|investigar|revisar|preparar|organizar)\b/.test(fold(event.title))
    && !/\b(?:cita|reunion|medic\w*|consulta|vuelo|tren|recoger|buscar a|entrevista|examen|reserva|audiencia)\b/.test(fold(event.title));
}

/** Shared by the preview and atomic writer. Explicit appointments win over
 * flexible work; changes stay in the requested target day and are disclosed. */
export function agendaDayMoves(events, moveDay, { now = Date.now(), timeZone, created = [], explicitMoves = [] } = {}) {
  const explicit=[],explicitIds=new Set();
  for(const move of explicitMoves){
    const event=events.find(item=>item.id===move.id);
    if(!event||event.kind!=='melodi_calendar_events'||!event.movable||explicitIds.has(move.id)||stamp(event.eventAt)!==stamp(move.previousEventAt)
      ||!Number.isFinite(stamp(move.eventAt))||stamp(move.eventAt)<=stamp(now))return{moved:[],adjustments:[],conflicts:[{event:event||{},reason:'agenda_changed'}]};
    explicitIds.add(move.id);explicit.push({...event,previousEventAt:event.eventAt,eventAt:move.eventAt});
  }
  if (!moveDay) return { moved: explicit, conflicts: [], adjustments: [] };
  const source = events.filter(event => !explicitIds.has(event.id) && event.kind === 'melodi_calendar_events' && event.movable
    && stamp(event.eventAt) > stamp(now) && clockContext(event.eventAt, timeZone).today_local === moveDay.fromDate);
  const sourceIds = new Set(source.map(event => event.id));
  const retained = [...events.filter(event => !sourceIds.has(event.id)&&!explicitIds.has(event.id)), ...created,...explicit];
  const occupied = new Map();
  const reserve = event => {
    const list = occupied.get(event.eventAt) || [];
    occupied.set(event.eventAt, [...list, event]);
  };
  retained.forEach(reserve);
  const moved = [...explicit], conflicts = [], adjustments = [];
  const candidates = source.map(event => ({ ...event, previousEventAt: event.eventAt,
    eventAt: localDateTimeToUtc(`${moveDay.toDate}T${clockContext(event.eventAt, timeZone).now_local.slice(11, 16)}`, timeZone) }))
    .sort((a,b) => Number(flexibleAgendaTask(a)) - Number(flexibleAgendaTask(b)) || a.previousEventAt.localeCompare(b.previousEventAt));
  // Reserve all requested original times first. Filling a work slot must not
  // displace another task that already had its own free start.
  for (const event of candidates) if (event.eventAt && !occupied.has(event.eventAt)) { moved.push(event); reserve(event); }
  for (const event of candidates.filter(item => !moved.some(saved => saved.id === item.id))) {
    if (!event.eventAt || stamp(event.eventAt) <= stamp(now)) {
      conflicts.push({ event, reason: 'target_wall_time_unavailable' }); continue;
    }
    const conflicting = occupied.get(event.eventAt) || [];
    if (!moveDay.resolveWorkConflicts || !flexibleAgendaTask(event)) {
      conflicts.push({ event, conflicting, eventAt: event.eventAt, reason: 'time_conflict' }); continue;
    }
    const preferred = clockContext(event.eventAt, timeZone).now_local.slice(11, 16);
    const preferredMinutes = Number(preferred.slice(0, 2)) * 60 + Number(preferred.slice(3));
    const slots = [];
    for (let minute = 9 * 60; minute <= 18 * 60; minute += 30) slots.push(minute);
    slots.sort((a, b) => Math.abs(a - preferredMinutes) - Math.abs(b - preferredMinutes) || b - a);
    let selected;
    for (const minute of slots) {
      const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const at = localDateTimeToUtc(`${moveDay.toDate}T${clock}`, timeZone);
      if (at && stamp(at) > stamp(now) && !occupied.has(at)) { selected = at; break; }
    }
    if (!selected) { conflicts.push({ event, conflicting, eventAt: event.eventAt, reason: 'time_conflict' }); continue; }
    const adjusted = { ...event, eventAt: selected };
    moved.push(adjusted); reserve(adjusted);
    adjustments.push({ id: event.id, title: event.title, from: event.eventAt, to: selected,
      conflicting: conflicting.map(item => ({ id: item.id, title: item.title, eventAt: item.eventAt })) });
  }
  return { moved, conflicts, adjustments };
}
