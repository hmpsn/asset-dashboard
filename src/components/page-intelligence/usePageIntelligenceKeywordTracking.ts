import { useEffect, useState } from 'react';
import { rankTracking } from '../../api/seo';

export function usePageIntelligenceKeywordTracking(workspaceId: string) {
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());

  useEffect(() => {
    rankTracking.keywords(workspaceId)
      .then(kws => setTrackedKeywords(new Set((kws || []).map(k => k.query))))
      .catch(() => {});
  }, [workspaceId]);

  const trackKeyword = async (kw: string) => {
    if (!kw || trackedKeywords.has(kw)) return;
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      setTrackedKeywords(prev => new Set(prev).add(kw));
    } catch {
      // silently ignore duplicates
    }
  };

  return {
    trackedKeywords,
    trackKeyword,
  };
}
