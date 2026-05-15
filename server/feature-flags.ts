import {
  FEATURE_FLAGS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_KEYS,
  type FeatureFlagAdminMeta,
  type FeatureFlagKey,
  type FeatureFlagValueSource,
} from '../shared/types/feature-flags.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';

/**
 * Server-side feature flag resolution. Priority (highest → lowest):
 *   1. DB override  (set via admin UI — survives restarts)
 *   2. Env var      (FEATURE_<FLAG_NAME>=true — set at deploy time)
 *   3. Hardcoded default in FEATURE_FLAGS (always false for dark-launched features)
 *
 * Performance note: DB overrides are cached in memory for CACHE_TTL_MS (10s).
 * The cache is invalidated immediately on any write via setFlagOverride().
 * isFeatureEnabled() is safe to call on hot request paths.
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

// ── Public API ────────────────────────────────────────────────────────────────

export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
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
 * Returns all flags with source metadata for the admin UI.
 * Source indicates where the current value came from.
 */
export function getAllFlagsWithMeta(): FeatureFlagAdminMeta[] {
  const dbOverrides = loadDbOverrides(); // single DB read shared across all flags and source checks
  return FEATURE_FLAG_KEYS.map(key => {
    let source: FeatureFlagValueSource;
    if (key in dbOverrides) source = 'db';
    else if (key in envOverrides) source = 'env';
    else source = 'default';

    return {
      key,
      enabled: resolveFlag(key, dbOverrides),
      source,
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
