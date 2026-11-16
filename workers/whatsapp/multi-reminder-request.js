import { clockContext, localDateTimeToUtc, DOMINICAN_TIME_ZONE } from './event-time.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DATE_PATTERN = /\b(?:pasado\s+manana|manana|hoy|(?:para\s+)?(?:el\s+)?(?:proximo\s+|este\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|(?:el\s+)?\d{4}-\d{2}-\d{2})\b/g;
const PERIOD = '(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?|de la manana|de la tarde|de la noche)';
const CLOCK_PATTERN = new RegExp(`\\b(?:a\\s+las?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(${PERIOD})?|(\\d{1,2}):(\\d{2})\\s*(${PERIOD})?|(\\d{1,2})\\s*(${PERIOD}))`, 'g');
const DIRECT_REQUEST = /\b(?:anota(?:lo|los|las|me)?|anade(?:lo|los|las|me)?|apunta(?:lo|los|las|me)?|agenda(?:lo|los|las|me)?|agendar|anotar|apuntar|recuerdame|programa(?:lo|los|las|me)?|guarda(?:lo|los|las|me)?)\b/;
const EXTERNAL_ACTION = /\b(?:envia|enviar|manda|mandar|publica|publicar|comparte|compartir|elimina|eliminar|borra|borrar|cancela|cancelar|cambia|cambiar|mueve|mover|edita|editar|modifica|modificar)\b/;

