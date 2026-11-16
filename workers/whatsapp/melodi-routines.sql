-- Weekly owner routines. Content and profiles have no plaintext fallback.
CREATE TABLE IF NOT EXISTS wa_melodi_routines (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    event_key TEXT NOT NULL, payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('auto','email','whatsapp')),
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), hour TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
    next_at INTEGER NOT NULL, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT, lease_until INTEGER, last_run_at INTEGER, last_outcome TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,event_key));

CREATE INDEX IF NOT EXISTS wa_melodi_routines_due ON wa_melodi_routines(owner,status,available_at,lease_until);

CREATE INDEX IF NOT EXISTS wa_melodi_routines_assigned ON wa_melodi_routines(owner,agent,status);
