import { useMemo } from 'react';
import type { AdminKeywordFeedbackListRow } from '../../../../shared/types/keyword-feedback';
import type { StrategyMetrics, PageKeywordMap } from '../types';
import { VOLUME_THRESHOLD } from '../types';

interface StrategyLike {
  pageMap?: PageKeywordMap[];
  generatedAt?: string | null;
}

export function useStrategyMetrics(
  strategy: StrategyLike | null | undefined,
  keywordFeedbackRows: AdminKeywordFeedbackListRow[],
  isRealStrategy: boolean
): StrategyMetrics {
  return useMemo(() => {
    // Computed metrics
    const pageMap: PageKeywordMap[] = strategy?.pageMap || [];
    // Filter out pages with known-low search volume to reduce noise in rendered cards.
    // Pages without volume data (undefined) are kept — they haven't been enriched yet.
    const filteredPageMap = pageMap.filter(
      (p: PageKeywordMap) => (p.volume ?? VOLUME_THRESHOLD) >= VOLUME_THRESHOLD
    );
    const ranked = filteredPageMap.filter((p: PageKeywordMap) => p.currentPosition);
    const avgPos = ranked.length > 0 ? ranked.reduce((s: number, p: PageKeywordMap) => s + (p.currentPosition || 0), 0) / ranked.length : 0;
    const totalImpressions = filteredPageMap.reduce((s: number, p: PageKeywordMap) => s + (p.impressions || 0), 0);
    const totalClicks = filteredPageMap.reduce((s: number, p: PageKeywordMap) => s + (p.clicks || 0), 0);
    const top3 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 3);
    const top10 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 10 && (p.currentPosition || 0) > 3);
    const top20 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 99) <= 20 && (p.currentPosition || 0) > 10);
    const beyond20 = ranked.filter((p: PageKeywordMap) => (p.currentPosition || 0) > 20);
    const notRankingCount = filteredPageMap.length - ranked.length;

    const lowHangingFruit = ranked
      .filter((p: PageKeywordMap) => (p.currentPosition || 0) >= 4 && (p.currentPosition || 0) <= 20 && (p.impressions || 0) > 20)
      .sort((a: PageKeywordMap, b: PageKeywordMap) => (b.impressions || 0) - (a.impressions || 0))
      .slice(0, 6);

    const intentCounts = filteredPageMap.reduce((acc: Record<string, number>, p: PageKeywordMap) => {
      const intent = p.searchIntent || 'unknown';
      acc[intent] = (acc[intent] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    // Position movements vs each page's previousPosition (v2 Rankings tab). Computed from the
    // filtered map so it's consistent with the distribution shown alongside it.
    let improved = 0;
    let declined = 0;
    let newlyRanking = 0;
    let lost = 0;
    for (const p of filteredPageMap) {
      const cur = p.currentPosition;
      const prev = p.previousPosition;
      const curRanked = typeof cur === 'number' && cur >= 1;
      const prevRanked = typeof prev === 'number' && prev >= 1;
      if (curRanked && prevRanked) {
        if (cur < prev) improved += 1;
        else if (cur > prev) declined += 1;
      } else if (curRanked && !prevRanked) {
        newlyRanking += 1;
      } else if (!curRanked && prevRanked) {
        lost += 1;
      }
    }
    const movements = { improved, declined, new: newlyRanking, lost };

    const declinedFeedback = keywordFeedbackRows.filter(row => row.status === 'declined');
    const requestedFeedback = keywordFeedbackRows.filter(row => row.status === 'requested');
    const approvedFeedback = keywordFeedbackRows.filter(row => row.status === 'approved');

    // Computed from the UNFILTERED pageMap (not filteredPageMap/ranked) — matches the orchestrator's
    // original line 1051 / 824 expressions. A page that ranks (or has volume) but falls below
    // VOLUME_THRESHOLD is in pageMap yet excluded from `ranked`/`filteredPageMap`, so deriving these
    // from the filtered arrays would silently flip the GSC tip / unvalidated-warning. Exposed here so
    // consumers cannot mis-source them.
    const hasAnyRanking = pageMap.some((p: PageKeywordMap) => p.currentPosition);
    const hasVolumeValidation = pageMap.some((p: PageKeywordMap) => p.volume != null && p.volume > 0);

    // Nudge: surface when client feedback is newer than the last strategy generation.
    // M2: Limit to requested/declined rows only — approved rows (from ADD_TO_STRATEGY)
    // must not trigger the nudge because they've already been acted on by the admin.
    const feedbackNewerThanStrategy = isRealStrategy && strategy?.generatedAt != null
      ? keywordFeedbackRows.some(row => {
          if (row.status !== 'requested' && row.status !== 'declined') return false;
          const ts = row.updated_at ?? row.created_at;
          return ts != null && new Date(ts) > new Date(strategy.generatedAt!);
        })
      : false;

    return {
      pageMap,
      filteredPageMap,
      ranked,
      avgPos,
      totalImpressions,
      totalClicks,
      top3,
      top10,
      top20,
      beyond20,
      notRankingCount,
      lowHangingFruit,
      intentCounts,
      movements,
      declinedFeedback,
      requestedFeedback,
      approvedFeedback,
      feedbackNewerThanStrategy,
      hasAnyRanking,
      hasVolumeValidation,
    };
  }, [strategy, keywordFeedbackRows, isRealStrategy]);
}
