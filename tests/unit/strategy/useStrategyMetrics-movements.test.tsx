// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStrategyMetrics } from '../../../src/components/strategy/hooks/useStrategyMetrics';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

function page(over: Partial<PageKeywordMap>): PageKeywordMap {
  return { pagePath: '/p', pageTitle: 'P', primaryKeyword: 'k', secondaryKeywords: [], volume: 100, ...over } as PageKeywordMap;
}

describe('useStrategyMetrics — position movements', () => {
  it('classifies improved / declined / new / lost vs previousPosition', () => {
    const pageMap: PageKeywordMap[] = [
      page({ pagePath: '/a', currentPosition: 3, previousPosition: 8 }),  // improved (smaller = better)
      page({ pagePath: '/b', currentPosition: 12, previousPosition: 6 }), // declined
      page({ pagePath: '/c', currentPosition: 5 }),                       // new (no previous)
      page({ pagePath: '/d', previousPosition: 4 }),                      // lost (no current)
      page({ pagePath: '/e', currentPosition: 2, previousPosition: 2 }),  // unchanged
    ];
    const { result } = renderHook(() =>
      useStrategyMetrics({ pageMap, generatedAt: '2026-06-17' } as never, [], true),
    );
    expect(result.current.movements).toEqual({ improved: 1, declined: 1, new: 1, lost: 1 });
  });

  it('treats sentinel position 0 as unranked (>= 1 guard), not as a #0 ranking', () => {
    const pageMap: PageKeywordMap[] = [
      page({ pagePath: '/a', currentPosition: 0, previousPosition: 5 }), // lost: was ranked, now 0 (unranked)
      page({ pagePath: '/b', currentPosition: 4, previousPosition: 0 }), // new: previously 0 (unranked), now ranked
    ];
    const { result } = renderHook(() =>
      useStrategyMetrics({ pageMap, generatedAt: '2026-06-17' } as never, [], true),
    );
    expect(result.current.movements).toEqual({ improved: 0, declined: 0, new: 1, lost: 1 });
  });

  it('ignores below-volume-threshold pages (consistent with the distribution)', () => {
    const pageMap: PageKeywordMap[] = [
      page({ pagePath: '/a', currentPosition: 3, previousPosition: 8, volume: 5 }), // below VOLUME_THRESHOLD
    ];
    const { result } = renderHook(() =>
      useStrategyMetrics({ pageMap, generatedAt: '2026-06-17' } as never, [], true),
    );
    expect(result.current.movements).toEqual({ improved: 0, declined: 0, new: 0, lost: 0 });
  });
});
