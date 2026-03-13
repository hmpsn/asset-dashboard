import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getOptional } from '../api/client';
import type { PageEditStatus } from '../components/ui/statusConfig';

export interface PageEditState {
  pageId: string;
  slug?: string;
  status: PageEditStatus;
  auditIssues?: string[];
  fields?: string[];
  source?: string;
  approvalBatchId?: string;
  contentRequestId?: string;
  workOrderId?: string;
  rejectionNote?: string;
  updatedAt: string;
  updatedBy?: 'admin' | 'client' | 'system';
}

export interface PageEditSummary {
  clean: number;
  issueDetected: number;
  fixProposed: number;
  inReview: number;
  approved: number;
  rejected: number;
  live: number;
  total: number;
}

// Module-level cache so multiple components share the same data
const cache = new Map<string, { data: Record<string, PageEditState>; fetchedAt: number }>();
const STALE_MS = 30_000;

function getCached(wsId: string): Record<string, PageEditState> | null {
  const entry = cache.get(wsId);
  if (entry && Date.now() - entry.fetchedAt < STALE_MS) return entry.data;
  return null;
}

/**
 * Shared hook for reading unified page edit states.
 * Caches at module level so multiple tools read the same data.
 */
export function usePageEditStates(workspaceId: string | undefined, isPublic = false) {
  // Initialize from cache synchronously (no setState in effect needed)
  const initialCache = workspaceId ? getCached(workspaceId) : null;
  const [states, setStates] = useState<Record<string, PageEditState>>(
    () => initialCache ?? {},
  );
  const [loading, setLoading] = useState(!initialCache && !!workspaceId);
  const fetchRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;
    // If cache is fresh, we already have data from initializer — skip fetch
    if (getCached(workspaceId)) return;

    const id = ++fetchRef.current;
    // loading was initialized to true when no cache — no need to set here
    const url = isPublic
      ? `/api/public/page-states/${workspaceId}`
      : `/api/workspaces/${workspaceId}/page-states`;
    getOptional<Record<string, PageEditState>>(url)
      .then(data => {
        if (id !== fetchRef.current || !data) return;
        cache.set(workspaceId, { data, fetchedAt: Date.now() });
        setStates(data);
      })
      .catch(() => { /* non-critical */ })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId, isPublic]);

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    cache.delete(workspaceId);
    const id = ++fetchRef.current;
    setLoading(true);
    const url = isPublic
      ? `/api/public/page-states/${workspaceId}`
      : `/api/workspaces/${workspaceId}/page-states`;
    getOptional<Record<string, PageEditState>>(url)
      .then(data => {
        if (id !== fetchRef.current || !data) return;
        cache.set(workspaceId, { data, fetchedAt: Date.now() });
        setStates(data);
      })
      .catch(() => { /* non-critical */ })
      .finally(() => { if (id === fetchRef.current) setLoading(false); });
  }, [workspaceId, isPublic]);

  const getState = useCallback(
    (pageId: string): PageEditState | undefined => states[pageId],
    [states],
  );

  const summary: PageEditSummary = useMemo(() => {
    const vals = Object.values(states);
    return {
      clean: vals.filter(s => s.status === 'clean').length,
      issueDetected: vals.filter(s => s.status === 'issue-detected').length,
      fixProposed: vals.filter(s => s.status === 'fix-proposed').length,
      inReview: vals.filter(s => s.status === 'in-review').length,
      approved: vals.filter(s => s.status === 'approved').length,
      rejected: vals.filter(s => s.status === 'rejected').length,
      live: vals.filter(s => s.status === 'live').length,
      total: vals.length,
    };
  }, [states]);

  return { states, loading, refresh, getState, summary };
}
