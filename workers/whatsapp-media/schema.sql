-- Requests, checkpoints and results are AES-GCM encrypted; queue bodies contain only an opaque ID.
CREATE TABLE IF NOT EXISTS wa_public_media_operations (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','downloading','analyzing','ready','blocked','cancelled')),
  request_cipher TEXT NOT NULL,
  request_iv TEXT NOT NULL,
  checkpoint_cipher TEXT,
  checkpoint_iv TEXT,
  result_cipher TEXT,
  result_iv TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  dispatch_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_public_media_expiry ON wa_public_media_operations(status,expires_at);
