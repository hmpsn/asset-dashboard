import { FEATURE_FLAGS, FeatureFlagKey } from '../shared/types/feature-flags.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

/**
 * Server-side feature flag resolution. Priority (highest → lowest):
 *   1. DB override  (set via admin UI — survives restarts)
 *   2. Env var      (FEATURE_<FLAG_NAME>=true — set at deploy time)
 *   3. Hardcoded default in FEATURE_FLAGS (always false for dark-launched features)
 */

// ── Env var overrides (resolved once at startup) ──────────────────────────────

const envOverrides: Partial<Record<FeatureFlagKey, boolean>> = {};

for (const key of Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]) {
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

/** Load all DB overrides as a map. Returns empty map if table doesn't exist yet. */
function loadDbOverrides(): Partial<Record<FeatureFlagKey, boolean>> {
  try {
    const rows = stmts().getAll.all() as Array<{ key: string; enabled: number }>;
    const result: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const row of rows) {
      if (row.key in FEATURE_FLAGS) {
        result[row.key as FeatureFlagKey] = row.enabled === 1;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  const dbOverrides = loadDbOverrides();
  // DB override takes highest priority
  if (flag in dbOverrides) return dbOverrides[flag]!;
  // Env var next
  if (flag in envOverrides) return envOverrides[flag]!;
  // Fall back to hardcoded default
  return FEATURE_FLAGS[flag];
}

/** Returns all flags with their resolved values and source. */
export function getAllFlags(): Record<FeatureFlagKey, boolean> {
  const result = {} as Record<FeatureFlagKey, boolean>;
  for (const key of Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]) {
    result[key] = isFeatureEnabled(key);
  }
  return result;
}

/**
 * Returns all flags with source metadata for the admin UI.
 * Source indicates where the current value came from.
 */
export function getAllFlagsWithMeta(): Array<{
  key: FeatureFlagKey;
  enabled: boolean;
  source: 'db' | 'env' | 'default';
  default: boolean;
}> {
  const dbOverrides = loadDbOverrides();
  return (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map(key => {
    let source: 'db' | 'env' | 'default';
    if (key in dbOverrides) source = 'db';
    else if (key in envOverrides) source = 'env';
    else source = 'default';

    return {
      key,
      enabled: isFeatureEnabled(key),
      source,
      default: FEATURE_FLAGS[key],
    };
  });
}

/** Set a DB override for a flag. Pass `null` to remove the override (revert to env/default). */
export function setFlagOverride(key: FeatureFlagKey, enabled: boolean | null): void {
  if (enabled === null) {
    stmts().delete.run(key);
  } else {
    stmts().upsert.run(key, enabled ? 1 : 0);
  }
}
