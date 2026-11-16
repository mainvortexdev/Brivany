CREATE TABLE IF NOT EXISTS google_calendar_connections (owner TEXT PRIMARY KEY, state_encrypted TEXT NOT NULL, state_iv TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', lease_token TEXT, lease_until INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS google_calendar_oauth (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, state_encrypted TEXT NOT NULL, state_iv TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE IF NOT EXISTS melodi_google_calendar_activity_map (owner TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, agent TEXT NOT NULL, google_event_id TEXT NOT NULL, google_etag TEXT, local_hash TEXT, remote_hash TEXT, source_version TEXT, status TEXT NOT NULL DEFAULT 'active', updated_at INTEGER NOT NULL, PRIMARY KEY(owner,kind,source_id), UNIQUE(owner,google_event_id));
CREATE INDEX IF NOT EXISTS google_calendar_oauth_expiry ON google_calendar_oauth(expires_at);
CREATE TABLE IF NOT EXISTS melodi_google_calendar_ignored_changes (owner TEXT NOT NULL,event_id TEXT NOT NULL,remote_hash TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,agent TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,event_id,remote_hash));
CREATE TABLE IF NOT EXISTS melodi_google_calendar_schedule_overrides (
    owner TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, agent TEXT NOT NULL,
    payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
    last_start_at TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(owner,kind,source_id));
