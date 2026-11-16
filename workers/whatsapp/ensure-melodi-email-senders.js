import { AGENT_EMAIL_SENDERS, agentEmailIdentity, agentForEmail } from './melodi-email-identity.js';
import { EMAIL_SENDER_STATUS_SCHEMA, refreshEmailSenders, readEmailSenderStatus } from './email-sender-status.js';

export const AGENT_EMAIL_SETUP_VERSION = '2026-10-08.2';
const HOUR_MS = 3600000;
const MAX_ATTEMPTS = 3;
const auditId = `agentsetup:${AGENT_EMAIL_SETUP_VERSION}`;
const attemptOf = status => Number(String(status).match(/^(?:pending|running|retry):(\d+)/)?.[1] || 0);
const terminal = status => /^(?:complete|blocked|failed)(?::|$)/.test(status);

/** Registers only the five owned aliases, once, after a fresh authenticated-domain preflight. */
export async function ensureAgentEmailSenders(env, { now = Date.now(), fetchImpl = fetch, uuid = () => crypto.randomUUID() } = {}) {
  if (env.TEAM_AGENT_EMAIL_SETUP !== AGENT_EMAIL_SETUP_VERSION) return { status: 'disabled' };
  const db = env.VETSA_CLOUD;
  const at = typeof now === 'string' ? Date.parse(now) : now instanceof Date ? now.getTime() : Number(now);
  if (!db?.prepare || !db?.batch || !Number.isFinite(at) || !env.BREVO_API_KEY) return { status: 'unavailable' };
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  await db.batch(EMAIL_SENDER_STATUS_SCHEMA.map(sql => db.prepare(sql)));
  await query("INSERT OR IGNORE INTO wa_email_sender_audit VALUES (?,0,0,'pending:0')", auditId).run();
  const existing = await query('SELECT * FROM wa_email_sender_audit WHERE id=?', auditId).first();
  if (terminal(existing.status) || existing.next_refresh_at > at) return {
    status: existing.status === 'complete' ? 'complete' : terminal(existing.status) ? existing.status.split(':', 1)[0] : 'deferred',
    state: existing.status, senders: await readEmailSenderStatus(env),
  };
  const attempt = attemptOf(existing.status) + 1;
  if (attempt > MAX_ATTEMPTS) {
    await query("UPDATE wa_email_sender_audit SET status='failed:retry_limit',checked_at=? WHERE id=? AND status=?", at, auditId, existing.status).run();
    return { status: 'failed', reason: 'retry_limit' };
  }
  const lease = `running:${attempt}:${uuid()}`;
  const claimed = await query(`UPDATE wa_email_sender_audit SET status=?,checked_at=?,next_refresh_at=?
    WHERE id=? AND status=? AND next_refresh_at<=? RETURNING id`, lease, at, at + HOUR_MS, auditId, existing.status, at).first();
  if (!claimed) return { status: 'deferred' };
  const finish = async (status, reason, senders = [], created = []) => {
    const state = status === 'complete' ? 'complete' : status === 'blocked' ? `blocked:${reason}`
      : attempt >= MAX_ATTEMPTS ? `failed:${reason}` : `retry:${attempt}:${reason}`;
    await query('UPDATE wa_email_sender_audit SET status=?,checked_at=?,next_refresh_at=? WHERE id=? AND status=?',
      state, at, at + HOUR_MS, auditId, lease).run();
    return { status: state.startsWith('failed:') ? 'failed' : status, ...(reason ? { reason } : {}), version: AGENT_EMAIL_SETUP_VERSION, created, senders };
  };
  const created = [];
  try {
    const preflight = await refreshEmailSenders(env, { now: at, force: true, fetchImpl });
    const rows = AGENT_EMAIL_SENDERS.map(email => preflight.senders?.find(row => row.email === email));
    if (rows.some(row => !row || row.registered === null || row.domainVerified === null || row.domainAuthenticated === null))
      return finish('retry', 'preflight_unavailable', preflight.senders || []);
    if (rows.some(row => row.domainVerified !== true || row.domainAuthenticated !== true))
      return finish('blocked', 'domain_not_authenticated', preflight.senders);
    if (rows.every(row => row.registered && row.providerActive === true)) return finish('complete', null, preflight.senders);
    let problem = null;
    for (const row of rows.filter(row => row.registered === false)) {
      // Per-alias receipts survive a lost setup acknowledgement or an ambiguous POST.
      const senderId = `${auditId}:${row.email}`;
      const receipt = await query('SELECT status FROM wa_email_sender_audit WHERE id=?', senderId).first();
      if (receipt && /^(?:creating|created|unconfirmed):/.test(receipt.status)) { problem ||= 'awaiting_provider_confirmation'; continue; }
      await query(`INSERT INTO wa_email_sender_audit VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        checked_at=excluded.checked_at,next_refresh_at=excluded.next_refresh_at,status=excluded.status`, senderId, at, at + HOUR_MS, `creating:${lease}`).run();
      let response;
      try {
        response = await fetchImpl('https://api.brevo.com/v3/senders', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': env.BREVO_API_KEY },
          body: JSON.stringify({ name: agentEmailIdentity(agentForEmail(row.email)).senderName, email: row.email }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        await query('UPDATE wa_email_sender_audit SET status=? WHERE id=?', 'unconfirmed:transport', senderId).run();
        problem = 'awaiting_provider_confirmation'; break;
      }
      if (response.status !== 201) {
        await response.body?.cancel();
        const retryable = response.status === 429 || response.status >= 500;
        await query('UPDATE wa_email_sender_audit SET status=? WHERE id=?', `${retryable ? 'retryable' : 'rejected'}:${response.status}`, senderId).run();
        problem = retryable ? 'provider_rejected_transient' : 'provider_rejected'; break;
      }
      const length = Number(response.headers.get('content-length') || 0);
      const result = length > 16000 ? (await response.body?.cancel(), null) : await response.json().catch(() => null);
      if (!Number.isSafeInteger(result?.id) || result.id <= 0) {
        await query('UPDATE wa_email_sender_audit SET status=? WHERE id=?', 'unconfirmed:invalid_receipt', senderId).run();
        problem = 'awaiting_provider_confirmation'; break;
      }
      await query('UPDATE wa_email_sender_audit SET status=? WHERE id=?', `created:${result.id}`, senderId).run();
      created.push({ email: row.email, id: result.id });
    }
    // POST acceptance alone cannot authorize a sender: prove registration and active status through GET.
    const verified = await refreshEmailSenders(env, { now: at, force: true, fetchImpl });
    const active = AGENT_EMAIL_SENDERS.every(email => verified.senders?.some(row => row.email === email && row.registered === true && row.providerActive === true));
    if (active) return finish('complete', null, verified.senders, created);
    return finish(problem === 'provider_rejected' ? 'blocked' : 'retry', problem || 'awaiting_provider_confirmation', verified.senders || [], created);
  } catch {
    return finish('retry', 'setup_unavailable', [], created);
  }
}
