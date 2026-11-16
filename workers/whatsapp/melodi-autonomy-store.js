import { publicInstagramResearchUrl } from './owner-research-request.js';

// Durable, owner-scoped queues. Payloads never have a plaintext storage fallback.
export const AUTONOMOUS_AGENTS = Object.freeze(['melodi']);
export const AUTONOMY_DEFAULTS = Object.freeze({ enabled: false, dailyRunLimit: 8, dailyMessageLimit: 3, cooldownMs: 45 * 60000 });
export const AUTONOMY_MEDIA_EVENT_TYPES = Object.freeze(['daily_review', 'background_review', 'goal_followup', 'owner_context', 'delegation', 'collaboration_result', 'collaboration_denied']);

export const AUTONOMY_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_state (
    owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    daily_run_limit INTEGER NOT NULL DEFAULT 8 CHECK(daily_run_limit >= 0),
    daily_message_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_message_limit >= 0),
    cooldown_ms INTEGER NOT NULL DEFAULT 2700000 CHECK(cooldown_ms >= 0),
    budget_day TEXT NOT NULL, runs_today INTEGER NOT NULL DEFAULT 0, messages_today INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT, lease_until INTEGER, outbox_lease_token TEXT, outbox_lease_until INTEGER,
    cooldown_until INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER, last_message_at INTEGER,
    checkpoint_encrypted TEXT, checkpoint_iv TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,agent))`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_events (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_key TEXT NOT NULL, type TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed','waiting')),
    priority INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
    lease_token TEXT, lease_until INTEGER, receipt_token TEXT, error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,agent,event_key), FOREIGN KEY(owner,agent) REFERENCES wa_melodi_work_state(owner,agent))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_work_events_due ON wa_melodi_work_events(owner,agent,status,available_at,priority)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_work_one_processing ON wa_melodi_work_events(owner,agent) WHERE status='processing'`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_outbox (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, message_key TEXT NOT NULL, event_id TEXT,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
    available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
    receipt_token TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,agent,message_key), FOREIGN KEY(owner,agent) REFERENCES wa_melodi_work_state(owner,agent))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_work_outbox_due ON wa_melodi_work_outbox(status,available_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_work_one_sending ON wa_melodi_work_outbox(owner,agent) WHERE status='sending'`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_audit (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_id TEXT, outbox_id TEXT,
    action TEXT NOT NULL, outcome TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_work_audit_owner ON wa_melodi_work_audit(owner,agent,created_at)`,
]);

function timestamp(value) {
  const number = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError('Invalid autonomy timestamp');
  return Math.trunc(number);
}

export function autonomyLocalDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp(now)));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function autonomyRetryDelay(attempts) {
  return Math.min(60 * 60000, 60000 * 2 ** Math.max(0, Math.min(10, Number(attempts) - 1)));
}

function scope(owner, agent) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('Invalid autonomy owner');
  if (!AUTONOMOUS_AGENTS.includes(agent)) throw new TypeError('Invalid autonomous agent');
}

function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new TypeError('Invalid autonomy configuration');
  return number;
}

function code(value) {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,64}$/i.test(value) ? value : value ? 'operation_failed' : null;
}

async function keyDigest(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) throw new TypeError('Missing idempotency key');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

const results = result => result?.results || [];
const changed = result => (result?.meta?.changes || 0) > 0;

