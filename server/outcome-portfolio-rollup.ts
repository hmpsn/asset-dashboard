import type {
  OutcomePortfolioAttributionMetrics,
  OutcomePortfolioMetrics,
  OutcomePortfolioRollup,
  OutcomePortfolioWorkspaceRollup,
} from '../shared/types/outcome-tracking.js';
import {
  getWinsWithValueByWorkspaceInWindow,
  type OutcomeValueWin,
} from './outcome-tracking.js';
import { listWorkspaces } from './workspaces.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
export const OUTCOME_PORTFOLIO_WINDOW_DAYS = 90 as const;

function emptyMetrics(): OutcomePortfolioMetrics {
  return { wins: 0, valuePerMonth: 0, clicksGained: 0, withValue: 0 };
}

function emptyAttributionMetrics(): OutcomePortfolioAttributionMetrics {
  return { wins: 0, valuePerMonth: 0, clicksGained: 0 };
}

function addWin(
  totals: OutcomePortfolioMetrics,
  attribution: OutcomePortfolioAttributionMetrics,
  win: OutcomeValueWin,
): void {
  const value = typeof win.attributedValue === 'number' && Number.isFinite(win.attributedValue)
    ? Math.max(0, win.attributedValue)
    : null;
  const clicks = win.delta.primary_metric === 'clicks'
    && typeof win.delta.delta_absolute === 'number'
    && Number.isFinite(win.delta.delta_absolute)
    ? Math.max(0, Math.round(win.delta.delta_absolute))
    : 0;

  totals.wins += 1;
  totals.clicksGained += clicks;
  attribution.wins += 1;
  attribution.clicksGained += clicks;
  if (value != null) {
    totals.valuePerMonth += value;
    totals.withValue += 1;
    attribution.valuePerMonth += value;
  }
}

/**
 * Builds the GO-004 cross-workspace read model from existing tracked actions and
 * measured outcomes. The server owns every sum. C4 attribution honesty is applied
 * twice at this seam: the canonical windowed reader excludes `not_acted_on` in SQL,
 * and this service accepts only the two executed attribution buckets.
 */
export function buildOutcomePortfolioRollup(now = new Date()): OutcomePortfolioRollup {
  const endExclusive = now.toISOString();
  const start = new Date(now.getTime() - OUTCOME_PORTFOLIO_WINDOW_DAYS * DAY_MS).toISOString();
  const portfolioTotals = emptyMetrics();
  const portfolioAttribution = {
    platformExecuted: emptyAttributionMetrics(),
    externallyExecuted: emptyAttributionMetrics(),
  };

  const workspaces = listWorkspaces().map<OutcomePortfolioWorkspaceRollup>((workspace) => {
    const totals = emptyMetrics();
    const attribution = {
      platformExecuted: emptyAttributionMetrics(),
      externallyExecuted: emptyAttributionMetrics(),
    };
    const wins = getWinsWithValueByWorkspaceInWindow(workspace.id, { start, endExclusive });

    for (const win of wins) {
      if (win.attribution === 'not_acted_on') continue;
      const bucket = win.attribution === 'platform_executed'
        ? attribution.platformExecuted
        : attribution.externallyExecuted;
      const portfolioBucket = win.attribution === 'platform_executed'
        ? portfolioAttribution.platformExecuted
        : portfolioAttribution.externallyExecuted;
      addWin(totals, bucket, win);
      addWin(portfolioTotals, portfolioBucket, win);
    }

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      hasMeasuredWins: totals.wins > 0,
      totals,
      attribution,
      notActedOnExcluded: true,
    };
  });

  return {
    window: {
      days: OUTCOME_PORTFOLIO_WINDOW_DAYS,
      label: 'Last 90 days',
      start,
      endExclusive,
    },
    totals: portfolioTotals,
    attribution: portfolioAttribution,
    workspaces,
  };
}
