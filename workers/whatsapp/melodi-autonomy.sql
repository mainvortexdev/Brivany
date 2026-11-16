-- Private per-owner agent state, encrypted events and a deduplicated outbox.
CREATE TABLE IF NOT EXISTS wa_melodi_work_state (
    owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    daily_run_limit INTEGER NOT NULL DEFAULT 8 CHECK(daily_run_limit >= 0),
    daily_message_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_message_limit >= 0),
    cooldown_ms INTEGER NOT NULL DEFAULT 2700000 CHECK(cooldown_ms >= 0),
    budget_day TEXT NOT NULL, runs_today INTEGER NOT NULL DEFAULT 0, messages_today INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT, lease_until INTEGER, outbox_lease_token TEXT, outbox_lease_until INTEGER,
    cooldown_until INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER, last_message_at INTEGER,
    checkpoint_encrypted TEXT, checkpoint_iv TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner,agent));

CREATE TABLE IF NOT EXISTS wa_melodi_work_events (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_key TEXT NOT NULL, type TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed','waiting')),
    priority INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
    lease_token TEXT, lease_until INTEGER, receipt_token TEXT, error_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,agent,event_key), FOREIGN KEY(owner,agent) REFERENCES wa_melodi_work_state(owner,agent));

CREATE INDEX IF NOT EXISTS wa_melodi_work_events_due ON wa_melodi_work_events(owner,agent,status,available_at,priority);

CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_work_one_processing ON wa_melodi_work_events(owner,agent) WHERE status='processing';

CREATE TABLE IF NOT EXISTS wa_melodi_work_outbox (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, message_key TEXT NOT NULL, event_id TEXT,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
    available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
    receipt_token TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,agent,message_key), FOREIGN KEY(owner,agent) REFERENCES wa_melodi_work_state(owner,agent));

CREATE INDEX IF NOT EXISTS wa_melodi_work_outbox_due ON wa_melodi_work_outbox(status,available_at);

CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_work_one_sending ON wa_melodi_work_outbox(owner,agent) WHERE status='sending';

CREATE TABLE IF NOT EXISTS wa_melodi_work_audit (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_id TEXT, outbox_id TEXT,
    action TEXT NOT NULL, outcome TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS wa_melodi_work_audit_owner ON wa_melodi_work_audit(owner,agent,created_at);
