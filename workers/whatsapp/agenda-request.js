import { clockContext, localDateTimeToUtc, DOMINICAN_TIME_ZONE } from './event-time.js';
import { stripAgentAddress } from './melodi-address.js';
import { agendaDayMoves } from './agenda-scheduling.js';
import { agendaPlanFailure } from './agenda-plan-reply.js';

const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const dayAfter = (day, offset = 1) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const clean = value => typeof value === 'string' && value.trim() && value.length <= 240 && !/[\u0000-\u001f<>{}`]/.test(value);
const CLOCK = /\b(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)?\b/g;
const WORK_HOURS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
const DISTRIBUTION = /\bdias?\s+(?:distintos|separados|diferentes)\b|\bun[oa]?\s+(?:por|cada)\s+dia\b/;

function sameRoutineTitle(left, right) {
  // Reuse only a literal title at the exact same instant. "Ir al boxeo" and
  // "Boxeo" differ only by this optional leading phrase; names and all other
  // action words stay intact so an unrelated routine cannot swallow a task.
  const key = value => fold(value).replace(/^ir\s+al\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(key(left)) && key(left) === key(right);
}

function clockMarkers(text) {
  return [...fold(text).matchAll(CLOCK)].filter(match => match[2] || match[3] || /^a\s+las?/.test(match[0]));
}

function distributionTitles(text) {
  const t = fold(text), marker = t.match(DISTRIBUTION);
  if (!marker) return null;
  let list = text.slice(marker.index + marker[0].length);
  const colon = list.indexOf(':');
  if (colon >= 0 && colon < 70) list = list.slice(colon + 1);
  list = list.split(/\.(?:\s|$)|\n|\b(?:[Dd]esplaza|[Mm]ueve|[Tt]raslada|[Rr]eprograma|[Aa]genda)\b/)[0];
  list = list.replace(/^\s*(?:para\s+trabajar\s+en\s+ello\s*)?/iu, '').trim();
  if (!list) return null;
  const pieces = list.split(/[,;]|\s+y\s+(?=(?:[Tt]erminar|[Mm]ejorar|[Rr]evisar|[Tt]rabajar|[Aa]ctualizar|[Cc]ontinuar|[Ii]mplementar|[Dd]iseñar|[Cc]rear|[Pp]robar)\b)/u)
    .map(value => value.trim()).filter(Boolean);
  return pieces.length > 1 && pieces.every(clean) ? pieces : null;
}

function actionText(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 6500 || /[\u0000-\u0008\u000b-\u001f]/.test(raw)) return '';
  const text = stripAgentAddress(raw, { includeStacy: true }).trim();
  const t = fold(text);
  // Scheduling text supplied as an example, quote, draft or hypothetical is
  // never an authenticated instruction to change today's actual calendar.
  if (/["“”«»`]|^\s*>/m.test(text)
    || /\b(?:ejemplo|hipotetic\w*|supongamos|imagina(?:te)?|simula\w*|literalmente|(?:me|te) (?:dijo|dijeron)|texto dice|mensaje dice|que significa|como responderias|como harias)\b/.test(t)
    || /\b(?:si|cuando)\s+(?:yo\s+)?(?:te\s+)?(?:digo|dijera|pidiera|pido|envio|enviara)\b/.test(t)
    || /\b(?:no|nunca|tampoco|jamas)\s+(?:(?:quiero|necesito)\s+que\s+)?(?:(?:me|lo|la|los|las)\s+)?(?:agend\w*|program\w*|muev\w*|despla\w*|cambi\w*|hag\w*|ejecut\w*|apli\w*)\b/.test(t)
    || /\b(?:solo|solamente)\s+(?:explica\w*|quiero saber|una prueba|un ejemplo)\b/.test(t)) return '';
  return text;
}

