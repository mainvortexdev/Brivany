import { autonomousArtifactJobId } from './melodi-artifact-tracking.js';
import { publicInstagramResearchUrl } from './owner-research-request.js';

/** A configured owner-authorized request resumes once after the real media connection is enabled. */
export async function resumeRequestedMedia({ db, owner, eventId, decrypt, now = Date.now() }) {
  const at = typeof now === 'string' ? Date.parse(now) : Number(now);
  if (!owner || !/^[A-Za-z0-9_-]{1,160}$/.test(eventId || '') || !Number.isFinite(at)) return null;
  const row = await db.prepare(`SELECT * FROM wa_melodi_work_events WHERE owner=? AND id=? AND type='owner_research_report'
    AND status='done' AND error_code IN ('requested_research_source_unavailable','requested_research_formats_not_verified')
    AND lease_token IS NULL`).bind(owner, eventId).first();
  if (!row) return null;
  let payload;
  try { payload = await decrypt(row.payload_encrypted, row.payload_iv); if (typeof payload === 'string') payload = JSON.parse(payload); }
  catch { return null; }
  const request = payload?.request;
  if (!request || request.agent !== row.agent || request.origin !== 'owner_request' || request.recipient !== 'owner'
    || request.channel !== 'email' || !publicInstagramResearchUrl(request.sourceUrl) || payload.approvedMedia || payload.mediaOperation) return null;
  const jobId = await autonomousArtifactJobId(owner, 'generate_document', `requested-research:${eventId}:document`);
  const result = await db.batch([
    db.prepare(`UPDATE wa_melodi_work_events SET status='pending',attempts=0,error_code=NULL,receipt_token=NULL,available_at=?,updated_at=?
      WHERE owner=? AND id=? AND agent=? AND payload_encrypted=? AND status='done' AND lease_token IS NULL
        AND error_code IN ('requested_research_source_unavailable','requested_research_formats_not_verified')
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit WHERE owner=? AND event_id=? AND action='media_activation_resume')
        AND NOT EXISTS (SELECT 1 FROM wa_owner_jobs WHERE owner_phone=? AND id=?)
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_artifact_tracking WHERE owner=? AND job_id=?)
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_permission_requests WHERE owner_phone=? AND parent_event_id=?)
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_outbox WHERE owner=? AND event_id=? AND status<>'sent')
      RETURNING id,agent`).bind(at, at, owner, eventId, row.agent, row.payload_encrypted,
        owner, eventId, owner, jobId, owner, jobId, owner, eventId, owner, eventId),
    db.prepare(`INSERT INTO wa_melodi_work_audit(id,owner,agent,event_id,action,outcome,created_at)
      SELECT ?,owner,agent,id,'media_activation_resume','pending',? FROM wa_melodi_work_events
      WHERE owner=? AND id=? AND status='pending' AND attempts=0 AND updated_at=? AND changes()>0
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_work_audit WHERE owner=? AND event_id=? AND action='media_activation_resume')`)
      .bind(crypto.randomUUID(), at, owner, eventId, at, owner, eventId),
  ]);
  return result[0]?.results?.[0] || null;
}
