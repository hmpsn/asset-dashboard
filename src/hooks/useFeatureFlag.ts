import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAGS } from '../../shared/types/feature-flags';
import type { FeatureFlagKey } from '../../shared/types/feature-flags';
import { queryKeys } from '../lib/queryKeys';

async function fetchFeatureFlags(): Promise<Record<FeatureFlagKey, boolean>> {
  const res = await fetch('/api/feature-flags');
  if (!res.ok) throw new Error('Failed to fetch feature flags');
  return res.json();
}

/**
 * Returns whether a feature flag is enabled.
 *
 * Fetches from /api/feature-flags (cached for the session).
 * Falls back to the static default in FEATURE_FLAGS while loading.
 *
 * Usage:
 *   const enabled = useFeatureFlag('copy-engine');
 */
export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.shared.featureFlags(),
    queryFn: fetchFeatureFlags,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return data?.[flag] ?? FEATURE_FLAGS[flag];
}
