-- Owner-scoped stable human task references; no private task content.
CREATE TABLE IF NOT EXISTS wa_owner_task_reference_counters (
    owner TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('approval','job','routine')),next_value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(owner,type));

CREATE TABLE IF NOT EXISTS wa_melodi_task_references (
    owner TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('approval','job','routine')),task_id TEXT NOT NULL,
    short_ref TEXT NOT NULL,ordinal INTEGER NOT NULL,agent TEXT,status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,type,task_id),UNIQUE(owner,short_ref),UNIQUE(owner,type,ordinal));

CREATE INDEX IF NOT EXISTS wa_owner_task_reference_recent ON wa_melodi_task_references(owner,type,agent,updated_at);
