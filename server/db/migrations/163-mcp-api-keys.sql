-- Per-workspace MCP API keys (additive — the env MCP_API_KEY master key is retained).
--
-- Each row is a single API key scoped to ONE workspace. Keys are stored hashed
-- (sha256 hex), never in plaintext; the plaintext is shown to the operator
-- exactly once at creation time. `revoked_at` non-null = the key is dead
-- (rotation/revocation). Multiple active keys per workspace are supported.
CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- Lookup path: authenticate a presented key by its sha256 hash.
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_key_hash
  ON mcp_api_keys(key_hash);

-- Admin listing/rotation path: enumerate a workspace's keys.
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_workspace
  ON mcp_api_keys(workspace_id, revoked_at);
