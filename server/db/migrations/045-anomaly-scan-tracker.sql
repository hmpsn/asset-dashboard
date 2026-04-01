-- Track anomaly scan completion without abusing the anomalies table.
-- The old approach inserted a fake row with workspace_id='__system__' which
-- violates the foreign key constraint on workspaces(id).

CREATE TABLE IF NOT EXISTS anomaly_scan_tracker (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  last_scan_at TEXT NOT NULL
);

-- Clean up the old fake row if it exists
DELETE FROM anomalies WHERE id = '__last_scan__';
