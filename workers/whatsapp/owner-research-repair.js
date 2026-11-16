import { explicitlyChosenAgent } from './melodi-team-commands.js';
import { parseOwnerResearchRequest } from './owner-research-request.js';
import { autonomousArtifactJobId } from './melodi-artifact-tracking.js';

// Repair only recent, unexecuted owner requests whose encrypted original words
// explicitly chose another agent. Keep the same event and idempotency key.
export async function repairOwnerResearchAssignments({ db, owner, ownerEmail, encrypt, decrypt, now = Date.now() }) {
  const at = typeof now === 'string' ? Date.parse(now) : Number(now);
  if (!owner || !Number.isFinite(at)) throw new TypeError('research_repair_invalid_scope');
  const rows = (await db.prepare(`SELECT e.* FROM wa_melodi_work_events e
    WHERE e.owner=? AND e.type='owner_research_report' AND e.priority>=20
      AND (e.status='pending' OR (e.status='failed' AND e.error_code='agent_run_failed'))
      AND e.lease_token IS NULL AND e.created_at>=?
      AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit a WHERE a.event_id=e.id AND a.action='assignment_repaired')
      AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit a WHERE a.event_id=e.id AND a.action='assignment_checked_v3')
    ORDER BY e.created_at DESC LIMIT 10`).bind(owner, at - 86400000).all()).results || [];
  const repaired = [];
  for (const row of rows) {
    // Requests are immutable. Mark checked snapshots so correct or blocked
    // newer requests cannot indefinitely hide an older misrouted one.
    const checked = outcome => db.prepare(`INSERT INTO wa_melodi_work_audit (id,owner,agent,event_id,action,outcome,created_at)
      SELECT ?,owner,agent,id,'assignment_checked_v3',?,? FROM wa_melodi_work_events
      WHERE id=? AND owner=? AND agent=? AND payload_encrypted=? AND lease_token IS NULL
        AND status IN ('pending','failed')
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit WHERE event_id=? AND action='assignment_checked_v3')`)
      .bind(crypto.randomUUID(), outcome, at, row.id, owner, row.agent, row.payload_encrypted, row.id).run();
    let payload;
    try {
      payload = await decrypt(row.payload_encrypted, row.payload_iv);
      if (typeof payload === 'string') payload = JSON.parse(payload);
    } catch { await checked('unreadable'); continue; }
    const request = payload?.request;
    if (request?.origin !== 'owner_request' || request.agent !== row.agent || payload.approvedResearch) { await checked('unsupported'); continue; }
    const chosen = explicitlyChosenAgent(request.brief);
    if (!chosen || chosen === row.agent) { await checked('unchanged'); continue; }
    const parsed = parseOwnerResearchRequest(request.brief, { agent: chosen, ownerEmail });
    if (!parsed || parsed.agent !== chosen || parsed.sourceUrl !== request.sourceUrl
      || parsed.scope !== request.scope || parsed.channel !== request.channel || request.recipient !== 'owner') { await checked('unsupported'); continue; }
    const jobId = await autonomousArtifactJobId(owner, 'generate_document', `requested-research:${row.id}:document`);
    const sealed = await encrypt(JSON.stringify({ ...payload, request: { ...request, agent: chosen } }));
    const result = await db.batch([
      db.prepare(`UPDATE wa_melodi_work_events SET agent=?,payload_encrypted=?,payload_iv=?,
        status='pending',attempts=0,available_at=?,error_code=NULL,receipt_token=NULL,updated_at=?
        WHERE id=? AND owner=? AND agent=? AND payload_encrypted=? AND lease_token IS NULL
          AND (status='pending' OR (status='failed' AND error_code='agent_run_failed'))
          AND EXISTS (SELECT 1 FROM wa_melodi_work_state WHERE owner=? AND agent=?)
          AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_events WHERE owner=? AND agent=? AND event_key=? AND id<>?)
          AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_outbox WHERE owner=? AND event_id=?)
          AND NOT EXISTS (SELECT 1 FROM wa_melodi_permission_requests WHERE owner_phone=? AND parent_event_id=?)
          AND NOT EXISTS (SELECT 1 FROM wa_owner_jobs WHERE owner_phone=? AND id=?)
          AND NOT EXISTS (SELECT 1 FROM wa_melodi_artifact_tracking WHERE owner=? AND job_id=?)
        RETURNING id,agent`).bind(chosen, sealed.encrypted, sealed.iv, at, at,
        row.id, owner, row.agent, row.payload_encrypted, owner, chosen, owner, chosen, row.event_key, row.id,
        owner, row.id, owner, row.id, owner, jobId, owner, jobId),
      db.prepare(`INSERT INTO wa_melodi_work_audit (id,owner,agent,event_id,action,outcome,error_code,created_at)
        SELECT ?,owner,agent,id,'assignment_repaired','reassigned',?,? FROM wa_melodi_work_events
        WHERE id=? AND owner=? AND agent=? AND payload_encrypted=? AND updated_at=?
          AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit WHERE event_id=? AND action='assignment_repaired')`)
        .bind(crypto.randomUUID(), `previous_agent_${row.agent}`, at, row.id, owner, chosen, sealed.encrypted, at, row.id),
    ]);
    if (result[0]?.results?.length) repaired.push({ id: row.id, agent: chosen, previousAgent: row.agent });
    else await checked('blocked');
  }
  return repaired;
}

export function requestedResearchErrorCode(error) {
  const message = String(error?.message || '');
  if (/^requested_research_[a-z_]{1,40}$/.test(message)) return message;
  const status = message.match(/^Vetsa Intelligence returned (\d{3})$/)?.[1];
  if (status) return `requested_research_model_http_${status}`;
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'requested_research_timeout';
  return 'requested_research_run_failed';
}
