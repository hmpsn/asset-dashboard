// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStrategyMetrics } from '../../../src/components/strategy/hooks/useStrategyMetrics';

const baseStrategy = {
  generatedAt: '2026-01-01T00:00:00Z',
  pageMap: [
    { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'a', secondaryKeywords: [], currentPosition: 2, impressions: 100, clicks: 10, volume: 50 },
    { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'b', secondaryKeywords: [], currentPosition: 8, impressions: 200, clicks: 5, volume: 50, searchIntent: 'commercial' },
    { pagePath: '/c', pageTitle: 'C', primaryKeyword: 'c', secondaryKeywords: [], volume: 1 }, // below VOLUME_THRESHOLD
  ],
};

describe('useStrategyMetrics', () => {
  it('filters by volume threshold and computes ranking tiers', () => {
    const { result } = renderHook(() => useStrategyMetrics(baseStrategy as any, [], true));
    expect(result.current.filteredPageMap).toHaveLength(2); // /c dropped
    expect(result.current.top3.map(p => p.pagePath)).toEqual(['/a']);
    expect(result.current.top10.map(p => p.pagePath)).toEqual(['/b']);
    expect(result.current.totalClicks).toBe(15);
    expect(result.current.totalImpressions).toBe(300);
  });

  it('flags feedbackNewerThanStrategy when a requested row postdates generation', () => {
    const rows = [{ keyword: 'x', status: 'requested', created_at: '2026-02-01T00:00:00Z', updated_at: null }];
    const { result } = renderHook(() => useStrategyMetrics(baseStrategy as any, rows as any, true));
    expect(result.current.feedbackNewerThanStrategy).toBe(true);
    expect(result.current.requestedFeedback).toHaveLength(1);
  });

  it('never flags newer-feedback when no real strategy', () => {
    const rows = [{ keyword: 'x', status: 'requested', created_at: '2026-02-01T00:00:00Z', updated_at: null }];
    const { result } = renderHook(() => useStrategyMetrics({ ...baseStrategy, generatedAt: null } as any, rows as any, false));
    expect(result.current.feedbackNewerThanStrategy).toBe(false);
  });

  it('derives hasAnyRanking / hasVolumeValidation from the UNFILTERED pageMap', () => {
    const { result } = renderHook(() => useStrategyMetrics(baseStrategy as any, [], true));
    expect(result.current.hasAnyRanking).toBe(true);
    expect(result.current.hasVolumeValidation).toBe(true);
  });

  it('hasAnyRanking is TRUE when the only ranking page is below VOLUME_THRESHOLD (not equal to ranked.length > 0)', () => {
    // The single page ranks (currentPosition) but volume<10 → excluded from `ranked`/filteredPageMap.
    // Unfiltered hasAnyRanking must still be true, while ranked is empty — the exact mis-wire the review caught.
    const belowThreshold = {
      generatedAt: '2026-01-01T00:00:00Z',
      pageMap: [{ pagePath: '/x', pageTitle: 'X', primaryKeyword: 'x', secondaryKeywords: [], currentPosition: 5, volume: 2 }],
    };
    const { result } = renderHook(() => useStrategyMetrics(belowThreshold as any, [], true));
    expect(result.current.ranked).toHaveLength(0);
    expect(result.current.hasAnyRanking).toBe(true);
    expect(result.current.hasVolumeValidation).toBe(true);
  });

  it('hasVolumeValidation is FALSE when no page has volume > 0', () => {
    const noVolume = {
      generatedAt: '2026-01-01T00:00:00Z',
      pageMap: [{ pagePath: '/y', pageTitle: 'Y', primaryKeyword: 'y', secondaryKeywords: [], currentPosition: 3 }],
    };
    const { result } = renderHook(() => useStrategyMetrics(noVolume as any, [], true));
    expect(result.current.hasVolumeValidation).toBe(false);
    expect(result.current.hasAnyRanking).toBe(true);
  });
});
