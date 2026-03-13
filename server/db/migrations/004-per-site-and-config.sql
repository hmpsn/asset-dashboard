-- Migration 004: Per-site snapshots + config/admin modules
-- Tables for: audit_snapshots (reports), schema_snapshots, redirect_snapshots,
--             performance_snapshots, chat_sessions, google_tokens, usage_tracking

-- Audit snapshots (reports.ts)
CREATE TABLE IF NOT EXISTS audit_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  site_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audit TEXT NOT NULL,          -- JSON: full SeoAuditResult
  logo_url TEXT,
  action_items TEXT,            -- JSON: ActionItem[]
  previous_score INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_site ON audit_snapshots(site_id, created_at);

-- Schema snapshots (schema-store.ts)
CREATE TABLE IF NOT EXISTS schema_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  results TEXT NOT NULL,        -- JSON: SchemaPageSuggestion[]
  page_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schema_snapshots_site ON schema_snapshots(site_id);

-- Redirect snapshots (redirect-store.ts)
CREATE TABLE IF NOT EXISTS redirect_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL           -- JSON: RedirectScanResult
);
CREATE INDEX IF NOT EXISTS idx_redirect_snapshots_site ON redirect_snapshots(site_id);

-- Performance snapshots (performance-store.ts)
-- Generic key-value store keyed by (sub, site_id)
CREATE TABLE IF NOT EXISTS performance_snapshots (
  sub TEXT NOT NULL,
  site_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL,          -- JSON
  PRIMARY KEY (sub, site_id)
);

-- Chat sessions (chat-memory.ts)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'client',
  title TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',   -- JSON: ChatMessage[]
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ws ON chat_sessions(workspace_id, channel, updated_at);

-- Google OAuth tokens (google-auth.ts)
CREATE TABLE IF NOT EXISTS google_tokens (
  site_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL
);

-- Usage tracking (usage-tracking.ts)
CREATE TABLE IF NOT EXISTS usage_tracking (
  workspace_id TEXT NOT NULL,
  month TEXT NOT NULL,           -- YYYY-MM
  feature TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, month, feature)
);
CREATE INDEX IF NOT EXISTS idx_usage_ws_month ON usage_tracking(workspace_id, month);
