import { AUTONOMOUS_AGENTS } from './melodi-autonomy-store.js';

export const ARTIFACT_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_artifact_tracking (
    job_id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    job_type TEXT NOT NULL CHECK(job_type IN ('generate_document','generate_story')),
    channel TEXT NOT NULL DEFAULT 'auto' CHECK(channel IN ('auto','email','whatsapp')),
    routine_id TEXT, run_key_hash TEXT, approval_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claiming','enqueued','delivered','cancelled')),
    lease_token TEXT, lease_until INTEGER, outbox_id TEXT, error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, delivered_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_artifact_pending ON wa_melodi_artifact_tracking(owner,status,created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_artifact_outbox ON wa_melodi_artifact_tracking(outbox_id) WHERE outbox_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_artifact_discovery_cursor (
    owner TEXT PRIMARY KEY, last_created_at TEXT NOT NULL, last_job_id TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
]);

function at(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(time) || time < 0) throw new TypeError('invalid_artifact_clock');
  return Math.trunc(time);
}

function ownerScope(owner) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('invalid_artifact_owner');
}

function opaque(value, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(value)) throw new TypeError('invalid_artifact_reference');
  return value;
}

async function digest(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) throw new TypeError('invalid_artifact_key');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Matches the owner-job queue's stable private-artifact ID before dispatch. */
export async function autonomousArtifactJobId(owner, jobType, idempotencyKey) {
  ownerScope(owner);
  if (!['generate_document', 'generate_story'].includes(jobType)) throw new TypeError('invalid_artifact_type');
  const bytes = await digest(`${owner}:${jobType}:${idempotencyKey}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `auto-${btoa(binary).replace(/[^A-Za-z0-9]/g, '').slice(0, 42)}`;
}

function summary(row) {
  if (!row) return null;
  const { lease_token, ...publicRow } = row;
  return publicRow;
}

export function createArtifactTracker(db, { now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TypeError('artifact_tracking_requires_d1');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const clock = value => at(value ?? now());
  const results = result => result?.results || [];

  async function ensureSchema() {
    await db.batch(ARTIFACT_SCHEMA.map(sql => db.prepare(sql)));
  }

  async function register({ jobId, owner, agent, jobType, channel = 'auto', routineId, runKey, approvalId, now: atValue }) {
    ownerScope(owner); opaque(jobId);
    if (!AUTONOMOUS_AGENTS.includes(agent)) throw new TypeError('invalid_artifact_agent');
    if (!['generate_document', 'generate_story'].includes(jobType)) throw new TypeError('invalid_artifact_type');
    if (!['auto', 'email', 'whatsapp'].includes(channel)) throw new TypeError('invalid_artifact_channel');
    const at = clock(atValue);
    const runHash = runKey == null ? null : Array.from(await digest(runKey), byte => byte.toString(16).padStart(2, '0')).join('');
    await statement(`INSERT OR IGNORE INTO wa_melodi_artifact_tracking
      (job_id,owner,agent,job_type,channel,routine_id,run_key_hash,approval_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    jobId, owner, agent, jobType, channel, opaque(routineId, true), runHash, opaque(approvalId, true), at, at).run();
    const row = await statement('SELECT * FROM wa_melodi_artifact_tracking WHERE job_id=?', jobId).first();
    if (row.owner !== owner || row.agent !== agent || row.job_type !== jobType || row.channel !== channel || row.routine_id !== (routineId ?? null)
      || row.run_key_hash !== runHash || row.approval_id !== (approvalId ?? null)) throw new Error('artifact_scope_conflict');
    return summary(row);
  }

  async function listReady({ owner, limit = 20, now: atValue }) {
    ownerScope(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('invalid_artifact_limit');
    return results(await statement(`SELECT t.* FROM wa_melodi_artifact_tracking t JOIN wa_owner_jobs j ON j.id=t.job_id
      AND j.owner_phone=t.owner AND j.job_type=t.job_type
      WHERE t.owner=? AND j.status='complete' AND (t.status='pending' OR (t.status='claiming' AND t.lease_until<=?))
      ORDER BY t.created_at,t.job_id LIMIT ?`, owner, clock(atValue), limit).all()).map(summary);
  }

  async function claim({ owner, jobId, leaseMs = 120000, now: atValue }) {
    ownerScope(owner); opaque(jobId);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 10 * 60000) throw new TypeError('invalid_artifact_lease');
    const at = clock(atValue), token = uuid();
    const result = await statement(`UPDATE wa_melodi_artifact_tracking SET status='claiming',lease_token=?,lease_until=?,updated_at=?
      WHERE job_id=? AND owner=? AND (status='pending' OR (status='claiming' AND lease_until<=?))
      AND EXISTS (SELECT 1 FROM wa_owner_jobs j WHERE j.id=wa_melodi_artifact_tracking.job_id AND j.owner_phone=wa_melodi_artifact_tracking.owner
        AND j.job_type=wa_melodi_artifact_tracking.job_type AND j.status='complete') RETURNING *`, token, at + leaseMs, at, jobId, owner, at).all();
    const row = results(result)[0];
    return row ? { ...summary(row), token, leaseToken: token } : null;
  }

  async function markEnqueued({ owner, jobId, token, outboxId, now: atValue }) {
    ownerScope(owner); opaque(jobId); opaque(outboxId);
    const at = clock(atValue);
    const result = await statement(`UPDATE wa_melodi_artifact_tracking SET status='enqueued',outbox_id=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE job_id=? AND owner=? AND status='claiming' AND lease_token=? AND lease_until>?
      AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox WHERE id=? AND owner=? AND agent=wa_melodi_artifact_tracking.agent)`,
    outboxId, at, jobId, owner, token, at, outboxId, owner).run();
    return Boolean(result.meta?.changes);
  }

  async function markDelivered({ owner, jobId, outboxId, now: atValue }) {
    ownerScope(owner); opaque(jobId); opaque(outboxId);
    const at = clock(atValue);
    const result = await statement(`UPDATE wa_melodi_artifact_tracking SET status='delivered',delivered_at=?,updated_at=?
      WHERE job_id=? AND owner=? AND status='enqueued' AND outbox_id=?
      AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox WHERE id=? AND owner=? AND agent=wa_melodi_artifact_tracking.agent AND status='sent')`,
    at, at, jobId, owner, outboxId, outboxId, owner).run();
    return Boolean(result.meta?.changes);
  }

  async function reconcileDelivered({ owner, now: atValue }) {
    ownerScope(owner);
    const at = clock(atValue);
    const result = await db.batch([statement(`UPDATE wa_melodi_artifact_tracking SET status='delivered',delivered_at=?,updated_at=?
      WHERE owner=? AND status='enqueued' AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox o
        WHERE o.id=wa_melodi_artifact_tracking.outbox_id AND o.owner=wa_melodi_artifact_tracking.owner
        AND o.agent=wa_melodi_artifact_tracking.agent AND o.status='sent')`, at, at, owner),
    statement(`UPDATE wa_melodi_artifact_tracking SET status='cancelled',error_code='delivery_cancelled',updated_at=?
      WHERE owner=? AND status='enqueued' AND EXISTS (SELECT 1 FROM wa_melodi_work_outbox o
        WHERE o.id=wa_melodi_artifact_tracking.outbox_id AND o.owner=wa_melodi_artifact_tracking.owner
        AND o.agent=wa_melodi_artifact_tracking.agent AND o.status='failed' AND o.error_code IN ('cancelled','routine_stopped'))`, at, owner)]);
    return { delivered: result[0].meta?.changes || 0, cancelled: result[1].meta?.changes || 0 };
  }

  async function cancel({ owner, jobId, reasonCode = 'artifact_cancelled', now: atValue }) {
    ownerScope(owner); opaque(jobId);
    if (typeof reasonCode !== 'string' || !/^[a-z0-9_:-]{1,64}$/i.test(reasonCode)) throw new TypeError('invalid_artifact_reason');
    const result = await statement(`UPDATE wa_melodi_artifact_tracking SET status='cancelled',lease_token=NULL,lease_until=NULL,error_code=?,updated_at=?
      WHERE job_id=? AND owner=? AND status IN ('pending','claiming')`, reasonCode, clock(atValue), jobId, owner).run();
    return Boolean(result.meta?.changes);
  }

  async function listPending({ owner, agent, limit = 50 }) {
    ownerScope(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (agent !== undefined && !AUTONOMOUS_AGENTS.includes(agent))) throw new TypeError('invalid_artifact_limit');
    return results(await statement(`SELECT * FROM wa_melodi_artifact_tracking WHERE owner=? AND status IN ('pending','claiming','enqueued')
      ${agent === undefined ? '' : 'AND agent=?'} ORDER BY created_at,job_id LIMIT ?`, owner, ...(agent === undefined ? [] : [agent]), limit).all()).map(summary);
  }

  async function discoverExisting({ owner, decrypt, limit = 40, now: atValue }) {
    ownerScope(owner);
    if (typeof decrypt !== 'function' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('invalid_artifact_discovery');
    const at = clock(atValue);
    const cursor = await statement('SELECT last_created_at,last_job_id FROM wa_melodi_artifact_discovery_cursor WHERE owner=?', owner).first();
    const jobs = results(await statement(`SELECT j.id,j.job_type,j.created_at,j.encrypted_payload,j.payload_iv FROM wa_owner_jobs j
      WHERE j.owner_phone=? AND j.status='complete' AND j.job_type IN ('generate_document','generate_story')
      AND NOT EXISTS (SELECT 1 FROM wa_melodi_artifact_tracking t WHERE t.job_id=j.id)
      AND (? IS NULL OR j.created_at>? OR (j.created_at=? AND j.id>?)) ORDER BY j.created_at,j.id LIMIT ?`,
    owner, cursor?.last_created_at ?? null, cursor?.last_created_at ?? null, cursor?.last_created_at ?? null, cursor?.last_job_id ?? null, limit).all());
    const result = { scanned: jobs.length, registered: 0, skipped: 0 };
    if (!jobs.length) {
      if (cursor) await statement('DELETE FROM wa_melodi_artifact_discovery_cursor WHERE owner=? AND last_created_at=? AND last_job_id=?', owner, cursor.last_created_at, cursor.last_job_id).run();
      return result;
    }
    for (const job of jobs) {
      try {
        let payload = await decrypt(job.encrypted_payload, job.payload_iv);
        if (typeof payload === 'string') payload = JSON.parse(payload);
        if (payload?.deliveryMode !== 'private' || !AUTONOMOUS_AGENTS.includes(payload.autonomyAgent)) { result.skipped += 1; continue; }
        await register({ owner, jobId: job.id, agent: payload.autonomyAgent, jobType: job.job_type,
          channel: payload.autonomyChannel || 'auto', routineId: payload.autonomyRoutineId || null,
          runKey: payload.autonomyRunKey || null, approvalId: payload.autonomyApprovalId || null, now: at });
        result.registered += 1;
      } catch { result.skipped += 1; }
    }
    const last = jobs.at(-1);
    await statement(`INSERT INTO wa_melodi_artifact_discovery_cursor(owner,last_created_at,last_job_id,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(owner) DO UPDATE SET last_created_at=excluded.last_created_at,last_job_id=excluded.last_job_id,updated_at=excluded.updated_at
      WHERE last_created_at<excluded.last_created_at OR (last_created_at=excluded.last_created_at AND last_job_id<excluded.last_job_id)`,
    owner, last.created_at, last.id, at).run();
    return result;
  }

  return Object.freeze({ ensureSchema, register, listReady, claim, markEnqueued, markDelivered, reconcileDelivered, cancel, listPending, discoverExisting });
}
