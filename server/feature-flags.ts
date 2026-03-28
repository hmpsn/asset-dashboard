import { FEATURE_FLAGS, FeatureFlagKey } from '../shared/types/feature-flags.js';

/**
 * Server-side feature flag check. Reads env var overrides at startup.
 *
 * Usage:
 *   import { isFeatureEnabled } from './feature-flags.js';
 *   if (!isFeatureEnabled('copy-engine')) return res.status(404).json({ error: 'Not found' });
 */

const overrides: Partial<Record<FeatureFlagKey, boolean>> = {};

for (const key of Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]) {
  const envKey = `FEATURE_${key.toUpperCase().replace(/-/g, '_')}`;
  const val = process.env[envKey];
  if (val !== undefined) {
    overrides[key] = val === 'true' || val === '1';
  }
}

export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  return overrides[flag] ?? FEATURE_FLAGS[flag];
}

/** Returns all flags with their resolved values — used by /api/feature-flags endpoint. */
export function getAllFlags(): Record<FeatureFlagKey, boolean> {
  const result = {} as Record<FeatureFlagKey, boolean>;
  for (const key of Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]) {
    result[key] = isFeatureEnabled(key);
  }
  return result;
}
