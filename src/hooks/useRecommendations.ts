import { useState, useEffect } from 'react';
import { getOptional } from '../api/client';

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
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getOptional<{ recommendations?: Recommendation[] }>(`/api/public/recommendations/${workspaceId}?status=pending`);
        if (!cancelled && data && Array.isArray(data.recommendations)) {
          setRecs(data.recommendations);
        }
      } catch { /* non-critical */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  /** Get recommendations relevant to a specific page slug */
  const forPage = (slug: string): Recommendation[] => {
    if (!slug) return [];
    const normalized = slug.startsWith('/') ? slug : `/${slug}`;
    return recs.filter(r =>
      r.affectedPages.some(p => {
        const np = p.startsWith('/') ? p : `/${p}`;
        return np === normalized || normalized.includes(np) || np.includes(normalized);
      })
    );
  };

  /** Get recommendations of a specific type */
  const ofType = (type: Recommendation['type']): Recommendation[] =>
    recs.filter(r => r.type === type);

  /** Get recommendations matching both page and type */
  const forPageAndType = (slug: string, type: Recommendation['type']): Recommendation[] =>
    forPage(slug).filter(r => r.type === type);

  return { recs, loaded, forPage, ofType, forPageAndType };
}
