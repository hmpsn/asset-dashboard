-- Migration 008: Content subscriptions (recurring monthly content packages)

CREATE TABLE IF NOT EXISTS content_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  plan TEXT NOT NULL,                -- content_starter | content_growth | content_scale
  posts_per_month INTEGER NOT NULL,
  price_usd INTEGER NOT NULL,        -- dollars (not cents)
  status TEXT NOT NULL DEFAULT 'pending',  -- active | paused | cancelled | past_due | pending
  current_period_start TEXT,
  current_period_end TEXT,
  posts_delivered_this_period INTEGER NOT NULL DEFAULT 0,
  topic_source TEXT NOT NULL DEFAULT 'strategy_gaps',  -- strategy_gaps | manual | ai_recommended
  preferred_page_types TEXT,          -- JSON array of page types
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_sub_ws ON content_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_sub_status ON content_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_content_sub_stripe ON content_subscriptions(stripe_subscription_id);
