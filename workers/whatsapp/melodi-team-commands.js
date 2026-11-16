import { agentAddress, stripAgentAddress } from './melodi-address.js';

const MEMBERS = 'melodi';
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RETRY = /^(?:reanuda|reanudar|retoma|retomar|reintenta|reintentar|continua|continuar|vuelve a (?:intentar(?:lo)?|ejecutar(?:lo)?)|intenta(?:lo)? (?:de nuevo|otra vez))\b/;
const JOB_TARGET = /\b(?:trabajo|tarea|encargo|documento|pdf|historia|correo|investigacion|fallid[oa]|pendiente)\b|\bt\s*\d+\b/;

function normalized(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function directive(raw) {
  return stripAgentAddress(raw).trim();
}

function references(raw, prefix) {
  const opaque = Array.from(raw.matchAll(UUID));
  if (prefix === 'T') opaque.push(...raw.matchAll(/\bauto-[A-Za-z0-9]{8,80}\b/g));
  if (prefix === 'R') opaque.push(...raw.matchAll(/\broutine-[\w-]+\b/gi));
  const short = Array.from(raw.toUpperCase().matchAll(new RegExp('\\b(' + prefix + ')\\s*(\\d{1,12})\\b', 'g')))
    .filter(match => !opaque.some(id => match.index >= id.index && match.index < id.index + id[0].length))
    .map(match => match[1] + Number(match[2]));
  const shortRefs = Array.from(new Set(short));
  const ids = Array.from(new Set(opaque.map(match => match[0])));
  const choices = shortRefs.length || ids.length > 1 ? [...shortRefs, ...ids].join(' ') : undefined;
  return { short: choices || undefined, opaque: opaque[0]?.[0] };
}

export function explicitlyChosenAgent(text) {
  const raw = String(text || '').trim();
  const direct = agentAddress(raw)?.agent;
  if (direct) return direct;
  const s = normalized(raw);
  const assignment = s.match(new RegExp('^(?:(?:no|perdon|corrijo)[, :]+)?(?:quiero que|necesito que|elige a|prefiero a|asigna (?:esto|esta tarea|este trabajo) a|asignalo a|que lo haga|(?:esto|eso|esta tarea|este trabajo|este documento|este encargo) (?:es|era) para|es para)\\s+(?:la agente\\s+)?(' + MEMBERS + ')\\b'));
  if (assignment) return assignment[1];
  // A named retry is also an explicit assignment; a mention in document content is not.
  if (!raw.includes('\n') && s.length <= 700 && RETRY.test(s) && JOB_TARGET.test(s)) return s.match(new RegExp('\\b(' + MEMBERS + ')\\b'))?.[1] || null;
  return null;
}

// Only the owner's direct message is parsed here. Commands in a document body
// or an attachment are data, so every control directive is anchored at its start.
export function ownerTeamCommand(text, activeAgent = 'melodi') {
  const raw = String(text || '').trim();
  if (raw.includes('\n') || raw.length > 700) return null;
  const body = directive(raw);
  const s = normalized(body);
  const question = s.replace(/^[¿¡\s]+/, '');
  const queried = question.match(new RegExp('^(?:que (?:esta haciendo|hace|tiene pendiente)|en que (?:esta trabajando|trabaja)|como (?:va|avanza)(?: (?:el trabajo|la tarea|el encargo))?(?: de)?|(?:dime|consulta|muestra(?:me)?) (?:el )?estado de)\\s+(' + MEMBERS + ')\\b'))?.[1];
  if (queried) return { action: 'task_progress', agent: explicitlyChosenAgent(raw) || activeAgent, targetAgent: queried };
  const named = normalized(raw).match(new RegExp('\\b(' + MEMBERS + ')\\b'))?.[1];
  const agent = named || activeAgent;
  const approval = references(raw, 'C');
  const approvalId = approval.opaque;
  if (/^(?:adelante|hazlo|continua|sigue)(?:[, ]+(?:melodi))?[.! ]*$/.test(s))
    return { action: 'approval', approved: true, contextual: true, agent };
  if (/^(?:(?:todavia|aun) )?no (?:he recibido|me (?:ha|han|has) (?:llegado|enviado))\b/.test(s)
      || /^(?:como va|que paso con|estado de|ya (?:esta|terminaste|lo enviaste)|lo enviaste|lo has enviado|cuando (?:llega|lo envias))\b/.test(s))
    return { action: 'task_progress', agent };
  if (/^(?:(?:si|no)[ .!]*$|si[, ]+(?:adelante|hazlo|aprobado)[ .!]*$|(?:si[, ]+)?(?:apruebo|aprueba|rechazo|rechaza|autorizo|deniego)\b|c\s*\d+\s+(?:aprobado|rechazado)[ .!]*$)/.test(s)) {
    return { action: 'approval', approvalId, approved: !/\b(?:no|rechazo|rechaza|rechazado|deniego)\b/.test(s),
      contextual: !approvalId && !approval.short, ...(approval.short ? { approvalReference: approval.short } : {}) };
  }
  const level = s.match(/\b(?:nivel|level)\s*(?:a|en|=|:)?\s*(\d{1,2})\b/);
  if (named && level && /^(?:baja|bajale|sube|subele|pon|ponle|establece|cambia|ajusta)\b/.test(s)) {
    return { action: 'set_level', agent, level: Number(level[1]) };
  }
  if (/^(?:baja|bajale|reduce)\b.*\b(?:nivel|niveles)\b/.test(s) && named) return { action: 'lower_level', agent };
  if (/^(?:excelente trabajo|buen trabajo|bien hecho|te felicito|felicidades por|felicito a)\b/.test(s)) return { action: 'praise', agent };
  if (/^(?:ver|muestra|muestrame|dime|consulta|cuales|como|estado)\b/.test(s) && /\b(?:niveles|jerarquia|permisos del equipo|estado del equipo)\b/.test(s)) return { action: 'status' };
  const job = references(raw, 'T');
  const jobId = job.opaque || raw.match(/\bauto-[A-Za-z0-9]{8,80}\b/)?.[0];
  if (RETRY.test(s) && (JOB_TARGET.test(s) || jobId || /^(?:vuelve a intentarlo|intentalo (?:de nuevo|otra vez))[ .!]*$/.test(s))) {
    return { action: 'retry_job', agent, ...(jobId ? { jobId } : {}), ...(job.short ? { jobReference: job.short } : {}),
      ...(!jobId && !job.short ? { latest: true } : {}) };
  }
  const stop = /^(?:deten|detener|cancela|cancelar|para|parar|detenme)\s+(?!(?:que|crear|hacer)\b)/.test(s);
  const routine = references(raw, 'R');
  const routineId = routine.opaque || raw.match(/\broutine-[\w-]+\b/i)?.[0];
  if (stop && (/\b(?:rutina|informe semanal|investigacion semanal|encargo semanal)\b/.test(s) || routine.short)) {
    return { action: 'stop_routine', agent: named || undefined, routineId, ...(routine.short ? { routineReference: routine.short } : {}) };
  }
  if (stop && (JOB_TARGET.test(s) || jobId)) return { action: 'stop_job', agent: named || undefined,
    ...(jobId ? { jobId } : {}), ...(job.short ? { jobReference: job.short } : {}) };
  if (/^(?:muestra|muestrame|ver|lista|cuales)\b.*\b(?:rutinas|encargos semanales|informes semanales)\b/.test(s)) return { action: 'list_routines', agent: named || undefined };
  return null;
}
