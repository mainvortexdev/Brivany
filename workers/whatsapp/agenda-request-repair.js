import { buildAgendaPlan } from './agenda-request.js';
import { readAgendaPlanSnapshot, applyAgendaPlan } from './agenda-plan-store.js';
import { agendaPlanConfirmation } from './agenda-plan-reply.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { requestGoogleCalendarSync } from './google-calendar-sync-queue.js';

export const AGENDA_REPAIR_SESSION_AT = '2026-10-21T09:46:43.553Z';
export const AGENDA_REPAIR_CONFIRMATION = 'wamid.HBgLMTg0OTUyMDUyNDYVAgASGBYzRUIwQjk0MTQ5OTZGNzIwNDQ1Mzk0AA==';
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

/** Repair only the owner-reported, already confirmed request. A new message or
 * cancellation cannot be overwritten. Freeze the attempted plan before its
 * atomic commit so a crash never rebuilds a different set of project events. */
export async function repairRequestedAgenda(env, { services, authorize, now = Date.now() } = {}) {
  if (env.REQUESTED_AGENDA_REPAIR_REV !== '2026-10-21.1') return { status: 'disabled' };
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  if (owner !== '18495205246') return { status: 'source_mismatch' };
  const db = env.VETSA_CLOUD;
  const key = `agenda-request-repair:${owner}:${AGENDA_REPAIR_CONFIRMATION}`;
  let marker = await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  if (marker?.state_value === 'repaired') return { status: 'already_repaired' };
  const session = await db.prepare('SELECT * FROM wa_owner_session WHERE owner_phone=?').bind(owner).first();
  if (!session || session.session_type !== 'await_agenda_plan' || session.updated_at !== AGENDA_REPAIR_SESSION_AT) return { status: 'source_changed' };
  const source = await db.prepare("SELECT response_encrypted,response_iv FROM wa_message_processing WHERE owner=? AND message_id=? AND status='done'")
    .bind(owner, AGENDA_REPAIR_CONFIRMATION).first();
  if (!source?.response_encrypted) return { status: 'source_unavailable' };
  const response = parse(await services.decrypt(source.response_encrypted, source.response_iv));
  if (response?.body !== 'Hay dos actividades a la misma hora. Necesito que elijas cuál cambiar antes de mover la agenda.') return { status: 'source_mismatch' };
  const authority = await authorize({ owner, messageId: key, tool: 'manage_calendar' });
  if (authority?.allowed !== true) return { status: 'approval_required' };
  if (!marker) {
    const state = parse(await services.decrypt(session.encrypted_state, session.state_iv));
    if (state?.reason !== 'non_personal_activities' || state.directive?.kind !== 'compound_agenda'
      || !state.directive.relaxToday || state.directive.actions?.fixed?.length !== 4
      || state.directive.actions?.distribute?.length !== 3) return { status: 'source_mismatch' };
    const directive = { ...state.directive, actions: { ...state.directive.actions,
      moveDay: { ...state.directive.actions.moveDay, onlyCalendarEvents: true } } };
    const timeZone = directive.timeZone || env.TIME_ZONE || 'America/Santo_Domingo';
    const snapshot = await readAgendaPlanSnapshot(env, owner, { services, now, timeZone });
    const plan = buildAgendaPlan(directive, { snapshot, now, timeZone });
    if (!plan?.executable) return { status: 'needs_clarification' };
    const sealed = await services.encrypt(JSON.stringify({ plan, snapshot }));
    await db.prepare('INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,?,?)')
      .bind(key, JSON.stringify(sealed), new Date(now).toISOString()).run();
    marker = await db.prepare('SELECT state_value FROM worker_state WHERE state_key=?').bind(key).first();
  }
  const sealed = JSON.parse(marker.state_value);
  const prepared = parse(await services.decrypt(sealed.encrypted, sealed.iv));
  const result = await applyAgendaPlan(env, owner, key, prepared.plan, {
    snapshot: prepared.snapshot, services, now, timeZone: prepared.plan.timeZone,
  });
  if (!['applied', 'replayed'].includes(result.status)) return { status: 'unconfirmed', reason: result.reason };
  const notices = createDeliveryNotices(db, services);
  await notices.ensureSchema();
  await notices.enqueue({ owner, agent: 'melodi', key, ownerRequested: true,
    body: agendaPlanConfirmation(result, prepared.plan, prepared.plan.timeZone, now) });
  await db.batch([
    db.prepare('DELETE FROM wa_owner_session WHERE owner_phone=? AND session_type=? AND updated_at=?')
      .bind(owner, 'await_agenda_plan', AGENDA_REPAIR_SESSION_AT),
    db.prepare('UPDATE worker_state SET state_value=?,updated_at=? WHERE state_key=?')
      .bind('repaired', new Date(now).toISOString(), key),
  ]);
  await requestGoogleCalendarSync(env, { owner, now }).catch(() =>
    console.error(JSON.stringify({ event: 'agenda_repair_sync_deferred' })));
  await env.MELODI_JOBS?.send({ type: 'autonomy_outbox' });
  return { status: 'repaired', moved: result.movedCount, created: result.createdCount };
}
