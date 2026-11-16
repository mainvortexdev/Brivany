export const RETRY_JOB_TYPES = Object.freeze(['generate_image', 'generate_story', 'edit_image', 'generate_document', 'send_email',
  'prepare_direct_email_attachment', 'prepare_scheduled_email_attachment', 'transcribe_audio']);
const AGENTS = ['melodi'];

export function ownerJobRetryPolicy(job) {
  if (!job || !RETRY_JOB_TYPES.includes(job.job_type)) return { allowed: false, reason: 'unsupported_job_type' };
  if (['complete', 'completed', 'sent'].includes(job.status)) return { allowed: false, reason: 'already_complete' };
  if (job.status === 'processing') return { allowed: false, pending: true, reason: 'already_processing' };
  if (job.status === 'pending') return { allowed: false, pending: true, reason: 'already_pending' };
  if (!['failed', 'waiting'].includes(job.status)) return { allowed: false, reason: 'job_not_retryable' };
  const error = String(job.error_code || '').toLowerCase();
  if (/(?:^|[^0-9])(?:400|401|402|403|404|422)(?:[^0-9]|$)|insufficient|credits|invalid|unsupported|rejected|forbidden|permission|not.?configured|missing.?key/.test(error)) {
    return { allowed: false, reason: 'permanent_failure' };
  }
  // Email timeouts can represent a provider accepting the email before the connection failed.
  if (job.job_type === 'send_email' && /timeout|timed_out|delivery_unknown|delivery_uncertain/.test(error)) return { allowed: false, reason: 'delivery_uncertain' };
  if (/delivery_unknown|delivery_uncertain/.test(error)) return { allowed: false, reason: 'delivery_uncertain' };
  if (job.status === 'waiting' && (!error || error.startsWith('retry_after:'))) return { allowed: true, reason: 'waiting_for_retry' };
  const transient = /(?:^|[^0-9])(?:408|425|429|5\d\d)(?:[^0-9]|$)|timeout|timed_out|temporar|unavailable|network|fetch_failed|lease_expired|recovered_stale|queue_dispatch|processing/.test(error);
  return { allowed: transient, reason: transient ? 'transient_failure' : 'failure_needs_review' };
}

function validate(owner, jobId, agent) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('invalid_retry_owner');
  if (jobId !== undefined && (typeof jobId !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(jobId))) throw new TypeError('invalid_retry_job');
  if (agent !== undefined && !AGENTS.includes(agent)) throw new TypeError('invalid_retry_agent');
}

function assignment(job, payload) {
  const stored = payload.autonomyAgent || payload.assignmentAgent || payload.agent;
  if (AGENTS.includes(stored)) return stored;
  return ['generate_document', 'send_email', 'prepare_direct_email_attachment', 'prepare_scheduled_email_attachment'].includes(job.job_type) ? 'melodi' : 'melodi';
}

function timestamp(value) {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(at) || at < 0) throw new TypeError('invalid_retry_clock');
  return Math.trunc(at);
}

