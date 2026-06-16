import { matchPageIdentity } from '../../../shared/page-address-utils';
import type { OpportunityRow, PageKeywordMap, StrategyQuickWin } from './types';

/**
 * Merge Quick Wins + Low-Hanging Fruit into one ordered, de-duplicated opportunity list.
 * Quick Wins lead (they are specific "do this now" actions), ordered by roiScore desc;
 * Low-Hanging Fruit follow, ordered by impressions desc. A LHF page whose path matches a
 * Quick Win page (trailing-slash / case insensitive) is dropped — the Quick Win already
 * owns that page with a concrete action.
 */
export function buildOpportunityRows(
  quickWins: StrategyQuickWin[],
  lowHangingFruit: PageKeywordMap[],
): OpportunityRow[] {
  const quickWinRows: OpportunityRow[] = [...quickWins]
    .sort((a, b) => (b.roiScore ?? 0) - (a.roiScore ?? 0))
    .map(qw => ({
      kind: 'quick_win',
      pagePath: qw.pagePath,
      action: qw.action,
      estimatedImpact: qw.estimatedImpact,
      rationale: qw.rationale,
      roiScore: qw.roiScore,
    }));

  const lhfRows: OpportunityRow[] = [...lowHangingFruit]
    .filter(p => !quickWins.some(qw => matchPageIdentity(qw.pagePath, p.pagePath)))
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .map(p => ({
      kind: 'low_hanging',
      pagePath: p.pagePath,
      pageTitle: p.pageTitle,
      primaryKeyword: p.primaryKeyword,
      currentPosition: p.currentPosition,
      impressions: p.impressions,
      clicks: p.clicks,
      volume: p.volume,
    }));

  return [...quickWinRows, ...lhfRows];
}
