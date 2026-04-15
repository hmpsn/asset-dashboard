-- Phase 4: llms.txt AI summary cache
CREATE TABLE IF NOT EXISTS llms_txt_cache (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  summary TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, page_url)
);
CREATE INDEX IF NOT EXISTS idx_llms_txt_cache_workspace ON llms_txt_cache(workspace_id);
