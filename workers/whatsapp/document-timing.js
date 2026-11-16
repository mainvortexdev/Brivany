import { stripAgentAddress } from './melodi-address.js';
import { clockContext, explicitReminderTime, dateOnlyReminderTime, localDateTimeToUtc } from './event-time.js';
import { parseOwnerAgendaQuery } from './owner-agenda.js';

// Only the command line can request a deadline. Dates inside source documents are data.
export function documentRequestLine(value) {
  return stripAgentAddress(String(value || '')).split(/\r?\n/, 1)[0].split(/[“"«]|:\s+/, 1)[0].trim();
}
export function documentDeadlineRequested(value) {
  const line = documentRequestLine(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\b(?:para|antes de|listo|lista|entrega\w*|envia\w*)\b/.test(line)
    && /\b(?:ese (?:mismo )?dia|esa fecha|manana|hoy|(?:el|dia) (?:proximo )?\d{1,2}|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las? \d|(?:en|dentro de) \d+ (?:minutos?|horas?|dias?))|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:\/\d{1,2}| de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))/.test(line);
}
export function resolveDocumentTiming(value, { now = new Date(), events = [], recent = [], interpretedLocal = '' } = {}) {
  const line = documentRequestLine(value), folded = line.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (!documentDeadlineRequested(value)) return { immediate: true, dueAt: null, context: '' };
  const relative = folded.match(/\b(?:en|dentro de) (\d+) (minutos?|horas?|dias?)\b/);
  if (relative) {
    const count = Number(relative[1]), delta = count * (/^minuto/.test(relative[2]) ? 60000 : /^hora/.test(relative[2]) ? 3600000 : 86400000);
    return count > 0 && delta <= 366*86400000 ? { immediate:false,dueAt:new Date(new Date(now).getTime()+delta).toISOString(),context:'' }
      : {clarification:'Indícame un plazo de entrega válido, de hasta un año.'};
  }
  let reference;
  if (/\b(?:ese (?:mismo )?dia|esa fecha)\b/.test(folded)) {
    for (const turn of [...recent].reverse()) {
      const matches = events.filter(event => turn.role === 'assistant' && turn.message?.includes(event.title));
      if (matches.length === 1) { reference = matches[0]; break; }
    }
    if (!reference) {
      const latest = [...events].filter(event => Date.parse(event.created_at) >= new Date(now).getTime() - 24*3600000)
        .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      if (latest.length === 1) reference = latest[0];
    }
    if (!reference) return { clarification: '¿Para qué fecha debe estar listo el documento? No pude identificar con certeza «ese mismo día».' };
  }
  const resolvedLine = reference ? folded.replace(/ese (?:mismo )?dia|esa fecha/g, clockContext(reference.event_at).today_local) : line;
  const query = parseOwnerAgendaQuery(`Qué tengo programado ${resolvedLine.replace(/\b(?:crea|crear|programa|programar|redacta|escribe|elimina|borra|envia(?:me)?|manda(?:me)?)\b/gi,'')}`, { now });
  const localDay = query?.start ? clockContext(query.start).today_local : interpretedLocal.slice(0,10);
  const local = localDay ? `${localDay}T09:00` : interpretedLocal;
  const result = explicitReminderTime(resolvedLine, now) ?? dateOnlyReminderTime(resolvedLine, local, now);
  const dueAt = result === undefined ? (local ? localDateTimeToUtc(local) : null) : result.eventAt;
  if (!dueAt || Date.parse(dueAt) <= new Date(now).getTime()) return { clarification: 'La fecha de entrega no es futura o no pude interpretarla. Indícame cuándo debe estar listo el documento.' };
  return { immediate: false, dueAt, context: reference ? `${reference.title}\nFecha acordada: ${reference.event_at}` : '',
    assumedHour: result?.assumedHour || (!/\ba las?\b|\d{1,2}:\d{2}/.test(folded) ? '09:00' : '') };
}
