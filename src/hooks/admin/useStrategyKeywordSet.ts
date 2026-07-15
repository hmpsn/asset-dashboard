/**
 * useStrategyKeywordSet — React Query hook for the managed keyword working set.
 *
 * - useQuery: fetches the active set (removedAt IS NULL) ordered by slotOrder.
 * - useMutation(add/remove/keep): invalidates both the keyword-set key and the
 *   keywordStrategy key on success so the SiteTargetKeywords display states refresh.
 * - External STRATEGY_KEYWORD_SET_UPDATED broadcasts are handled once by the
 *   admin shell's centralized useWsInvalidation registry.
 *
 * `enabled` is gated on the `strategy-keywords-managed-set` feature flag being ON
 * AND workspaceId being present. Flag-OFF → no fetch, no network traffic.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addStrategyKeywordApi,
  getStrategyKeywordSet,
  keepStrategyKeywordApi,
  removeStrategyKeywordApi,
} from '../../api/keyword-strategy';
import { queryKeys } from '../../lib/queryKeys';
import type { ActiveStrategyKeyword } from '../../../shared/types/strategy-keyword-set';

export interface UseStrategyKeywordSetResult {
  /** Active keywords (removedAt IS NULL), ordered by slotOrder. Empty array when loading or flag-OFF. */
  managedKeywordSet: ActiveStrategyKeyword[];
  isLoading: boolean;
  isError: boolean;
  addStrategyKeyword: (keyword: string, source: 'client_request' | 'manual_add') => void;
  removeStrategyKeyword: (keyword: string) => void;
  keepStrategyKeyword: (keyword: string) => void;
  addPending: boolean;
  removePending: boolean;
  keepPending: boolean;
}

/**
 * @param workspaceId - The workspace ID to fetch the keyword set for.
 * @param managedSetEnabled - The `strategy-keywords-managed-set` feature flag value.
 *   When false, the query is disabled and no mutations are submitted.
 */
export function useStrategyKeywordSet(
  workspaceId: string,
  managedSetEnabled: boolean,
): UseStrategyKeywordSetResult {
  const queryClient = useQueryClient();
  const enabled = !!workspaceId && managedSetEnabled;

  // ── Query ──────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.strategyKeywordSet(workspaceId),
    queryFn: () => getStrategyKeywordSet(workspaceId),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });

  const managedKeywordSet = data?.keywords ?? [];

  // ── Invalidation helper ────────────────────────────────────────────
  const invalidateSet = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.strategyKeywordSet(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
  };

  // ── Mutations ──────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: ({ keyword, source }: { keyword: string; source: 'client_request' | 'manual_add' }) =>
      addStrategyKeywordApi(workspaceId, keyword, source),
    onSuccess: invalidateSet,
  });

  const removeMutation = useMutation({
    mutationFn: (keyword: string) => removeStrategyKeywordApi(workspaceId, keyword),
    onSuccess: invalidateSet,
  });

  const keepMutation = useMutation({
    mutationFn: (keyword: string) => keepStrategyKeywordApi(workspaceId, keyword),
    onSuccess: invalidateSet,
  });

  return {
    managedKeywordSet,
    isLoading: enabled ? isLoading : false,
    isError: enabled ? isError : false,
    addStrategyKeyword: (keyword: string, source: 'client_request' | 'manual_add') =>
      addMutation.mutate({ keyword, source }),
    removeStrategyKeyword: (keyword: string) => removeMutation.mutate(keyword),
    keepStrategyKeyword: (keyword: string) => keepMutation.mutate(keyword),
    addPending: addMutation.isPending,
    removePending: removeMutation.isPending,
    keepPending: keepMutation.isPending,
  };
}
