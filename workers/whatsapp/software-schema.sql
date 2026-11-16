CREATE TABLE IF NOT EXISTS software_auth_codes (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_auth_codes_email_created
  ON software_auth_codes(email_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS software_sessions (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_sessions_expiry
  ON software_sessions(expires_at);

CREATE TABLE IF NOT EXISTS software_audit_log (
  id TEXT PRIMARY KEY,
  actor_email_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_audit_created
  ON software_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS software_rate_limits (
  bucket TEXT PRIMARY KEY,
  requests INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS software_security_events (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_security_events_created
  ON software_security_events(created_at DESC);
