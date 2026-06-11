import type { IntelligenceOptions, InsightsSlice } from '../../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../../shared/types/analytics.js';
import { createLogger } from '../logger.js';
import { matchPageIdentity } from '../helpers.js';

const log = createLogger('workspace-intelligence/insights');

/**
 * Returns the slice's prompt-facing insight list (`all`, top 100 by impactScore desc).
 *
 * G3: `byType` is capped at 25 per type, so it can no longer reconstruct full coverage —
 * this helper reads `all` directly. Consumers that need full PRE-cap counts must use
 * `insights.countsByType` / `insights.bySeverity`, never the lengths of these lists.
 */
export function listAllInsightsFromSlice(insights: InsightsSlice): AnalyticsInsight[] {
  return [...insights.all].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
}

function insightPageIdentities(insight: AnalyticsInsight): string[] {
  const identities = new Set<string>();
  if (insight.pageId) identities.add(insight.pageId);
  const data = insight.data as Record<string, unknown>;
  for (const key of ['pagePath', 'pageUrl', 'page', 'url', 'affectedPage']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) identities.add(value);
  }
  return [...identities];
}

export async function assembleInsights(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<InsightsSlice> {
  let all: AnalyticsInsight[] = [];
  try {
    const { getInsights } = await import('../analytics-insights-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    all = getInsights(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleInsights: getInsights failed, returning empty slice');
  }

  // Keep prompt-facing payload bounded, but compute rollups from the full set.
  const sorted = [...all].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
  const capped = sorted.slice(0, 100);

  // Group by type. countsByType carries the full PRE-cap totals — it must be computed
  // from the complete sorted set, never from the (capped) byType list lengths.
  const byType: Partial<Record<InsightType, AnalyticsInsight[]>> = {};
  const countsByType: Partial<Record<InsightType, number>> = {};
  for (const insight of sorted) {
    countsByType[insight.insightType] = (countsByType[insight.insightType] ?? 0) + 1;
    const list = byType[insight.insightType] ?? [];
    list.push(insight);
    byType[insight.insightType] = list;
  }

  // Count by severity
  const bySeverity: Record<InsightSeverity, number> = {
    critical: 0, warning: 0, opportunity: 0, positive: 0,
  };
  for (const insight of sorted) {
    bySeverity[insight.severity] = (bySeverity[insight.severity] ?? 0) + 1;
  }

  // Top 10 by impact
  const topByImpact = sorted.slice(0, 10);

  // Page-specific filtering
  let forPage: AnalyticsInsight[] | undefined;
  if (opts?.pagePath) {
    forPage = sorted.filter(i =>
      insightPageIdentities(i).some(identity => matchPageIdentity(identity, opts.pagePath!)),
    );
  }

  return { all: capped, byType, countsByType, bySeverity, topByImpact, forPage };
}
