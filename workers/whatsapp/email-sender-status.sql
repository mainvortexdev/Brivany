-- Read-only provider audit. Contains no API keys, recipient addresses, DNS record values or message bodies.
CREATE TABLE IF NOT EXISTS wa_email_sender_audit (
    id TEXT PRIMARY KEY,checked_at INTEGER NOT NULL,next_refresh_at INTEGER NOT NULL,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wa_melodi_email_sender_status (
    email TEXT PRIMARY KEY,agent TEXT NOT NULL,status TEXT NOT NULL,registered INTEGER,provider_active INTEGER,
    domain_verified INTEGER,domain_authenticated INTEGER,provider_name TEXT,checked_at INTEGER NOT NULL);
