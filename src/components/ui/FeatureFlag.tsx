import React from 'react';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { FeatureFlagKey } from '../../../shared/types/feature-flags';

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
 *   <FeatureFlag flag="copy-engine">
 *     <CopyEnginePage />
 *   </FeatureFlag>
 *
 *   <FeatureFlag flag="copy-engine" fallback={<ComingSoon />}>
 *     <CopyEnginePage />
 *   </FeatureFlag>
 */
export function FeatureFlag({ flag, children, fallback = null }: Props) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
