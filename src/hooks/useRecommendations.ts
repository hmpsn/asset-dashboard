import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOptional } from '../api/client';
import { queryKeys } from '../lib/queryKeys';

export interface Recommendation {
  id: string;
  workspaceId: string;
  priority: 'fix_now' | 'fix_soon' | 'fix_later' | 'ongoing';
  type: 'technical' | 'content' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy';
  title: string;
  description: string;
  insight: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  impactScore: number;
  source: string;
  affectedPages: string[];
  trafficAtRisk: number;
  impressionsAtRisk: number;
  estimatedGain: string;
  actionType: 'automated' | 'manual' | 'content_creation' | 'purchase';
  productType?: string;
  productPrice?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  assignedTo?: 'team' | 'client';
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch active recommendations for a workspace and provide helpers
 * to filter them by page slug and type.
 */
export function useRecommendations(workspaceId?: string) {
  const { data: recs = [], isSuccess: loaded } = useQuery({
    queryKey: queryKeys.shared.recommendations(workspaceId!),
    queryFn: async () => {
      const data = await getOptional<{ recommendations?: Recommendation[] }>(`/api/public/recommendations/${workspaceId}?status=pending`);
      return data && Array.isArray(data.recommendations) ? data.recommendations : [];
    },
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
