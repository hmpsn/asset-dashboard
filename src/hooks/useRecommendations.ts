import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client';
import { queryKeys } from '../lib/queryKeys';
import { matchPageIdentity } from '../lib/pathUtils';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.ts';

export function recommendationAppliesToPage(
  recommendation: Pick<Recommendation, 'affectedPages'>,
  pageIdentity: string,
): boolean {
  return recommendation.affectedPages.some(page => matchPageIdentity(page, pageIdentity));
}

/**
 * Fetch active recommendations for a workspace and provide helpers
 * to filter them by page identity and type.
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

  /** Get recommendations relevant to a specific page identity (path, URL, or homepage slug). */
  const forPage = useCallback((pageIdentity: string): Recommendation[] => {
    return recs.filter(r => recommendationAppliesToPage(r, pageIdentity));
  }, [recs]);

  /** Get recommendations of a specific type */
  const ofType = useCallback((type: Recommendation['type']): Recommendation[] =>
    recs.filter(r => r.type === type), [recs]);

  /** Get recommendations matching both page and type */
  const forPageAndType = useCallback((pageIdentity: string, type: Recommendation['type']): Recommendation[] =>
    forPage(pageIdentity).filter(r => r.type === type), [forPage]);

  return { recs, loaded, forPage, ofType, forPageAndType };
}
