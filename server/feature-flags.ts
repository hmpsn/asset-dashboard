import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_KEYS,
  type FeatureFlagAdminMeta,
  type FeatureFlagKey,
  type FeatureFlagValueSource,
  type WorkspaceFeatureFlagMeta,
} from '../shared/types/feature-flags.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';

/**
 * Server-side feature flag resolution. Priority (highest → lowest):
 *   1. Per-workspace DB override  (only when a workspaceId is supplied — set via
 *      admin UI / canary rollout; survives restarts)
 *   2. Global DB override         (set via admin UI — survives restarts)
 *   3. Env var                    (FEATURE_<FLAG_NAME>=true — set at deploy time)
 *   4. Hardcoded default in FEATURE_FLAGS (always false for dark-launched features)
 *
 * `isFeatureEnabled(flag)` (no workspaceId) is BACKWARD-COMPATIBLE — it resolves
 * exactly as before (global → env → default) and never consults the per-workspace
 * layer. `isFeatureEnabled(flag, workspaceId)` adds the per-workspace layer on top.
 *
 * Performance note: both the global and per-workspace DB overrides are cached in
 * memory for CACHE_TTL_MS (10s). The caches are invalidated immediately on any
 * write via setFlagOverride() / setWorkspaceFlagOverride(). isFeatureEnabled() is
 * safe to call on hot request paths.
 */

const log = createLogger('feature-flags');

// ── Env var overrides (resolved once at startup) ──────────────────────────────

const envOverrides: Partial<Record<FeatureFlagKey, boolean>> = {};

for (const key of FEATURE_FLAG_KEYS) {
  const envKey = `FEATURE_${key.toUpperCase().replace(/-/g, '_')}`;
  const val = process.env[envKey];
  if (val !== undefined) {
    envOverrides[key] = val === 'true' || val === '1';
  }
}

// ── DB persistence ────────────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  getAll: db.prepare(`SELECT key, enabled FROM feature_flag_overrides`),
  upsert: db.prepare(`
    INSERT INTO feature_flag_overrides (key, enabled, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `),
  delete: db.prepare(`DELETE FROM feature_flag_overrides WHERE key = ?`),
}));

// Per-workspace overrides (migration 114). Lazy prepared statements so they are
// created after migrations run (createStmtCache contract).
const wsStmts = createStmtCache(() => ({
  getForWorkspace: db.prepare(
    `SELECT key, enabled FROM feature_flag_workspace_overrides WHERE workspace_id = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO feature_flag_workspace_overrides (key, workspace_id, enabled, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key, workspace_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `),
  delete: db.prepare(`DELETE FROM feature_flag_workspace_overrides WHERE key = ? AND workspace_id = ?`),
}));

// ── In-memory cache for DB overrides ─────────────────────────────────────────
// Avoids a DB query on every isFeatureEnabled() call on hot request paths.
// Invalidated immediately on writes; otherwise expires after CACHE_TTL_MS.

const CACHE_TTL_MS = 10_000; // 10 seconds
let dbOverrideCache: Partial<Record<FeatureFlagKey, boolean>> | null = null;
let cacheExpiry = 0;

function loadDbOverrides(): Partial<Record<FeatureFlagKey, boolean>> {
  const now = Date.now();
  if (dbOverrideCache !== null && now < cacheExpiry) return dbOverrideCache;
  try {
    const rows = stmts().getAll.all() as Array<{ key: string; enabled: number }>;
    const result: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const row of rows) {
      if (row.key in FEATURE_FLAGS) {
        result[row.key as FeatureFlagKey] = row.enabled === 1;
      }
    }
    dbOverrideCache = result;
    cacheExpiry = now + CACHE_TTL_MS;
    return result;
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'feature-flags/loadDbOverrides: programming error');
    return {};
  }
}

function resolveFlag(key: FeatureFlagKey, dbOverrides: Partial<Record<FeatureFlagKey, boolean>>): boolean {
  if (key in dbOverrides) return dbOverrides[key]!;
  if (key in envOverrides) return envOverrides[key]!;
  return FEATURE_FLAGS[key];
}

// ── In-memory cache for per-workspace DB overrides ───────────────────────────
// Keyed by workspaceId; same TTL pattern as the global cache. Invalidated on any
// per-workspace write. Only consulted when isFeatureEnabled() is given a workspaceId,
// so the no-workspaceId hot path is unchanged.

type FlagOverrideMap = Partial<Record<FeatureFlagKey, boolean>>;

const wsOverrideCache = new Map<string, { values: FlagOverrideMap; expiry: number }>();

