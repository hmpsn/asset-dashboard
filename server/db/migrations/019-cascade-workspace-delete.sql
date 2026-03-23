-- Migration 019: Add ON DELETE CASCADE to workspace_id foreign keys
-- Previously, deleting a workspace orphaned rows in 15+ tables.
-- SQLite doesn't support ALTER TABLE … ADD CONSTRAINT, so we recreate tables.
-- IMPORTANT: Each _new table must exactly match the current schema (original CREATE
-- + any ALTER TABLE ADD COLUMN from later migrations) so SELECT * copies all data.

-- ── 002-global-singletons tables ────────────────────────────────

-- client_users (002: 11 cols)
CREATE TABLE IF NOT EXISTS client_users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client_member',
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  avatar_url TEXT,
  invited_by TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO client_users_new SELECT * FROM client_users;
DROP TABLE IF EXISTS client_users;
ALTER TABLE client_users_new RENAME TO client_users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_email_ws ON client_users(LOWER(email), workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_users_workspace ON client_users(workspace_id);

-- reset_tokens (002: 5 cols)
CREATE TABLE IF NOT EXISTS reset_tokens_new (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO reset_tokens_new SELECT * FROM reset_tokens;
DROP TABLE IF EXISTS reset_tokens;
ALTER TABLE reset_tokens_new RENAME TO reset_tokens;

-- activity_log (002: 9 cols — note: actor_id not actor)
CREATE TABLE IF NOT EXISTS activity_log_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,
  actor_id TEXT,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO activity_log_new SELECT * FROM activity_log;
DROP TABLE IF EXISTS activity_log;
ALTER TABLE activity_log_new RENAME TO activity_log;
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id, created_at);

-- requests (002: 14 cols)
CREATE TABLE IF NOT EXISTS requests_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
INSERT OR IGNORE INTO requests_new SELECT * FROM requests;
DROP TABLE IF EXISTS requests;
ALTER TABLE requests_new RENAME TO requests;
CREATE INDEX IF NOT EXISTS idx_requests_workspace ON requests(workspace_id);

-- churn_signals (002: 9 cols — title/description not message/data)
CREATE TABLE IF NOT EXISTS churn_signals_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_name TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  dismissed_at TEXT
);
INSERT OR IGNORE INTO churn_signals_new SELECT * FROM churn_signals;
DROP TABLE IF EXISTS churn_signals;
ALTER TABLE churn_signals_new RENAME TO churn_signals;
CREATE INDEX IF NOT EXISTS idx_churn_workspace ON churn_signals(workspace_id);

-- anomalies (002: 16 cols)
CREATE TABLE IF NOT EXISTS anomalies_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
INSERT OR IGNORE INTO anomalies_new SELECT * FROM anomalies;
DROP TABLE IF EXISTS anomalies;
ALTER TABLE anomalies_new RENAME TO anomalies;
CREATE INDEX IF NOT EXISTS idx_anomalies_workspace ON anomalies(workspace_id, detected_at);

-- audit_schedules (002: 6 cols — last_score not next_run_at)
CREATE TABLE IF NOT EXISTS audit_schedules_new (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_days INTEGER NOT NULL DEFAULT 7,
  score_drop_threshold INTEGER NOT NULL DEFAULT 5,
  last_run_at TEXT,
  last_score INTEGER
);
INSERT OR IGNORE INTO audit_schedules_new SELECT * FROM audit_schedules;
DROP TABLE IF EXISTS audit_schedules;
ALTER TABLE audit_schedules_new RENAME TO audit_schedules;

-- ── 003-per-workspace tables ────────────────────────────────────

-- approval_batches (003: 8 cols)
CREATE TABLE IF NOT EXISTS approval_batches_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO approval_batches_new SELECT * FROM approval_batches;
DROP TABLE IF EXISTS approval_batches;
ALTER TABLE approval_batches_new RENAME TO approval_batches;
CREATE INDEX IF NOT EXISTS idx_approval_batches_workspace ON approval_batches(workspace_id);

