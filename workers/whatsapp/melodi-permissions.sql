-- Agent hierarchy and encrypted owner approval requests.
CREATE TABLE IF NOT EXISTS wa_melodi_levels (
    owner_phone TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 10), xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0),
    permission_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner_phone,agent));

CREATE TABLE IF NOT EXISTS wa_melodi_level_events (
    id TEXT PRIMARY KEY, owner_phone TEXT NOT NULL, agent TEXT NOT NULL,
    event_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('selected','praised','adjusted')),
    xp_delta INTEGER NOT NULL DEFAULT 0, requested_level INTEGER, applied INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, UNIQUE(owner_phone,event_key),
    FOREIGN KEY(owner_phone,agent) REFERENCES wa_melodi_levels(owner_phone,agent));

CREATE TABLE IF NOT EXISTS wa_melodi_permission_requests (
    id TEXT PRIMARY KEY, owner_phone TEXT NOT NULL, requester TEXT NOT NULL, helper TEXT NOT NULL,
    event_key TEXT NOT NULL, tool TEXT NOT NULL, required_level INTEGER NOT NULL,
    goal_scope TEXT NOT NULL CHECK(goal_scope IN ('team','personal')), parent_event_id TEXT,
    input_encrypted TEXT NOT NULL, input_iv TEXT NOT NULL,
    requester_revision INTEGER NOT NULL, helper_revision INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','claimed','completed','denied','failed','expired','revoked')),
    decision_key TEXT, claim_token TEXT, claim_event_key TEXT, receipt_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    UNIQUE(owner_phone,event_key),
    FOREIGN KEY(owner_phone,requester) REFERENCES wa_melodi_levels(owner_phone,agent),
    FOREIGN KEY(owner_phone,helper) REFERENCES wa_melodi_levels(owner_phone,agent));

CREATE INDEX IF NOT EXISTS wa_melodi_permission_pending ON wa_melodi_permission_requests(owner_phone,status,created_at);

CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_permission_decision_once ON wa_melodi_permission_requests(owner_phone,decision_key) WHERE decision_key IS NOT NULL;
