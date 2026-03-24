/**
 * React Query hook for keyword strategy data
 * Replaces manual useEffect fetch pattern in KeywordStrategy.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client.js';
import { keywords } from '../../api/seo.js';
import { workspaces } from '../../api/workspaces.js';

interface KeywordStrategy {
  id: string;
  workspaceId: string;
  businessContext?: string;
  primaryKeywords: Array<{
    keyword: string;
    volume: number;
    difficulty: number;
    priority: 'high' | 'medium' | 'low';
    targetPages: string[];
  }>;
  contentGaps: Array<{
    keyword: string;
    recommendedPageType: string;
    priority: 'high' | 'medium' | 'low';
    searchIntent: string;
  }>;
  competitorGaps: Array<{
    keyword: string;
    competitors: string[];
    opportunity: 'high' | 'medium' | 'low';
  }>;
  lastUpdated: string;
  status: 'generating' | 'ready' | 'error';
}

interface WorkspaceData {
  competitorDomains?: string[];
}

interface KeywordStrategyData {
  strategy: KeywordStrategy | null;
  semrushAvailable: boolean;
  workspaceData: WorkspaceData | null;
}

export function useKeywordStrategy(workspaceId: string) {
  return useQuery({
    queryKey: ['keyword-strategy', workspaceId],
    queryFn: async (): Promise<KeywordStrategyData> => {
      const [strategyResponse, semrushStatus, workspaceResponse] = await Promise.all([
        workspaceId ? get<{ data: KeywordStrategy }>(`/api/keyword-strategy/${workspaceId}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        keywords.semrushStatus().catch(() => ({ configured: false } as { configured?: boolean })),
        workspaceId ? workspaces.getById(workspaceId).catch(() => null) : Promise.resolve(null)
      ]);
      
      return {
        strategy: strategyResponse.data || null,
        semrushAvailable: (semrushStatus as { configured?: boolean })?.configured || false,
        workspaceData: workspaceResponse as WorkspaceData | null
      };
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!workspaceId,
    retry: 2,
    refetchOnWindowFocus: false, // Don't refetch on window focus for this
  });
}
