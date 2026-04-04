-- Store client CTA taps with surrounding chat context.
-- Created when a client taps a Service Interest CTA in the chat panel.
-- chatContext is JSON: ClientSignalMessage[] (last 10 messages at time of tap).

CREATE TABLE IF NOT EXISTS client_signals (
  id          TEXT NOT NULL PRIMARY KEY,
  workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('content_interest', 'service_interest')),
  chatContext TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'actioned')),
  createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_signals_workspace ON client_signals(workspaceId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_client_signals_status    ON client_signals(status);
