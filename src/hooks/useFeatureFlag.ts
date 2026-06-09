import { useQuery } from '@tanstack/react-query';
import { featureFlags } from '../api/misc';
import { FEATURE_FLAGS } from '../../shared/types/feature-flags';
import type { FeatureFlagKey } from '../../shared/types/feature-flags';
import { queryKeys } from '../lib/queryKeys';

/**
 * Returns whether a feature flag is enabled.
 *
 * Fetches from /api/feature-flags (cached for the session).
 * Falls back to the static default in FEATURE_FLAGS while loading.
 *
 * Usage:
 *   const enabled = useFeatureFlag('keyword-hub');
 */
export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.shared.featureFlags(),
    queryFn: featureFlags.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return data?.[flag] ?? FEATURE_FLAGS[flag];
}
