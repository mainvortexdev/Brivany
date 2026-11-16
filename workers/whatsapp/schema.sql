-- State owned by the Vetsa WhatsApp Worker.  This intentionally coexists with
-- the Vetsa Intelligence tables in vetsa-cloud-prod.

CREATE TABLE IF NOT EXISTS wa_messages (
  message_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_conversation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  encrypted_content TEXT,
  content_iv TEXT,
  legacy_cleanup_pending INTEGER NOT NULL DEFAULT 0,
  turn_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_conversation_phone_created
  ON wa_conversation(phone, created_at DESC);
-- The turn_key unique index is created by encrypted-conversation-store after
-- its lazy column migration, so this bootstrap also runs over legacy tables.
CREATE TABLE IF NOT EXISTS wa_conversation_blind_index (
  owner_phone TEXT NOT NULL,
  turn_id INTEGER NOT NULL,
  term_hash TEXT NOT NULL,
  PRIMARY KEY(owner_phone, term_hash, turn_id)
);
-- Recover FTS rows with no surviving turn only after that sender's legacy
-- migration is complete. Their encrypted archive never becomes a new turn.
CREATE TABLE IF NOT EXISTS wa_conversation_legacy_recovery (
  owner_phone TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_rowid INTEGER NOT NULL,
  payload_encrypted TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  recovered_at TEXT NOT NULL,
  PRIMARY KEY(owner_phone, source_key)
);

-- Only the active assistant is retained here; no message or credential content.
CREATE TABLE IF NOT EXISTS wa_melodi_state (
  phone TEXT PRIMARY KEY,
  active_agent TEXT NOT NULL CHECK (active_agent IN ('melodi')),
  updated_at TEXT NOT NULL
);

-- Project names, next steps and updates are encrypted with the owner's memory key.
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

-- Compact, encrypted long-term memory, scoped to each sender. Legacy plaintext
-- columns are emptied only after the encrypted payload has been authenticated.
CREATE TABLE IF NOT EXISTS wa_memory (
  phone TEXT PRIMARY KEY,
  memory_text TEXT NOT NULL DEFAULT '',
  summarized_through_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  encrypted_memory TEXT,
  memory_iv TEXT
);

-- Exact, encrypted memories available only to the verified owner number.
CREATE TABLE IF NOT EXISTS wa_owner_memory_items (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  item_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  has_reference INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_memory_created
  ON wa_owner_memory_items(owner_phone, created_at DESC);

-- Blind term index: searchable without storing prompt/password text in clear.
CREATE TABLE IF NOT EXISTS wa_owner_memory_terms (
  item_id TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  term_hash TEXT NOT NULL,
  PRIMARY KEY(item_id, term_hash),
  FOREIGN KEY(item_id) REFERENCES wa_owner_memory_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_memory_terms_lookup
  ON wa_owner_memory_terms(owner_phone, term_hash);

-- One encrypted conversational state per owner (capture, retrieval choice, etc.).
CREATE TABLE IF NOT EXISTS wa_owner_session (
  owner_phone TEXT PRIMARY KEY,
  session_type TEXT NOT NULL,
  encrypted_state TEXT NOT NULL,
  state_iv TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Durable queue jobs contain only an opaque id; their private payload stays encrypted here.
CREATE TABLE IF NOT EXISTS wa_owner_jobs (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  job_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_jobs_status
  ON wa_owner_jobs(owner_phone, status, created_at DESC);

-- Reusable private document formats. The source file and every mapping note
-- are retained only for the owner, so a named business template can be used
-- again without placing customer data in the normal chat history.
CREATE TABLE IF NOT EXISTS wa_owner_document_templates (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  template_name TEXT NOT NULL,
  document_kind TEXT NOT NULL DEFAULT 'document',
  encrypted_profile TEXT NOT NULL,
  profile_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_phone, template_name)
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_document_templates_owner_kind
  ON wa_owner_document_templates(owner_phone, document_kind, updated_at DESC);

-- An issued invoice, quotation or other client document is recoverable as an
-- original file. Its customer fields remain encrypted in D1; the R2 object
-- key is deliberately random and only reachable through this Worker.
CREATE TABLE IF NOT EXISTS wa_owner_documents (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  template_id TEXT,
  document_kind TEXT NOT NULL DEFAULT 'document',
  encrypted_metadata TEXT NOT NULL,
  metadata_iv TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(template_id) REFERENCES wa_owner_document_templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_documents_owner_created
  ON wa_owner_documents(owner_phone, created_at DESC);

-- Publicly referenceable, immutable sequence for every quotation. The job id
-- makes retries idempotent while the auto-incremented number remains global.
CREATE TABLE IF NOT EXISTS wa_quote_numbers (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_owner_document_terms (
  document_id TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  term_hash TEXT NOT NULL,
  PRIMARY KEY(document_id, term_hash),
  FOREIGN KEY(document_id) REFERENCES wa_owner_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_document_terms_lookup
  ON wa_owner_document_terms(owner_phone, term_hash);

-- Inbound and outbound mail for the verified owner. Addresses, subjects and
-- bodies are encrypted; the mailbox hash permits a private lookup of current
-- verification codes without exposing mail contents in D1.
CREATE TABLE IF NOT EXISTS wa_owner_email_messages (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  mailbox_hash TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  related_job_id TEXT,
  received_at TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(owner_phone, direction, related_job_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_email_mailbox_lookup
  ON wa_owner_email_messages(owner_phone, direction, mailbox_hash, received_at DESC);

-- Private address book for owner-authorized recipients. Names and email
-- addresses are encrypted; blind term hashes permit a name lookup without
-- exposing the directory in D1.
CREATE TABLE IF NOT EXISTS wa_owner_contacts (
  id TEXT PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  name_hash TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_phone, name_hash)
);

CREATE TABLE IF NOT EXISTS wa_owner_contact_terms (
  contact_id TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  term_hash TEXT NOT NULL,
  PRIMARY KEY(contact_id, term_hash),
  FOREIGN KEY(contact_id) REFERENCES wa_owner_contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wa_owner_contact_terms_lookup
  ON wa_owner_contact_terms(owner_phone, term_hash);

-- A reminder can have a private outbound-email action. The encrypted payload
-- contains its recipient, message and optional R2 attachment. The event id is
-- unique so cron retries can never create a duplicate email schedule.
CREATE TABLE IF NOT EXISTS wa_melodi_scheduled_email_actions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  owner_phone TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES melodi_calendar_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_actions_due
  ON wa_melodi_scheduled_email_actions(status, updated_at);

-- Legacy FTS is retained only for bounded migration cleanup. New conversation
-- retrieval uses sender-scoped HMAC tokens in wa_conversation_blind_index.
CREATE VIRTUAL TABLE IF NOT EXISTS wa_conversation_search USING fts5(
  phone UNINDEXED,
  role UNINDEXED,
  content,
  created_at UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS calendar_pins (
  phone TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_sessions (
  token_hash TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_sessions_expiry
  ON calendar_sessions(expires_at);

CREATE TABLE IF NOT EXISTS melodi_calendar_events (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  title TEXT NOT NULL,
  event_at TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'REMINDER',
  assigned_agent TEXT CHECK(assigned_agent IS NULL OR assigned_agent IN ('melodi')),
  emily_prepared_at TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_schedule
  ON melodi_calendar_events(event_at, emily_prepared_at, reminded_at);

-- One immutable request identity for an atomic set of appointments. Titles and
-- the original provider message ID are not duplicated in this receipt.
CREATE TABLE IF NOT EXISTS calendar_reminder_batches (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count BETWEEN 2 AND 8),
  created_at TEXT NOT NULL,
  UNIQUE(phone, source_hash)
);

-- Marks one-time platform configuration completed by the Worker itself.
CREATE TABLE IF NOT EXISTS worker_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
