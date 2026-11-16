CREATE TABLE IF NOT EXISTS wa_owner_projects (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  encrypted_state TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_owner_projects_owner_updated
  ON wa_owner_projects(owner_phone, updated_at DESC);

CREATE TABLE IF NOT EXISTS wa_owner_project_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_owner_project_updates_project_created
  ON wa_owner_project_updates(project_id, created_at DESC);
