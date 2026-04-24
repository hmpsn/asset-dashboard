/**
 * Shared layout utilities — single gap scale referenced by Row, Stack, and
 * Grid so the Phase 5 gap enum lives in one place.
 */
export type GapSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const gapMap: Record<GapSize, string> = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
};
