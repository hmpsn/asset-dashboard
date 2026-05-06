/**
 * React Query hook for keyword strategy data
 * Replaces manual useEffect fetch pattern in KeywordStrategy.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { keywords } from '../../api/seo';
import { workspaces } from '../../api/workspaces';
import type { KeywordStrategy } from '../../../shared/types/workspace';
import { queryKeys } from '../../lib/queryKeys';

interface WorkspaceData {
  competitorDomains?: string[];
}

interface KeywordStrategyData {
  strategy: KeywordStrategy | null;
  seoDataAvailable: boolean;
  workspaceData: WorkspaceData | null;
}

export function useKeywordStrategy(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.keywordStrategy(workspaceId),
    queryFn: async (): Promise<KeywordStrategyData> => {
      const [strategyResponse, providerStatus, workspaceResponse] = await Promise.all([
        workspaceId ? get<KeywordStrategy>(`/api/webflow/keyword-strategy/${workspaceId}`).catch(() => null) : Promise.resolve(null),
        keywords.providerStatus().catch(() => ({ providers: [] })),
        workspaceId ? workspaces.getById(workspaceId).catch(() => null) : Promise.resolve(null)
      ]);
      
      return {
        strategy: strategyResponse || null,
        seoDataAvailable: Boolean((providerStatus as { providers?: Array<{ configured: boolean }> })?.providers?.some(provider => provider.configured)),
        workspaceData: workspaceResponse as WorkspaceData | null
      };
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!workspaceId,
    retry: 2,
    refetchOnWindowFocus: false, // Don't refetch on window focus for this
  });
}
