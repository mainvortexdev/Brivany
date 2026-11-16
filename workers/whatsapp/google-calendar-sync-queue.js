import { googleCalendarConfigured } from './google-calendar-auth.js';
import { syncGoogleCalendar } from './google-calendar-sync.js';

const DISPATCH_MS = 120000;
export const GOOGLE_CALENDAR_SYNC_QUEUE_SCHEMA = `CREATE TABLE IF NOT EXISTS google_calendar_sync_requests (
  owner TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, completed_revision INTEGER NOT NULL DEFAULT 0,
  dispatch_token TEXT, dispatch_until INTEGER, updated_at INTEGER NOT NULL)`;

function authorizedOwner(env, owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '')) {
  if (!/^\d{8,15}$/.test(owner) || owner !== String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '')) throw Error('invalid_calendar_sync_owner');
  return owner;
}
const statement = (env, sql, ...values) => env.VETSA_CLOUD.prepare(sql).bind(...values);

/** Invoke only after local schedule persistence. Queue payloads contain no task content. */
export async function requestGoogleCalendarSync(env, { owner: value, now = Date.now() } = {}) {
  if (!googleCalendarConfigured(env) || typeof env.MELODI_JOBS?.send !== 'function') return { status: 'unconfigured' };
  const owner = authorizedOwner(env, value);
  const exists = await statement(env, "SELECT name FROM sqlite_master WHERE type='table' AND name='google_calendar_connections'").first();
  if (!exists || !await statement(env, "SELECT owner FROM google_calendar_connections WHERE owner=? AND status='connected'", owner).first()) return { status: 'disconnected' };
  await env.VETSA_CLOUD.prepare(GOOGLE_CALENDAR_SYNC_QUEUE_SCHEMA).run();
  await statement(env, `INSERT INTO google_calendar_sync_requests(owner,revision,updated_at) VALUES(?,1,?)
    ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at`, owner, now).run();
  const token = crypto.randomUUID();
  const claimed = await statement(env, `UPDATE google_calendar_sync_requests SET dispatch_token=?,dispatch_until=?,updated_at=?
    WHERE owner=? AND (dispatch_token IS NULL OR dispatch_until<=?) RETURNING owner`, token, now + DISPATCH_MS, now, owner, now).first();
  if (!claimed) return { status: 'coalesced' };
  try {
    await env.MELODI_JOBS.send({ type: 'calendar_sync', owner, token });
    return { status: 'queued' };
  } catch (error) {
    await statement(env, 'UPDATE google_calendar_sync_requests SET dispatch_token=NULL,dispatch_until=NULL WHERE owner=? AND dispatch_token=?', owner, token).run();
    throw error;
  }
}

/** The consumer retries this same message when sync is busy or newer local work appeared. */
export async function processGoogleCalendarSync(env, body, { sync = syncGoogleCalendar, now = Date.now() } = {}) {
  const owner = authorizedOwner(env, body?.owner);
  if (body?.type !== 'calendar_sync' || typeof body.token !== 'string' || !/^[a-f0-9-]{36}$/.test(body.token)) throw Error('invalid_calendar_sync_message');
  const pending = await statement(env, 'SELECT revision,completed_revision FROM google_calendar_sync_requests WHERE owner=? AND dispatch_token=?', owner, body.token).first();
  if (!pending || pending.revision <= pending.completed_revision) return { status: 'superseded', retry: false };
  // syncGoogleCalendar owns the existing connection lease and reads the real
  // scheduled sources; this job never reconstructs appointments from a chat.
  const result = await sync(env);
  if (['busy', 'retrying', 'continuing'].includes(result?.status) || (result?.status === 'synced' && result.actions >= 8)) {
    await statement(env, 'UPDATE google_calendar_sync_requests SET dispatch_until=?,updated_at=? WHERE owner=? AND dispatch_token=?', now + DISPATCH_MS, now, owner, body.token).run();
    return { ...result, retry: true, retryDelaySeconds: result.status === 'busy' ? 5 : 1 };
  }
  if (result?.status !== 'synced') {
    await statement(env, 'UPDATE google_calendar_sync_requests SET dispatch_token=NULL,dispatch_until=NULL WHERE owner=? AND dispatch_token=?', owner, body.token).run();
    return { ...result, retry: false };
  }
  const completed = await statement(env, `UPDATE google_calendar_sync_requests SET completed_revision=MAX(completed_revision,?),
    dispatch_token=CASE WHEN revision>? THEN dispatch_token ELSE NULL END,
    dispatch_until=CASE WHEN revision>? THEN ? ELSE NULL END,updated_at=?
    WHERE owner=? AND dispatch_token=? RETURNING revision,completed_revision`, pending.revision, pending.revision, pending.revision,
    now + DISPATCH_MS, now, owner, body.token).first();
  return completed && completed.revision > completed.completed_revision
    ? { ...result, status: 'continuing', retry: true, retryDelaySeconds: 1 }
    : { ...result, retry: false };
}
