import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/** React Query key for page edit states */
export const pageEditStatesKey = (workspaceId: string, isPublic: boolean) =>
  ['page-edit-states', workspaceId, isPublic ? 'public' : 'admin'] as const;

/**
 * Shared hook for reading unified page edit states.
 * Uses React Query for caching, deduplication, and background refetching.
 */
export function usePageEditStates(workspaceId: string | undefined, isPublic = false) {
  const queryClient = useQueryClient();

  const { data: states = {}, isLoading: loading } = useQuery({
    queryKey: pageEditStatesKey(workspaceId!, isPublic),
    queryFn: async () => {
      const url = isPublic
        ? `/api/public/page-states/${workspaceId}`
        : `/api/workspaces/${workspaceId}/page-states`;
      const data = await getOptional<Record<string, PageEditState>>(url);
      return data ?? {};
    },
    enabled: !!workspaceId,
    staleTime: 30_000, // matches previous 30s cache TTL
  });

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    queryClient.invalidateQueries({ queryKey: pageEditStatesKey(workspaceId, isPublic) });
  }, [workspaceId, isPublic, queryClient]);

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
