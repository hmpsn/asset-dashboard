// ── useActOnRecommendation — client "Act on this" greenlight ───────────────────
//
// Phase 2 (strategy-the-issue). "Act on this" is a durable content REQUEST — a
// retainer greenlight — NOT generation. The mutation POSTs the public act-on route
// (Track C / audit P2-3), which sets the rec's clientStatus → 'approved' and creates
// a server-side content-request work-queue item. Nothing is pre-generated or generated
// on the fly; the operator works the request later.
//
// On success it invalidates the evergreen feed + the loop-footer response summary so
// the greenlit card drops out of the feed and the footer count ("you've greenlit N")
// ticks up immediately — the client-side half of the closed loop.
//
// This hook MUST NOT import any brief/post generator or fixContext helper (enforced
// by the request-not-generate + client-act-on-must-not-fire-fixContext pr-check rules).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { theIssueApi, type ActOnRecommendationResult } from '../../api/theIssue';
import { queryKeys } from '../../lib/queryKeys';
import { ISSUE_REQUEST_SUCCESS_TOAST } from '../../components/client/the-issue/evergreenCopy';

interface UseActOnRecommendationOptions {
  workspaceId?: string;
  /** Optional toast on success/failure (the surface passes its own toast sink). */
  setToast?: (msg: string) => void;
}

export function useActOnRecommendation({ workspaceId, setToast }: UseActOnRecommendationOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation<ActOnRecommendationResult, Error, string>({
    mutationFn: (recId: string) => {
      if (!workspaceId) throw new Error('No workspace');
      return theIssueApi.actOn(workspaceId, recId);
    },
    onSuccess: () => {
      if (!workspaceId) return;
      // Both halves of the loop: refresh the curated feed (greenlit rec drops out as it
      // is no longer clientStatus='sent') and the response summary (greenlit count ↑).
      void queryClient.invalidateQueries({ queryKey: queryKeys.client.theIssue(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.client.recResponses(workspaceId) });
      // Audit blocker #1 (D1) success copy — names the plan + the no-charge consequence.
      setToast?.(ISSUE_REQUEST_SUCCESS_TOAST);
    },
    onError: () => {
      setToast?.('Could not send that just now — please try again.');
    },
  });

  return {
    /** Greenlight a recommendation (creates a content request). */
    actOn: mutation.mutate,
    /** Promise-returning variant for callers that need to await. */
    actOnAsync: mutation.mutateAsync,
    isActingOn: mutation.isPending,
    /** The recId currently in flight (for per-card spinner state). */
    pendingRecId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}
