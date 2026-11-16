CREATE TABLE IF NOT EXISTS wa_melodi_state (
  phone TEXT PRIMARY KEY,
  active_agent TEXT NOT NULL CHECK (active_agent IN ('melodi')),
  updated_at TEXT NOT NULL
);
