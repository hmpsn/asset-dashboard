import { useState, useEffect, useCallback, useRef } from 'react';

export interface SearchOverview {
  totalClicks: number;
  totalImpressions: number;
  ctr: number;
  avgPosition: number;
  avgCtr?: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  dateRange?: { startDate: string; endDate: string };
}

export interface SearchComparison {
  clicks: { current: number; previous: number; delta: number; pct: number };
  impressions: { current: number; previous: number; delta: number; pct: number };
  ctr: { current: number; previous: number; delta: number; pct: number };
  position: { current: number; previous: number; delta: number; pct: number };
}

interface SearchDataResult {
  overview: SearchOverview;
  trend: Array<{ date: string; clicks: number; impressions: number }>;
  comparison: SearchComparison | null;
}

// Module-level cache so multiple components share the same data
const cache = new Map<string, { data: SearchDataResult; fetchedAt: number }>();
const STALE_MS = 60_000; // 1 min

function cacheKey(wsId: string, days: number): string { return `${wsId}-${days}`; }

function getCached(wsId: string, days: number): SearchDataResult | null {
  const entry = cache.get(cacheKey(wsId, days));
  if (entry && Date.now() - entry.fetchedAt < STALE_MS) return entry.data;
  return null;
}

/**
 * Shared hook for fetching GSC search data with module-level caching.
 * Returns overview, trend, and period comparison.
 * Used by ClientDashboard, WorkspaceHome, and any component needing search data.
 */
export function useSearchData(workspaceId: string | undefined, days = 28) {
  const initialCache = workspaceId ? getCached(workspaceId, days) : null;
  const [overview, setOverview] = useState<SearchOverview | null>(() => initialCache?.overview ?? null);
  const [trend, setTrend] = useState<SearchDataResult['trend']>(() => initialCache?.trend ?? []);
  const [comparison, setComparison] = useState<SearchComparison | null>(() => initialCache?.comparison ?? null);
  const [loading, setLoading] = useState(!initialCache && !!workspaceId);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(0);

  const load = useCallback(async (
    wsId: string,
    numDays: number,
    dateRange?: { startDate: string; endDate: string },
  ) => {
    const id = ++fetchRef.current;
    setLoading(true);
    setError(null);
    try {
      const drParams = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
      const [ovRes, trRes, cmpRes] = await Promise.all([
        fetch(`/api/public/search-overview/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/performance-trend/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/search-comparison/${wsId}?days=${numDays}${drParams}`),
      ]);
      const [ovData, trData, cmpData] = await Promise.all([ovRes.json(), trRes.json(), cmpRes.json()]);
      if (id !== fetchRef.current) return;
      if (ovData.error) throw new Error(ovData.error);

      const result: SearchDataResult = {
        overview: ovData,
        trend: Array.isArray(trData) ? trData : [],
        comparison: cmpData && !cmpData.error ? cmpData : null,
      };
      cache.set(cacheKey(wsId, numDays), { data: result, fetchedAt: Date.now() });
      setOverview(result.overview);
      setTrend(result.trend);
      setComparison(result.comparison);
    } catch (err) {
      if (id === fetchRef.current) setError(err instanceof Error ? err.message : 'Failed to load search data');
    } finally {
      if (id === fetchRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    if (getCached(workspaceId, days)) return;
    load(workspaceId, days);
  }, [workspaceId, days, load]);

  return { overview, trend, comparison, loading, error, reload: load };
}
