CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  product_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  content_request_id TEXT,
  metadata TEXT, -- JSON string
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_workspace ON payments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(workspace_id, stripe_session_id);
