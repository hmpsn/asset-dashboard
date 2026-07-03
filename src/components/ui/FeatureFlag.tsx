import React from 'react';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';

interface Props {
  flag: FeatureFlagKey;
  children: React.ReactNode;
  /** Rendered when the flag is disabled. Defaults to null. */
  fallback?: React.ReactNode;
}

/**
 * Conditionally renders children based on a feature flag.
 *
 * Usage:
 *   <FeatureFlag flag="strategy-the-issue">
 *     <TheIssuePage />
 *   </FeatureFlag>
 *
 *   <FeatureFlag flag="strategy-the-issue" fallback={<ComingSoon />}>
 *     <TheIssuePage />
 *   </FeatureFlag>
 */
export function FeatureFlag({ flag, children, fallback = null }: Props) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
