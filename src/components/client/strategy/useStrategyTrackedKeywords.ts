import { useCallback, useEffect, useState } from 'react';
import { trackedKeywords as trackedKwApi } from '../../../api';

export interface StrategyTrackedKeyword {
  query: string;
  pinned: boolean;
  addedAt: string;
}

interface UseStrategyTrackedKeywordsOptions {
  workspaceId?: string;
}

export function useStrategyTrackedKeywords({ workspaceId }: UseStrategyTrackedKeywordsOptions) {
  const [trackedKeywords, setTrackedKeywords] = useState<StrategyTrackedKeyword[]>([]);
  const [newTrackedKeyword, setNewTrackedKeyword] = useState('');
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const [trackedKeywordsLoading, setTrackedKeywordsLoading] = useState(false);
  const [trackedKeywordsError, setTrackedKeywordsError] = useState(false);

  const loadTrackedKeywords = useCallback(() => {
    if (!workspaceId) return;
    setTrackedKeywordsError(false);
    setTrackedKeywordsLoading(true);
    trackedKwApi.get(workspaceId)
      .then((data) => {
        setTrackedKeywords(data.keywords || []);
      })
      .catch(() => { setTrackedKeywordsError(true); })
      .finally(() => setTrackedKeywordsLoading(false));
  }, [workspaceId]);

  useEffect(() => { loadTrackedKeywords(); }, [loadTrackedKeywords]);

  const addTrackedKeyword = useCallback(async (keyword: string): Promise<StrategyTrackedKeyword[]> => {
    if (!workspaceId) return trackedKeywords;
    const res = await trackedKwApi.add(workspaceId, keyword);
    const keywords = res.keywords || [];
    setTrackedKeywords(keywords);
    return keywords;
  }, [workspaceId, trackedKeywords]);

  const removeTrackedKeyword = useCallback(async (keyword: string): Promise<StrategyTrackedKeyword[]> => {
    if (!workspaceId) return trackedKeywords;
    const data = await trackedKwApi.remove(workspaceId, keyword);
    const keywords = data.keywords || [];
    setTrackedKeywords(keywords);
    return keywords;
  }, [workspaceId, trackedKeywords]);

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
