-- Bounded recovery for private autonomous artifact jobs.
CREATE TABLE IF NOT EXISTS wa_melodi_work_recovery_budget (
    owner TEXT PRIMARY KEY, window_start INTEGER NOT NULL, reserved_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS wa_melodi_work_job_recovery (
    owner TEXT NOT NULL, job_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','dispatching','dispatched','dispatch_failed')),
    lease_token TEXT, lease_until INTEGER, last_attempt_at INTEGER, last_dispatch_at INTEGER,
    error_code TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(owner,job_id));

CREATE INDEX IF NOT EXISTS wa_melodi_work_job_recovery_owner ON wa_melodi_work_job_recovery(owner,lease_until);

CREATE TABLE IF NOT EXISTS wa_melodi_work_recovery_scan (
    owner TEXT PRIMARY KEY, last_created_at TEXT NOT NULL, last_job_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
