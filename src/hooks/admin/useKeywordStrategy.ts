/**
 * React Query hook for keyword strategy data
 * Replaces manual useEffect fetch pattern in KeywordStrategy.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client.js';
import { keywords } from '../../api/seo.js';
import { workspaces } from '../../api/workspaces.js';
import type { KeywordStrategy } from '../../shared/types/workspace.ts';

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
        workspaceId ? get<KeywordStrategy>(`/api/webflow/keyword-strategy/${workspaceId}`).catch(() => null) : Promise.resolve(null),
        keywords.semrushStatus().catch(() => ({ configured: false } as { configured?: boolean })),
        workspaceId ? workspaces.getById(workspaceId).catch(() => null) : Promise.resolve(null)
      ]);
      
      return {
        strategy: strategyResponse || null,
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
