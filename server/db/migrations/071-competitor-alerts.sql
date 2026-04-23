CREATE TABLE IF NOT EXISTS competitor_alerts (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  competitor_domain TEXT NOT NULL,
  alert_type  TEXT NOT NULL,
  keyword     TEXT,
  previous_position INTEGER,
  current_position  INTEGER,
  position_change   INTEGER,
  volume      INTEGER,
  severity    TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  insight_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_ws_date
  ON competitor_alerts(workspace_id, created_at DESC);
