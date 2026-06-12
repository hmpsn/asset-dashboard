/**
 * React Query hook for keyword strategy data
 * Replaces manual useEffect fetch pattern in KeywordStrategy.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { keywords } from '../../api/seo';
import { workspaces } from '../../api/workspaces';
import type { KeywordStrategy } from '../../../shared/types/workspace';
import type { KeywordStrategyUxPayload } from '../../../shared/types/keyword-strategy-ux';
import { queryKeys } from '../../lib/queryKeys';

interface WorkspaceData {
  competitorDomains?: string[];
  seoDataProvider?: 'dataforseo';
}

/**
 * The raw GET /api/webflow/keyword-strategy/:id response shape.
 * Extends KeywordStrategy with the strategyUx field that the server
 * attaches on every admin read (both real and shell branches).
 */
export type KeywordStrategyRead = KeywordStrategy & { strategyUx?: KeywordStrategyUxPayload };

interface KeywordStrategyData {
  strategy: KeywordStrategyRead | null;
  seoDataAvailable: boolean;
  providers: Array<{ name: string; configured: boolean }>;
  workspaceData: WorkspaceData | null;
}

interface KeywordStrategyAuxData {
  seoDataAvailable: boolean;
  providers: Array<{ name: string; configured: boolean }>;
  workspaceData: WorkspaceData | null;
}

export function useKeywordStrategy(workspaceId: string) {
  const strategyQuery = useQuery({
    queryKey: queryKeys.admin.keywordStrategy(workspaceId),
    queryFn: async (): Promise<KeywordStrategyRead | null> => {
      if (!workspaceId) return null;
      return get<KeywordStrategyRead>(`/api/webflow/keyword-strategy/${workspaceId}`);
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!workspaceId,
    retry: 2,
    refetchOnWindowFocus: false, // Don't refetch on window focus for this
  });

  const auxQuery = useQuery({
    queryKey: [...queryKeys.admin.keywordStrategy(workspaceId), 'aux'] as const,
    queryFn: async (): Promise<KeywordStrategyAuxData> => {
      const [providerStatus, workspaceResponse] = await Promise.all([
        keywords.providerStatus().catch(() => ({ providers: [] })),
        workspaceId ? workspaces.getById(workspaceId).catch(() => null) : Promise.resolve(null),
      ]);
      const rawProviders = (providerStatus as { providers?: Array<{ name: string; configured: boolean }> })?.providers ?? [];
      return {
        seoDataAvailable: Boolean(rawProviders.some(p => p.configured)),
        providers: rawProviders,
        workspaceData: workspaceResponse as WorkspaceData | null,
      };
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!workspaceId,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  const auxData: KeywordStrategyAuxData = auxQuery.data ?? {
    seoDataAvailable: false,
    providers: [],
    workspaceData: null,
  };
  const strategyReady = strategyQuery.data !== undefined;
  const data: KeywordStrategyData | undefined = workspaceId && strategyReady
    ? {
      strategy: strategyQuery.data ?? null,
      seoDataAvailable: auxData.seoDataAvailable,
      providers: auxData.providers,
      workspaceData: auxData.workspaceData,
    }
    : undefined;

  return {
    ...strategyQuery,
    data,
    isAuxLoading: auxQuery.isLoading,
  };
}
