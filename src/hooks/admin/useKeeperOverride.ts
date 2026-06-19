/**
 * useKeeperOverride — admin mutation hook for the cannibalization keeper-override endpoint.
 *
 * Patches the keeper page for a cannibalization URL set and invalidates the
 * admin recommendations cache on success (via useWorkspaceEvents for the
 * both-halves WS contract — the server broadcasts RECOMMENDATIONS_UPDATED).
 *
 * Lane 1E — The Issue Phase 1.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { patch } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';
import { useWorkspaceEvents } from '../useWorkspaceEvents.js';
import { WS_EVENTS } from '../../lib/wsEvents.js';

interface KeeperOverridePatchResponse {
  keeperPath: string;
  urlSetKey: string;
}

interface SetKeeperOverrideArgs {
  urlSetKey: string;
  keeperPath: string;
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

  const mutation = useMutation({
    mutationFn: ({ urlSetKey, keeperPath }: SetKeeperOverrideArgs): Promise<KeeperOverridePatchResponse> =>
      patch<KeeperOverridePatchResponse>(
        `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(urlSetKey)}/keeper`,
        { keeperPath },
      ),
    onSuccess: () => {
      // Invalidate the admin recommendations cache so the cockpit reflects the new keeper.
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.recommendations(workspaceId),
      });
    },
  });

  // Both-halves WS handler — server broadcasts RECOMMENDATIONS_UPDATED on keeper-override PATCH.
  // useWorkspaceEvents is called unconditionally (Rules of Hooks); the internal subscription
  // sends 'subscribe' only when workspaceId is present.
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.recommendations(workspaceId),
        });
      },
    }),
    [queryClient, workspaceId],
  );
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    setKeeper: mutation.mutate,
    isSettingKeeper: mutation.isPending,
    keeperError: mutation.error,
  };
}
