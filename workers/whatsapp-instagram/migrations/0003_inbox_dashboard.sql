CREATE TABLE IF NOT EXISTS ig_inbox_items (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  instagram_account_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  matched_policy_id TEXT,
  provider_message_id TEXT,
  received_at TEXT NOT NULL,
  replied_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_inbox_status_received
  ON ig_inbox_items(status, received_at DESC);

CREATE TABLE IF NOT EXISTS ig_reply_grants (
  owner_phone TEXT PRIMARY KEY,
  instagram_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_reply_grants_active
  ON ig_reply_grants(status, expires_at);

CREATE TABLE IF NOT EXISTS ig_keyword_rules (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  instagram_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_keyword_rules_account_status
  ON ig_keyword_rules(instagram_account_id, status, updated_at DESC);

