// ── Admin MCP API key management API ───────────────────────────────
// Typed wrappers over /api/admin/mcp-api-keys (admin HMAC gate). Per-workspace
// keys minted on top of the retained env MCP_API_KEY master key.
import { get, post, del } from './client';
import type {
  McpApiKeyListResponse,
  CreateMcpApiKeyResult,
} from '../../shared/types/mcp-api-keys';

export const mcpApiKeysApi = {
  list: (): Promise<McpApiKeyListResponse> =>
    get<McpApiKeyListResponse>('/api/admin/mcp-api-keys'),

  /** Mint a key. The response's `plaintextKeyOnceShown` is the only time the secret is returned. */
  create: (workspaceId: string, label: string): Promise<CreateMcpApiKeyResult> =>
    post<CreateMcpApiKeyResult>('/api/admin/mcp-api-keys', { workspaceId, label }),

  revoke: (id: string): Promise<{ success: boolean }> =>
    del<{ success: boolean }>(`/api/admin/mcp-api-keys/${id}`),
};
