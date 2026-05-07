import { useCallback, useEffect, useMemo, useState } from 'react';
import { keywordFeedback as kwFeedbackApi } from '../../../api';

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
  const [keywordFeedback, setKeywordFeedback] = useState<Map<string, KeywordFeedbackStatus>>(new Map());
  const [feedbackLoading, setFeedbackLoading] = useState<Set<string>>(new Set());
  const [feedbackLoadError, setFeedbackLoadError] = useState(false);

  const loadFeedback = useCallback(() => {
    if (!workspaceId) return;
    setFeedbackLoadError(false);
    kwFeedbackApi.get(workspaceId)
      .then((items) => {
        const map = new Map<string, KeywordFeedbackStatus>();
        for (const item of items as KeywordFeedback[]) map.set(item.keyword, item.status);
        setKeywordFeedback(map);
      })
      .catch(() => { setFeedbackLoadError(true); });
  }, [workspaceId]);

  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  const submitFeedback = useCallback(async (
    keyword: string,
    status: 'approved' | 'declined',
    source: string,
    reason?: string,
    options?: FeedbackMutationOptions,
  ) => {
    if (!workspaceId) return;
    const kw = keyword.toLowerCase().trim();
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.submit(workspaceId, { keyword: kw, status, source, reason });
      setKeywordFeedback(prev => {
        const next = new Map(prev);
        next.set(kw, status);
        return next;
      });
      if (options?.toast !== false) {
        setToast?.(status === 'approved' ? `"${keyword}" marked relevant - it can shape future recommendations` : `"${keyword}" marked not relevant - it won't appear in future strategies`);
      }
    } catch {
      if (options?.toast !== false) setToast?.('Failed to save feedback');
      if (options?.rethrow) throw new Error('Failed to save feedback');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast]);

  const removeFeedback = useCallback(async (keyword: string, options?: FeedbackMutationOptions) => {
    if (!workspaceId) return;
    const kw = keyword.toLowerCase().trim();
    setFeedbackLoading(prev => new Set(prev).add(kw));
    try {
      await kwFeedbackApi.remove(workspaceId, kw);
      setKeywordFeedback(prev => { const next = new Map(prev); next.delete(kw); return next; });
      if (options?.toast !== false) setToast?.(`"${keyword}" restored - it can appear in future strategies`);
    } catch {
      if (options?.clearOnError) {
        setKeywordFeedback(prev => {
          const next = new Map(prev);
          next.delete(kw);
          return next;
        });
      }
      if (options?.toast !== false) setToast?.('Failed to undo');
      if (options?.rethrow) throw new Error('Failed to undo keyword feedback');
    } finally {
      setFeedbackLoading(prev => { const next = new Set(prev); next.delete(kw); return next; });
    }
  }, [workspaceId, setToast]);

  const getFeedbackStatus = useCallback(
    (keyword: string) => keywordFeedback.get(keyword.toLowerCase().trim()),
    [keywordFeedback],
  );

  const isLoadingFeedback = useCallback(
    (keyword: string) => feedbackLoading.has(keyword.toLowerCase().trim()),
    [feedbackLoading],
  );

  const requestedKeywords = useMemo(
    () => [...keywordFeedback.entries()].filter(([, s]) => s === 'requested').map(([k]) => k),
    [keywordFeedback],
  );

  return {
    keywordFeedback,
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