-- content_briefs (003: 29 cols + 015: 4 cols = 33 cols)
CREATE TABLE IF NOT EXISTS content_briefs_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_keyword TEXT NOT NULL,
  secondary_keywords TEXT NOT NULL DEFAULT '[]',
  suggested_title TEXT NOT NULL,
  suggested_meta_desc TEXT NOT NULL,
  outline TEXT NOT NULL DEFAULT '[]',
  word_count_target INTEGER NOT NULL,
  intent TEXT NOT NULL,
  audience TEXT NOT NULL,
  competitor_insights TEXT NOT NULL,
  internal_link_suggestions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  executive_summary TEXT,
  content_format TEXT,
  tone_and_style TEXT,
  people_also_ask TEXT,
  topical_entities TEXT,
  serp_analysis TEXT,
  difficulty_score REAL,
  traffic_potential TEXT,
  cta_recommendations TEXT,
  eeat_guidance TEXT,
  content_checklist TEXT,
  schema_recommendations TEXT,
  page_type TEXT,
  reference_urls TEXT,
  real_people_also_ask TEXT,
  real_top_results TEXT,
  keyword_locked INTEGER DEFAULT 0,
  keyword_source TEXT,
  keyword_validation TEXT,
  template_id TEXT
);
INSERT OR IGNORE INTO content_briefs_new SELECT * FROM content_briefs;
DROP TABLE IF EXISTS content_briefs;
ALTER TABLE content_briefs_new RENAME TO content_briefs;
CREATE INDEX IF NOT EXISTS idx_content_briefs_workspace ON content_briefs(workspace_id);

-- content_topic_requests (003: 24 cols)
CREATE TABLE IF NOT EXISTS content_topic_requests_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  target_keyword TEXT NOT NULL,
  intent TEXT NOT NULL,
  priority TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  brief_id TEXT,
  client_note TEXT,
  internal_note TEXT,
  decline_reason TEXT,
  client_feedback TEXT,
  source TEXT DEFAULT 'strategy',
  service_type TEXT DEFAULT 'brief_only',
  page_type TEXT DEFAULT 'blog',
  upgraded_at TEXT,
  delivery_url TEXT,
  delivery_notes TEXT,
  target_page_id TEXT,
  target_page_slug TEXT,
  comments TEXT NOT NULL DEFAULT '[]',
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO content_topic_requests_new SELECT * FROM content_topic_requests;
DROP TABLE IF EXISTS content_topic_requests;
ALTER TABLE content_topic_requests_new RENAME TO content_topic_requests;
CREATE INDEX IF NOT EXISTS idx_content_topic_requests_workspace ON content_topic_requests(workspace_id);

-- content_posts (003: 18 cols + 007: 4 cols + 010: 1 col = 23 cols)
CREATE TABLE IF NOT EXISTS content_posts_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brief_id TEXT NOT NULL,
  target_keyword TEXT NOT NULL,
  title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  introduction TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL DEFAULT '[]',
  conclusion TEXT NOT NULL DEFAULT '',
  seo_title TEXT,
  seo_meta_description TEXT,
  total_word_count INTEGER NOT NULL DEFAULT 0,
  target_word_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'generating',
  unification_status TEXT,
  unification_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  webflow_item_id TEXT,
  webflow_collection_id TEXT,
  published_at TEXT,
  published_slug TEXT,
  review_checklist TEXT
);
INSERT OR IGNORE INTO content_posts_new SELECT * FROM content_posts;
DROP TABLE IF EXISTS content_posts;
ALTER TABLE content_posts_new RENAME TO content_posts;
CREATE INDEX IF NOT EXISTS idx_content_posts_workspace ON content_posts(workspace_id);

-- work_orders (003: 13 cols)
CREATE TABLE IF NOT EXISTS work_orders_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL,
  product_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  page_ids TEXT NOT NULL DEFAULT '[]',
  issue_checks TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  assigned_to TEXT,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO work_orders_new SELECT * FROM work_orders;
DROP TABLE IF EXISTS work_orders;
ALTER TABLE work_orders_new RENAME TO work_orders;
CREATE INDEX IF NOT EXISTS idx_work_orders_workspace ON work_orders(workspace_id);