async function keyDigest(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) throw new TypeError('explicit_retry_request_key_required');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** An authenticated owner retry resumes its original job; it never creates a new intent. */
export function createOwnerJobRetry(db, { encrypt, decrypt, queue, now = () => Date.now() } = {}) {
  if (!db?.prepare || typeof encrypt !== 'function' || typeof decrypt !== 'function' || typeof queue?.send !== 'function') throw new TypeError('owner_retry_dependencies_required');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const unpack = async job => {
    let payload = await decrypt(job.encrypted_payload, job.payload_iv);
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('retry_payload_unavailable');
    return payload;
  };
  const publicJob = (job, payload) => ({ jobId: job.id, type: job.job_type, status: job.status, agent: assignment(job, payload), createdAt: job.created_at,
    retryable: ownerJobRetryPolicy(job).allowed, reason: ownerJobRetryPolicy(job).reason });

  async function select({ owner, jobId, agent, latest = false, recentIds, statuses = ['failed'] }) {
    validate(owner, jobId, agent);
    if (!Array.isArray(statuses) || !statuses.length || statuses.some(status => !['failed', 'waiting', 'pending', 'processing', 'complete', 'rejected'].includes(status))) throw new TypeError('invalid_retry_statuses');
    if (recentIds !== undefined && !Array.isArray(recentIds)) throw new TypeError('invalid_retry_context');
    const jobs = jobId ? [await statement('SELECT * FROM wa_owner_jobs WHERE id=? AND owner_phone=?', jobId, owner).first()].filter(Boolean)
      : (await statement(`SELECT * FROM wa_owner_jobs WHERE owner_phone=? AND status IN (${statuses.map(() => '?').join(',')})
        ORDER BY created_at DESC,id DESC LIMIT 100`, owner, ...statuses).all()).results || [];
    const candidates = [];
    for (const job of jobs) {
      if (!RETRY_JOB_TYPES.includes(job.job_type)) continue;
      try {
        const payload = await unpack(job);
        if (!agent || assignment(job, payload) === agent) candidates.push(publicJob(job, payload));
      } catch { /* Corrupt ciphertext cannot be routed as a different task. */ }
    }
    for (const id of recentIds || []) {
      const contextual = candidates.find(candidate => candidate.jobId === id);
      if (contextual) return { status: 'selected', jobId: contextual.jobId, job: contextual, candidates };
    }
    if (!candidates.length) return { status: 'missing', reason: 'no_matching_job', candidates: [] };
    if (candidates.length > 1 && !latest && !jobId) return { status: 'ambiguous', reason: 'multiple_matching_jobs', candidates };
    return { status: 'selected', jobId: candidates[0].jobId, job: candidates[0], candidates };
  }

  async function retry({ owner, jobId, agent, requestKey, explicit = false, latest = false, recentIds }) {
    validate(owner, jobId, agent);
    if (explicit !== true) return { status: 'blocked', reason: 'explicit_owner_retry_required' };
    const requestDigest = await keyDigest(requestKey);
    const selected = await select({ owner, jobId, agent, latest, recentIds });
    if (selected.status !== 'selected') return selected;
    const job = await statement('SELECT * FROM wa_owner_jobs WHERE id=? AND owner_phone=?', selected.jobId, owner).first();
    if (!job) return { status: 'missing', reason: 'no_matching_job' };
    let payload;
    try { payload = await unpack(job); }
    catch { return { status: 'blocked', jobId: job.id, reason: 'retry_payload_unavailable' }; }
    const receipts = Array.isArray(payload.ownerRetryRequestKeys) ? payload.ownerRetryRequestKeys : [];
    if (receipts.includes(requestDigest)) return { status: 'pending', jobId: job.id, reason: 'request_already_applied' };
    const policy = ownerJobRetryPolicy(job);
    if (!policy.allowed) return { status: policy.pending ? 'pending' : 'blocked', jobId: job.id, reason: policy.reason };
    const at = timestamp(now());
    const retryAt = String(job.error_code || '').startsWith('retry_after:') ? Date.parse(job.error_code.slice(12)) : 0;
    if (Number.isFinite(retryAt) && retryAt > at) return { status: 'pending', jobId: job.id, reason: 'retry_scheduled', retryAt: new Date(retryAt).toISOString() };
    // Keep every explicit request receipt. A replay never spends another retry.
    const restored = { ...payload, ownerRetryRequestKeys: [...receipts, requestDigest], ownerRetryCount: Number(payload.ownerRetryCount || 0) + 1,
      ownerRetryRequestedAt: new Date(at).toISOString() };
    const sealed = await encrypt(restored);
    if (typeof sealed?.encrypted !== 'string' || !sealed.encrypted || typeof sealed?.iv !== 'string' || !sealed.iv) throw new Error('retry_encryption_failed');
    const claim = await statement(`UPDATE wa_owner_jobs SET status='pending',error_code=NULL,encrypted_payload=?,payload_iv=?
      WHERE id=? AND owner_phone=? AND status=? AND encrypted_payload=? AND payload_iv=?`,
    sealed.encrypted, sealed.iv, job.id, owner, job.status, job.encrypted_payload, job.payload_iv).run();
    if (!claim.meta?.changes) return { status: 'pending', jobId: job.id, reason: 'already_reclaimed' };
    try {
      await queue.send({ jobId: job.id });
      return { status: 'queued', jobId: job.id, type: job.job_type, agent: assignment(job, payload) };
    } catch {
      // A duplicate queue envelope is harmless because processOwnerJob claims its status.
      // Leave this original job waiting for its recovery path instead of creating a reminder.
      await statement(`UPDATE wa_owner_jobs SET status='waiting',error_code='queue_dispatch_failed'
        WHERE id=? AND owner_phone=? AND status='pending' AND encrypted_payload=? AND payload_iv=?`, job.id, owner, sealed.encrypted, sealed.iv).run();
      return { status: 'pending', jobId: job.id, type: job.job_type, reason: 'queue_dispatch_failed' };
    }
  }

  return Object.freeze({ select, retry });
}
