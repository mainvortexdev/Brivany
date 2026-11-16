import { AUTONOMOUS_AGENTS } from './melodi-autonomy-store.js';

export const MAINTENANCE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_recovery_budget (
    owner TEXT PRIMARY KEY, window_start INTEGER NOT NULL, reserved_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_job_recovery (
    owner TEXT NOT NULL, job_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','dispatching','dispatched','dispatch_failed')),
    lease_token TEXT, lease_until INTEGER, last_attempt_at INTEGER, last_dispatch_at INTEGER,
    error_code TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(owner,job_id))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_work_job_recovery_owner ON wa_melodi_work_job_recovery(owner,lease_until)`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_work_recovery_scan (
    owner TEXT PRIMARY KEY, last_created_at TEXT NOT NULL, last_job_id TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
]);

function milliseconds(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(time) || time < 0) throw new TypeError('Invalid maintenance clock');
  return Math.trunc(time);
}

function ownerId(owner) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('Invalid maintenance owner');
}

const rows = result => result?.results || [];

/** Recovery is limited to private autonomous artifacts; ordinary owner jobs are untouched. */
export function createAutonomyMaintenance(db, { encrypt, decrypt, queue, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch || typeof encrypt !== 'function' || typeof decrypt !== 'function' || typeof queue?.send !== 'function') {
    throw new TypeError('Maintenance requires D1, encryption hooks and the jobs queue');
  }
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const clock = value => milliseconds(value ?? now());

  async function ensureSchema() {
    await db.batch(MAINTENANCE_SCHEMA.map(sql => db.prepare(sql)));
  }

  async function pruneExpiredEvents({ owner, now: atValue, retentionMs = 86400000 }) {
    ownerId(owner);
    if (!Number.isInteger(retentionMs) || retentionMs < 86400000 || retentionMs > 30 * 86400000) throw new TypeError('Invalid event retention');
    const at = clock(atValue), token = uuid();
    const batch = await db.batch([
      statement(`UPDATE wa_melodi_work_events SET status='done',error_code='event_expired',receipt_token=?,updated_at=?
        WHERE owner=? AND status='pending' AND type IN ('background_review','daily_review') AND created_at<? RETURNING id`, token, at, owner, at - retentionMs),
      statement(`INSERT INTO wa_melodi_work_audit (id,owner,agent,event_id,action,outcome,error_code,created_at)
        SELECT lower(hex(randomblob(16))),owner,agent,id,'event_expire','done','event_expired',?
        FROM wa_melodi_work_events WHERE owner=? AND receipt_token=?`, at, owner, token),
    ]);
    return { expired: rows(batch[0]).length };
  }

  async function inspectRecovery({ owner, jobId }) {
    ownerId(owner);
    return statement(`SELECT job_id,attempts,status,lease_until,last_attempt_at,last_dispatch_at,error_code,updated_at
      FROM wa_melodi_work_job_recovery WHERE owner=? AND job_id=?`, owner, jobId).first();
  }

  async function recoverPrivateJobs({ owner, now: atValue, limit = 2 }) {
    ownerId(owner);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw new TypeError('Recovery limit must be 1 or 2');
    const at = clock(atValue), minute = Math.floor(at / 60000) * 60000;
    const beforePending = new Date(at - 2 * 60000).toISOString();
    const beforeProcessing = new Date(at - 12 * 60000).toISOString();
    const cursor = await statement('SELECT last_created_at,last_job_id FROM wa_melodi_work_recovery_scan WHERE owner=?', owner).first();
    const scan = async position => rows(await statement(`SELECT j.id,j.job_type,j.status,j.created_at,j.error_code,j.encrypted_payload,j.payload_iv,
        r.attempts AS recovery_attempts,r.lease_until AS recovery_lease_until,r.last_attempt_at AS recovery_last_attempt
      FROM wa_owner_jobs j LEFT JOIN wa_melodi_work_job_recovery r ON j.owner_phone=r.owner AND j.id=r.job_id
      WHERE j.owner_phone=? AND j.job_type IN ('generate_document','generate_story')
        AND ((j.status IN ('pending','waiting') AND j.created_at<=?) OR (j.status='processing' AND j.created_at<=?))
        AND (r.lease_until IS NULL OR r.lease_until<=?) AND (r.attempts IS NULL OR r.attempts<2)
        AND (? IS NULL OR j.created_at>? OR (j.created_at=? AND j.id>?))
      ORDER BY j.created_at,j.id LIMIT 40`, owner, beforePending, beforeProcessing, at,
    position?.last_created_at ?? null, position?.last_created_at ?? null, position?.last_created_at ?? null, position?.last_job_id ?? null).all());
    let candidates = await scan(cursor);
    if (!candidates.length && cursor) {
      await statement('DELETE FROM wa_melodi_work_recovery_scan WHERE owner=? AND last_created_at=? AND last_job_id=?', owner, cursor.last_created_at, cursor.last_job_id).run();
      candidates = await scan(null);
    }
    const summary = { scanned: candidates.length, recovered: 0, skipped: 0, deferred: 0, failed: 0, exhausted: 0 };
    if (!candidates.length) {
      return summary;
    }
    await statement(`INSERT OR IGNORE INTO wa_melodi_work_recovery_budget (owner,window_start,reserved_count,updated_at) VALUES (?,?,0,?)`, owner, minute, at).run();

    for (const job of candidates) {
      if (summary.recovered + summary.failed >= limit) break;
      const budget = await statement('SELECT window_start,reserved_count FROM wa_melodi_work_recovery_budget WHERE owner=?', owner).first();
      if (budget.window_start === minute && budget.reserved_count >= 2) break;
      await statement(`INSERT INTO wa_melodi_work_recovery_scan(owner,last_created_at,last_job_id,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(owner) DO UPDATE SET last_created_at=excluded.last_created_at,last_job_id=excluded.last_job_id,updated_at=excluded.updated_at
        WHERE last_created_at<excluded.last_created_at OR (last_created_at=excluded.last_created_at AND last_job_id<excluded.last_job_id)`,
      owner, job.created_at, job.id, at).run();
      // Stale created_at alone cannot reclaim a job recently dispatched by this maintainer.
      const age = job.status === 'processing' ? 12 * 60000 : 2 * 60000;
      if (job.recovery_last_attempt && job.recovery_last_attempt > at - age) { summary.deferred += 1; continue; }
      const retryDeadline = typeof job.error_code === 'string' && job.error_code.startsWith('retry_after:') ? Date.parse(job.error_code.slice(12)) : 0;
      if (Number.isFinite(retryDeadline) && retryDeadline > at) { summary.deferred += 1; continue; }

      let payload;
      try {
        payload = await decrypt(job.encrypted_payload, job.payload_iv);
        if (typeof payload === 'string') payload = JSON.parse(payload);
      } catch { summary.skipped += 1; continue; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.deliveryMode !== 'private' || !AUTONOMOUS_AGENTS.includes(payload.autonomyAgent)) {
        summary.skipped += 1;
        continue;
      }
      const startedAt = Date.parse(payload.autonomyStartedAt || '');
      if (job.status === 'processing' && Number.isFinite(startedAt) && startedAt > at - 12 * 60000) {
        summary.deferred += 1;
        continue;
      }
      const previous = Number(payload.autonomyRetries || 0);
      if (!Number.isInteger(previous) || previous < 0 || previous >= 2) { summary.exhausted += 1; continue; }
      const attempts = Math.max(previous, Number(job.recovery_attempts || 0)) + 1;
      if (attempts > 2) { summary.exhausted += 1; continue; }
      const recoveredPayload = { ...payload, autonomyRetries: attempts, autonomyRecoveryAt: new Date(at).toISOString() };
      const sealed = await encrypt(recoveredPayload);
      if (!sealed?.encrypted || !sealed?.iv || typeof sealed.encrypted !== 'string' || typeof sealed.iv !== 'string') throw new Error('Maintenance encryption failed');
      const token = uuid();
      await statement(`INSERT OR IGNORE INTO wa_melodi_work_job_recovery(owner,job_id,updated_at) VALUES (?,?,?)`, owner, job.id, at).run();
      const claim = await db.batch([
        statement(`UPDATE wa_melodi_work_job_recovery SET attempts=?,status='dispatching',lease_token=?,lease_until=?,last_attempt_at=?,error_code=NULL,updated_at=?
          WHERE owner=? AND job_id=? AND attempts<2 AND (lease_until IS NULL OR lease_until<=?)
          AND (last_attempt_at IS NULL OR last_attempt_at<=?)
          AND EXISTS (SELECT 1 FROM wa_melodi_work_recovery_budget WHERE owner=? AND (window_start<>? OR reserved_count<2))
          AND EXISTS (SELECT 1 FROM wa_owner_jobs WHERE id=? AND owner_phone=? AND status=? AND encrypted_payload=? AND payload_iv=?)`,
        attempts, token, at + 2 * 60000, at, at, owner, job.id, at, at - age, owner, minute,
        job.id, owner, job.status, job.encrypted_payload, job.payload_iv),
        statement(`UPDATE wa_owner_jobs SET status='waiting',encrypted_payload=?,payload_iv=?,error_code='autonomy_recovery_queued'
          WHERE id=? AND owner_phone=? AND status=? AND encrypted_payload=? AND payload_iv=?
          AND EXISTS (SELECT 1 FROM wa_melodi_work_job_recovery WHERE owner=? AND job_id=? AND lease_token=?) RETURNING id`,
        sealed.encrypted, sealed.iv, job.id, owner, job.status, job.encrypted_payload, job.payload_iv, owner, job.id, token),
        statement(`UPDATE wa_melodi_work_recovery_budget SET reserved_count=CASE WHEN window_start=? THEN reserved_count+1 ELSE 1 END,
          window_start=?,updated_at=? WHERE owner=?
          AND EXISTS (SELECT 1 FROM wa_melodi_work_job_recovery WHERE owner=? AND job_id=? AND lease_token=?)`, minute, minute, at, owner, owner, job.id, token),
      ]);
      if (!rows(claim[1])[0]) { summary.deferred += 1; continue; }
      try {
        await queue.send({ jobId: job.id });
        await statement(`UPDATE wa_melodi_work_job_recovery SET status='dispatched',lease_token=NULL,last_dispatch_at=?,updated_at=?
          WHERE owner=? AND job_id=? AND lease_token=?`, at, at, owner, job.id, token).run();
        summary.recovered += 1;
      } catch {
        // Sending can be ambiguous. Consume the reservation and wait before a bounded retry;
        // the owner job processor's persistent status claim makes duplicate queue envelopes harmless.
        await statement(`UPDATE wa_melodi_work_job_recovery SET status='dispatch_failed',lease_token=NULL,error_code='queue_dispatch_failed',updated_at=?
          WHERE owner=? AND job_id=? AND lease_token=?`, at, owner, job.id, token).run();
        summary.failed += 1;
      }
    }
    return summary;
  }

  return Object.freeze({ ensureSchema, pruneExpiredEvents, recoverPrivateJobs, inspectRecovery });
}
