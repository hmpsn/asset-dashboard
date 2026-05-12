-- Dedicated content_gaps table — normalizes keywordStrategy.contentGaps[] out of
-- the workspace JSON blob. Each row = one strategy-level content gap (a topic +
-- target keyword the workspace should create content for) for a workspace.
--
-- NOTE: distinct from the per-page `content_gaps TEXT` column on the
-- `page_keywords` table (PageKeywordMap.contentGaps), which stores per-page
-- AI-keyword-analysis gap topics. This table holds the strategy-level
-- ContentGap[] from `keywordStrategy.contentGaps`.

CREATE TABLE IF NOT EXISTS content_gaps (
  workspace_id TEXT NOT NULL,
  target_keyword TEXT NOT NULL,
  topic TEXT NOT NULL,
  intent TEXT NOT NULL,                 -- 'informational' | 'commercial' | 'transactional' | 'navigational'
  priority TEXT NOT NULL,               -- 'high' | 'medium' | 'low'
  rationale TEXT NOT NULL,
  suggested_page_type TEXT,             -- 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'
  -- SEMRush enrichment
  volume INTEGER,
  difficulty REAL,
  trend_direction TEXT,                 -- 'rising' | 'declining' | 'stable'
  serp_features TEXT,                   -- JSON array of strings
  -- GSC enrichment
  impressions INTEGER,
  -- Competitor proof
  competitor_proof TEXT,                -- e.g. "competitor.com ranks #3"
  -- AEO / SERP targeting
  question_keywords TEXT,               -- JSON array of strings
  serp_targeting TEXT,                  -- JSON array of strings
  -- Composite opportunity score (0–100): volume × ease × GSC signal × trend
  opportunity_score REAL,
  PRIMARY KEY (workspace_id, target_keyword),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_gaps_workspace ON content_gaps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_gaps_priority ON content_gaps(workspace_id, priority);
CREATE INDEX IF NOT EXISTS idx_content_gaps_score ON content_gaps(workspace_id, opportunity_score);
