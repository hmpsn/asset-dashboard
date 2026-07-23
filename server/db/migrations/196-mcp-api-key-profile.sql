-- Bind every durable workspace MCP credential to exactly one transport profile.
-- Existing keys retain their historical full /mcp behavior through the default.
ALTER TABLE mcp_api_keys
  ADD COLUMN profile TEXT NOT NULL DEFAULT 'full'
  CHECK (profile IN ('full', 'client'));
