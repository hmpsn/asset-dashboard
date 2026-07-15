/**
 * Admin hooks for the recommendations queue.
 *
 * useAdminRecommendationSet — fetches the full set for a workspace via the
 * admin-only GET /api/recommendations/:workspaceId route (all statuses, full
 * OV data including emvPerWeek). Uses queryKeys.admin.recommendations so it
 * gets its own React Query cache entry separate from the client-facing
 * queryKeys.shared.recommendations key (which strips EMV and only returns a
 * subset).
 *
 * useAdminUndismissRecommendation — PATCH .../undismiss mutation with
 * awaited invalidation of every recommendation consumer on success.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';
import type { RecommendationSet, Recommendation } from '../../../shared/types/recommendations.js';

export function useAdminRecommendationSet(workspaceId: string | undefined, opts?: { enabled?: boolean }) {
  return useQuery<RecommendationSet>({
    queryKey: queryKeys.admin.recommendations(workspaceId!),
    queryFn: (): Promise<RecommendationSet> =>
      get<RecommendationSet>(`/api/recommendations/${workspaceId}`),
    // `enabled` lets a caller suppress the fetch entirely (e.g. a flag-gated consumer that must not
    // add a network request when the flag is off). Defaults to true — existing callers are unaffected.
    enabled: !!workspaceId && (opts?.enabled ?? true),
    staleTime: 30_000,
  });
}

export function useAdminUndismissRecommendation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recId: string): Promise<Recommendation> =>
      patch<Recommendation>(`/api/recommendations/${workspaceId}/${recId}/undismiss`, {}),
    onSuccess: (updated) => {
      // Apply the authoritative status response before refetching. If a refresh
      // fails, the history row cannot remain visibly dismissed and invite the
      // same mutation twice; independent lifecycle axes (for example `struck`)
      // remain intact because the response is merged onto the cached row.
      qc.setQueryData<RecommendationSet>(
        queryKeys.admin.recommendations(workspaceId),
        current => current
          ? {
              ...current,
              recommendations: current.recommendations.map(recommendation => (
                recommendation.id === updated.id
                  ? { ...recommendation, ...updated }
                  : recommendation
              )),
            }
          : current,
      );

      return Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) }),
        qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) }),
        qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) }),
        qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) }),
        qc.invalidateQueries({ queryKey: queryKeys.admin.issueLenses(workspaceId) }),
      ]);
    },
  });
}

/**
 * Derives the ordered id list of a workspace's recommendations for predicate selection
 * (Strategy v3 P3 — feeds useCurationSelection). Returns [] while loading. The cockpit
 * narrows this to the active filter before passing it to the selection hook; this hook is
 * intentionally filter-agnostic (it returns ALL rec ids in set order) so the cockpit owns
 * the filter predicate in one place.
 */
export function useAdminRecommendationIds(workspaceId: string | undefined): string[] {
  const { data } = useAdminRecommendationSet(workspaceId, { enabled: !!workspaceId });
  return (data?.recommendations ?? []).map(r => r.id);
}
