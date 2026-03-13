-- Migration 005: Workspaces + page edit states + SEO edit tracking
-- Normalizes the workspace model from a single JSON file into proper tables.

-- Core workspace
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL,
  webflow_site_id TEXT,
  webflow_site_name TEXT,
  webflow_token TEXT,
  gsc_property_url TEXT,
  ga4_property_id TEXT,
  client_password TEXT,
  client_email TEXT,
  live_domain TEXT,
  event_config TEXT,        -- JSON array of EventDisplayConfig
  event_groups TEXT,        -- JSON array of EventGroup
  keyword_strategy TEXT,    -- JSON KeywordStrategy object
  competitor_domains TEXT,  -- JSON array of strings
  personas TEXT,            -- JSON array of AudiencePersona
  -- Feature toggles
  client_portal_enabled INTEGER,
  seo_client_view INTEGER,
  analytics_client_view INTEGER,
  auto_reports INTEGER,
  auto_report_frequency TEXT,
  -- Branding
  brand_voice TEXT,
  knowledge_base TEXT,
  brand_logo_url TEXT,
  brand_accent_color TEXT,
  -- Monetization
  tier TEXT DEFAULT 'free',
  trial_ends_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  -- Client onboarding
  onboarding_enabled INTEGER,
  onboarding_completed INTEGER,
  -- Content pricing (JSON)
  content_pricing TEXT,
  -- Portal contacts (JSON array)
  portal_contacts TEXT,
  -- Audit suppressions (JSON array)
  audit_suppressions TEXT,
  -- Timestamps
  created_at TEXT NOT NULL
);

-- Page edit states (extracted from the nested Record<string, PageEditState>)
CREATE TABLE IF NOT EXISTS page_edit_states (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'clean',
  audit_issues TEXT,       -- JSON array
  fields TEXT,             -- JSON array
  source TEXT,
  approval_batch_id TEXT,
  content_request_id TEXT,
  work_order_id TEXT,
  recommendation_id TEXT,
  rejection_note TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (workspace_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_page_edit_ws ON page_edit_states(workspace_id);

-- Legacy seoEditTracking (kept for backward compat)
CREATE TABLE IF NOT EXISTS seo_edit_tracking (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fields TEXT,             -- JSON array
  PRIMARY KEY (workspace_id, page_id)
);
