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
 * optimistic invalidation of the admin cache on success.
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
  });
}
