-- Owner-scoped encrypted financial records and correction history.
CREATE TABLE IF NOT EXISTS wa_finance_records (
    ref INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,agent TEXT NOT NULL,
    kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL DEFAULT 1,
    payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS wa_finance_owner ON wa_finance_records(owner,kind,status,ref);

CREATE TABLE IF NOT EXISTS wa_finance_changes (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,record_id TEXT NOT NULL,agent TEXT NOT NULL,
    revision INTEGER NOT NULL,payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at INTEGER NOT NULL,
    UNIQUE(owner,record_id,revision));
