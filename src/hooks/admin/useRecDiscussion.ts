/**
 * Admin hooks for the strategy v3 recommendation discussion thread.
 *
 * useRecDiscussion — reads a single rec's discussion thread (admin cockpit
 * Discuss filter) via GET /api/recommendations/:ws/:recId/discussion.
 *
 * usePostRecDiscussion — appends a strategist reply via POST to the same
 * route; invalidates the workspace-level recDiscussion key on success (the
 * WS broadcast RECOMMENDATIONS_DISCUSSION_UPDATED also covers cross-client
 * fan-out).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import type { RecDiscussionEntry } from '../../../shared/types/recommendations';

/** Admin cockpit Discuss filter — read a rec's discussion thread. */
export function useRecDiscussion(workspaceId: string, recId: string | undefined) {
  return useQuery<RecDiscussionEntry[]>({
    queryKey: [...queryKeys.admin.recDiscussion(workspaceId), recId ?? '_'],
    queryFn: () => recommendations.listDiscussion(workspaceId, recId!),
    enabled: !!workspaceId && !!recId,
    staleTime: 15_000,
  });
}

/** Admin cockpit — append a strategist reply to a rec's discussion thread. */
export function usePostRecDiscussion(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recId, body }: { recId: string; body: string }) =>
      recommendations.postDiscussion(workspaceId, recId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.recDiscussion(workspaceId) });
    },
  });
}
