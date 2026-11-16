-- Delivery text is encrypted. Ambiguous sends never retry automatically.
CREATE TABLE IF NOT EXISTS wa_melodi_delivery_notices (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, notice_key TEXT NOT NULL, agent TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL, owner_requested INTEGER NOT NULL DEFAULT 0,
    artifact_job_id TEXT, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','leased','sent','uncertain','window_closed')),
    available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner,notice_key));
CREATE INDEX IF NOT EXISTS wa_melodi_delivery_notices_due ON wa_melodi_delivery_notices(owner,status,available_at);