function fold(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function nextDay(day, offset) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

function dateFor(marker, today) {
  const value = marker.replace(/^(?:para\s+)?(?:el\s+)?/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { day: value, basis: 'explicit_date' };
  if (value === 'hoy') return { day: today, basis: 'same_day' };
  if (value === 'manana' || value === 'pasado manana') return { day: nextDay(today, value === 'manana' ? 1 : 2), basis: 'relative_day' };
  const weekday = WEEKDAYS.findIndex(day => value.endsWith(day));
  if (weekday < 0) return null;
  const currentWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  let offset = (weekday - currentWeekday + 7) % 7;
  if (value.startsWith('proximo ') && offset === 0) offset = 7;
  return { day: nextDay(today, offset), basis: 'weekday', sameWeekday: offset === 0, thisWeek: value.startsWith('este ') };
}

function clocksIn(segment) {
  return [...fold(segment).matchAll(CLOCK_PATTERN)].map(match => ({
    start: match.index, length: match[0].length,
    hour: Number(match[1] || match[4] || match[7]),
    minute: Number(match[2] || match[5] || 0),
    period: match[3] || match[6] || match[8] || '',
  }));
}

function eventTime(date, clock, now, timeZone) {
  if (clock.minute > 59 || clock.hour > (clock.period ? 12 : 23) || (clock.period && clock.hour < 1)) return null;
  const hours = clock.period
    ? [clock.hour % 12 + (/^(?:p|de la tarde|de la noche)/.test(clock.period) ? 12 : 0)]
    : clock.hour >= 1 && clock.hour <= 12 ? [clock.hour % 12, clock.hour % 12 + 12] : [clock.hour];
  const days = date.sameWeekday && !date.thisWeek ? [date.day, nextDay(date.day, 7)] : [date.day];
  for (const day of days) {
    for (const hour of hours) {
      const localDateTime = `${day}T${String(hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
      const eventAt = localDateTimeToUtc(localDateTime, timeZone);
      if (eventAt && Date.parse(eventAt) > new Date(now).getTime()) return { eventAt, localDateTime };
    }
  }
  return null;
}

function titleFrom(segment, clock) {
  let title = clock ? `${segment.slice(0, clock.start)} ${segment.slice(clock.start + clock.length)}` : segment;
  title = title.replace(/\b(?:an[oó]ta(?:lo|los|las|me)?|a[ñn]ade(?:lo|los|las|me)?|ap[uú]nta(?:lo|los|las|me)?|agenda(?:lo|los|las|me)?|rec[uú]erdame|programa(?:lo|los|las|me)?|gu[aá]rda(?:lo|los|las|me)?)\s*(?:(?:ambos|ambas|todo|los dos|las dos)\s*)?(?:(?:en|a)\s+(?:mi|la)\s+(?:agenda|calendario))?/gi, ' ');
  title = title.replace(/\bpor favor\b/gi, ' ').replace(/[,.!;:?¿¡]+/g, ' ').replace(/\s+/g, ' ').trim();
  title = title.replace(/^(?:(?:y|adem[aá]s|tambi[eé]n)(?:\s+|$))+/i, '').replace(/(?:^|\s+)y$/i, '');
  title = title.replace(/^(?:yo\s+)?(?:tengo|tendr[eé]|hay|tendr[aá]|ser[aá])(?:\s+|$)/i, '');
  title = title.replace(/^(?:un|una)(?:\s+|$)/i, '').trim();
  return title;
}

/**
 * Parse only a bounded, explicit list of appointments in this message. It never
 * reads conversation history or invents an activity. Unsupported syntax returns
 * null so the semantic router can handle it; incomplete supported lists produce
 * one precise clarification and no executable events.
 */
export function parseMultiReminderRequest(input, { now = new Date(), timeZone = DOMINICAN_TIME_ZONE } = {}) {
  if (typeof input !== 'string' || !input.trim() || input.length > 3000 || /[\r\n\u0000-\u001f'‘’"“”«»`]/.test(input)) return null;
  const text = input.normalize('NFC').trim();
  const normalized = fold(text);
  if (!DIRECT_REQUEST.test(normalized) || EXTERNAL_ACTION.test(normalized)) return null;
  if (/\b(?:no|nunca|jamas|tampoco|sin|si|ejemplo|imagina|supongamos|hipoteticamente|literalmente)\b|\b(?:me dijo|ha dicho|mensaje dice|texto dice|dice que|que significa)\b/.test(normalized)) return null;
  // Repetitions, durations and alternatives have a separate, semantic contract.
  if (/\b(?:cada|todos los|todas las|diariamente|semanalmente|mensualmente|durante|hasta|entre|o bien)\b/.test(normalized)) return null;
  const dates = [...normalized.matchAll(DATE_PATTERN)].filter(match => !/\b(?:de|por) la\s+$/.test(normalized.slice(Math.max(0, match.index - 12), match.index)));
  if (!dates.length || dates.length > 5) return null;
  // A sentence before the first date may contain a different appointment title;
  // do not silently discard it while deriving a title from the later segment.
  const prefix = text.slice(0, dates[0].index).replace(/^(?:(?:melodi)[,:]?\s*)?/i, '')
    .replace(/^(?:por favor\s+)?(?:puedes\s+)?(?:an[oó]ta(?:lo|los|las|me)?|a[ñn]ade(?:lo|los|las|me)?|ap[uú]nta(?:lo|los|las|me)?|agenda(?:lo|los|las|me)?|rec[uú]erdame|programa(?:lo|los|las|me)?|gu[aá]rda(?:lo|los|las|me)?)\s*(?:(?:en|a)\s+(?:mi|la)\s+(?:agenda|calendario))?\s*[:;,]?\s*/i, '').trim();
  if (prefix && !/^(?:en mi agenda|en el calendario)$/i.test(prefix)) return null;
  if (dates.length === 1) {
    // A second clock plus a new appointment is not a time range or permission
    // to silently reuse tomorrow for an otherwise undated second appointment.
    if (clocksIn(text).length === 2 && /\b(?:y|tambien|ademas)\s+(?:(?:tengo|tendre|hay)\s+)?(?:otro|otra|uno mas|una mas)\b/.test(normalized)) {
      return { events: [], clarification: '¿Para qué día quieres agendar la segunda actividad?' };
    }
    return null;
  }
  let today;
  try { today = clockContext(now, timeZone).today_local; } catch { return null; }
  const events = [];
  let previousTitle = '';
  for (let index = 0; index < dates.length; index += 1) {
    const marker = dates[index];
    const segment = text.slice(marker.index + marker[0].length, dates[index + 1]?.index ?? text.length);
    const clocks = clocksIn(segment);
    if (clocks.length > 1) return null;
    if (!clocks.length && /\ba las?\b|\b\d{1,2}:|\b(?:madrugada|temprano|mediodia|medianoche|tarde|noche)\b|\b(?:de|por) la manana\b|\b(?:esa|misma|habitual) hora\b/.test(fold(segment))) {
      return { events: [], clarification: `¿A qué hora es la actividad de ${text.slice(marker.index, marker.index + marker[0].length)}?` };
    }
    let title = titleFrom(segment, clocks[0]);
    if (/^(?:otro|otra|uno mas|una mas|el mismo|la misma)$/i.test(fold(title))) title = previousTitle;
    else title = title.replace(/^(?:otro|otra)\s+/i, '');
    if (!title || /\b(?:eso|esto|aquello|lo anterior|lo mismo|de antes|pendiente)\b/.test(fold(title))
      || /^(?:algo|alguna cosa|cualquier cosa|cosa|cosas|tal cosa|lo otro)\b/.test(fold(title))
      || /^(?:(?:en|a|mi|la|el|agenda|calendario|tengo|un|una|para|por|favor|y)\s*)+$/.test(fold(title))) {
      return { events: [], clarification: `¿Qué actividad quieres agendar para ${text.slice(marker.index, marker.index + marker[0].length)}?` };
    }
    if (title.length > 240 || /[<>={}]|\b(?:ignora|instrucciones|system|assistant|developer)\b/i.test(title)) return null;
    const date = dateFor(marker[0], today);
    const when = date && eventTime(date, clocks[0] || { hour: 9, minute: 0, period: 'a.m.' }, now, timeZone);
    if (!when) return { events: [], clarification: `No pude validar la fecha y hora de «${title}». ¿Para qué día y hora quieres agendarla?` };
    events.push({ title, ...when, ...(!clocks.length ? { assumedHour: '09:00' } : {}), dateBasis: date.basis, source: 'current_message', sourceIndex: index });
    previousTitle = title;
  }
  return { events, clarification: '' };
}
