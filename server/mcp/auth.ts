import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';
import { findActiveKeyByHash, hashMcpApiKey, touchLastUsed } from './api-keys.js';
import type { McpApiKeyProfile } from '../../shared/types/mcp-api-keys.js';

const log = createLogger('mcp-auth');

/**
 * Caller identity attached to an authenticated MCP request.
 *
 * - `scope: 'all'` with no key ID/label — the env MCP_API_KEY admin master
 *   key. Unchanged behavior: may operate on every workspace.
 * - `scope: <workspaceId>` — a per-workspace key from the `mcp_api_keys` table.
 *   May ONLY operate on that one workspace (enforced by the canonical tool
 *   registry executor, where the called tool's declared workspace field and
 *   arguments are available). `label` is the key's human-readable label,
 *   exposed for downstream activity attribution.
 */
export interface McpAuthContext {
  scope: 'all' | (string & {});
  /** Per-workspace-key label for activity attribution; undefined for the master key. */
  label?: string;
  /** mcp_api_keys.id for the authenticating per-workspace key; undefined for master. */
  keyId?: string;
  /** Durable transport profile; undefined only for the environment master key. */
  credentialProfile?: McpApiKeyProfile;
}

/**
 * Distinguish the environment master key from a workspace key whose durable
 * workspace ID happens to equal the reserved scope sentinel `all`.
 */
export function isMcpMasterKeyAuth(
  auth: McpAuthContext | undefined,
): auth is McpAuthContext & {
  scope: 'all';
  label?: undefined;
  keyId?: undefined;
  credentialProfile?: undefined;
} {
  return (
    auth?.scope === 'all'
    && auth.keyId === undefined
    && auth.label === undefined
    && auth.credentialProfile === undefined
  );
}

// Augment the Express Request the same way server/auth.ts and
// server/middleware/fingerprint.ts already do (declare global → namespace
// Express → interface Request). This keeps req.mcpAuth typed everywhere.
declare global {
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpAuth?: McpAuthContext;
    }
  }
}

/** Constant-time string compare that also guards against length leaks. */
function constantTimeEquals(a: string, b: string): boolean {
  const expected = Buffer.from(a);
  // Pad to equal length so timingSafeEqual never throws on length mismatch;
  // the explicit length check below makes a length difference always fail.
  const provided = Buffer.from(b.padEnd(a.length));
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided) &&
    a.length === b.length
  );
}

/**
 * MCP auth middleware. Fail-closed everywhere.
 *
 * Order of checks:
 *   1. Bearer token present? (else 401)
 *   2. Matches the env MCP_API_KEY master key (constant-time)? → scope 'all'.
 *      Backward-compatible: existing master-key callers are unaffected.
 *   3. Else look the token's sha256 hash up in mcp_api_keys. Active match →
 *      scope = that key's workspaceId, attach label, touch last_used_at.
 *   4. Neither → 401.
 */
export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const masterKey = process.env.MCP_API_KEY;

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = auth.slice(7);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 1) Master key — retained, all-workspace admin scope, no label.
  // Only attempt the compare when the env var is actually set (fail-closed:
  // an unset master key must never match an empty/absent token).
  if (masterKey && constantTimeEquals(masterKey, token)) {
    req.mcpAuth = { scope: 'all' };
    next();
    return;
  }

  // 2) Per-workspace key — hash the presented token and look up an active row.
  const presentedHash = hashMcpApiKey(token);
  const record = findActiveKeyByHash(presentedHash);
  if (record) {
    req.mcpAuth = {
      scope: record.workspaceId,
      label: record.label,
      keyId: record.id,
      credentialProfile: record.profile,
    };
    touchLastUsed(record.id);
    log.debug({ workspaceId: record.workspaceId, keyId: record.id }, 'MCP per-workspace key authenticated');
    next();
    return;
  }

  // 3) Neither master nor a known active per-workspace key — reject (fail-closed).
  if (!masterKey) {
    log.warn('MCP_API_KEY env var not set and no matching per-workspace key — rejecting');
  }
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * P1 operator-profile credential boundary.
 *
 * This runs only after mcpAuthMiddleware has authenticated the bearer token.
 * It deliberately checks the resolved scope instead of reading or comparing
 * bearer material a second time. Capability-scoped operator credentials are a
 * later phase; until then only the environment master key resolves to `all`.
 */
export function mcpMasterKeyOnlyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isMcpMasterKeyAuth(req.mcpAuth)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
