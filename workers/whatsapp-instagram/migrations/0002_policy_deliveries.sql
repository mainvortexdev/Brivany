-- A private reply is an external action. Persist the delivery key before a
-- retry can re-enter the webhook worker, so an active policy never sends the
-- same reply twice for the same Meta event.
CREATE TABLE IF NOT EXISTS ig_policy_deliveries (
  policy_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (policy_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_ig_policy_deliveries_status
  ON ig_policy_deliveries(status, created_at);
