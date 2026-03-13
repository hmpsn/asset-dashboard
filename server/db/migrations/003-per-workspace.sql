-- 003-per-workspace.sql
-- Tier 2: Per-workspace data modules (14 modules)

-- Approval batches (items stored as JSON array)
CREATE TABLE IF NOT EXISTS approval_batches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_batches_workspace ON approval_batches(workspace_id);

-- Content briefs
CREATE TABLE IF NOT EXISTS content_briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  -- v2 enhanced fields
  executive_summary TEXT,
  content_format TEXT,
  tone_and_style TEXT,
  people_also_ask TEXT,
  topical_entities TEXT,
  serp_analysis TEXT,
  difficulty_score REAL,
  traffic_potential TEXT,
  cta_recommendations TEXT,
  -- v3 fields
  eeat_guidance TEXT,
  content_checklist TEXT,
  schema_recommendations TEXT,
  -- v4 field
  page_type TEXT,
  -- v5 fields
  reference_urls TEXT,
  real_people_also_ask TEXT,
  real_top_results TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_briefs_workspace ON content_briefs(workspace_id);

-- Content topic requests
CREATE TABLE IF NOT EXISTS content_topic_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_content_topic_requests_workspace ON content_topic_requests(workspace_id);

-- Content posts (generated AI content)
CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_posts_workspace ON content_posts(workspace_id);

-- Work orders
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_work_orders_workspace ON work_orders(workspace_id);

-- Recommendation sets (per-workspace, stored as JSON)
CREATE TABLE IF NOT EXISTS recommendation_sets (
  workspace_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  recommendations TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}'
);

-- Annotations (chart annotations)
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#2dd4bf',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_workspace ON annotations(workspace_id);

-- SEO change events
CREATE TABLE IF NOT EXISTS seo_changes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  page_title TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seo_changes_workspace ON seo_changes(workspace_id);

-- Content decay analyses (per workspace)
CREATE TABLE IF NOT EXISTS decay_analyses (
  workspace_id TEXT PRIMARY KEY,
  analyzed_at TEXT NOT NULL,
  total_pages INTEGER NOT NULL DEFAULT 0,
  decaying_pages TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}'
);

-- ROI snapshots (historical traffic value)
CREATE TABLE IF NOT EXISTS roi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  organic_traffic_value REAL NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roi_snapshots_workspace ON roi_snapshots(workspace_id, computed_at);

-- Feedback items
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_feedback_workspace ON feedback(workspace_id);

-- Rank tracking config
CREATE TABLE IF NOT EXISTS rank_tracking_config (
  workspace_id TEXT PRIMARY KEY,
  tracked_keywords TEXT NOT NULL DEFAULT '[]'
);

-- Rank snapshots
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  queries TEXT NOT NULL DEFAULT '[]',
  UNIQUE(workspace_id, date)
);
CREATE INDEX IF NOT EXISTS idx_rank_snapshots_workspace ON rank_snapshots(workspace_id, date);
