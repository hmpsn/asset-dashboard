import { useState, useEffect, useCallback, useRef } from 'react';

export interface AuditSummaryData {
  id: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  previousScore?: number;
  scoreHistory?: Array<{ id: string; createdAt: string; siteScore: number; errors: number; warnings: number }>;
}

// Module-level cache so multiple components share the same data
const cache = new Map<string, { data: AuditSummaryData; fetchedAt: number }>();
const STALE_MS = 60_000; // 1 min

function getCached(wsId: string): AuditSummaryData | null {
  const entry = cache.get(wsId);
  if (entry && Date.now() - entry.fetchedAt < STALE_MS) return entry.data;
  return null;
}

/**
 * Shared hook for fetching audit summary with module-level caching.
 * Used by WorkspaceHome, ClientDashboard, and any component needing site health data.
 */
export function useAuditSummary(workspaceId: string | undefined) {
  const initialCache = workspaceId ? getCached(workspaceId) : null;
  const [data, setData] = useState<AuditSummaryData | null>(() => initialCache);
  const [loading, setLoading] = useState(!initialCache && !!workspaceId);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;
    if (getCached(workspaceId)) return;

    const id = ++fetchRef.current;
    fetch(`/api/public/audit-summary/${workspaceId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (id !== fetchRef.current) return;
        if (d?.id) {
          cache.set(workspaceId, { data: d, fetchedAt: Date.now() });
          setData(d);
          setError(null);
        }
      })
      .catch(() => { if (id === fetchRef.current) setError('Unable to load site health data'); })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId]);

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    cache.delete(workspaceId);
    const id = ++fetchRef.current;
    setLoading(true);
    fetch(`/api/public/audit-summary/${workspaceId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (id !== fetchRef.current) return;
        if (d?.id) {
          cache.set(workspaceId, { data: d, fetchedAt: Date.now() });
          setData(d);
          setError(null);
        }
      })
      .catch(() => { if (id === fetchRef.current) setError('Unable to load site health data'); })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId]);

  return { audit: data, loading, error, refresh };
}
