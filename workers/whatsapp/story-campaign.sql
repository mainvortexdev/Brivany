CREATE TABLE IF NOT EXISTS wa_story_portraits (
  owner_phone TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_story_portrait_refs (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_story_portrait_refs_owner ON wa_story_portrait_refs(owner_phone, created_at DESC);

-- Style and composition references are deliberately separate from identity photos.
CREATE TABLE IF NOT EXISTS wa_story_visual_refs (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  guidance TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_story_visual_refs_owner ON wa_story_visual_refs(owner_phone, active, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_story_campaigns (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
  brief TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_story_slots (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES wa_story_campaigns(id),
  owner_phone TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  stage TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','generating','ready','publishing','published','needs_review')),
  object_key TEXT,
  mime_type TEXT,
  operation_id TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, day_index, stage)
);

CREATE INDEX IF NOT EXISTS idx_wa_story_slots_due ON wa_story_slots(status, scheduled_at);