-- recommendation_sets (003: 4 cols)
CREATE TABLE IF NOT EXISTS recommendation_sets_new (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  recommendations TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO recommendation_sets_new SELECT * FROM recommendation_sets;
DROP TABLE IF EXISTS recommendation_sets;
ALTER TABLE recommendation_sets_new RENAME TO recommendation_sets;

-- annotations (003: 7 cols)
CREATE TABLE IF NOT EXISTS annotations_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#2dd4bf',
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO annotations_new SELECT * FROM annotations;
DROP TABLE IF EXISTS annotations;
ALTER TABLE annotations_new RENAME TO annotations;
CREATE INDEX IF NOT EXISTS idx_annotations_workspace ON annotations(workspace_id);

-- seo_changes (003: 8 cols — column is "fields" not "changes")
CREATE TABLE IF NOT EXISTS seo_changes_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  page_title TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
INSERT OR IGNORE INTO seo_changes_new SELECT * FROM seo_changes;
DROP TABLE IF EXISTS seo_changes;
ALTER TABLE seo_changes_new RENAME TO seo_changes;
CREATE INDEX IF NOT EXISTS idx_seo_changes_workspace ON seo_changes(workspace_id);

-- decay_analyses (003: 5 cols)
CREATE TABLE IF NOT EXISTS decay_analyses_new (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  analyzed_at TEXT NOT NULL,
  total_pages INTEGER NOT NULL DEFAULT 0,
  decaying_pages TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO decay_analyses_new SELECT * FROM decay_analyses;
DROP TABLE IF EXISTS decay_analyses;
ALTER TABLE decay_analyses_new RENAME TO decay_analyses;

-- roi_snapshots (003: 4 cols — explicit column list for AUTOINCREMENT safety)
CREATE TABLE IF NOT EXISTS roi_snapshots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organic_traffic_value REAL NOT NULL,
  computed_at TEXT NOT NULL
);
INSERT OR IGNORE INTO roi_snapshots_new SELECT id, workspace_id, organic_traffic_value, computed_at FROM roi_snapshots;
DROP TABLE IF EXISTS roi_snapshots;
ALTER TABLE roi_snapshots_new RENAME TO roi_snapshots;
CREATE INDEX IF NOT EXISTS idx_roi_snapshots_workspace ON roi_snapshots(workspace_id, computed_at);

-- feedback (003: 11 cols — context/submitted_by/replies not rating/source)
CREATE TABLE IF NOT EXISTS feedback_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  context TEXT,
  submitted_by TEXT,
  replies TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO feedback_new SELECT * FROM feedback;
DROP TABLE IF EXISTS feedback;
ALTER TABLE feedback_new RENAME TO feedback;
CREATE INDEX IF NOT EXISTS idx_feedback_workspace ON feedback(workspace_id);

-- rank_tracking_config (003: 2 cols)
CREATE TABLE IF NOT EXISTS rank_tracking_config_new (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  tracked_keywords TEXT NOT NULL DEFAULT '[]'
);
INSERT OR IGNORE INTO rank_tracking_config_new SELECT * FROM rank_tracking_config;
DROP TABLE IF EXISTS rank_tracking_config;
ALTER TABLE rank_tracking_config_new RENAME TO rank_tracking_config;

-- rank_snapshots (003: 4 cols — explicit column list for AUTOINCREMENT safety)
CREATE TABLE IF NOT EXISTS rank_snapshots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  queries TEXT NOT NULL DEFAULT '[]',
  UNIQUE(workspace_id, date)
);
INSERT OR IGNORE INTO rank_snapshots_new SELECT id, workspace_id, date, queries FROM rank_snapshots;
DROP TABLE IF EXISTS rank_snapshots;
ALTER TABLE rank_snapshots_new RENAME TO rank_snapshots;
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_workspace ON rank_snapshots(workspace_id, date);

-- ── 004-per-site-and-config tables ──────────────────────────────

-- chat_sessions (004: 8 cols)
CREATE TABLE IF NOT EXISTS chat_sessions_new (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'client',
  title TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, workspace_id)
);
INSERT OR IGNORE INTO chat_sessions_new SELECT * FROM chat_sessions;
DROP TABLE IF EXISTS chat_sessions;
ALTER TABLE chat_sessions_new RENAME TO chat_sessions;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ws ON chat_sessions(workspace_id, channel, updated_at);

-- usage_tracking (004: 4 cols)
CREATE TABLE IF NOT EXISTS usage_tracking_new (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  feature TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, month, feature)
);
INSERT OR IGNORE INTO usage_tracking_new SELECT * FROM usage_tracking;
DROP TABLE IF EXISTS usage_tracking;
ALTER TABLE usage_tracking_new RENAME TO usage_tracking;
CREATE INDEX IF NOT EXISTS idx_usage_ws_month ON usage_tracking(workspace_id, month);

-- schema_snapshots (004: 6 cols)
CREATE TABLE IF NOT EXISTS schema_snapshots_new (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  results TEXT NOT NULL,
  page_count INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_snapshots_new SELECT * FROM schema_snapshots;
DROP TABLE IF EXISTS schema_snapshots;
ALTER TABLE schema_snapshots_new RENAME TO schema_snapshots;
CREATE INDEX IF NOT EXISTS idx_schema_snapshots_site ON schema_snapshots(site_id);

-- ── 006-jobs ────────────────────────────────────────────────────

-- (jobs table uses workspace_id but it's nullable — skip CASCADE)
