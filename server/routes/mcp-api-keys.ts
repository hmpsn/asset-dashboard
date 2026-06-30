import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
import { createMcpApiKey, listMcpApiKeys, revokeMcpApiKey } from '../mcp/api-keys.js';
import type { McpApiKeyMetadata } from '../mcp/api-keys.js';
import { getWorkspace, listWorkspaces } from '../workspaces.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import type {
  McpApiKeySummary,
  McpApiKeyListResponse,
  CreateMcpApiKeyResult,
} from '../../shared/types/mcp-api-keys.js';

const router = Router();
const log = createLogger('mcp-api-keys-route');

function toSummary(meta: McpApiKeyMetadata, workspaceName: string): McpApiKeySummary {
  return {
    id: meta.id,
    workspaceId: meta.workspaceId,
    workspaceName,
    label: meta.label,
    createdAt: meta.createdAt,
    lastUsedAt: meta.lastUsedAt,
    revokedAt: meta.revokedAt,
    revoked: meta.revokedAt !== null,
  };
}

/**
 * List ALL per-workspace MCP API keys (metadata only — never the hash/plaintext),
 * newest first, enriched with the workspace name. Admin-only: the HMAC gate
 * (`requireAdminAuth`) rejects JWT client users — these are operator infra
 * credentials, not workspace-member data (per CLAUDE.md Auth Conventions).
 */
router.get('/api/admin/mcp-api-keys', requireAdminAuth, (_req, res) => {
  const nameById = new Map(listWorkspaces().map((w) => [w.id, w.name]));
  const keys = listMcpApiKeys().map((k) =>
    toSummary(k, nameById.get(k.workspaceId) ?? 'Unknown workspace'),
  );
  const body: McpApiKeyListResponse = {
    keys,
    masterKeyConfigured: !!process.env.MCP_API_KEY,
  };
  res.json(body);
});

/**
 * Mint a new per-workspace key. Returns the plaintext exactly ONCE — only the hash
 * is stored, so a lost key must be rotated, not recovered.
 */
router.post(
  '/api/admin/mcp-api-keys',
  requireAdminAuth,
  validate(
    z.object({
      workspaceId: z.string().min(1),
      label: z.string().trim().min(1).max(120),
    }),
  ),
  (req, res) => {
    // workspace-scope-from-request-ok: requireAdminAuth is HMAC-only and rejects ALL JWT
    // client users, so no workspace-scoped member can reach this admin-infra route at all —
    // strictly tighter than requireWorkspaceAccessFromBody, which would WRONGLY admit a
    // client JWT scoped to `workspaceId` to mint MCP keys.
    const { workspaceId, label } = req.body as { workspaceId: string; label: string };
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const created = createMcpApiKey(workspaceId, label);
    addActivity(workspaceId, 'mcp_key_created', `MCP API key created: ${label}`, undefined, {
      keyId: created.id,
      label,
    });

    // Re-read to surface the persisted created_at (createMcpApiKey returns only id + plaintext).
    const meta = listMcpApiKeys(workspaceId).find((k) => k.id === created.id);
    if (!meta) {
      // Should be impossible — we just inserted it. Fail loud rather than ship a bad shape.
      log.error({ workspaceId, keyId: created.id }, 'Newly created MCP API key not found on re-read');
      return res.status(500).json({ error: 'Failed to read back created key' });
    }
    const body: CreateMcpApiKeyResult = {
      key: toSummary(meta, ws.name),
      plaintextKeyOnceShown: created.plaintextKeyOnceShown,
    };
    res.json(body);
  },
);

/**
 * Revoke (rotate out) a key by id. Reads the key first for activity context
 * (Data Flow Rule #3). Idempotent at the store layer; a second revoke → 409.
 */
router.delete('/api/admin/mcp-api-keys/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const meta = listMcpApiKeys().find((k) => k.id === id);
  if (!meta) return res.status(404).json({ error: 'API key not found' });

  const revoked = revokeMcpApiKey(id);
  if (!revoked) return res.status(409).json({ error: 'API key already revoked' });

  addActivity(meta.workspaceId, 'mcp_key_revoked', `MCP API key revoked: ${meta.label}`, undefined, {
    keyId: meta.id,
    label: meta.label,
  });
  res.json({ success: true });
});

export default router;
