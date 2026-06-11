-- Stores the last successfully generated LLMs.txt result for a workspace.
-- GET routes serve this stored blob instead of re-running the full crawl.
CREATE TABLE IF NOT EXISTS llms_txt_stored_result (
  workspace_id TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  full_content TEXT NOT NULL,
  page_count   INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL
);
