import { clockContext, explicitReminderTime, DOMINICAN_TIME_ZONE } from './event-time.js';
import { reminderHasTaskReference } from './owner-reminder-context.js';

const COMMAND = /^(?:(?:melodi)[,:]?\s+)?(?:por favor[,]?\s+)?(?:recu[eé]rdame|av[ií]same)\s+/i;
const PERIOD = '(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?|de la ma[ñn]ana|de la tarde|de la noche)';
const CLOCK = new RegExp(`\\b(?:a\\s+las?\\s+\\d{1,2}(?::\\d{2})?\\s*(?:${PERIOD})?|\\d{1,2}:\\d{2}\\s*(?:${PERIOD})?|\\d{1,2}\\s*${PERIOD})`, 'gi');
const DAY = /\b(?:pasado\s+ma[ñn]ana|ma[ñn]ana|hoy|(?:el\s+)?\d{4}-\d{2}-\d{2}|(?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\b/gi;
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const fold = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const trim = value => value.replace(/^[\s,:.]+|[\s,.!]+$/g, '').trim();

/** Cheap preflight only. The caller still authenticates the owner, resolves the
 * selected speaker, authorizes manage_calendar and persists through its usual
 * idempotent action ledger before sending a confirmation. */
export function isSimpleReminderCandidate(value) {
  return typeof value === 'string' && value.length <= 650 && COMMAND.test(value.trim());
}

/** A deliberately small fast path, not a replacement for semantic routing.
 * Unsupported wording returns null so email, recurring, quoted, contextual and
 * multi-action requests retain their existing interpreter and safety checks.
 * now must be the durable receipt's original instant, including on retries. */
export function parseSimpleReminderRequest(value, { now = Date.now(), timeZone = DOMINICAN_TIME_ZONE } = {}) {
  if (!isSimpleReminderCandidate(value) || !Number.isFinite(new Date(now).getTime())) return null;
  let body = value.trim().replace(COMMAND, '').replace(/\s+por favor[.!\s]*$/i, '').trim();
  const normalized = fold(body);
  if (/[\n\r;?¿<>={}"“”«»`]/.test(body)
    || /\b(?:cada|diario|diariamente|semanal|mensual|anual|todos|todas|repite|repetir|correo|email|e-mail|adjunt[oa]|adjuntar|foto|imagen|destinatario|enviarselo|mismo|misma|habitual|proximo|proxima)\b/.test(normalized)
    || /\b(?:y|ademas|tambien|pero|aunque|si|cuando|hasta|desde|entre|excepto)\b/.test(normalized)
    || reminderHasTaskReference(body)) return null;
  let eventAt;
  let title;
  const duration = [...body.matchAll(/\b(?:en|dentro de)\s+(\d{1,4})\s+(minutos?|horas?)\b/gi)];
  if (duration.length) {
    if (duration.length !== 1) return null;
    const match = duration[0];
    const before = trim(body.slice(0, match.index)), after = trim(body.slice(match.index + match[0].length));
    if (before && after) return null;
    title = before || after;
    // Durations are resolved from receipt time; the executor must not rebase
    // them on processing time after a Queue retry.
    const minutes = Number(match[1]) * (/^hora/i.test(match[2]) ? 60 : 1);
    if (minutes < 1 || minutes > 7 * 24 * 60) return null;
    eventAt = new Date(new Date(now).getTime() + minutes * 60000).toISOString();
  } else {
    const clocks = [...body.matchAll(CLOCK)];
    if (clocks.length !== 1) return null;
    const clock = clocks[0];
    // A daypart inside the clock ("de la mañana") is not a second date.
    const withoutClock = body.slice(0, clock.index) + ' '.repeat(clock[0].length) + body.slice(clock.index + clock[0].length);
    const days = [...withoutClock.matchAll(DAY)];
    if (days.length > 1) return null;
    const day = days[0];
    let start = Math.min(clock.index, day?.index ?? clock.index);
    const end = Math.max(clock.index + clock[0].length, day ? day.index + day[0].length : 0);
    let timing = body.slice(start, end);
    const internal = trim(timing.replace(CLOCK, '').replace(DAY, ''));
    if (internal && !/^(?:para|el)$/i.test(internal)) return null;
    // "para mañana" and "para las 7" belong to the timing, not the title.
    const lead = body.slice(0, start).match(/\bpara\s*$/i);
    if (lead) start = lead.index;
    const before = trim(body.slice(0, start)), after = trim(body.slice(end));
    if (before && after) return null;
    title = before || after;
    const weekday = day ? WEEKDAYS.indexOf(fold(day[0]).replace(/^el\s+/, '')) : -1;
    try {
      if (weekday >= 0) {
        const today = clockContext(now, timeZone).today_local;
        let offset = (weekday - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7;
        for (let attempt = 0; attempt < (offset === 0 ? 2 : 1); attempt++) {
          const date = new Date(Date.parse(`${today}T12:00:00Z`) + (offset + attempt * 7) * 86400000).toISOString().slice(0, 10);
          const time = /^a\s+las?\s/i.test(clock[0]) ? clock[0] : `a las ${clock[0]}`;
          eventAt = explicitReminderTime(`${date} ${time}`, now, timeZone)?.eventAt;
          if (eventAt) break;
        }
      } else {
        // Bare 24-hour clocks are accepted by this grammar and passed to the
        // shared time validator with an explicit clock introducer.
        timing = `${day?.[0] || ''} ${/^a\s+las?\s/i.test(clock[0]) ? clock[0] : `a las ${clock[0]}`}`;
        eventAt = explicitReminderTime(timing, now, timeZone)?.eventAt;
      }
    } catch { return null; }
  }
  if (!title || title.length > 240 || !/[\p{L}]/u.test(title) || !eventAt || Date.parse(eventAt) <= new Date(now).getTime()
    || /^(?:(?:algo|alguna cosa|cualquier cosa|cosa|cosas|tarea|tareas|evento|eventos|pendiente|pendientes|otro|otra|un|una|el|la)\s*)+$/.test(fold(title))) return null;
  // A remaining temporal phrase, pronoun or operation continuation belongs to
  // semantic routing; never silently discard an unparsed part of the message.
  if (reminderHasTaskReference(title) || /\d{1,2}:\d{2}|\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|horas?|minutos?|segundos?|semanas?|meses?|anos?|temprano|mediodia|medianoche|madrugada|tarde|noche)\b/.test(fold(title))) return null;
  return { intent: 'create_reminder', title, eventAt, clarification: '', source: 'current_message' };
}
