-- 155-llm-mention-snapshots.sql
-- SEO Decision Engine P8: LLM-mention (AI-visibility) time series. The trend IS the before/after
-- AEO proof — each refresh writes a dated snapshot. mentions/ai_search_volume are NULLable;
-- readers treat absent as 0 (never invented — see tests/fixtures/dataforseo-llm-mentions.ts).
CREATE TABLE IF NOT EXISTS llm_mention_snapshots (
  workspace_id      TEXT NOT NULL,
  snapshot_date     TEXT NOT NULL,
  platform          TEXT NOT NULL,                 -- 'chat_gpt' (room for 'google')
  domain            TEXT,
  mentions          INTEGER,                        -- NULL/absent → 0 by readers (NEVER invented)
  ai_search_volume  INTEGER,
  share_of_voice    REAL,                           -- 0..1 (own ÷ own + co-mentioned competitors)
  competitor_brands TEXT NOT NULL DEFAULT '[]',     -- JSON [{name,mentions,aiSearchVolume}]
  source_domains    TEXT NOT NULL DEFAULT '[]',     -- JSON [{domain,mentions}]
  fetched_at        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, snapshot_date, platform),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_llm_mentions_ws ON llm_mention_snapshots(workspace_id, platform, snapshot_date);
