-- Dedicated page_keywords table — normalizes pageMap out of the workspace JSON blob.
-- Each row = one page's keyword assignment + analysis data for a workspace.
-- Replaces the keywordStrategy.pageMap array with indexed, per-row access.

CREATE TABLE IF NOT EXISTS page_keywords (
  workspace_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  primary_keyword TEXT NOT NULL DEFAULT '',
  secondary_keywords TEXT NOT NULL DEFAULT '[]',
  search_intent TEXT,
  -- GSC enrichment
  current_position REAL,
  previous_position REAL,
  impressions INTEGER,
  clicks INTEGER,
  gsc_keywords TEXT,          -- JSON array of {query, clicks, impressions, position}
  -- SEMRush enrichment
  volume INTEGER,
  difficulty REAL,
  cpc REAL,
  secondary_metrics TEXT,     -- JSON array of {keyword, volume, difficulty}
  metrics_source TEXT,        -- 'exact' | 'partial_match' | 'bulk_lookup'
  validated INTEGER,          -- boolean 0/1
  -- Persisted page analysis
  optimization_score INTEGER,
  analysis_generated_at TEXT,
  optimization_issues TEXT,   -- JSON array of strings
  recommendations TEXT,       -- JSON array of strings
  content_gaps TEXT,          -- JSON array of strings
  primary_keyword_presence TEXT, -- JSON {inTitle, inMeta, inContent, inSlug}
  long_tail_keywords TEXT,    -- JSON array of strings
  competitor_keywords TEXT,   -- JSON array of strings
  estimated_difficulty TEXT,
  keyword_difficulty REAL,
  monthly_volume INTEGER,
  topic_cluster TEXT,
  search_intent_confidence REAL,
  PRIMARY KEY (workspace_id, page_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_keywords_workspace ON page_keywords(workspace_id);
CREATE INDEX IF NOT EXISTS idx_page_keywords_score ON page_keywords(workspace_id, optimization_score);
CREATE INDEX IF NOT EXISTS idx_page_keywords_keyword ON page_keywords(workspace_id, primary_keyword);
