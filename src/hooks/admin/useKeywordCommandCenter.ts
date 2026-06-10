import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordCommandCenter } from '../../api/keywordCommandCenter';
import { rankTracking } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import { invalidateMany, keywordMutationInvalidationKeys } from '../../lib/queryInvalidation';
import type {
  KeywordCommandCenterActionRequest,
  KeywordCommandCenterBulkActionRequest,
  KeywordCommandCenterRowsQuery,
} from '../../../shared/types/keyword-command-center';

export function useKeywordCommandCenterSummary(
  workspaceId: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterSummary(workspaceId),
    queryFn: () => keywordCommandCenter.summary(workspaceId),
    enabled: !!workspaceId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useKeywordCommandCenterRows(workspaceId: string, query: KeywordCommandCenterRowsQuery) {
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterRows(workspaceId, query),
    queryFn: () => keywordCommandCenter.rows(workspaceId, query),
    enabled: !!workspaceId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useKeywordCommandCenterDetail(workspaceId: string, keyword: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterDetail(workspaceId, keyword ?? ''),
    queryFn: () => keywordCommandCenter.detail(workspaceId, keyword ?? ''),
    enabled: !!workspaceId && !!keyword,
    staleTime: 2 * 60 * 1000,
  });
}

export function useKeywordCommandCenterAction(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: KeywordCommandCenterActionRequest) => keywordCommandCenter.action(workspaceId, body),
    onSuccess: () => {
      invalidateMany(queryClient, keywordMutationInvalidationKeys(workspaceId));
    },
  });
}

export function useKeywordCommandCenterBulkAction(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: KeywordCommandCenterBulkActionRequest) => keywordCommandCenter.bulkAction(workspaceId, body),
    onSuccess: () => {
      invalidateMany(queryClient, keywordMutationInvalidationKeys(workspaceId));
    },
  });
}

/**
 * Hard delete (P3-3c) — its OWN mutation, separate from the lifecycle action enum.
 * Invalidates the same caches as the lifecycle action so the row vanishes everywhere.
 */
export function useKeywordHardDelete(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { keyword: string; force?: boolean }) =>
      keywordCommandCenter.deleteHard(workspaceId, vars.keyword, { force: vars.force }),
    onSuccess: () => {
      invalidateMany(queryClient, keywordMutationInvalidationKeys(workspaceId));
    },
  });
}

/**
 * Add a keyword to rank tracking via the existing server add path
 * (POST /api/rank-tracking/:workspaceId/keywords).
 *
 * Input: the raw keyword string (caller trims before calling mutateAsync).
 * Invalidates keywordMutationInvalidationKeys so the Hub, KCC, and RankTracker
 * caches all refresh.
 */
export function useRankTrackingAddKeyword(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyword: string) => rankTracking.addKeyword(workspaceId, { query: keyword }),
    onSuccess: () => {
      invalidateMany(queryClient, keywordMutationInvalidationKeys(workspaceId));
    },
  });
}
