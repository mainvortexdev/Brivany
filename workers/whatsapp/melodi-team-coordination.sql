CREATE TABLE IF NOT EXISTS wa_melodi_coordination (
  owner_phone TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  focus_agent TEXT,
  contact_agent TEXT,
  contact_until TEXT,
  contact_token TEXT,
  conversation_agent TEXT,
  conversation_until TEXT,
  last_contact_at TEXT,
  notification_start TEXT NOT NULL DEFAULT '08:00',
  notification_end TEXT NOT NULL DEFAULT '22:00',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_melodi_personal_goals (
  owner_phone TEXT NOT NULL,
  agent TEXT NOT NULL CHECK(agent IN ('melodi')),
  encrypted_goal TEXT NOT NULL,
  goal_iv TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused','complete')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_phone,agent)
);
CREATE TABLE IF NOT EXISTS wa_melodi_private_context (
  owner_phone TEXT NOT NULL,
  agent TEXT NOT NULL CHECK(agent IN ('melodi')),
  encrypted_context TEXT NOT NULL,
  context_iv TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_phone,agent)
);
CREATE TABLE IF NOT EXISTS wa_melodi_chat_state (
  owner_phone TEXT PRIMARY KEY,
  agent TEXT NOT NULL CHECK(agent IN ('melodi')),
  updated_at TEXT NOT NULL
);
