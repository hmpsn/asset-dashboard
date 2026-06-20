-- The Issue (Client) P0: daily GA4 key-event conversion snapshots, modeled on roi_snapshots.
-- One row per workspace per day; by_event holds the per-event breakdown (mirrors GA4ConversionSummary).
-- Back-anchored to workspace.createdAt so the baseline is "since we started," not "since first query."
CREATE TABLE IF NOT EXISTS ga4_conversion_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      TEXT NOT NULL,
  captured_at       TEXT NOT NULL,
  total_conversions INTEGER NOT NULL,
  total_users       INTEGER NOT NULL,
  by_event          TEXT NOT NULL,       -- JSON: { eventName, conversions, users, rate }[]
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ga4_conv_snapshots_workspace ON ga4_conversion_snapshots(workspace_id, captured_at);