/** Encryption hooks accept JSON text and return {encrypted,iv}; decrypt returns JSON text. */
export function createAutonomyStore(db, { encrypt, decrypt, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TypeError('Autonomy requires a D1 binding');
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('Autonomy requires encryption hooks');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const time = value => timestamp(value ?? now());
  const day = (localDay, at) => {
    const value = localDay ?? autonomyLocalDay(at);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Invalid local budget day');
    return value;
  };
  const seal = async value => {
    const encoded = JSON.stringify(value ?? {});
    if (encoded.length > 100000) throw new RangeError('Autonomy payload too large');
    const sealed = await encrypt(encoded);
    if (typeof sealed?.encrypted !== 'string' || !sealed.encrypted || typeof sealed?.iv !== 'string' || !sealed.iv) throw new Error('Autonomy encryption failed');
    return sealed;
  };
  const unseal = async row => JSON.parse(await decrypt(row.payload_encrypted, row.payload_iv));

  async function ensureSchema() {
    await db.batch(AUTONOMY_SCHEMA.map(sql => db.prepare(sql)));
  }

  async function ensureAgent({ owner, agent, config = {} }) {
    scope(owner, agent);
    const at = time();
    await statement(`INSERT OR IGNORE INTO wa_melodi_work_state
      (owner,agent,enabled,daily_run_limit,daily_message_limit,cooldown_ms,budget_day,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, owner, agent, config.enabled === true ? 1 : 0,
    integer(config.dailyRunLimit, 8, 1000), integer(config.dailyMessageLimit, 3, 100), integer(config.cooldownMs, 2700000, 7 * 86400000), autonomyLocalDay(at), at, at).run();
    return getState(owner, agent);
  }

  async function getState(owner, agent) {
    scope(owner, agent);
    const state = await statement('SELECT * FROM wa_melodi_work_state WHERE owner=? AND agent=?', owner, agent).first();
    if (!state) return null;
    const countRows = results(await statement('SELECT status,COUNT(*) AS count FROM wa_melodi_work_events WHERE owner=? AND agent=? GROUP BY status', owner, agent).all());
    const outboxRows = results(await statement('SELECT status,COUNT(*) AS count FROM wa_melodi_work_outbox WHERE owner=? AND agent=? GROUP BY status', owner, agent).all());
    const { checkpoint_encrypted, checkpoint_iv, lease_token, outbox_lease_token, ...publicState } = state;
    return { ...publicState, enabled: state.enabled === 1, dailyRunLimit: state.daily_run_limit,
      dailyMessageLimit: state.daily_message_limit, cooldownMs: state.cooldown_ms, hasCheckpoint: Boolean(checkpoint_encrypted),
      eventCounts: { pending: 0, processing: 0, done: 0, failed: 0, waiting: 0, ...Object.fromEntries(countRows.map(row => [row.status, row.count])) },
      outboxCounts: { pending: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, ...Object.fromEntries(outboxRows.map(row => [row.status, row.count])) },
    };
  }

  async function listStates(owner) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('Invalid autonomy owner');
    const rows = results(await statement('SELECT agent FROM wa_melodi_work_state WHERE owner=? ORDER BY agent', owner).all());
    return Promise.all(rows.map(row => getState(owner, row.agent)));
  }

  async function configureAgent({ owner, agent, config }) {
    scope(owner, agent);
    if (!config || typeof config !== 'object') throw new TypeError('Missing agent configuration');
    const current = await getState(owner, agent);
    if (!current) return ensureAgent({ owner, agent, config });
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new TypeError('Invalid enabled setting');
    await statement(`UPDATE wa_melodi_work_state SET enabled=?,daily_run_limit=?,daily_message_limit=?,cooldown_ms=?,updated_at=? WHERE owner=? AND agent=?`,
      config.enabled === undefined ? Number(current.enabled) : Number(config.enabled), integer(config.dailyRunLimit, current.dailyRunLimit, 1000),
      integer(config.dailyMessageLimit, current.dailyMessageLimit, 100), integer(config.cooldownMs, current.cooldownMs, 7 * 86400000), time(), owner, agent).run();
    return getState(owner, agent);
  }

  async function enqueueEvent({ owner, agent, eventKey, type, payload = {}, availableAt, maxAttempts = 3, priority = 0 }) {
    scope(owner, agent);
    if (typeof type !== 'string' || !/^[a-z0-9_.:-]{1,64}$/i.test(type)) throw new TypeError('Invalid event type');
    const attempts = integer(maxAttempts, 3, 20);
    if (!attempts || !Number.isInteger(priority) || Math.abs(priority) > 100) throw new TypeError('Invalid event limits');
    const at = time();
    const digest = await keyDigest(eventKey);
    const sealed = await seal(payload);
    await statement(`INSERT OR IGNORE INTO wa_melodi_work_events
      (id,owner,agent,event_key,type,payload_encrypted,payload_iv,available_at,max_attempts,priority,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, uuid(), owner, agent, digest, type, sealed.encrypted, sealed.iv, time(availableAt ?? at), attempts, priority, at, at).run();
    const row = await statement('SELECT id,status,available_at FROM wa_melodi_work_events WHERE owner=? AND agent=? AND event_key=?', owner, agent, digest).first();
    return row;
  }

  async function listDueAgents({ owner, now: atValue, limit = 20 } = {}) {
    if (owner !== undefined && (typeof owner !== 'string' || !owner.trim() || owner.length > 160)) throw new TypeError('Invalid autonomy owner');
    const at = time(atValue);
    return results(await statement(`SELECT s.owner,s.agent FROM wa_melodi_work_state s WHERE s.enabled=1
      AND (s.lease_until IS NULL OR s.lease_until<=?)
      AND EXISTS (SELECT 1 FROM wa_melodi_work_events e WHERE e.owner=s.owner AND e.agent=s.agent
        AND ((e.status='pending' AND e.available_at<=?) OR (e.status='processing' AND e.lease_until<=?))
        AND (e.type='public_media_poll' OR (e.type IN ('approved_action','owner_research_report','agent_objective') AND e.priority>=20)
          OR (s.cooldown_until<=? AND s.daily_run_limit>0 AND (s.budget_day<>? OR s.runs_today<s.daily_run_limit))))
      AND (? IS NULL OR s.owner=?)
      ORDER BY COALESCE(s.last_run_at,0),s.agent LIMIT ?`, at, at, at, at, autonomyLocalDay(at), owner ?? null, owner ?? null, integer(limit, 20, 100)).all());
  }

  async function claimEvent({ owner, agent, now: atValue, localDay, leaseMs = 5 * 60000 }) {
    scope(owner, agent);
    const at = time(atValue), budgetDay = day(localDay, at), token = uuid();
    const until = at + Math.max(1000, integer(leaseMs, 300000, 30 * 60000));
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_events SET status=CASE WHEN attempts<max_attempts THEN 'pending' ELSE 'failed' END,
        available_at=?,lease_token=NULL,lease_until=NULL,error_code='lease_expired',updated_at=?
        WHERE owner=? AND agent=? AND status='processing' AND lease_until<=?`, at, at, owner, agent, at),
      statement(`UPDATE wa_melodi_work_state SET lease_token=?,lease_until=?,
        runs_today=CASE WHEN budget_day=? THEN runs_today ELSE 0 END,
        messages_today=CASE WHEN budget_day=? THEN messages_today ELSE 0 END,budget_day=?,last_run_at=?,updated_at=?
        WHERE owner=? AND agent=? AND enabled=1 AND (lease_until IS NULL OR lease_until<=?)
        AND EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE owner=? AND agent=? AND status='pending' AND available_at<=?
          AND (type='public_media_poll' OR (type IN ('approved_action','owner_research_report','agent_objective') AND priority>=20)
            OR (wa_melodi_work_state.cooldown_until<=? AND wa_melodi_work_state.daily_run_limit>0
              AND (wa_melodi_work_state.budget_day<>? OR wa_melodi_work_state.runs_today<wa_melodi_work_state.daily_run_limit))))`,
      token, until, budgetDay, budgetDay, budgetDay, at, at, owner, agent, at, owner, agent, at, at, budgetDay),
      statement(`UPDATE wa_melodi_work_events SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
        WHERE id=(SELECT id FROM wa_melodi_work_events WHERE owner=? AND agent=? AND status='pending' AND available_at<=?
          AND (type='public_media_poll' OR (type IN ('approved_action','owner_research_report','agent_objective') AND priority>=20)
            OR EXISTS (SELECT 1 FROM wa_melodi_work_state s WHERE s.owner=? AND s.agent=? AND s.lease_token=?
              AND s.cooldown_until<=? AND s.daily_run_limit>0 AND s.runs_today<s.daily_run_limit))
          ORDER BY (type='public_media_poll' OR (type IN ('approved_action','owner_research_report','agent_objective') AND priority>=20)) DESC,priority DESC,available_at,created_at,id LIMIT 1)
        AND EXISTS (SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND lease_token=?) RETURNING *`,
      token, until, at, owner, agent, at, owner, agent, token, at, owner, agent, token),
      statement(`UPDATE wa_melodi_work_state SET runs_today=runs_today+1 WHERE owner=? AND agent=? AND lease_token=?
        AND EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE owner=? AND agent=? AND lease_token=? AND status='processing'
          AND NOT (type='public_media_poll' OR (type IN ('approved_action','owner_research_report','agent_objective') AND priority>=20)))`, owner, agent, token, owner, agent, token),
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,event_id,action,outcome,created_at)
        SELECT ?,owner,agent,id,'event_claim','processing',? FROM wa_melodi_work_events WHERE owner=? AND agent=? AND lease_token=?`, uuid(), at, owner, agent, token),
    ]);
    const event = results(batch[2])[0];
    if (!event) return null;
    try { return { ...event, leaseToken: token, payload: await unseal(event) }; }
    catch {
      await finishEvent({ owner, agent, eventId: event.id, leaseToken: token, status: 'failed', errorCode: 'payload_decryption_failed', now: at });
      return null;
    }
  }

  async function renewLease({ owner, agent, eventId, leaseToken, now: atValue, leaseMs = 300000 }) {
    scope(owner, agent);
    const at = time(atValue), until = at + Math.max(1000, integer(leaseMs, 300000, 1800000));
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_state SET lease_until=?,updated_at=? WHERE owner=? AND agent=? AND lease_token=? AND lease_until>?
        AND EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=? AND status='processing' AND lease_token=? AND lease_until>?)`,
      until, at, owner, agent, leaseToken, at, eventId, owner, agent, leaseToken, at),
      statement(`UPDATE wa_melodi_work_events SET lease_until=?,updated_at=? WHERE id=? AND owner=? AND agent=? AND status='processing'
        AND lease_token=? AND lease_until>? AND EXISTS (SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND lease_token=?) RETURNING id`,
      until, at, eventId, owner, agent, leaseToken, at, owner, agent, leaseToken),
    ]);
    return changed(batch[0]) && Boolean(results(batch[1])[0]);
  }

  async function finishEvent({ owner, agent, eventId, leaseToken, status = 'done', checkpoint, errorCode, retryAt, now: atValue }) {
    scope(owner, agent);
    if (!['done', 'failed', 'waiting', 'pending'].includes(status)) throw new TypeError('Invalid event result');
    const at = time(atValue);
    const event = await statement(`SELECT attempts,max_attempts FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=? AND status='processing' AND lease_token=? AND lease_until>?`, eventId, owner, agent, leaseToken, at).first();
    if (!event) return false;
    const outcome = status === 'pending' && event.attempts >= event.max_attempts ? 'failed' : status;
    const available = outcome === 'pending' ? time(retryAt ?? at + autonomyRetryDelay(event.attempts)) : at;
    const sealed = checkpoint === undefined ? null : await seal(checkpoint);
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_events SET status=?,available_at=?,lease_token=NULL,lease_until=NULL,receipt_token=?,error_code=?,updated_at=?
        WHERE id=? AND owner=? AND agent=? AND status='processing' AND lease_token=? AND lease_until>? RETURNING id`,
      outcome, available, leaseToken, code(errorCode), at, eventId, owner, agent, leaseToken, at),
      statement(`UPDATE wa_melodi_work_state SET lease_token=NULL,lease_until=NULL,cooldown_until=?+cooldown_ms,
        checkpoint_encrypted=COALESCE(?,checkpoint_encrypted),checkpoint_iv=COALESCE(?,checkpoint_iv),updated_at=?
        WHERE owner=? AND agent=? AND lease_token=?
        AND EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE id=? AND receipt_token=? AND updated_at=?)`,
      at, sealed?.encrypted ?? null, sealed?.iv ?? null, at, owner, agent, leaseToken, eventId, leaseToken, at),
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,event_id,action,outcome,error_code,created_at)
        SELECT ?,owner,agent,id,'event_finish',status,error_code,? FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=? AND receipt_token=? AND updated_at=? AND changes()>0`,
      uuid(), at, eventId, owner, agent, leaseToken, at),
    ]);
    return Boolean(results(batch[0])[0]);
  }

  async function getCheckpoint(owner, agent) {
    scope(owner, agent);
    const row = await statement('SELECT checkpoint_encrypted,checkpoint_iv FROM wa_melodi_work_state WHERE owner=? AND agent=?', owner, agent).first();
    return row?.checkpoint_encrypted ? JSON.parse(await decrypt(row.checkpoint_encrypted, row.checkpoint_iv)) : null;
  }

  // Calendar deferrals are not failed executions. Only an existing weekly
  // assignment or its unclaimed approved tool can return to this queue.
  async function deferRoutineEvent({owner,agent,eventId,leaseToken,routineId,runKey,retryAt,now:atValue}) {
    scope(owner,agent);
    const at=time(atValue),available=time(retryAt);
    if (typeof routineId!=='string' || !routineId || typeof runKey!=='string'
      || !runKey.startsWith(`routine:${routineId}:`) || !/^\d{1,15}$/.test(runKey.slice(`routine:${routineId}:`.length))
      || available<=at || available>at+366*86400000) throw new TypeError('Invalid routine deferral');
    const row=await statement(`SELECT * FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?
      AND status='processing' AND lease_token=? AND lease_until>?`,eventId,owner,agent,leaseToken,at).first();
    if (!row) return false;
    const payload=await unseal(row);
    let routine=payload.routine,assignmentAgent=agent;
    if (row.type==='approved_action') {
      const approval=await statement(`SELECT * FROM wa_melodi_permission_requests WHERE id=? AND owner_phone=? AND helper=?
        AND status='approved' AND expires_at>?`,payload.approvalId,owner,agent,at).first();
      if (!approval) return false;
      const decoded=await decrypt(approval.input_encrypted,approval.input_iv);
      routine=(typeof decoded==='string' ? JSON.parse(decoded):decoded)?.routine;assignmentAgent=approval.requester;
    } else if (!['weekly_research','motivational_message','recurring_reminder'].includes(row.type)) throw new TypeError('Invalid routine event type');
    if (routine?.id!==routineId || routine.runKey!==runKey || routine.agent!==assignmentAgent
      || (routine.owner && routine.owner!==owner)) throw new TypeError('Routine deferral scope mismatch');
    const assignment=await statement("SELECT id FROM wa_melodi_routines WHERE owner=? AND id=? AND agent=? AND status='active'",owner,routineId,assignmentAgent).first();
    if (!assignment) return false;
    const counted=!(row.type==='approved_action' && row.priority>=20);
    const batch=await db.batch([
      statement(`UPDATE wa_melodi_work_events SET status='pending',available_at=?,attempts=MAX(0,attempts-1),
        lease_token=NULL,lease_until=NULL,receipt_token=?,error_code='calendar_deferred',updated_at=?
        WHERE id=? AND owner=? AND agent=? AND status='processing' AND lease_token=? AND lease_until>?
          AND EXISTS(SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND lease_token=? AND lease_until>?) RETURNING id`,
      available,leaseToken,at,eventId,owner,agent,leaseToken,at,owner,agent,leaseToken,at),
      statement(`UPDATE wa_melodi_work_state SET lease_token=NULL,lease_until=NULL,
        runs_today=CASE WHEN budget_day=? THEN MAX(0,runs_today-?) ELSE runs_today END,updated_at=?
        WHERE owner=? AND agent=? AND lease_token=? AND EXISTS(SELECT 1 FROM wa_melodi_work_events
          WHERE id=? AND owner=? AND agent=? AND status='pending' AND receipt_token=? AND updated_at=?)`,
      autonomyLocalDay(row.updated_at),Number(counted),at,owner,agent,leaseToken,eventId,owner,agent,leaseToken,at),
      statement(`INSERT INTO wa_melodi_work_audit(id,owner,agent,event_id,action,outcome,created_at)
        SELECT ?,owner,agent,id,'routine_defer','pending',? FROM wa_melodi_work_events
          WHERE id=? AND owner=? AND agent=? AND status='pending' AND receipt_token=? AND updated_at=? AND changes()>0`,
      uuid(),at,eventId,owner,agent,leaseToken,at),
    ]);
    return Boolean(results(batch[0])[0]);
  }

  // A verified external media operation is still running. Polling does not
  // consume the retry allowance reserved for failed research or analysis.
  async function deferEvent({ owner, agent, eventId, leaseToken, payload, retryAt, checkpoint, now: atValue }) {
    scope(owner, agent);
    const at = time(atValue);
    const row = await statement(`SELECT * FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?
      AND status='processing' AND lease_token=? AND lease_until>?`,
    eventId, owner, agent, leaseToken, at).first();
    if (!row) return false;
    const prior = await unseal(row), generic = row.type !== 'owner_research_report';
    if (!generic && row.priority < 20) throw new TypeError('Invalid deferred research event');
    if (generic && !AUTONOMY_MEDIA_EVENT_TYPES.includes(row.type) && row.type !== 'public_media_poll') throw new TypeError('Invalid deferred media event type');
    const pending = prior.pendingTool || payload?.pendingTool;
    if (generic && (pending?.name !== 'inspect_public_media' || !['team', 'personal'].includes(pending.goalScope)
      || !AUTONOMY_MEDIA_EVENT_TYPES.includes(pending.originalType))) throw new TypeError('Invalid deferred media tool');
    if (generic) {
      if (!publicInstagramResearchUrl(pending.url) || (prior.pendingTool && (pending.url !== prior.pendingTool.url || pending.eventId !== prior.pendingTool.eventId))) throw new TypeError('Invalid deferred media source');
    }
    const operation = payload?.mediaOperation;
    if (typeof operation?.operationId !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(operation.operationId)) throw new TypeError('Invalid deferred media operation');
    if (prior.mediaOperation?.operationId && prior.mediaOperation.operationId !== operation.operationId) throw new TypeError('Deferred media operation changed');
    const startedAt = time(prior.mediaOperation?.startedAt ?? operation.startedAt);
    if (startedAt > at) throw new TypeError('Invalid deferred media clock');
    const deadline = startedAt + 15 * 60000;
    if (at >= deadline) throw new Error('requested_research_media_timeout');
    const available = Math.min(deadline, Math.max(at + 1000, time(retryAt ?? at + 60000)));
    const sourceEvent = prior.mediaOperation?.eventId || operation.eventId || eventId;
    if (typeof sourceEvent !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(sourceEvent)) throw new TypeError('Invalid deferred media event');
    if (generic && pending.eventId !== sourceEvent) throw new TypeError('Deferred media event changed');
    const sealed = await seal({ ...prior,
      ...(generic ? { pendingTool: { ...pending, originalType: row.type === 'public_media_poll' ? pending.originalType : row.type,
        name: 'inspect_public_media', url: pending.url, eventId: sourceEvent,
        observations: Array.isArray(pending.observations) ? pending.observations.slice(-8) : [],
        receipts: Array.isArray(pending.receipts) ? pending.receipts.slice(-8) : [] } } : {}),
      mediaOperation: { operationId: operation.operationId, startedAt, deadline, eventId: sourceEvent,
        ...(prior.mediaOperation?.approvalId || pending?.approvalId ? { approvalId: prior.mediaOperation?.approvalId || pending.approvalId } : {}) } });
    const next = checkpoint === undefined ? null : await seal(checkpoint);
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_events SET type=?,status='pending',available_at=?,attempts=MAX(0,attempts-1),
        payload_encrypted=?,payload_iv=?,lease_token=NULL,lease_until=NULL,receipt_token=?,error_code=NULL,updated_at=?
        WHERE id=? AND owner=? AND agent=? AND status='processing' AND lease_token=? AND lease_until>?
          AND EXISTS (SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND lease_token=? AND lease_until>?) RETURNING id`,
      generic ? 'public_media_poll' : row.type, available, sealed.encrypted, sealed.iv, leaseToken, at, eventId, owner, agent, leaseToken, at, owner, agent, leaseToken, at),
      statement(`UPDATE wa_melodi_work_state SET lease_token=NULL,lease_until=NULL,
        checkpoint_encrypted=COALESCE(?,checkpoint_encrypted),checkpoint_iv=COALESCE(?,checkpoint_iv),updated_at=?
        WHERE owner=? AND agent=? AND lease_token=?
          AND EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=? AND status='pending' AND receipt_token=? AND updated_at=?)`,
      next?.encrypted ?? null, next?.iv ?? null, at, owner, agent, leaseToken, eventId, owner, agent, leaseToken, at),
      statement(`INSERT INTO wa_melodi_work_audit(id,owner,agent,event_id,action,outcome,created_at)
        SELECT ?,owner,agent,id,'event_defer','pending',? FROM wa_melodi_work_events
        WHERE id=? AND owner=? AND agent=? AND status='pending' AND receipt_token=? AND updated_at=? AND changes()>0`,
      uuid(), at, eventId, owner, agent, leaseToken, at),
    ]);
    return Boolean(results(batch[0])[0]);
  }

  async function resumeEvent({ owner, agent, eventId, availableAt, payload }) {
    scope(owner, agent);
    const at = time(), sealed = payload === undefined ? null : await seal(payload);
    return changed(await statement(`UPDATE wa_melodi_work_events SET status='pending',attempts=0,available_at=?,error_code=NULL,
      payload_encrypted=COALESCE(?,payload_encrypted),payload_iv=COALESCE(?,payload_iv),updated_at=? WHERE id=? AND owner=? AND agent=? AND status='waiting'`,
    time(availableAt ?? at), sealed?.encrypted ?? null, sealed?.iv ?? null, at, eventId, owner, agent).run());
  }

  async function enqueueOutbox({ owner, agent, messageKey, payload, eventId = null, availableAt }) {
    scope(owner, agent);
    const at = time(), digest = await keyDigest(messageKey), sealed = await seal(payload);
    if (eventId && !await statement('SELECT id FROM wa_melodi_work_events WHERE id=? AND owner=? AND agent=?', eventId, owner, agent).first()) {
      let helperReply = null;
      if (payload?.ownerRequested === true && typeof payload.approvalId === 'string') {
        try {
          const approval = await statement(`SELECT e.id,e.type,e.payload_encrypted,e.payload_iv,
            p.input_encrypted,p.input_iv,p.requester,p.goal_scope FROM wa_melodi_work_events e JOIN wa_melodi_permission_requests p
            ON p.parent_event_id=e.id AND p.owner_phone=e.owner AND p.requester=e.agent
            WHERE e.id=? AND e.owner=? AND e.type IN ('owner_research_report','agent_objective') AND p.id=? AND p.helper=? AND p.status='pending'`,
          eventId, owner, payload.approvalId, agent).first();
          if (approval?.type === 'owner_research_report') helperReply = approval;
          else if (approval?.type === 'agent_objective' && payload.ownerRequestEventId === eventId && typeof payload.brainTaskId === 'string') {
            const eventPayload = await unseal(approval);
            const decoded = await decrypt(approval.input_encrypted, approval.input_iv);
            const input = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
            const task = await statement(`SELECT status FROM wa_melodi_brain_tasks WHERE id=? AND owner=? AND agent=?
              AND status IN ('pending','running','waiting')`, payload.brainTaskId, owner, approval.requester).first();
            if (task && eventPayload.brainTaskId === payload.brainTaskId && input?.ownerRequest?.brainTaskId === payload.brainTaskId
              && input.ownerRequest.origin === 'owner_request' && input.ownerRequest.assignmentAgent === approval.requester
              && input.ownerRequest.eventId === eventId) helperReply = approval;
          }
        } catch { /* Missing authority schema cannot authorize a cross-agent reply. */ }
      }
      if (!helperReply) throw new TypeError('Outbox event scope mismatch');
    }
    await statement(`INSERT OR IGNORE INTO wa_melodi_work_outbox
      (id,owner,agent,message_key,event_id,payload_encrypted,payload_iv,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uuid(), owner, agent, digest, eventId, sealed.encrypted, sealed.iv, time(availableAt ?? at), at, at).run();
    return statement('SELECT id,status FROM wa_melodi_work_outbox WHERE owner=? AND agent=? AND message_key=?', owner, agent, digest).first();
  }

  async function peekOutbox({ owner, agent, messageKey, outboxId, now: atValue, localDay }) {
    scope(owner, agent);
    if (outboxId !== undefined && (typeof outboxId !== 'string' || !outboxId || outboxId.length > 180)) throw new TypeError('Invalid outbox ID');
    const at = time(atValue);
    const messageDigest = messageKey === undefined ? null : await keyDigest(messageKey);
    const row = await statement(`SELECT o.* FROM wa_melodi_work_outbox o JOIN wa_melodi_work_state s ON o.owner=s.owner AND o.agent=s.agent
      WHERE o.owner=? AND o.agent=? AND o.status='pending' AND o.available_at<=? AND s.enabled=1
      AND (s.outbox_lease_until IS NULL OR s.outbox_lease_until<=?)
      AND (? IS NULL OR o.message_key=?) AND (? IS NULL OR o.id=?) ORDER BY o.available_at,o.created_at,o.id LIMIT 1`,
    owner, agent, at, at, messageDigest, messageDigest, outboxId ?? null, outboxId ?? null).first();
    if (!row) return null;
    try {
      const { payload_encrypted, payload_iv, lease_token, receipt_token, ...metadata } = row;
      return { ...metadata, payload: await unseal(row) };
    } catch { return null; }
  }

  async function recoverExpiredOutbox({ owner, agent, now: atValue } = {}) {
    if (agent !== undefined && owner === undefined) throw new TypeError('Outbox recovery requires owner scope');
    if (owner !== undefined) scope(owner, agent ?? 'melodi');
    const at = time(atValue);
    // A transport may have accepted an expired sending row. Never automatically resend it.
    const batch = await db.batch([
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,outbox_id,action,outcome,error_code,created_at)
        SELECT lower(hex(randomblob(16))),owner,agent,id,'outbox_recover','uncertain','delivery_unknown',? FROM wa_melodi_work_outbox
        WHERE status='sending' AND lease_until<=? AND (? IS NULL OR owner=?) AND (? IS NULL OR agent=?)`,
      at, at, owner ?? null, owner ?? null, agent ?? null, agent ?? null),
      statement(`UPDATE wa_melodi_work_outbox SET status='uncertain',receipt_token=lease_token,lease_token=NULL,lease_until=NULL,
        error_code='delivery_unknown',updated_at=? WHERE status='sending' AND lease_until<=?
        AND (? IS NULL OR owner=?) AND (? IS NULL OR agent=?)`, at, at, owner ?? null, owner ?? null, agent ?? null, agent ?? null),
      statement(`UPDATE wa_melodi_work_state SET outbox_lease_token=NULL,outbox_lease_until=NULL WHERE outbox_lease_until<=?
        AND (? IS NULL OR owner=?) AND (? IS NULL OR agent=?)`, at, owner ?? null, owner ?? null, agent ?? null, agent ?? null),
    ]);
    return { recovered: batch[1].meta?.changes || 0 };
  }

  async function claimOutbox({ owner, agent, messageKey, outboxId, requestedReply = false, now: atValue, localDay, leaseMs = 120000 } = {}) {
    if (owner !== undefined && agent !== undefined) scope(owner, agent);
    if ((owner === undefined) !== (agent === undefined)) throw new TypeError('Outbox scope requires owner and agent');
    if (outboxId !== undefined && (typeof outboxId !== 'string' || !outboxId || outboxId.length > 180)) throw new TypeError('Invalid outbox ID');
    if (typeof requestedReply !== 'boolean' || (requestedReply && (!owner || !agent || !outboxId))) throw new TypeError('Requested replies require a trusted exact outbox scope');
    const at = time(atValue), budgetDay = day(localDay, at), token = uuid();
    const messageDigest = messageKey === undefined ? null : await keyDigest(messageKey);
    const until = at + Math.max(1000, integer(leaseMs, 120000, 1800000));
    await recoverExpiredOutbox({ owner, agent, now: at });
    const candidate = await statement(`SELECT o.id,o.owner,o.agent FROM wa_melodi_work_outbox o JOIN wa_melodi_work_state s ON o.owner=s.owner AND o.agent=s.agent
      WHERE o.status='pending' AND o.available_at<=? AND s.enabled=1
      AND (s.outbox_lease_until IS NULL OR s.outbox_lease_until<=?)
      AND (?=1 OR (s.daily_message_limit>0 AND (s.budget_day<>? OR s.messages_today<s.daily_message_limit)
        AND (s.last_message_at IS NULL OR s.last_message_at+s.cooldown_ms<=?)))
      AND (? IS NULL OR o.owner=?) AND (? IS NULL OR o.agent=?) AND (? IS NULL OR o.message_key=?) AND (? IS NULL OR o.id=?)
      ORDER BY o.available_at,o.created_at,o.id LIMIT 1`,
    at, at, Number(requestedReply), budgetDay, at, owner ?? null, owner ?? null, agent ?? null, agent ?? null, messageDigest, messageDigest, outboxId ?? null, outboxId ?? null).first();
    if (!candidate) return null;
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_state SET outbox_lease_token=?,outbox_lease_until=?,
        messages_today=CASE WHEN budget_day=? THEN messages_today+? ELSE ? END,
        runs_today=CASE WHEN budget_day=? THEN runs_today ELSE 0 END,budget_day=?,updated_at=?
        WHERE owner=? AND agent=? AND enabled=1 AND (outbox_lease_until IS NULL OR outbox_lease_until<=?)
        AND (?=1 OR (daily_message_limit>0 AND (budget_day<>? OR messages_today<daily_message_limit)
          AND (last_message_at IS NULL OR last_message_at+cooldown_ms<=?)))
        AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox WHERE id=? AND status='pending' AND available_at<=?)`,
      token, until, budgetDay, requestedReply ? 0 : 1, requestedReply ? 0 : 1, budgetDay, budgetDay, at,
      candidate.owner, candidate.agent, at, Number(requestedReply), budgetDay, at, candidate.id, at),
      statement(`UPDATE wa_melodi_work_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
        WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND outbox_lease_token=?) RETURNING *`,
      token, until, at, candidate.id, candidate.owner, candidate.agent, token),
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,outbox_id,action,outcome,created_at)
        SELECT ?,owner,agent,id,'outbox_claim','sending',? FROM wa_melodi_work_outbox WHERE id=? AND lease_token=?`, uuid(), at, candidate.id, token),
    ]);
    const row = results(batch[1])[0];
    if (!row) return null;
    try { return { ...row, leaseToken: token, payload: await unseal(row) }; }
    catch {
      await finishOutbox({ id: row.id, leaseToken: token, status: 'failed', errorCode: 'payload_decryption_failed', now: at });
      return null;
    }
  }

  /** Use pending only when the transport confirms that no delivery occurred. */
  async function finishOutbox({ id, leaseToken, status, errorCode, retryAt, now: atValue }) {
    if (!['sent', 'failed', 'pending', 'uncertain'].includes(status)) throw new TypeError('Invalid outbox result');
    const at = time(atValue), available = time(retryAt ?? at + 60000);
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_outbox SET status=?,available_at=?,receipt_token=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=?
        WHERE id=? AND status='sending' AND lease_token=? AND lease_until>? RETURNING id`, status, available, leaseToken, code(errorCode), at, id, leaseToken, at),
      statement(`UPDATE wa_melodi_work_state SET outbox_lease_token=NULL,outbox_lease_until=NULL,
        last_message_at=CASE WHEN ?='sent' THEN ? ELSE last_message_at END,updated_at=?
        WHERE outbox_lease_token=? AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox o WHERE o.id=? AND o.owner=wa_melodi_work_state.owner
          AND o.agent=wa_melodi_work_state.agent AND o.receipt_token=? AND o.updated_at=?)`, status, at, at, leaseToken, id, leaseToken, at),
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,outbox_id,action,outcome,error_code,created_at)
        SELECT ?,owner,agent,id,'outbox_finish',status,error_code,? FROM wa_melodi_work_outbox WHERE id=? AND receipt_token=? AND updated_at=? AND changes()>0`,
      uuid(), at, id, leaseToken, at),
    ]);
    return Boolean(results(batch[0])[0]);
  }

  async function deferRoutineOutbox({owner,agent,id,leaseToken,routineId,runKey,retryAt,now:atValue}) {
    scope(owner,agent);const at=time(atValue),available=time(retryAt);
    if (typeof routineId!=='string' || !routineId || available<=at || available>at+366*86400000) throw new TypeError('Invalid routine delivery deferral');
    const row=await statement(`SELECT * FROM wa_melodi_work_outbox WHERE id=? AND owner=? AND agent=?
      AND status='sending' AND lease_token=? AND lease_until>?`,id,owner,agent,leaseToken,at).first();
    if (!row) return false;
    const payload=await unseal(row),runHash=runKey==null ? null:await keyDigest(runKey);
    if (payload.routineId!==routineId || !payload.artifactJobId
      || (payload.routineRunKey && payload.routineRunKey!==runKey)) throw new TypeError('Routine delivery scope mismatch');
    const proof=await statement(`SELECT job_id FROM wa_melodi_artifact_tracking WHERE owner=? AND agent=? AND job_id=? AND outbox_id=?
      AND routine_id=? AND run_key_hash IS ? AND status='enqueued'`,owner,agent,payload.artifactJobId,id,routineId,runHash).first();
    if (!proof) throw new TypeError('Routine delivery authority missing');
    const batch=await db.batch([
      statement(`UPDATE wa_melodi_work_outbox SET status='pending',available_at=?,attempts=MAX(0,attempts-1),receipt_token=?,
        lease_token=NULL,lease_until=NULL,error_code='calendar_deferred',updated_at=? WHERE id=? AND owner=? AND agent=?
          AND status='sending' AND lease_token=? AND lease_until>?
          AND EXISTS(SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=? AND outbox_lease_token=? AND outbox_lease_until>?) RETURNING id`,
      available,leaseToken,at,id,owner,agent,leaseToken,at,owner,agent,leaseToken,at),
      statement(`UPDATE wa_melodi_work_state SET outbox_lease_token=NULL,outbox_lease_until=NULL,
        messages_today=CASE WHEN budget_day=? THEN MAX(0,messages_today-1) ELSE messages_today END,updated_at=?
        WHERE owner=? AND agent=? AND outbox_lease_token=? AND EXISTS(SELECT 1 FROM wa_melodi_work_outbox
          WHERE id=? AND owner=? AND agent=? AND status='pending' AND receipt_token=? AND updated_at=?)`,
      autonomyLocalDay(row.updated_at),at,owner,agent,leaseToken,id,owner,agent,leaseToken,at),
    ]);
    return Boolean(results(batch[0])[0]);
  }

  async function listEvents({ owner, agent, limit = 20 }) {
    scope(owner, agent);
    return results(await statement(`SELECT id,type,status,priority,available_at,attempts,max_attempts,error_code,created_at,updated_at
      FROM wa_melodi_work_events WHERE owner=? AND agent=? ORDER BY created_at DESC,id LIMIT ?`, owner, agent, integer(limit, 20, 100)).all());
  }

  async function listAudit({ owner, agent, limit = 50 }) {
    scope(owner, agent);
    return results(await statement('SELECT * FROM wa_melodi_work_audit WHERE owner=? AND agent=? ORDER BY created_at DESC,id LIMIT ?', owner, agent, integer(limit, 50, 200)).all());
  }

  return Object.freeze({ ensureSchema, ensureAgent, getState, listStates, configureAgent, enqueueEvent, listDueAgents, claimEvent, renewLease,
    finishEvent, deferEvent, deferRoutineEvent, getCheckpoint, resumeEvent, enqueueOutbox, peekOutbox, recoverExpiredOutbox, claimOutbox, finishOutbox, deferRoutineOutbox, listEvents, listAudit });
}
