CREATE TABLE IF NOT EXISTS wa_story_publish_settings (
  owner_phone TEXT PRIMARY KEY,
  auto_publish INTEGER NOT NULL DEFAULT 0 CHECK(auto_publish IN (0,1)),
  updated_at TEXT NOT NULL
);

ALTER TABLE wa_story_slots ADD COLUMN preview_sent_at TEXT;
ALTER TABLE wa_story_slots ADD COLUMN approved_at TEXT;

CREATE TABLE IF NOT EXISTS wa_story_single_drafts (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready','publishing','published','needs_review')),
  preview_sent_at TEXT,
  approved_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_story_single_due ON wa_story_single_drafts(status,scheduled_at);
