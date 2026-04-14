-- Deep Diagnostics — stores investigation reports triggered by admin from anomaly insights
CREATE TABLE IF NOT EXISTS diagnostic_reports (
  id                   TEXT NOT NULL PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  insight_id           TEXT,
  anomaly_type         TEXT NOT NULL,
  affected_pages       TEXT NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','running','completed','failed')),
  diagnostic_context   TEXT NOT NULL DEFAULT '{}',
  root_causes          TEXT NOT NULL DEFAULT '[]',
  remediation_actions  TEXT NOT NULL DEFAULT '[]',
  admin_report         TEXT NOT NULL DEFAULT '',
  client_summary       TEXT NOT NULL DEFAULT '',
  error_message        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at         TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_workspace
  ON diagnostic_reports(workspace_id, created_at DESC);
