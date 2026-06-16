import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rankTracking } from '../../../api/seo';
import { queryKeys } from '../../../lib/queryKeys';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { keywordTrackingKey } from '../../../lib/keywordTracking';

export function useTrackKeyword(workspaceId: string) {
  const queryClient = useQueryClient();
  const [trackingPending, setTrackingPending] = useState<Set<string>>(new Set());
  const [trackingErrors, setTrackingErrors] = useState<Map<string, string>>(new Map());

  // Tracked keywords via React Query — buttons reflect actual server state with keywordTrackingKey normalization.
  // The `rankTrackingKeywords` cache holds the canonical TrackedKeyword[] array (the shape RankTracker
  // consumes — both components share this key). `select` derives the normalized Set this component needs
  // WITHOUT mutating the cached shape, so a tab switch between this panel and RankTracker can't read a Set
  // where an array is expected (or vice versa).
  const { data: trackedKeywordsData } = useQuery({
    queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId),
    queryFn: () => rankTracking.keywords(workspaceId),
    select: (rows) => new Set((rows ?? []).map(k => keywordTrackingKey(k.query))),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
  const trackedKeywords = trackedKeywordsData ?? new Set<string>();

  const trackKeyword = useCallback(async (kw: string) => {
    const key = keywordTrackingKey(kw);
    if (!key || trackedKeywords.has(key)) return;
    setTrackingPending(prev => new Set(prev).add(key));
    setTrackingErrors(prev => { const m = new Map(prev); m.delete(key); return m; });
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      // The rankTrackingKeywords cache holds TrackedKeyword[] (shared with RankTracker). addKeyword
      // returns `unknown`, so we cannot synthesize a faithful TrackedKeyword (pinned/addedAt/source/etc.)
      // for an optimistic array append. Invalidate instead — correctness over a micro-optimization; the
      // refetch is cheap and keeps the canonical array shape intact for both consumers.
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId),
      });
    } catch (err: unknown) {
      // Duplicate / already-tracked responses are silently fine — the server deduplicates.
      // Real network/server failures are surfaced as a visible error on the keyword chip.
      const errMsg = extractErrorMessage(err, '');
      const isDuplicate = /already|duplicate/i.test(errMsg);
      if (!isDuplicate) {
        setTrackingErrors(prev => new Map(prev).set(key, 'Failed to track keyword. Please try again.'));
      }
    } finally {
      setTrackingPending(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [trackedKeywords, workspaceId, queryClient]);

  return { trackedKeywords, trackingPending, trackingErrors, trackKeyword };
}
