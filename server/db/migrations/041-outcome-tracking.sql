-- 041-outcome-tracking.sql
-- Outcome Intelligence Engine: action tracking, outcome measurement, learnings, playbooks

CREATE TABLE IF NOT EXISTS tracked_actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_workspace ON tracked_actions(workspace_id, action_type);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_attribution ON tracked_actions(workspace_id, attribution);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_created ON tracked_actions(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_page ON tracked_actions(workspace_id, page_url);
CREATE INDEX IF NOT EXISTS idx_tracked_actions_measurement ON tracked_actions(measurement_complete, created_at);

CREATE TABLE IF NOT EXISTS action_outcomes (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  early_signal TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (action_id) REFERENCES tracked_actions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_action ON action_outcomes(action_id, checkpoint_days);
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_outcomes_unique ON action_outcomes(action_id, checkpoint_days);

CREATE TABLE IF NOT EXISTS workspace_learnings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  learnings TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_playbooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  action_sequence TEXT NOT NULL DEFAULT '[]',
  historical_win_rate REAL NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'low',
  average_outcome TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_action_playbooks_workspace ON action_playbooks(workspace_id);

-- Archive tables for data retention (24-month active window)
CREATE TABLE IF NOT EXISTS tracked_actions_archive (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace ON tracked_actions_archive(workspace_id);

CREATE TABLE IF NOT EXISTS action_outcomes_archive (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  early_signal TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action ON action_outcomes_archive(action_id);

-- Scoring config column on workspaces table
-- NULL = use defaults, JSON = partial override
ALTER TABLE workspaces ADD COLUMN scoring_config TEXT DEFAULT NULL;
