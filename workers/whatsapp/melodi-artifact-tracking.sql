-- Durable private artifact delivery receipts independent of job age.
CREATE TABLE IF NOT EXISTS wa_melodi_artifact_tracking (
    job_id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    job_type TEXT NOT NULL CHECK(job_type IN ('generate_document','generate_story')),
    channel TEXT NOT NULL DEFAULT 'auto' CHECK(channel IN ('auto','email','whatsapp')),
    routine_id TEXT, run_key_hash TEXT, approval_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claiming','enqueued','delivered','cancelled')),
    lease_token TEXT, lease_until INTEGER, outbox_id TEXT, error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, delivered_at INTEGER);

CREATE INDEX IF NOT EXISTS wa_melodi_artifact_pending ON wa_melodi_artifact_tracking(owner,status,created_at);

CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_artifact_outbox ON wa_melodi_artifact_tracking(outbox_id) WHERE outbox_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_melodi_artifact_discovery_cursor (
    owner TEXT PRIMARY KEY, last_created_at TEXT NOT NULL, last_job_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