function loadWorkspaceOverrides(workspaceId: string): FlagOverrideMap {
  const now = Date.now();
  const cached = wsOverrideCache.get(workspaceId);
  if (cached && now < cached.expiry) return cached.values;
  try {
    const rows = wsStmts().getForWorkspace.all(workspaceId) as Array<{ key: string; enabled: number }>;
    const result: FlagOverrideMap = {};
    for (const row of rows) {
      if (row.key in FEATURE_FLAGS) {
        result[row.key as FeatureFlagKey] = row.enabled === 1;
      }
    }
    wsOverrideCache.set(workspaceId, { values: result, expiry: now + CACHE_TTL_MS });
    return result;
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'feature-flags/loadWorkspaceOverrides: programming error');
    return {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a feature flag.
 *
 * @param flag         the flag key
 * @param workspaceId  optional — when supplied, a per-workspace DB override takes
 *                     priority over the global override/env/default chain. Omit it
 *                     for global resolution (byte-identical to the pre-P0 behavior;
 *                     the 52 existing call sites pass no workspaceId).
 */
export function isFeatureEnabled(flag: FeatureFlagKey, workspaceId?: string): boolean {
  if (workspaceId) {
    const wsOverrides = loadWorkspaceOverrides(workspaceId);
    if (flag in wsOverrides) return wsOverrides[flag]!;
  }
  return resolveFlag(flag, loadDbOverrides());
}

/** Returns all flags with their resolved values — used by /api/feature-flags endpoint. */
export function getAllFlags(): Record<FeatureFlagKey, boolean> {
  const dbOverrides = loadDbOverrides(); // single DB read shared across all flags
  const result = {} as Record<FeatureFlagKey, boolean>;
  for (const key of FEATURE_FLAG_KEYS) {
    result[key] = resolveFlag(key, dbOverrides);
  }
  return result;
}

/**
 * Resolve which layer of the GLOBAL chain (db override → env → default) supplied
 * a flag's value. Shared by the global and per-workspace meta builders so the
 * "what does clearing the per-workspace override revert to" answer stays in sync
 * with isFeatureEnabled()'s global resolution.
 */
function resolveGlobalSource(
  key: FeatureFlagKey,
  dbOverrides: Partial<Record<FeatureFlagKey, boolean>>,
): FeatureFlagValueSource {
  if (key in dbOverrides) return 'db';
  if (key in envOverrides) return 'env';
  return 'default';
}

/**
 * Returns all flags with source metadata for the admin UI.
 * Source indicates where the current value came from.
 */
export function getAllFlagsWithMeta(): FeatureFlagAdminMeta[] {
  const dbOverrides = loadDbOverrides(); // single DB read shared across all flags and source checks
  return FEATURE_FLAG_KEYS.map(key => ({
    key,
    enabled: resolveFlag(key, dbOverrides),
    source: resolveGlobalSource(key, dbOverrides),
    default: FEATURE_FLAGS[key],
    label: FEATURE_FLAG_CATALOG[key].label,
    group: FEATURE_FLAG_CATALOG[key].group,
    lifecycle: FEATURE_FLAG_CATALOG[key].lifecycle,
  }));
}

/**
 * Returns all flags with PER-WORKSPACE source metadata for the per-workspace
 * admin override UI. For each flag:
 *   - `enabled` / `source` reflect the workspace-scoped resolution
 *     (per-workspace override → global db override → env → default). `source` is
 *     `'workspace'` when a per-workspace override row exists for the flag.
 *   - `inheritedEnabled` / `inheritedSource` reflect the GLOBAL chain only
 *     (what the workspace falls back to when the override is cleared).
 *
 * Reuses loadWorkspaceOverrides()/loadDbOverrides() so the source attribution is
 * derived from the same rows isFeatureEnabled() resolves against. Single DB read
 * per layer shared across all flags.
 */
export function getWorkspaceFlagsWithMeta(workspaceId: string): WorkspaceFeatureFlagMeta[] {
  const dbOverrides = loadDbOverrides();
  const wsOverrides = loadWorkspaceOverrides(workspaceId);
  return FEATURE_FLAG_KEYS.map(key => {
    const hasWsOverride = key in wsOverrides;
    const inheritedSource = resolveGlobalSource(key, dbOverrides);
    const inheritedEnabled = resolveFlag(key, dbOverrides);
    return {
      key,
      enabled: hasWsOverride ? wsOverrides[key]! : inheritedEnabled,
      source: hasWsOverride ? 'workspace' : inheritedSource,
      inheritedEnabled,
      inheritedSource,
      default: FEATURE_FLAGS[key],
      label: FEATURE_FLAG_CATALOG[key].label,
      group: FEATURE_FLAG_CATALOG[key].group,
      lifecycle: FEATURE_FLAG_CATALOG[key].lifecycle,
    };
  });
}

/**
 * Set a DB override for a flag. Pass `null` to remove the override (revert to env/default).
 * Invalidates the in-memory cache immediately so callers see the change on the next request.
 */
export function setFlagOverride(key: FeatureFlagKey, enabled: boolean | null): void {
  if (enabled === null) {
    stmts().delete.run(key);
    log.info({ key }, 'Feature flag DB override removed');
  } else {
    stmts().upsert.run(key, enabled ? 1 : 0);
    log.info({ key, enabled }, 'Feature flag DB override set');
  }
  dbOverrideCache = null; // invalidate cache immediately
}

/**
 * Set a per-workspace DB override for a flag. Pass `null` to remove the override
 * (the workspace then falls back to the global → env → default chain).
 * Mirrors setFlagOverride(); invalidates that workspace's in-memory cache entry
 * immediately so callers see the change on the next request.
 */
export function setWorkspaceFlagOverride(
  key: FeatureFlagKey,
  workspaceId: string,
  enabled: boolean | null,
): void {
  if (enabled === null) {
    wsStmts().delete.run(key, workspaceId);
    log.info({ key, workspaceId }, 'Feature flag per-workspace DB override removed');
  } else {
    wsStmts().upsert.run(key, workspaceId, enabled ? 1 : 0);
    log.info({ key, workspaceId, enabled }, 'Feature flag per-workspace DB override set');
  }
  wsOverrideCache.delete(workspaceId); // invalidate this workspace's cache immediately
}
