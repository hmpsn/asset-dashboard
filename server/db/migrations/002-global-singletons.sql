-- PR 2: Global singletons — users, client users, activity log, requests,
-- churn signals, anomalies, and audit schedules.

-- Internal admin users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  workspace_ids TEXT NOT NULL DEFAULT '[]',
  avatar_url TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- Client users (per-workspace logins)
CREATE TABLE IF NOT EXISTS client_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client_member',
  workspace_id TEXT NOT NULL,
  avatar_url TEXT,
  invited_by TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_email_ws ON client_users(LOWER(email), workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_users_workspace ON client_users(workspace_id);

-- Client password reset tokens
CREATE TABLE IF NOT EXISTS reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,
  actor_id TEXT,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id, created_at);

-- Client requests
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new',
  submitted_by TEXT,
  page_url TEXT,
  page_id TEXT,
  attachments TEXT,
  notes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_workspace ON requests(workspace_id);

-- Churn signals
CREATE TABLE IF NOT EXISTS churn_signals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  dismissed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_churn_workspace ON churn_signals(workspace_id);

-- Anomalies
CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metric TEXT NOT NULL,
  current_value REAL NOT NULL,
  previous_value REAL NOT NULL,
  change_pct REAL NOT NULL,
  ai_summary TEXT,
  detected_at TEXT NOT NULL,
  dismissed_at TEXT,
  acknowledged_at TEXT,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anomalies_workspace ON anomalies(workspace_id, detected_at);

-- Audit schedules
CREATE TABLE IF NOT EXISTS audit_schedules (
  workspace_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_days INTEGER NOT NULL DEFAULT 7,
  score_drop_threshold INTEGER NOT NULL DEFAULT 5,
  last_run_at TEXT,
  last_score INTEGER
);
