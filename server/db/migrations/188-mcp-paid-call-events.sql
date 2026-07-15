-- Durable exactly-once event ledger for accepted MCP commands that initiate
-- paid work. The event key is caller-namespaced and stable across command
-- replay, so metering can be repaired after a crash without double-counting.
--
-- This deliberately has no workspace foreign key. The existing paid-call
-- counter supports a synthetic global row, and generic MCP callers may meter
-- work for workspace identifiers whose lifecycle must not erase the audit
-- record that an accepted paid trigger was counted.

CREATE TABLE IF NOT EXISTS mcp_paid_call_events (
  event_key TEXT PRIMARY KEY CHECK (
    length(trim(event_key)) > 0
    AND length(CAST(event_key AS BLOB)) <= 512
  ),
  workspace_id TEXT,
  increment INTEGER NOT NULL CHECK (increment > 0),
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_paid_call_events_workspace_recorded
  ON mcp_paid_call_events(workspace_id, recorded_at);
