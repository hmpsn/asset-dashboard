import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordFeedback as kwFeedbackApi } from '../../../api';
import { keywordComparisonKey } from '../../../../shared/keyword-normalization';
import { queryKeys } from '../../../lib/queryKeys';

export type KeywordFeedbackStatus = 'approved' | 'declined' | 'requested';

export interface KeywordFeedback {
  keyword: string;
  status: KeywordFeedbackStatus;
  reason?: string;
  source?: string;
  created_at?: string;
}

interface UseStrategyKeywordFeedbackOptions {
  workspaceId?: string;
  setToast?: (msg: string) => void;
}

interface FeedbackMutationOptions {
  toast?: boolean;
  rethrow?: boolean;
  clearOnError?: boolean;
}

export function useStrategyKeywordFeedback({ workspaceId, setToast }: UseStrategyKeywordFeedbackOptions) {
  const queryClient = useQueryClient();
  const [feedbackLoading, setFeedbackLoading] = useState<Set<string>>(new Set());

  const { data: keywordFeedback, isError: feedbackLoadError, refetch } = useQuery({
    queryKey: queryKeys.client.keywordFeedback(workspaceId ?? ''),
    queryFn: async () => {
      const items = await kwFeedbackApi.get(workspaceId!);
      const map = new Map<string, KeywordFeedbackStatus>();
      for (const item of items as KeywordFeedback[]) map.set(keywordComparisonKey(item.keyword), item.status);
      return map;
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const feedbackMap = keywordFeedback ?? new Map<string, KeywordFeedbackStatus>();

  const loadFeedback = useCallback(() => { void refetch(); }, [refetch]);
  // STRATEGY_UPDATED invalidation is handled centrally in useWsInvalidation.ts

  const submitFeedback = useCallback(async (
    keyword: string,
    status: 'approved' | 'declined',
    source: string,
    reason?: string,
    options?: FeedbackMutationOptions,
  ) => {
    if (!workspaceId) return;
    const kw = keywordComparisonKey(keyword);
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.submit(workspaceId, { keyword: keyword.trim(), status, source, reason });
      queryClient.setQueryData(
        queryKeys.client.keywordFeedback(workspaceId),
        (old: Map<string, KeywordFeedbackStatus> | undefined) => {
          const next = new Map(old ?? []);
          next.set(kw, status);
          return next;
        },
      );
      if (options?.toast !== false) {
        setToast?.(status === 'approved' ? `"${keyword}" marked relevant - it can shape future recommendations` : `"${keyword}" marked not relevant - it won't appear in future strategies`);
      }
    } catch {
      if (options?.toast !== false) setToast?.('Failed to save feedback');
      if (options?.rethrow) throw new Error('Failed to save feedback');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast, queryClient]);

  const removeFeedback = useCallback(async (keyword: string, options?: FeedbackMutationOptions) => {
    if (!workspaceId) return;
    const kw = keywordComparisonKey(keyword);
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.remove(workspaceId, kw);
      queryClient.setQueryData(
        queryKeys.client.keywordFeedback(workspaceId),
        (old: Map<string, KeywordFeedbackStatus> | undefined) => {
          const next = new Map(old ?? []);
          next.delete(kw);
          return next;
        },
      );
      if (options?.toast !== false) setToast?.(`"${keyword}" restored - it can appear in future strategies`);
    } catch {
      if (options?.clearOnError) {
        queryClient.setQueryData(
          queryKeys.client.keywordFeedback(workspaceId),
          (old: Map<string, KeywordFeedbackStatus> | undefined) => {
            const next = new Map(old ?? []);
            next.delete(kw);
            return next;
          },
        );
      }
      if (options?.toast !== false) setToast?.('Failed to undo');
      if (options?.rethrow) throw new Error('Failed to undo keyword feedback');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast, queryClient]);

  const getFeedbackStatus = useCallback(
    (keyword: string) => feedbackMap.get(keywordComparisonKey(keyword)),
    [feedbackMap],
  );

  const isLoadingFeedback = useCallback(
    (keyword: string) => feedbackLoading.has(keywordComparisonKey(keyword)),
    [feedbackLoading],
  );

  const requestedKeywords = useMemo(
    () => [...feedbackMap.entries()].filter(([, s]) => s === 'requested').map(([k]) => k),
    [feedbackMap],
  );

  return {
    keywordFeedback: feedbackMap,
    feedbackLoadError,
    loadFeedback,
    submitFeedback,
    removeFeedback,
    undoFeedback: removeFeedback,
    getFeedbackStatus,
    isLoadingFeedback,
    requestedKeywords,
  };
}
