/**
 * Per-workspace MCP API key store.
 *
 * ADDITIVE on top of the env `MCP_API_KEY` admin master key (which is retained,
 * unchanged, and grants all-workspace scope). Per-workspace keys live in SQLite,
 * are stored hashed (sha256 hex) — never in plaintext — and are scoped to exactly
 * ONE workspace. A presented key is authenticated by looking up its hash; revoked
 * keys (`revoked_at` non-null) are ignored, which is how rotation works.
 *
 * Plaintext is shown to the operator exactly once, at creation time. After that
 * only the hash is recoverable, so a lost key must be rotated, not recovered.
 */
import { randomBytes, randomUUID, createHash } from 'crypto';
import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';
import { createLogger } from '../logger.js';
import {
  MCP_API_KEY_PROFILES,
  type McpApiKeyProfile,
} from '../../shared/types/mcp-api-keys.js';

const log = createLogger('mcp-api-keys');

/** Plaintext key prefix — makes keys recognizable + greppable in logs/configs. */
const KEY_PREFIX = 'mcp_';

export interface McpApiKeyRecord {
  id: string;
  workspaceId: string;
  label: string;
  profile: McpApiKeyProfile;
}

export interface CreatedMcpApiKey {
  id: string;
  /** Plaintext key — shown exactly once. Never persisted; only its hash is stored. */
  plaintextKeyOnceShown: string;
}

/**
 * Key metadata for the admin management UI. NEVER includes the hash or plaintext —
 * only non-secret descriptive fields the operator needs to list/rotate keys.
 */
export interface McpApiKeyMetadata {
  id: string;
  workspaceId: string;
  profile: McpApiKeyProfile;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// INTERNAL — not exported
interface McpApiKeyRow {
  id: string;
  workspace_id: string;
  key_hash: string;
  profile: McpApiKeyProfile;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO mcp_api_keys
      (id, workspace_id, key_hash, profile, label, created_at, last_used_at, revoked_at)
    VALUES
      (@id, @workspace_id, @key_hash, @profile, @label, @created_at, NULL, NULL)
  `),
  // Only active (non-revoked) keys authenticate. The hash index serves this lookup.
  findActiveByHash: db.prepare<[keyHash: string]>(
    `SELECT * FROM mcp_api_keys WHERE key_hash = ? AND revoked_at IS NULL`,
  ),
  touchLastUsed: db.prepare<[lastUsedAt: string, id: string]>(
    `UPDATE mcp_api_keys SET last_used_at = ? WHERE id = ?`,
  ),
  // Idempotent revoke: only stamps revoked_at if not already revoked.
  revoke: db.prepare<[revokedAt: string, id: string]>(
    `UPDATE mcp_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ),
  // Admin listing — metadata only, never key_hash. Newest first; includes revoked
  // keys so the operator sees rotation history.
  listAll: db.prepare(
    `SELECT id, workspace_id, profile, label, created_at, last_used_at, revoked_at
       FROM mcp_api_keys ORDER BY created_at DESC`,
  ),
  listByWorkspace: db.prepare<[workspaceId: string]>(
    `SELECT id, workspace_id, profile, label, created_at, last_used_at, revoked_at
       FROM mcp_api_keys WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
}));

/** sha256 hex of the plaintext key — the only representation we persist. */
export function hashMcpApiKey(plaintextKey: string): string {
  return createHash('sha256').update(plaintextKey).digest('hex');
}

/**
 * Create a new per-workspace MCP API key.
 * Returns the new id and the plaintext key (shown once). Only the hash is stored.
 */
export function createMcpApiKey(
  workspaceId: string,
  label: string,
  profile: McpApiKeyProfile = MCP_API_KEY_PROFILES.FULL,
): CreatedMcpApiKey {
  const id = randomUUID();
  // 32 bytes of CSPRNG entropy, base64url (URL/header-safe, no padding).
  const plaintextKey = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const keyHash = hashMcpApiKey(plaintextKey);

  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    key_hash: keyHash,
    profile,
    label,
    created_at: new Date().toISOString(),
  });

  log.info({ workspaceId, keyId: id, profile }, 'MCP API key created');
  return { id, plaintextKeyOnceShown: plaintextKey };
}

/**
 * Look up an active (non-revoked) key by its sha256 hash.
 * Returns the caller identity (id, workspaceId, label) or null. Revoked and
 * unknown keys both return null — fail-closed.
 */
export function findActiveKeyByHash(keyHash: string): McpApiKeyRecord | null {
  const row = stmts().findActiveByHash.get(keyHash) as McpApiKeyRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    profile: row.profile,
  };
}

/**
 * List API key METADATA (never the hash or plaintext) for the admin management UI.
 * Pass a `workspaceId` to scope to one workspace; omit for ALL keys across every
 * workspace (the admin global view). Newest first; revoked keys are included so the
 * operator can see rotation history.
 */
export function listMcpApiKeys(workspaceId?: string): McpApiKeyMetadata[] {
  const rows = (
    workspaceId ? stmts().listByWorkspace.all(workspaceId) : stmts().listAll.all()
  ) as Array<Omit<McpApiKeyRow, 'key_hash'>>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    profile: row.profile,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/** Stamp last_used_at for activity/audit. Best-effort; never throws to the caller. */
export function touchLastUsed(id: string): void {
  try {
    stmts().touchLastUsed.run(new Date().toISOString(), id);
  } catch (err) {
    log.warn({ err, keyId: id }, 'Failed to touch MCP API key last_used_at');
  }
}

/**
 * Revoke (rotate out) a key. Idempotent: returns true if this call revoked an
 * active key, false if the key was already revoked or does not exist.
 */
export function revokeMcpApiKey(id: string): boolean {
  const info = stmts().revoke.run(new Date().toISOString(), id);
  if (info.changes > 0) {
    log.info({ keyId: id }, 'MCP API key revoked');
    return true;
  }
  return false;
}
