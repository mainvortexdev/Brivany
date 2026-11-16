// Convert an AI-interpreted local wall time to UTC. Intent and date recognition
// happen in the AI; this module only validates and converts the resulting data.
export const DOMINICAN_TIME_ZONE = 'America/Santo_Domingo';

function partsInZone(date, timeZone = DOMINICAN_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function clockContext(now = new Date(), timeZone = DOMINICAN_TIME_ZONE) {
  const date = new Date(now);
  const p = partsInZone(date, timeZone);
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  const offset = Math.round((Date.parse(`${local}:00Z`) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  const suffix = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return { now: `${local}${suffix}`,
    now_local: local, now_utc: date.toISOString(), time_zone: timeZone,
    today_local: local.slice(0, 10) };
}

// Resolve clock values after semantic intent routing; omitted AM/PM uses the
// next future occurrence. Explicit dates and dayparts take priority.
// Other natural language dates remain the responsibility of the interpreter.
export function explicitReminderTime(text, now = new Date(), timeZone = DOMINICAN_TIME_ZONE) {
  const t = String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|semanas?|meses?|anos?)\b|\b(?:en|dentro de)\s+(?:\d+|un|una)|\b(?:diario|diariamente|cada dia|todos los dias)\b/.test(t)) return undefined;
  const matches = [...t.matchAll(/\b(?:a las?\s+)(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)?|\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)/g)];
  if (matches.length !== 1) return undefined;
  const m = matches[0];
  let hour = Number(m[1] || m[4]);
  const minute = Number(m[2] || m[5] || 0);
  const period = m[3] || m[6];
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) return { eventAt: null };
  if (period) hour = hour % 12 + (/^(p|de la tarde|de la noche)/.test(period) ? 12 : 0);
  const today = clockContext(now, timeZone).today_local;
  let day = today;
  const isoDay = t.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const thisMonth = t.match(/\b(?:el|dia)\s+(\d{1,2})\s+(?:de|del)\s+(?:este|el presente|el actual)\s+mes\b/);
  if (isoDay) day = isoDay;
  else if (thisMonth) day = `${today.slice(0, 7)}-${thisMonth[1].padStart(2, '0')}`;
  else if (/\bmanana\b/.test(t.replace(/(?:de|por) la manana/g, ''))) {
    const offset = /pasado manana/.test(t) ? 2 : 1;
    day = new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  } else if (/\b(?:el|para el|dia)\s+\d|\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.test(t)) return undefined;
  if (!localDateTimeToUtc(`${day}T00:00`, timeZone)) return { eventAt: null };
  if (!period && hour >= 1 && hour <= 12) {
    const explicitDay = isoDay || thisMonth || /\bhoy\b|\besta (?:noche|tarde|manana)\b|\bmanana\b/.test(t.replace(/(?:de|por) la manana/g, ''));
    const candidates = [hour % 12, hour % 12 + 12];
    // "esta noche" is an explicit daypart, even without a p.m. suffix.
    const hours = /\besta (?:noche|tarde)\b/.test(t) ? candidates.slice(1) : candidates;
    for (const dayOffset of explicitDay ? [0] : [0, 1]) {
      const candidateDay = new Date(Date.parse(`${day}T12:00:00Z`) + dayOffset * 86400000).toISOString().slice(0, 10);
      for (const h of hours) {
        const candidate = localDateTimeToUtc(`${candidateDay}T${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timeZone);
        if (candidate && Date.parse(candidate) > new Date(now).getTime()) return { eventAt: candidate };
      }
    }
    return { eventAt: null };
  }
  const local = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const eventAt = localDateTimeToUtc(local, timeZone);
  return { eventAt: eventAt && Date.parse(eventAt) > new Date(now).getTime() ? eventAt : null };
}

// An explicit calendar day without a clock uses the existing morning policy.
// This does not turn an unspecified date, a daypart or a duration into 09:00.
export function dateOnlyReminderTime(text, interpretedLocalDateTime, now = new Date(), timeZone = DOMINICAN_TIME_ZONE) {
  const t = String(text || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const dayText = t.replace(/(?:de|por) la manana/g, '');
  if (/\ba las?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b|\b(?:mediodia|medianoche|madrugada|temprano|tarde|noche)\b|\b(?:de|por) la manana\b|\b(?:esa|misma|habitual) hora\b/.test(t)) return undefined;
  if (/\b(?:en|dentro de)\s+(?:\d+|un|una)\s+(?:segundos?|minutos?|horas?|dias?|semanas?)\b/.test(t)) return undefined;
  const today = clockContext(now, timeZone).today_local;
  let day;
  const isoDay = dayText.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const thisMonth = dayText.match(/\b(?:el|dia)\s+(\d{1,2})\s+(?:de|del)\s+(?:este|el presente|el actual)\s+mes\b/);
  if (isoDay) day = isoDay;
  else if (thisMonth) day = `${today.slice(0, 7)}-${thisMonth[1].padStart(2, '0')}`;
  else if (/\bmanana\b/.test(dayText)) day = new Date(Date.parse(`${today}T12:00:00Z`) + (/\bpasado manana\b/.test(dayText) ? 2 : 1) * 86400000).toISOString().slice(0, 10);
  else if (/\bhoy\b/.test(dayText)) day = today;
  else if (/\b(?:el|dia)\s+\d{1,2}\b|\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.test(dayText)) {
    // Less common natural-language dates remain the semantic parser's job.
    if (!localDateTimeToUtc(interpretedLocalDateTime, timeZone)) return { eventAt: null };
    day = interpretedLocalDateTime.slice(0, 10);
  } else return undefined;
  const eventAt = localDateTimeToUtc(`${day}T09:00`, timeZone);
  return { eventAt: eventAt && Date.parse(eventAt) > new Date(now).getTime() ? eventAt : null, assumedHour: '09:00' };
}

export function localDateTimeToUtc(value, timeZone = DOMINICAN_TIME_ZONE) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [year, month, day, hour, minute] = [value.slice(0, 4), value.slice(5, 7), value.slice(8, 10), value.slice(11, 13), value.slice(14, 16)].map(Number);
  const guessed = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(guessed).toISOString().slice(0, 16) !== value) return null;
  let target = guessed;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = partsInZone(new Date(target), timeZone);
    const foundAsUtc = Date.UTC(Number(found.year), Number(found.month) - 1, Number(found.day), Number(found.hour), Number(found.minute));
    const delta = guessed - foundAsUtc;
    if (!delta) break;
    target += delta;
  }
  const found = partsInZone(new Date(target), timeZone);
  if (`${found.year}-${found.month}-${found.day}T${found.hour}:${found.minute}` !== value) return null;
  return new Date(target).toISOString();
}

export function localEventTime(value, timeZone = DOMINICAN_TIME_ZONE) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'hora por confirmar';
  return new Intl.DateTimeFormat('es-DO', {
    timeZone, dateStyle: 'full', timeStyle: 'short', hourCycle: 'h12',
  }).format(date);
}
