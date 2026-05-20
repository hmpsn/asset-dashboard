import { useCallback, useEffect, useState } from 'react';
import { rankTracking } from '../../api/seo';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { keywordTrackingKey } from '../../lib/keywordTracking';

export function usePageIntelligenceKeywordTracking(workspaceId: string) {
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());

  const loadTrackedKeywords = useCallback(() => {
    rankTracking.keywords(workspaceId)
      .then(kws => setTrackedKeywords(new Set((kws || []).map(k => keywordTrackingKey(k.query)))))
      .catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    loadTrackedKeywords();
  }, [loadTrackedKeywords]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok: Page Intelligence stores local tracking badges as a Set, not a React Query result.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: loadTrackedKeywords,
    // ws-invalidation-ok: strategy refresh can reconcile tracked state used by local badges.
    [WS_EVENTS.STRATEGY_UPDATED]: loadTrackedKeywords,
  });

  const trackKeyword = async (kw: string) => {
    const key = keywordTrackingKey(kw);
    if (!key || trackedKeywords.has(key)) return;
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      setTrackedKeywords(prev => new Set(prev).add(key));
    } catch {
      // silently ignore duplicates
    }
  };

  return {
    trackedKeywords,
    trackKeyword,
  };
}
