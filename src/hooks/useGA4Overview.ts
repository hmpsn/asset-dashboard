import { useState, useEffect, useCallback, useRef } from 'react';
import { getOptional } from '../api/client';

export interface GA4OverviewData {
  totalUsers: number;
  totalSessions: number;
  totalPageviews: number;
  avgBounceRate: number;
  avgSessionDuration: number;
  engagementRate?: number;
  screenPageViews?: number;
}

// Module-level cache so multiple components share the same data
const cache = new Map<string, { data: GA4OverviewData; fetchedAt: number }>();
const STALE_MS = 60_000; // 1 min

function cacheKey(wsId: string, days: number): string { return `${wsId}-${days}`; }

function getCached(wsId: string, days: number): GA4OverviewData | null {
  const entry = cache.get(cacheKey(wsId, days));
  if (entry && Date.now() - entry.fetchedAt < STALE_MS) return entry.data;
  return null;
}

/**
 * Shared hook for fetching GA4 overview with module-level caching.
 * Returns the high-level analytics summary (users, sessions, pageviews, bounce rate).
 * Used by WorkspaceHome, ClientDashboard, and any component needing GA4 top-line data.
 */
export function useGA4Overview(workspaceId: string | undefined, days = 28) {
  const initialCache = workspaceId ? getCached(workspaceId, days) : null;
  const [data, setData] = useState<GA4OverviewData | null>(() => initialCache);
  const [loading, setLoading] = useState(!initialCache && !!workspaceId);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;
    if (getCached(workspaceId, days)) return;

    const id = ++fetchRef.current;
    getOptional<GA4OverviewData>(`/api/public/analytics-overview/${workspaceId}?days=${days}`)
      .then(d => {
        if (id !== fetchRef.current) return;
        if (d) {
          cache.set(cacheKey(workspaceId, days), { data: d, fetchedAt: Date.now() });
          setData(d);
          setError(null);
        }
      })
      .catch(() => { if (id === fetchRef.current) setError('Unable to load analytics'); })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId, days]);

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    cache.delete(cacheKey(workspaceId, days));
    const id = ++fetchRef.current;
    setLoading(true);
    getOptional<GA4OverviewData>(`/api/public/analytics-overview/${workspaceId}?days=${days}`)
      .then(d => {
        if (id !== fetchRef.current) return;
        if (d) {
          cache.set(cacheKey(workspaceId, days), { data: d, fetchedAt: Date.now() });
          setData(d);
          setError(null);
        }
      })
      .catch(() => { if (id === fetchRef.current) setError('Unable to load analytics'); })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId, days]);

  return { ga4Overview: data, loading, error, refresh };
}
