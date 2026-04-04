-- client_signals: stores signals created when the AI detects purchase/service
-- intent in client chat. Reviewed and actioned by the admin team.
-- chat_context is JSON: ClientSignalMessage[] (last 10 messages at time of signal creation).

CREATE TABLE IF NOT EXISTS client_signals (
  id              TEXT NOT NULL PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_name  TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('content_interest', 'service_interest')),
  status          TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'actioned')),
  chat_context    TEXT NOT NULL DEFAULT '[]',
  trigger_message TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_signals_workspace ON client_signals(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_signals_status    ON client_signals(status, created_at DESC);
