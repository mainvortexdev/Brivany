-- A follow requirement is a delivery gate, not a claim of follower access.
-- Meta's supported API does not expose a per-user follower relationship.
CREATE TABLE IF NOT EXISTS ig_follow_gates (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  instagram_account_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_follow',
  baseline_followers INTEGER NOT NULL,
  observed_followers INTEGER,
  invitation_message_id TEXT,
  claimed_at TEXT,
  verified_heuristically_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(policy_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_follow_gates_account_status
  ON ig_follow_gates(instagram_account_id, status, updated_at DESC);
