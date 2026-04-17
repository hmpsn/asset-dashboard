import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client';
import { queryKeys } from '../lib/queryKeys';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.ts';

/**
 * Fetch active recommendations for a workspace and provide helpers
 * to filter them by page slug and type.
 *
 * Uses queryKeys.shared.recommendations — the same key as InsightsEngine.
 * The queryFn caches the full RecommendationSet; select projects to Recommendation[]
 * so callers that only need the array don't cause a cache shape collision.
 */
export function useRecommendations(workspaceId?: string) {
  const { data: recs = [], isSuccess: loaded } = useQuery({
    queryKey: queryKeys.shared.recommendations(workspaceId!),
    queryFn: (): Promise<RecommendationSet> =>
      get<RecommendationSet>(`/api/public/recommendations/${workspaceId}`),
    select: (set: RecommendationSet): Recommendation[] => set.recommendations,
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  /** Get recommendations relevant to a specific page slug */
  const forPage = useCallback((slug: string): Recommendation[] => {
    if (!slug) return [];
    const normalized = slug.startsWith('/') ? slug : `/${slug}`;
    return recs.filter(r =>
      r.affectedPages.some(p => {
        const np = p.startsWith('/') ? p : `/${p}`;
        return np === normalized || normalized.includes(np) || np.includes(normalized);
      })
    );
  }, [recs]);

  /** Get recommendations of a specific type */
  const ofType = useCallback((type: Recommendation['type']): Recommendation[] =>
    recs.filter(r => r.type === type), [recs]);

  /** Get recommendations matching both page and type */
  const forPageAndType = useCallback((slug: string, type: Recommendation['type']): Recommendation[] =>
    forPage(slug).filter(r => r.type === type), [forPage]);

  return { recs, loaded, forPage, ofType, forPageAndType };
}
