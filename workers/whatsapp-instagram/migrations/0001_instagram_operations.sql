-- Shared state for the Vetsa Instagram operations Worker. Payload columns are
-- AES-GCM encrypted before they reach D1; clear text is deliberately limited
-- to routing, status and idempotency data needed to operate the integration.

CREATE TABLE IF NOT EXISTS ig_webhook_events (
  event_key TEXT PRIMARY KEY,
  instagram_account_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_ig_webhook_events_status
  ON ig_webhook_events(status, received_at);

CREATE TABLE IF NOT EXISTS ig_conversations (
  id TEXT PRIMARY KEY,
  instagram_account_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  last_event_key TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  encrypted_summary TEXT,
  summary_iv TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(instagram_account_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_conversations_account_updated
  ON ig_conversations(instagram_account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ig_owner_operations (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  instagram_account_id TEXT,
  operation_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  provider_container_id TEXT,
  provider_media_id TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  completed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_ig_owner_operations_owner_status
  ON ig_owner_operations(owner_phone, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ig_automation_policies (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  instagram_account_id TEXT,
  policy_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_automation_policies_account_status
  ON ig_automation_policies(instagram_account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ig_media_delivery (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_media_delivery_expiry
  ON ig_media_delivery(expires_at);
