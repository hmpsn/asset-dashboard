/**
 * useKeeperOverride — admin mutation hook for the cannibalization keeper-override endpoint.
 *
 * Patches the keeper page for a cannibalization URL set and invalidates both
 * recommendation and keyword-strategy reads on success (via useWorkspaceEvents
 * for the both-halves WS contract — the server broadcasts RECOMMENDATIONS_UPDATED).
 *
 * Lane 1E — The Issue Phase 1.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { cannibalizationUrlSetKey } from '../../../shared/page-address-utils.js';
import { patch } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';
import { useWorkspaceEvents } from '../useWorkspaceEvents.js';
import { WS_EVENTS } from '../../lib/wsEvents.js';
import type { KeywordStrategyRead } from './useKeywordStrategy.js';

interface KeeperOverridePatchResponse {
  keeperPath: string;
  urlSetKey: string;
}

interface SetKeeperOverrideArgs {
  urlSetKey: string;
  keeperPath: string;
}

interface KeeperMutationContext {
  previousStrategy: KeywordStrategyRead | null | undefined;
}

/**
 * Returns a mutation for setting the keeper path for a cannibalization URL set.
 *
 * Both-halves WS contract (CLAUDE.md §Data Flow Rule #2):
 *   - Server broadcasts RECOMMENDATIONS_UPDATED after PATCH.
 *   - This hook handles the frontend half: invalidate admin recommendations cache.
 */
export function useKeeperOverride(workspaceId: string) {
  const queryClient = useQueryClient();
  const invalidateKeeperReads = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.admin.recommendations(workspaceId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.admin.keywordStrategy(workspaceId),
    });
  }, [queryClient, workspaceId]);

  const mutation = useMutation<KeeperOverridePatchResponse, Error, SetKeeperOverrideArgs, KeeperMutationContext>({
    mutationFn: ({ urlSetKey, keeperPath }: SetKeeperOverrideArgs): Promise<KeeperOverridePatchResponse> =>
      patch<KeeperOverridePatchResponse>(
        `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(urlSetKey)}/keeper`,
        { keeperPath },
      ),
    onMutate: async ({ urlSetKey, keeperPath }) => {
      const strategyKey = queryKeys.admin.keywordStrategy(workspaceId);
      await queryClient.cancelQueries({ queryKey: strategyKey });
      const previousStrategy = queryClient.getQueryData<KeywordStrategyRead | null>(strategyKey);
      queryClient.setQueryData<KeywordStrategyRead | null>(strategyKey, (current) => {
        if (!current?.cannibalization) return current;
        return {
          ...current,
          cannibalization: current.cannibalization.map((item) => (
            cannibalizationUrlSetKey(item.pages.map((page) => page.path)) === urlSetKey
              ? { ...item, canonicalPath: keeperPath }
              : item
          )),
        };
      });
      return { previousStrategy };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(
          queryKeys.admin.keywordStrategy(workspaceId),
          context.previousStrategy,
        );
      }
    },
    onSuccess: () => {
      invalidateKeeperReads();
    },
  });

  // Both-halves WS handler — server broadcasts RECOMMENDATIONS_UPDATED on keeper-override PATCH.
  // useWorkspaceEvents is called unconditionally (Rules of Hooks); the internal subscription
  // sends 'subscribe' only when workspaceId is present.
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => {
        invalidateKeeperReads();
      },
    }),
    [invalidateKeeperReads],
  );
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    setKeeper: mutation.mutate,
    isSettingKeeper: mutation.isPending,
    keeperError: mutation.error,
  };
}
