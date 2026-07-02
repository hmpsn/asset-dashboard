/**
 * Admin MCP API key management — the contract between `server/routes/mcp-api-keys.ts`
 * and the admin Settings UI (`McpApiKeysSettings`).
 *
 * These are the per-workspace keys minted on top of the retained env `MCP_API_KEY`
 * admin master key. The server stores only a sha256 hash; the plaintext is surfaced
 * to the operator exactly once at creation and never again.
 */

/** One per-workspace MCP API key as shown in the admin management table (no secret material). */
export interface McpApiKeySummary {
  id: string;
  workspaceId: string;
  /** Resolved workspace name for display; 'Unknown workspace' if the workspace was deleted. */
  workspaceName: string;
  label: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last authenticated use, or null if the key has never been used. */
  lastUsedAt: string | null;
  /** ISO timestamp of revocation, or null if still active. */
  revokedAt: string | null;
  /** Convenience flag: `revokedAt !== null`. A revoked key no longer authenticates. */
  revoked: boolean;
}

/** GET /api/admin/mcp-api-keys response. */
export interface McpApiKeyListResponse {
  keys: McpApiKeySummary[];
  /** Whether the env `MCP_API_KEY` admin master key is configured (grants all-workspace scope). */
  masterKeyConfigured: boolean;
}

/** POST /api/admin/mcp-api-keys response — `plaintextKeyOnceShown` is surfaced exactly once. */
export interface CreateMcpApiKeyResult {
  key: McpApiKeySummary;
  /** The plaintext key. Shown to the operator ONCE; never persisted or retrievable again. */
  plaintextKeyOnceShown: string;
}