/** Cheap routing boundary. This does not execute work or classify completion. */
export function detectAgendaRequest(raw) {
  const text = actionText(raw), t = fold(text);
  if (!text || !/\b(?:agenda(?:lo|los|las|me)?|organiz\w*|reorganiz\w*|program\w*|repart\w*|distribu\w*|pon(?:lo|los|las)?|desplaza|mueve|pasa)\b/.test(t)) return false;
  const distribution = /\b(?:dias?\s+(?:distintos|separados|diferentes)|un[oa]?\s+(?:por|cada)\s+dia)\b/.test(t);
  const move = /\b(?:desplaza\w*|mueve|mover|pasa\w*|traslada\w*|reprogram\w*)\b/.test(t) && /\bhoy\b/.test(t) && /\bmanana\b/.test(t);
  const clocks = clockMarkers(text).length;
  return distribution || (move && (clocks > 0 || /\b(?:agenda|calendario|suave|libre|descans\w*)\b/.test(t))) || clocks >= 2;
}

function dateFrom(marker, today) {
  if (marker === 'today') return today;
  if (marker === 'tomorrow') return dayAfter(today);
  if (marker === 'day_after_tomorrow') return dayAfter(today, 2);
  return typeof marker === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(marker) ? marker : null;
}

function anchoredTitle(title, source) {
  if (!clean(title) || !clean(source)) return false;
  const tokens = fold(source).match(/[\p{L}\p{N}]+/gu) || [];
  const ignored = new Set(['a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'en', 'mi', 'un', 'una', 'para']);
  const meaningful = (fold(title).match(/[\p{L}\p{N}]+/gu) || []).filter(word => !ignored.has(word));
  return meaningful.length > 0 && meaningful.every(word => tokens.includes(word));
}

function sourceClock(source, time, assumed) {
  const [hour, minute] = time.split(':').map(Number);
  return [...fold(source).matchAll(CLOCK)].some(match => {
    const h = Number(match[1]), m = Number(match[2] || 0), period = match[3];
    if (m !== minute || h > (period ? 12 : 23) || (period && h < 1)) return false;
    if (period) return !assumed && h % 12 + (/^(?:p|de la tarde|de la noche)/.test(period) ? 12 : 0) === hour;
    return h >= 1 && h <= 12 ? (assumed && [h % 12, h % 12 + 12].includes(hour)) : (!assumed && h === hour);
  });
}

export const AGENDA_REQUEST_SCHEMA = Object.freeze({
  intent: 'compound_agenda',
  distribute: [{ title: 'Título literal de una actividad a trabajar, nunca una ejecución', source: 'Fragmento exacto del mensaje' }],
  moveDay: { from: 'today', to: 'tomorrow', source: 'Fragmento exacto que autoriza trasladar la agenda' },
  fixed: [{ title: 'Actividad', day: 'today|tomorrow|day_after_tomorrow|YYYY-MM-DD', localTime: 'HH:MM', assumedPeriod: false, source: 'Fragmento exacto con actividad y hora' }],
  relaxToday: false,
  relaxSource: 'Fragmento exacto que pide aligerar hoy, o cadena vacía',
});

/** Validate extraction against the current, top-level owner request. Models may
 * identify actions; they cannot invent titles, times, dates or tool grants. */
export function validateAgendaRequest(candidate, raw, { now = Date.now(), timeZone = DOMINICAN_TIME_ZONE,semantic=false } = {}) {
  if ((!semantic && !detectAgendaRequest(raw)) || !only(candidate, ['intent', 'distribute', 'moveDay', 'fixed', 'relaxToday', 'relaxSource'])
    || candidate.intent !== 'compound_agenda' || !Array.isArray(candidate.distribute) || candidate.distribute.length > 12
    || !Array.isArray(candidate.fixed) || candidate.fixed.length > 12 || typeof candidate.relaxToday !== 'boolean') return null;
  let context;
  try { context = clockContext(now, timeZone); } catch { return null; }
  const text = semantic && typeof raw==='string' && raw.length<=12000 && !/[\u0000-\u0008\u000b-\u001f]/.test(raw)?raw:actionText(raw);
  const hasSource = source => clean(source) && text.includes(source.trim());
  const titles = [];
  for (const item of candidate.distribute) {
    if (!only(item, ['title', 'source']) || !hasSource(item.source) || !anchoredTitle(item.title, item.source)) return null;
    titles.push(item.title.trim());
  }
  if (new Set(titles.map(fold)).size !== titles.length) return null;
  const normalized = fold(text);
  if (!semantic && DISTRIBUTION.test(normalized) !== Boolean(titles.length)) return null;
  const explicitTitles = semantic?null:distributionTitles(text);
  if (explicitTitles && (explicitTitles.length !== titles.length || explicitTitles.some(title => !titles.some(candidateTitle => fold(candidateTitle) === fold(title))))) return null;
  let moveDay = null;
  if (candidate.moveDay !== null && candidate.moveDay !== undefined) {
    const move = candidate.moveDay;
    if (!only(move, ['from', 'to', 'source']) || !hasSource(move.source) || move.from !== 'today' || move.to !== 'tomorrow'
      || !semantic && (!/\b(?:desplaza\w*|mueve|mover|pasa\w*|traslada\w*|reprogram\w*)\b/.test(fold(move.source))
      || !/\bhoy\b/.test(fold(move.source)) || !/\bmanana\b/.test(fold(move.source)))) return null;
    moveDay = { from: move.from, to: move.to };
  }
  const moveRequested = /\b(?:desplaza\w*|mueve|mover|pasa\w*|traslada\w*|reprogram\w*)\b[^.!?\n]*\bhoy\b[^.!?\n]*\bmanana\b/.test(normalized);
  if (!semantic && moveRequested !== Boolean(moveDay)) return null;
  if (candidate.relaxToday && (!hasSource(candidate.relaxSource)
    || !semantic && (!/\b(?:hoy|dia)\b/.test(fold(candidate.relaxSource))
    || !/\b(?:suave|libre|descans\w*|liger\w*|tranquil\w*|menos\s+cargad\w*)\b/.test(fold(candidate.relaxSource))))) return null;
  if (!semantic && /\b(?:hoy|dia)\b[^.!?\n]*\b(?:suave|libre|liger\w*|tranquil\w*|menos\s+cargad\w*)\b/.test(normalized) && !candidate.relaxToday) return null;
  const fixed = [];
  const requestedClocks = clockMarkers(text), matchedClocks = new Set();
  for (const item of candidate.fixed) {
    if (!only(item, ['title', 'day', 'localTime', 'assumedPeriod', 'source']) || !hasSource(item.source) || !anchoredTitle(item.title, item.source)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.localTime) || typeof item.assumedPeriod !== 'boolean'
      || !sourceClock(item.source, item.localTime, item.assumedPeriod)) return null;
    const sourceStart = text.indexOf(item.source.trim()), sourceEnd = sourceStart + item.source.trim().length;
    const markers = requestedClocks.filter(marker => marker.index >= sourceStart && marker.index < sourceEnd);
    if (markers.length !== 1 || matchedClocks.has(markers[0].index)) return null;
    matchedClocks.add(markers[0].index);
    const localDay = dateFrom(item.day, context.today_local);
    if (!localDay || localDay < context.today_local || localDay > dayAfter(context.today_local, 366)
      || !localDateTimeToUtc(`${localDay}T${item.localTime}`, timeZone)) return null;
    // Today can be the unstated day of the current day's plan. Future days
    // require an explicit source marker, not the model's preferred schedule.
    if (!semantic && item.day === 'tomorrow' && !/\bmanana\b/.test(fold(item.source))) return null;
    if (!semantic && item.day === 'day_after_tomorrow' && !/\bpasado manana\b/.test(fold(item.source))) return null;
    if (!semantic && /^\d/.test(item.day) && !item.source.includes(item.day)) return null;
    fixed.push({ title: item.title.trim(), day: item.day, localTime: item.localTime, assumedPeriod: item.assumedPeriod });
  }
  if (requestedClocks.length !== fixed.length || matchedClocks.size !== requestedClocks.length) return null;
  if (!titles.length && !moveDay && fixed.length < 2) return null;
  return { kind: 'compound_agenda', source: 'current_message', referenceAt: context.now_utc, timeZone,
    actions: { distribute: titles, moveDay, fixed }, relaxToday: candidate.relaxToday, assumptions: [], clarification: '' };
}

/** Zero-model support for the complete, explicitly ordered owner example.
 * The anchored grammar refuses extra clauses rather than dropping actions. */
export function parseAgendaRequest(raw, options = {}) {
  if (!detectAgendaRequest(raw)) return null;
  const text = actionText(raw);
  const pattern = /^agenda lo siguiente,?\s*ponlo en d[ií]as separados para trabajar en ello:\s*(.+?)\.\s*(Desplaza lo que tengo para hoy a ma[ñn]ana),?\s*(quiero tener el d[ií]a un poco m[aá]s suave),?\s*(ir[eé] al boxeo a las 9),?\s*(a las 11 ir[eé] a trabajar al apartamento de Alfredo),?\s*(recu[eé]rdame a las 2:40\s*p\.?\s*m\.?\s*buscar a mi hermana a la escuela)\s+y\s*(que tengo que volver a las 3:40\s*p\.?\s*m\.?\s*al trabajo)\s*\.?$/iu;
  const match = text.match(pattern);
  if (!match) return null;
  const titles = match[1].split(',').map(title => title.trim());
  if (titles.length !== 3 || titles.some(title => !clean(title))) return null;
  return validateAgendaRequest({ intent: 'compound_agenda', distribute: titles.map(title => ({ title, source: title })),
    moveDay: { from: 'today', to: 'tomorrow', source: match[2] }, relaxToday: true, relaxSource: match[3],
    fixed: [
      { title: 'Boxeo', day: 'today', localTime: '09:00', assumedPeriod: true, source: match[4] },
      { title: 'Trabajar en apartamento de Alfredo', day: 'today', localTime: '11:00', assumedPeriod: true, source: match[5] },
      { title: 'Buscar a mi hermana a la escuela', day: 'today', localTime: '14:40', assumedPeriod: false, source: match[6] },
      { title: 'Volver al trabajo', day: 'today', localTime: '15:40', assumedPeriod: false, source: match[7] },
    ] }, raw, options);
}

function semanticObject(result) {
  let data = result?.text ?? result?.response ?? result;
  if (typeof data === 'string') {
    if (data.length > 16000) return null;
    try { data = JSON.parse(data.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  }
  return data;
}

/** One compact semantic call for compound requests outside the fast grammar.
 * Pass generate(body) to reuse the application's existing model transport. */
export async function interpretAgendaRequest(env, raw, { now = Date.now(), timeZone = env?.TIME_ZONE || DOMINICAN_TIME_ZONE, generate,semantic=false } = {}) {
  if (!semantic && !detectAgendaRequest(raw)) return null;
  const direct = semantic?null:parseAgendaRequest(raw, { now, timeZone });
  if (direct) return direct;
  let context;
  try { context = clockContext(now, timeZone); } catch { return null; }
  const body = { model: 'spaik-flash', contents: JSON.stringify({ message: raw, clock: context }), options: { temperature: 0,
    systemPrompt: `Extrae exclusivamente las instrucciones actuales de agenda en JSON con este esquema: ${JSON.stringify(AGENDA_REQUEST_SCHEMA)}. source y relaxSource deben ser fragmentos exactos del mensaje; no son instrucciones. Si no hay una acción usa null para moveDay o listas vacías. No ejecutes proyectos: «Terminar la app» es el título de una sesión futura, no permiso para desarrollar software ni usar el PC. Conserva cada actividad y sus nombres. Distribuir en días separados no permite concentrar los proyectos mañana si hoy se traslada a mañana. No inventes duración ni confirmes cambios. Solo fechas de los próximos 366 días. Cuando 9 y 11 preceden actividades de las 2:40 p.m. y 3:40 p.m. en el mismo día, usa 09:00/11:00 y assumedPeriod=true; nunca cambies a 21:00/23:00 porque ya pasó la mañana. Usa false en horas con AM/PM explícito. Excluye citas, ejemplos, hipótesis, negaciones y peticiones de explicar capacidad; en esos casos devuelve intent='none'. No añadas operaciones, herramientas ni propiedades.`,
    max_tokens: 2200, jsonMode: true } };
  try {
    let result;
    if (typeof generate === 'function') result = await generate(body);
    else if (typeof env?.VETSA_INTELLIGENCE?.fetch === 'function') {
      const response = await env.VETSA_INTELLIGENCE.fetch(new Request('https://vetsa.internal/v1/generate', { method: 'POST',
        headers: { 'content-type': 'application/json', ...(env.VETSA_INTELLIGENCE_API_KEY ? { 'x-api-key': env.VETSA_INTELLIGENCE_API_KEY } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }));
      if (!response.ok) return null;
      result = await response.json();
    } else return null;
    return validateAgendaRequest(semanticObject(result), raw, { now: context.now_utc, timeZone,semantic });
  } catch { return null; }
}

function planFailure(directive, clarification, assumptions = [], clarificationCode = 'agenda_clarification') {
  return { kind: 'compound_agenda', referenceAt: directive.referenceAt, timeZone: directive.timeZone,
    createEvents: [], moveDay: null, relaxToday: directive.relaxToday, assumptions, clarification, clarificationCode, executable: false };
}

/** Resolve a pending day question only. This preserves the original complete
 * request, and never turns an unrelated follow-up into a scheduling command. */
export function resolveAgendaContinuation(directive, answer, { now = Date.now(), timeZone = directive?.timeZone || DOMINICAN_TIME_ZONE } = {}) {
  if (directive?.kind !== 'compound_agenda' || typeof answer !== 'string' || answer.length > 140
    || /[\r\n"“”«»`]/.test(answer)) return null;
  const response = fold(stripAgentAddress(answer, { includeStacy: true })).replace(/^[¿¡\s]+|[.!?\s]+$/g, '');
  const confirmedDay = response.match(/^(?:si[, ]+)?(?:(?:pon(?:lo|los|las)|deja(?:lo|los|las)|pas(?:alo|alos|alas))\s+)?(?:para\s+)?(manana|\d{4}-\d{2}-\d{2})(?:[, ]+por favor)?$/);
  if (!confirmedDay) return /^(?:si|vale|ok|de acuerdo|claro)$/.test(response)
    ? { clarification: '¿Para qué día dejamos las actividades que ya pasaron?', clarificationCode: 'past_fixed', executable: false } : null;
  let context;
  try { context = clockContext(now, timeZone); } catch { return null; }
  const day = confirmedDay[1] === 'manana' ? dayAfter(context.today_local) : confirmedDay[1];
  if (!localDateTimeToUtc(`${day}T00:00`, timeZone) || day < context.today_local || day > dayAfter(context.today_local, 366)) {
    return { clarification: 'Dime una fecha futura válida para esas actividades.', clarificationCode: 'past_fixed', executable: false };
  }
  return { ...directive, effectiveAt: context.now_utc,
    actions: { ...directive.actions, fixed: directive.actions.fixed.map(item => item.day === 'today' ? { ...item, day } : { ...item }) } };
}

/** Pure planner. Uses the original receipt clock even on delayed processing;
 * no writes, no secondary calendars, no durations or completion claims. */
export function buildAgendaPlan(directive, { snapshot = [], now = directive?.referenceAt || Date.now(), timeZone = directive?.timeZone || DOMINICAN_TIME_ZONE } = {}) {
  if (directive?.kind !== 'compound_agenda' || !object(directive.actions) || !Array.isArray(directive.actions.distribute)
    || !Array.isArray(directive.actions.fixed)) return null;
  let context;
  try { context = clockContext(directive.referenceAt || now, timeZone); } catch { return null; }
  const today = context.today_local, tomorrow = dayAfter(today), assumptions = [];
  // "Aligera hoy, pero hoy voy a boxeo/trabajo..." already states which
  // routines stay. Operational routines such as a daily phrase need no move.
  const preserveRoutines = directive.relaxToday && directive.actions.fixed.length > 0;
  const moveDay = directive.actions.moveDay ? { fromDate: today, toDate: tomorrow,
    ...(directive.actions.moveDay.onlyCalendarEvents === true || preserveRoutines ? { onlyCalendarEvents: true } : {}),
    ...(preserveRoutines ? { resolveWorkConflicts: true } : {}) } : null;
  const rows = Array.isArray(snapshot) ? snapshot : Array.isArray(snapshot?.events) ? snapshot.events : null;
  if (!rows || rows.length > 2000) return planFailure(directive, 'No pude comprobar la agenda completa. Necesito consultarla antes de reorganizarla.');
  const windowEnd = !Array.isArray(snapshot) && typeof snapshot?.end === 'string' && Number.isFinite(Date.parse(snapshot.end))
    ? Date.parse(snapshot.end) : Date.parse(localDateTimeToUtc(`${dayAfter(today, 14)}T00:00`, timeZone));
  const withinWindow = local => {
    const eventAt = localDateTimeToUtc(local, timeZone);
    return eventAt && Date.parse(eventAt) < windowEnd;
  };
  const occupied = new Set();
  const schedulingRows = rows.map(row => ({ ...row, eventAt: row.eventAt || row.event_at,
    kind: row.kind || 'melodi_calendar_events', movable: row.movable ?? !row.kind,
    eventType: row.eventType || 'REMINDER' }));
  const plannedFixed = directive.actions.fixed.map(item => ({ title: item.title,
    eventAt: localDateTimeToUtc(`${dateFrom(item.day, today)}T${item.localTime}`, timeZone) })).filter(item => item.eventAt);
  const changes = agendaDayMoves(schedulingRows, moveDay, { now: directive.effectiveAt || context.now_utc, timeZone, created: plannedFixed,explicitMoves:directive.eventMoves||[] });
  if (changes.conflicts.length) {
    const conflict = changes.conflicts[0];
    const failure = { status: 'conflict', reason: conflict.reason, eventAt: conflict.eventAt,
      events: [conflict.event, ...(conflict.conflicting || [])] };
    return { ...planFailure(directive, agendaPlanFailure(failure, { timeZone, now }), assumptions, 'time_conflict'), conflict: failure };
  }
  for (const row of rows) {
    const timestamp = row.eventAt || row.event_at;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return planFailure(directive, 'Hay una fecha de agenda que necesito revisar antes de reorganizarla.');
    const local = clockContext(timestamp, timeZone).now_local;
    const moved = changes.moved.find(item => item.id === row.id);
    occupied.add(moved ? clockContext(moved.eventAt,timeZone).now_local : local);
  }
  const createEvents = [], retainedFixed = [], fixed = directive.actions.fixed;
  const ambiguous = fixed.filter(item => item.assumedPeriod);
  if (ambiguous.length) {
    // An ordered day with explicit afternoon appointments anchors the bare
    // morning clocks. Without that context, ask once rather than guess AM/PM.
    const ordered = fixed.every((item, index) => !index || item.day !== fixed[index - 1].day || item.localTime > fixed[index - 1].localTime);
    const afternoonAnchor = ambiguous.every(item => Number(item.localTime.slice(0, 2)) < 12
      && fixed.some(anchor => anchor.day === item.day && !anchor.assumedPeriod && Number(anchor.localTime.slice(0, 2)) >= 12 && anchor.localTime > item.localTime));
    if (!ordered || !afternoonAnchor) return planFailure(directive, '¿Las horas sin a. m. o p. m. son por la mañana o por la tarde?');
    assumptions.push(`Tomé ${ambiguous.map(item => `${Number(item.localTime.slice(0, 2))}:${item.localTime.slice(3)}`).join(' y ')} como horas de la mañana por el orden de tu día.`);
  }
  for (const item of fixed) {
    const localDay = dateFrom(item.day, today), localDateTime = `${localDay}T${item.localTime}`;
    const eventAt = localDateTimeToUtc(localDateTime, timeZone);
    if (!eventAt || Date.parse(eventAt) <= Date.parse(directive.effectiveAt || context.now_utc)) return planFailure(directive,
      `La hora de «${item.title}» ya pasó hoy. ¿Dejamos esas actividades para mañana o prefieres otra fecha?`, assumptions, 'past_fixed');
    if (!withinWindow(localDateTime)) return planFailure(directive, 'Esa fecha queda fuera de la agenda que pude consultar. Necesito ampliar la consulta antes de reorganizarla.', assumptions);
    const matchingRoutine = rows.filter(row => row.kind === 'agent_routine' && Date.parse(row.eventAt || row.event_at) === Date.parse(eventAt)
      && sameRoutineTitle(row.title, item.title));
    if (matchingRoutine.length === 1) {
      const row = matchingRoutine[0];
      retainedFixed.push({ id: row.id, eventAt, title: item.title, kind: row.kind });
      occupied.add(localDateTime);
      continue;
    }
    if (occupied.has(localDateTime)) {
      const existing = rows.filter(row => {
        const moved = changes.moved.find(change => change.id === row.id);
        return Date.parse(moved?.eventAt || row.eventAt || row.event_at) === Date.parse(eventAt);
      });
      const conflict = { status: 'conflict', reason: 'time_conflict', eventAt, events: [{ title: item.title }, ...existing] };
      return { ...planFailure(directive, agendaPlanFailure(conflict, { timeZone, now }), assumptions, 'time_conflict'), conflict };
    }
    occupied.add(localDateTime);
    createEvents.push({ title: item.title, localDay, localTime: item.localTime, localDateTime, eventAt, kind: 'fixed' });
  }
  let projectDay = dayAfter(today, moveDay ? 2 : 1);
  for (const title of directive.actions.distribute) {
    if (!clean(title)) return null;
    let selected;
    for (let offset = 0; offset < 14; offset++) {
      const day = dayAfter(projectDay, offset);
      const hour = WORK_HOURS.find(value => withinWindow(`${day}T${value}`) && !occupied.has(`${day}T${value}`)
        && Date.parse(localDateTimeToUtc(`${day}T${value}`, timeZone)) > Date.parse(directive.effectiveAt || context.now_utc));
      if (hour) { selected = { day, hour }; break; }
    }
    if (!selected) return planFailure(directive, 'No encontré un espacio disponible para separar los proyectos. ¿Qué días prefieres?', assumptions);
    const localDateTime = `${selected.day}T${selected.hour}`, eventAt = localDateTimeToUtc(localDateTime, timeZone);
    if (!eventAt) return planFailure(directive, 'Necesito revisar la hora local antes de separar los proyectos.', assumptions);
    occupied.add(localDateTime);
    createEvents.push({ title, localDay: selected.day, localTime: selected.hour, localDateTime, eventAt, kind: 'project_work' });
    projectDay = dayAfter(selected.day);
  }
  if (directive.actions.distribute.length) assumptions.push('Dejé los proyectos en días distintos, a partir de las 9:00 a. m. según los espacios disponibles; son sesiones de trabajo, sin duración estimada.');
  return { kind: 'compound_agenda', referenceAt: context.now_utc, timeZone, createEvents, retainedFixed, moveDay, ...(directive.eventMoves?.length?{eventMoves:directive.eventMoves}:{}),adjustments: changes.adjustments,
    relaxToday: directive.relaxToday, assumptions, clarification: '', executable: true };
}
