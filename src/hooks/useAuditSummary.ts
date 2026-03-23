import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOptional } from '../api/client';

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

/** React Query key for audit summary */
export const auditSummaryKey = (workspaceId: string) =>
  ['audit-summary', workspaceId] as const;

/**
 * Shared hook for fetching audit summary.
 * Uses React Query for caching, deduplication, and background refetching.
 */
export function useAuditSummary(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: audit = null, isLoading: loading, error: queryError } = useQuery({
    queryKey: auditSummaryKey(workspaceId!),
    queryFn: async () => {
      const d = await getOptional<AuditSummaryData>(`/api/public/audit-summary/${workspaceId}`);
      return d?.id ? d : null;
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const error = queryError ? 'Unable to load site health data' : null;

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    queryClient.invalidateQueries({ queryKey: auditSummaryKey(workspaceId) });
  }, [workspaceId, queryClient]);

  return { audit, loading, error, refresh };
}
