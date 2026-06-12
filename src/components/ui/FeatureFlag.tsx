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
 *   <FeatureFlag flag="keyword-universe-full">
 *     <KeywordUniversePage />
 *   </FeatureFlag>
 *
 *   <FeatureFlag flag="keyword-universe-full" fallback={<ComingSoon />}>
 *     <KeywordUniversePage />
 *   </FeatureFlag>
 */
export function FeatureFlag({ flag, children, fallback = null }: Props) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
