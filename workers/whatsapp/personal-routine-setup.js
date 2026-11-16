import { createRoutineStore } from './melodi-routines.js';
import { requestGoogleCalendarSync } from './google-calendar-sync-queue.js';

// Explicit schedules requested by the owner on 21 October 2026. The revision
// guard prevents a later restart from undoing Calendar edits or cancellations.
export const REQUESTED_PERSONAL_ROUTINES = Object.freeze([
  { key: 'boxing', title: 'Ir al boxeo', hour: '09:00', weekdays: [1, 2, 3, 4, 5] },
  { key: 'work', title: 'Trabajar en apartamento de Alfredo', hour: '11:00', weekdays: [1, 2, 3, 4, 5, 6] },
  { key: 'work-return', title: 'Volver al trabajo', hour: '15:40', weekdays: [1, 2, 3, 4, 5, 6] },
]);

export async function ensureRequestedPersonalRoutines(env, { services, now = Date.now() } = {}) {
  const revision = env.PERSONAL_ROUTINES_SETUP_REV;
  if (!revision) return { status: 'disabled' };
  if (revision !== '2026-10-21.1') throw Error('unknown_personal_routine_revision');
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(owner)) throw Error('personal_routine_owner_invalid');
  const key = `requested-personal-routines:${owner}:${revision}`;
  if (await env.VETSA_CLOUD.prepare('SELECT state_key FROM worker_state WHERE state_key=?').bind(key).first()) return { status: 'already_applied' };
  const routines = createRoutineStore(env.VETSA_CLOUD, { ...services, now: () => now });
  await routines.ensureSchema();
  const saved = [];
  for (const { key: identity, ...schedule } of REQUESTED_PERSONAL_ROUTINES) {
    const routine = await routines.create({ ...schedule, owner, agent: 'melodi', kind: 'recurring_reminder',
      frequency: 'weekly', channel: 'whatsapp', eventKey: `owner-request:personal:${revision}:${identity}` });
    if (!routine?.id || routine.status !== 'active' || JSON.stringify(routine.weekdays) !== JSON.stringify(schedule.weekdays)
      || routine.hour !== schedule.hour) throw Error('personal_routine_not_confirmed');
    saved.push(routine);
  }
  await env.VETSA_CLOUD.prepare('INSERT OR IGNORE INTO worker_state(state_key,state_value,updated_at) VALUES(?,?,?)')
    .bind(key, 'applied', new Date(now).toISOString()).run();
  await requestGoogleCalendarSync(env, { owner, now }).catch(() =>
    console.error(JSON.stringify({ event: 'personal_routine_calendar_sync_deferred' })));
  return { status: 'applied', routineIds: saved.map(item => item.id) };
}
