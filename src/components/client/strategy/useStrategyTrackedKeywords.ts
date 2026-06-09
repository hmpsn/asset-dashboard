import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trackedKeywords as trackedKwApi } from '../../../api';
import { useWorkspaceEvents } from '../../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../../lib/queryKeys';
import { WS_EVENTS } from '../../../lib/wsEvents';
import type { TrackedKeyword } from '../../../../shared/types/rank-tracking';

export type StrategyTrackedKeyword = TrackedKeyword;

interface UseStrategyTrackedKeywordsOptions {
  workspaceId?: string;
}

export function useStrategyTrackedKeywords({ workspaceId }: UseStrategyTrackedKeywordsOptions) {
  const queryClient = useQueryClient();
  const [newTrackedKeyword, setNewTrackedKeyword] = useState('');
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const trackedKeywordsQuery = useQuery({
    queryKey: queryKeys.client.trackedKeywords(workspaceId ?? ''),
    queryFn: () => trackedKwApi.get(workspaceId!),
    enabled: !!workspaceId,
    select: (data) => data.keywords || [],
  });

  const trackedKeywords = trackedKeywordsQuery.data ?? [];
  const trackedKeywordsLoading = trackedKeywordsQuery.isLoading;
  const trackedKeywordsError = trackedKeywordsQuery.isError;
  const loadTrackedKeywords = useCallback(() => {
    if (!workspaceId) return Promise.resolve();
    return trackedKeywordsQuery.refetch();
  }, [trackedKeywordsQuery, workspaceId]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok: Strategy tab owns the public tracked-keywords query key, not central invalidation.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: loadTrackedKeywords,
    // ws-invalidation-ok: strategy refresh can reconcile tracked keyword lifecycle/source metadata.
    [WS_EVENTS.STRATEGY_UPDATED]: loadTrackedKeywords,
  });

  const addTrackedKeyword = useCallback(async (keyword: string): Promise<StrategyTrackedKeyword[]> => {
    if (!workspaceId) return trackedKeywords;
    const res = await trackedKwApi.add(workspaceId, keyword);
    const keywords = res.keywords || [];
    queryClient.setQueryData(queryKeys.client.trackedKeywords(workspaceId), { keywords });
    return keywords;
  }, [queryClient, trackedKeywords, workspaceId]);

  const removeTrackedKeyword = useCallback(async (keyword: string): Promise<StrategyTrackedKeyword[]> => {
    if (!workspaceId) return trackedKeywords;
    const data = await trackedKwApi.remove(workspaceId, keyword);
    const keywords = data.keywords || [];
    queryClient.setQueryData(queryKeys.client.trackedKeywords(workspaceId), { keywords });
    return keywords;
  }, [queryClient, trackedKeywords, workspaceId]);

  return {
    trackedKeywords,
    newTrackedKeyword,
    setNewTrackedKeyword,
    addingKeyword,
    setAddingKeyword,
    removingKeyword,
    setRemovingKeyword,
    trackedKeywordsLoading,
    trackedKeywordsError,
    loadTrackedKeywords,
    addTrackedKeyword,
    removeTrackedKeyword,
  };
}
