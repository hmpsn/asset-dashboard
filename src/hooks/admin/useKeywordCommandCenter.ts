import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordCommandCenter } from '../../api/keywordCommandCenter';
import { rankTracking } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import { invalidateMany, keywordMutationInvalidationKeys } from '../../lib/queryInvalidation';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
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

export function useKeywordCommandCenterInitialView(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterInitial(workspaceId, query),
    queryFn: async () => {
      const initial = await keywordCommandCenter.initial(workspaceId, query);
      queryClient.setQueryData(queryKeys.admin.keywordCommandCenterSummary(workspaceId), initial.summary);
      queryClient.setQueryData(queryKeys.admin.keywordCommandCenterRows(workspaceId, query), initial.rows);
      return initial;
    },
    enabled: !!workspaceId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useKeywordCommandCenterRows(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterRows(workspaceId, query),
    queryFn: () => keywordCommandCenter.rows(workspaceId, query),
    enabled: !!workspaceId && enabled,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
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

/**
 * Start the national advanced-SERP rank refresh job (P6 / national-serp-tracking).
 * POST /api/rank-tracking/:workspaceId/refresh-national — gated server-side by the flag +
 * Growth+ tier. Tracks the returned job through useBackgroundTasks/NotificationBell; the
 * command-center cache also refreshes live via the SERP_SNAPSHOTS_REFRESHED broadcast, so the
 * onSuccess invalidate is just the optimistic local nudge.
 */
export function useNationalSerpRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  const { trackJob } = useBackgroundTasks();
  return useMutation({
    mutationFn: () => rankTracking.refreshNational(workspaceId),
    onSuccess: (result) => {
      if (result?.jobId) {
        trackJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, result.jobId, { workspaceId });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
    },
  });
}

/**
 * Toggle the pin state of a tracked keyword via the existing rank-tracking pin
 * endpoint (PATCH /api/rank-tracking/:workspaceId/keywords/:keyword/pin).
 *
 * Input: the raw keyword string. Invalidates keywordMutationInvalidationKeys so
 * the Hub (and the KCC prefix key the drawer detail lives under), rank-tracking,
 * and intelligence caches all refresh and the Pinned badge re-resolves. Pinning
 * is only meaningful for tracked keywords — the server no-ops the broadcast for
 * untracked ones, and the drawer only surfaces the toggle when tracked.
 */
export function useRankTrackingTogglePin(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyword: string) => rankTracking.togglePin(workspaceId, keyword),
    onSuccess: () => {
      invalidateMany(queryClient, keywordMutationInvalidationKeys(workspaceId));
    },
  });
}
