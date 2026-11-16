import { detectAgendaRequest, interpretAgendaRequest, buildAgendaPlan, resolveAgendaContinuation } from './agenda-request.js';
import { readAgendaPlanSnapshot } from './agenda-plan-store.js';
import { agendaPlanFailure } from './agenda-plan-reply.js';
import {resolveSemanticAgendaContinuation} from './owner-agenda-continuation.js';

function confirmedAgendaAdjustment(text, { narrow = false } = {}) {
  if (typeof text !== 'string' || text.length > 180 || /[\r\n?¿"“”«»`]/.test(text)) return false;
  const value = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
    .replace(/^(?:melodi)[,:]?\s+/, '').replace(/[.!]+$/, '').trim();
  // An acknowledgement followed by a condition, question or negation is not
  // a grant. Match complete short answers instead of accepting their prefix.
  if (/\b(?:no|nunca|tampoco|jamas|pero|aunque|siempre|explica|ejemplo|hipotetic\w*)\b/.test(value)) return false;
  if (/^(?:si|vale|adelante|de acuerdo)(?:[, ]+(?:hazlo|por favor))?$/.test(value)) return true;
  if (!narrow) return /^(?:revisa(?:lo)?|comprueba(?:lo)?|vuelve a (?:revisar|comprobar))(?:[, ]+por favor)?$/.test(value);
  return /^(?:(?:si|vale|adelante|de acuerdo)[, ]+)?(?:solo|solamente)\s+(?:(?:mis|los)\s+)?compromisos\s+puntuales(?:\s+y\s+deja\s+(?:las|esas)\s+rutinas\s+igual)?(?:[, ]+por favor)?$/.test(value);
}

export function agendaContinuationCandidate(text) {
  return typeof text === 'string' && text.length <= 180
    && /^(?:(?:melodi)[,:]?\s+)?(?:s[ií]|vale|adelante|de acuerdo|revisa|comprueba|vuelve|no|hoy|ma[ñn]ana|para|son|los|las|el|solo|solamente|cancela)/i.test(text.trim());
}

/** All writes still go through the calendar skill, its grant and action ledger. */
export async function prepareOwnerAgendaPlan(env, context, dependencies) {
  const { phone, message, incoming, agent, reply, referenceAt, session,semanticRoute } = context;
  const { services, generate, authorize, execute, setSession, clearSession, observe } = dependencies;
  let directive;
  if(semanticRoute==='continue_existing'){
    const resolved=resolveSemanticAgendaContinuation(session,context.resolution,{now:referenceAt});
    if(resolved.status==='cancelled'){await clearSession(env,phone);return{status:'cancelled'};}
    directive=resolved.directive;
  } else if (semanticRoute==='complex_agenda' || (!semanticRoute && detectAgendaRequest(incoming))) {
    directive = await interpretAgendaRequest(env, incoming, { now: referenceAt, timeZone: env.TIME_ZONE || 'America/Santo_Domingo', generate,semantic:semanticRoute==='complex_agenda' });
    if (!directive) throw Error('agenda_routing_temporarily_unavailable');
  } else if (session?.type === 'await_agenda_plan') {
    if (/^(?:no[,!\s]*)?(?:cancela|olvida|d[eé]jalo|no hagas)[\s\S]*$/i.test(incoming.trim())) {
      await clearSession(env, phone);
      await reply('De acuerdo, dejo la agenda como está.');
      return true;
    }
    const state = session.state;
    if (state.reason === 'non_personal_activities' && confirmedAgendaAdjustment(incoming, { narrow: true })) {
      directive = { ...state.directive, actions: { ...state.directive.actions,
        moveDay: { ...state.directive.actions.moveDay, onlyCalendarEvents: true } } };
    } else if (state.reason === 'agenda_changed' && confirmedAgendaAdjustment(incoming)) {
      directive = state.directive;
    } else if (state.reason === 'past_fixed') {
      const continuation = resolveAgendaContinuation(state.directive, incoming, { now: referenceAt, timeZone: state.directive.timeZone });
      if (continuation?.kind === 'compound_agenda') directive = continuation;
      else { await reply(continuation?.clarification || '¿Para qué día dejamos los compromisos que ya pasaron?'); return true; }
    }
    if (!directive) {
      if (state.reason === 'time_conflict' && state.conflict) {
        await reply(agendaPlanFailure(state.conflict, { timeZone: state.directive.timeZone, now: referenceAt }));
        return true;
      }
      await reply('Todavía no cambié la agenda. Confírmame el ajuste pendiente o dime que lo cancele.');
      return true;
    }
  } else return false;

  const timeZone = directive.timeZone;
  const snapshot = await readAgendaPlanSnapshot(env, phone, { now: referenceAt, timeZone, services });
  const plan = buildAgendaPlan(directive, { snapshot, now: referenceAt, timeZone });
  if (!plan) throw Error('agenda_plan_invalid');
  if (!plan.executable) {
    await setSession(env, phone, 'await_agenda_plan', { directive, reason: plan.clarificationCode || 'planning',
      ...(plan.conflict ? { conflict: plan.conflict } : {}) });
    await reply(plan.clarification);
    return true;
  }
  const interpretation = { intent: 'create_reminder', agent, agendaPlan: { plan, snapshot, directive } };
  const execution = { message, normalized: incoming.trim(), interpretation, upcomingEvents: [], receiptSent: false };
  if (!await authorize(execution, reply)) return true;
  if (observe) await observe(agent);
  return execute({ ...execution, env, phone, session: null, reply });
}
