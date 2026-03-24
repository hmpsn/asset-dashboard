/**
 * React Query hook for keyword strategy data
 * Replaces manual useEffect fetch pattern in KeywordStrategy.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client.js';

interface KeywordStrategy {
  id: string;
  workspaceId: string;
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

export function useKeywordStrategy(workspaceId: string) {
  return useQuery({
    queryKey: ['keyword-strategy', workspaceId],
    queryFn: async (): Promise<KeywordStrategy> => {
      const response = await get<{ data: KeywordStrategy }>(`/api/keyword-strategy/${workspaceId}`);
      return response.data;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!workspaceId,
    retry: 2,
    refetchOnWindowFocus: false, // Don't refetch on window focus for this
  });
}
