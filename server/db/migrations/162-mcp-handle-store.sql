-- Durable, multi-instance-safe MCP handle store + paid-call counter.
--
-- Previously both lived in-memory (server/mcp/handles.ts + paid-call-counter.ts),
-- so large-tool-output handles and the per-workspace paid-call signal did not
-- survive a process restart and did not work across multiple server instances.
--
-- No foreign key on workspace_id: handles are short-lived, single-use, TTL-swept
-- tokens issued with whatever workspace id the caller supplies, and the paid
-- counter uses a synthetic global sentinel key — neither should be coupled to the
-- workspaces table lifecycle (and FK enforcement is OFF in the test harness, which
-- issues handles for synthetic workspace ids).

CREATE TABLE IF NOT EXISTS mcp_handles (
  token TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Sweeper + MAX_HANDLES eviction both order by expiry/creation; index supports both.
CREATE INDEX IF NOT EXISTS idx_mcp_handles_expires_at
  ON mcp_handles(expires_at);

CREATE INDEX IF NOT EXISTS idx_mcp_handles_created_at
  ON mcp_handles(created_at);

-- Durable, per-workspace paid-call counter. Informational only (warn/track; no
-- hard cap, no refusal of calls). The global aggregate is tracked under the
-- synthetic workspace id '__global__' so the existing global threshold semantics
-- survive the migration unchanged.
CREATE TABLE IF NOT EXISTS mcp_paid_call_counts (
  workspace_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
