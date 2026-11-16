import { shortReminderTime } from './reminder-language.js';

/** Dates chosen by the assistant need a compact, reviewable confirmation. */
export function agendaPlanConfirmation(result, plan, timeZone, now = Date.now()) {
  if (!['applied', 'replayed'].includes(result?.status) || !Array.isArray(result.created) || !Array.isArray(result.moved)) {
    throw Error('agenda_plan_not_confirmed');
  }
  const parts = ['Listo, Daniel.'];
  if (plan.moveDay) parts.push(result.movedCount
    ? `Pasé ${result.movedCount === 1 ? 'tu pendiente de hoy' : `tus ${result.movedCount} pendientes de hoy`} a mañana${result.adjustments?.length ? '.' : ', conservando sus horas.'}`
    : 'No había pendientes por mover de hoy a mañana.');
  for (const change of result.adjustments || []) parts.push(`Dejé «${change.title}» ${shortReminderTime(change.to,timeZone,now)} para que no coincida con ${change.conflicting?.[0]?.title || 'la otra actividad'}.`);
  const projects = plan.createEvents.filter(event => event.kind === 'project_work');
  if (projects.length) parts.push(`Repartí el trabajo en días distintos:\n${projects.map(event => `• ${event.title}: ${shortReminderTime(event.eventAt, timeZone, now)}`).join('\n')}`);
  const fixed = [...plan.createEvents.filter(event => event.kind === 'fixed'), ...(plan.retainedFixed || [])];
  if (fixed.length) parts.push(`También dejé ${fixed.length === 1 ? 'el aviso' : `los ${fixed.length} avisos`} de tus compromisos personales.`);
  const morning = plan.assumptions?.find(value => /horas de la mañana/.test(value));
  if (morning) parts.push(morning);
  return parts.join('\n');
}

export function agendaPlanFailure(result, { timeZone = 'America/Santo_Domingo', now = Date.now() } = {}) {
  if (result?.status === 'unsupported' && result.reason === 'unsupported_day_activities') {
    return 'Además de tus pendientes, tienes actividades que se repiten. ¿Dejo esas repeticiones como están y paso a mañana los pendientes de hoy?';
  }
  if (result?.reason === 'time_conflict') {
    const names = [...new Set((result.events || []).map(event => event?.title).filter(Boolean))].slice(0,2);
    if (names.length === 2 && result.eventAt) return `«${names[0]}» y «${names[1]}» coinciden ${shortReminderTime(result.eventAt,timeZone,now)}. ¿Cuál prefieres cambiar de hora?`;
    return 'No pude identificar con certeza las actividades que se cruzan. Voy a conservar el encargo para revisar sus horarios.';
  }
  if (result?.status === 'conflict') return 'La agenda cambió mientras la organizaba. No apliqué este plan; puedo volver a comprobarlo con los cambios actuales.';
  return 'No pude comprobar todo el cambio de agenda. Conservé los compromisos anteriores y no añadí una parte del plan.';
}
