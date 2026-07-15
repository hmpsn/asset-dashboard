import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordFeedback as kwFeedbackApi } from '../../../api';
import { keywordIdentityKeyV2 } from '../../../../shared/keyword-normalization';
import { queryKeys } from '../../../lib/queryKeys';

export type KeywordFeedbackStatus = 'approved' | 'declined' | 'requested';

interface UseStrategyKeywordFeedbackOptions {
  workspaceId?: string;
  setToast?: (msg: string) => void;
}

interface FeedbackMutationOptions {
  toast?: boolean;
  rethrow?: boolean;
  clearOnError?: boolean;
}

interface FeedbackCache {
  statuses: Map<string, KeywordFeedbackStatus>;
  rawKeywords: Map<string, string>;
}

const EMPTY_FEEDBACK_CACHE: FeedbackCache = {
  statuses: new Map(),
  rawKeywords: new Map(),
};

export function useStrategyKeywordFeedback({ workspaceId, setToast }: UseStrategyKeywordFeedbackOptions) {
  const queryClient = useQueryClient();
  const [feedbackLoading, setFeedbackLoading] = useState<Set<string>>(new Set());

  const { data: keywordFeedback, isError: feedbackLoadError, refetch } = useQuery({
    queryKey: queryKeys.client.keywordFeedback(workspaceId ?? ''),
    queryFn: async () => {
      const items = await kwFeedbackApi.get(workspaceId!);
      const statuses = new Map<string, KeywordFeedbackStatus>();
      const rawKeywords = new Map<string, string>();
      for (const item of items) {
        const key = keywordIdentityKeyV2(item.keyword);
        if (!key) continue;
        statuses.set(key, item.status);
        rawKeywords.set(key, item.keyword);
      }
      return { statuses, rawKeywords };
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });

  const feedbackCache = keywordFeedback ?? EMPTY_FEEDBACK_CACHE;
  const feedbackMap = feedbackCache.statuses;

  const loadFeedback = useCallback(() => { if (workspaceId) void refetch(); }, [refetch, workspaceId]);
  // STRATEGY_UPDATED invalidation is handled centrally in useWsInvalidation.ts

  const submitFeedback = useCallback(async (
    keyword: string,
    status: 'approved' | 'declined',
    source: string,
    reason?: string,
    options?: FeedbackMutationOptions,
  ) => {
    if (!workspaceId) return;
    const rawKeyword = keyword.trim();
    const kw = keywordIdentityKeyV2(rawKeyword);
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.submit(workspaceId, { keyword: rawKeyword, status, source, reason });
      queryClient.setQueryData(
        queryKeys.client.keywordFeedback(workspaceId),
        (old: FeedbackCache | undefined) => {
          const statuses = new Map(old?.statuses ?? []);
          const rawKeywords = new Map(old?.rawKeywords ?? []);
          statuses.set(kw, status);
          rawKeywords.set(kw, rawKeyword);
          return { statuses, rawKeywords };
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
    const rawKeyword = keyword.trim();
    const kw = keywordIdentityKeyV2(rawKeyword);
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.remove(workspaceId, rawKeyword);
      queryClient.setQueryData(
        queryKeys.client.keywordFeedback(workspaceId),
        (old: FeedbackCache | undefined) => {
          const statuses = new Map(old?.statuses ?? []);
          const rawKeywords = new Map(old?.rawKeywords ?? []);
          statuses.delete(kw);
          rawKeywords.delete(kw);
          return { statuses, rawKeywords };
        },
      );
      if (options?.toast !== false) setToast?.(`"${keyword}" restored - it can appear in future strategies`);
    } catch {
      if (options?.clearOnError) {
        queryClient.setQueryData(
          queryKeys.client.keywordFeedback(workspaceId),
          (old: FeedbackCache | undefined) => {
            const statuses = new Map(old?.statuses ?? []);
            const rawKeywords = new Map(old?.rawKeywords ?? []);
            statuses.delete(kw);
            rawKeywords.delete(kw);
            return { statuses, rawKeywords };
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
    (keyword: string) => feedbackMap.get(keywordIdentityKeyV2(keyword)),
    [feedbackMap],
  );

  const isLoadingFeedback = useCallback(
    (keyword: string) => feedbackLoading.has(keywordIdentityKeyV2(keyword)),
    [feedbackLoading],
  );

  const requestedKeywords = useMemo(
    () => [...feedbackMap.entries()]
      .filter(([, status]) => status === 'requested')
      .map(([key]) => feedbackCache.rawKeywords.get(key) ?? key),
    [feedbackCache.rawKeywords, feedbackMap],
  );

  const declinedKeywords = useMemo(
    () => [...feedbackMap.entries()]
      .filter(([, status]) => status === 'declined')
      .map(([key]) => feedbackCache.rawKeywords.get(key) ?? key),
    [feedbackCache.rawKeywords, feedbackMap],
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
    declinedKeywords,
  };
}
