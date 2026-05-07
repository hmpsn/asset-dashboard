import type { IntelligenceOptions, InsightsSlice } from '../../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../../shared/types/analytics.js';
import { createLogger } from '../logger.js';
import { matchPageIdentity } from '../helpers.js';

const log = createLogger('workspace-intelligence/insights');

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

  // Cap at 100, sorted by impact score descending (§13)
  const sorted = [...all].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
  const capped = sorted.slice(0, 100);

  // Group by type
  const byType: Partial<Record<InsightType, AnalyticsInsight[]>> = {};
  for (const insight of capped) {
    const list = byType[insight.insightType] ?? [];
    list.push(insight);
    byType[insight.insightType] = list;
  }

  // Count by severity
  const bySeverity: Record<InsightSeverity, number> = {
    critical: 0, warning: 0, opportunity: 0, positive: 0,
  };
  for (const insight of capped) {
    bySeverity[insight.severity] = (bySeverity[insight.severity] ?? 0) + 1;
  }

  // Top 10 by impact
  const topByImpact = capped.slice(0, 10);

  // Page-specific filtering
  let forPage: AnalyticsInsight[] | undefined;
  if (opts?.pagePath) {
    forPage = capped.filter(i => i.pageId ? matchPageIdentity(i.pageId, opts.pagePath!) : false);
  }

  return { all: capped, byType, bySeverity, topByImpact, forPage };
}
