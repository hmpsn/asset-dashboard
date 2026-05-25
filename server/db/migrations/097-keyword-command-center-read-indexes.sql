-- Migration 097: Keyword Command Center read indexes
-- Supports latest local visibility summary reads used by the paginated Keywords surface.

CREATE INDEX IF NOT EXISTS idx_local_visibility_snapshots_workspace_market_keyword_captured
  ON local_visibility_snapshots(workspace_id, market_id, normalized_keyword, device, language_code, captured_at DESC);
