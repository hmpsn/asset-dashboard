import type { AnalyticsInsight, InsightType } from '../../../shared/types/analytics.js';

const PUBLIC_CAP = 25;
const MAX_PER_TYPE = 5; // prevent any single insight type from dominating the feed

/**
 * Cap insights with type diversity: at most MAX_PER_TYPE per insight type,
 * then fill remaining slots by impact score. When a specific insightType
 * filter is requested, skip diversity (return up to PUBLIC_CAP of that type).
 */
export function capWithDiversity(insights: AnalyticsInsight[], typeFilter?: InsightType): AnalyticsInsight[] {
  if (typeFilter) return insights.slice(0, PUBLIC_CAP);

  // Already sorted by impact_score DESC from the DB query
  const result: AnalyticsInsight[] = [];
  const typeCounts = new Map<string, number>();

  // First pass: take up to MAX_PER_TYPE of each type (highest impact first)
  for (const insight of insights) {
    if (result.length >= PUBLIC_CAP) break;
    const count = typeCounts.get(insight.insightType) ?? 0;
    if (count < MAX_PER_TYPE) {
      result.push(insight);
      typeCounts.set(insight.insightType, count + 1);
    }
  }

  // Second pass: if we still have capacity, backfill from skipped insights
  if (result.length < PUBLIC_CAP) {
    const selected = new Set(result.map(r => r.id));
    for (const insight of insights) {
      if (result.length >= PUBLIC_CAP) break;
      if (!selected.has(insight.id)) {
        result.push(insight);
      }
    }
  }

  return result;
}
