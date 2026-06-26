import type { AnalyticsInsight, InsightType } from '../../../shared/types/analytics.js';
import { getInsights, suppressInsights } from '../../analytics-insights-store.js';
import { createLogger } from '../../logger.js';

const log = createLogger('analytics-intelligence');

// ── Insight Validation Pass ──────────────────────────────────────
// Deterministic quality gate: suppress contradictory, duplicate, and
// low-confidence insights AFTER computation, BEFORE feedback loops.

/** Severity rank for comparison — higher = stronger signal */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  warning: 3,
  opportunity: 2,
  positive: 1,
};

/** Minimum impressions for a ranking_opportunity to be considered actionable */
const MIN_RANKING_OPP_IMPRESSIONS = 100;

/** Minimum absolute click loss for content_decay to be considered actionable */
const MIN_DECAY_CLICK_LOSS = 10;

/** Minimum estimated traffic gain for a ranking_opportunity to survive validation */
const MIN_RANKING_OPP_TRAFFIC_GAIN = 5;

/** Minimum estimated click gap for a ctr_opportunity to survive validation */
const MIN_CTR_OPP_CLICK_GAP = 5;

/**
 * Contradiction pairs: when the same page appears under both insight types,
 * suppress the weaker signal (lower severity, then lower impactScore).
 */
const CONTRADICTION_PAIRS: ReadonlyArray<[InsightType, InsightType]> = [
  ['ranking_opportunity', 'content_decay'],
  ['ctr_opportunity', 'content_decay'],
];

/**
 * Pick the weaker insight from a pair based on severity rank, then impactScore.
 * Returns the id of the insight to suppress, or null if they're equal.
 */
export function pickWeaker(a: AnalyticsInsight, b: AnalyticsInsight): string | null {
  const rankA = SEVERITY_RANK[a.severity] ?? 0;
  const rankB = SEVERITY_RANK[b.severity] ?? 0;
  if (rankA !== rankB) return rankA < rankB ? a.id : b.id;
  const scoreA = a.impactScore ?? 0;
  const scoreB = b.impactScore ?? 0;
  if (scoreA !== scoreB) return scoreA < scoreB ? a.id : b.id;
  return null; // truly equal — don't suppress either
}

export function validateInsightBatch(workspaceId: string): number {
  const allInsights = getInsights(workspaceId);
  if (allInsights.length === 0) return 0;

  const toSuppress = new Set<string>();

  // Build lookup: pageId → insights on that page
  // Skip resolved and bridge-sourced insights — they are protected from background cleanup
  // (mirrors the deleteStaleByType guard: resolution_status IS NULL AND bridge_source IS NULL).
  const byPage = new Map<string, AnalyticsInsight[]>();
  const protectedIds = new Set<string>();
  for (const insight of allInsights) {
    if (insight.resolutionStatus === 'resolved' || insight.resolutionStatus === 'in_progress' || insight.bridgeSource) {
      protectedIds.add(insight.id);
      continue;
    }
    if (!insight.pageId) continue;
    const list = byPage.get(insight.pageId);
    if (list) list.push(insight);
    else byPage.set(insight.pageId, [insight]);
  }

  // ── Rule 1: Contradiction suppression ──────────────────────────
  for (const [typeA, typeB] of CONTRADICTION_PAIRS) {
    for (const [, insights] of byPage) {
      const a = insights.find(i => i.insightType === typeA && !toSuppress.has(i.id));
      const b = insights.find(i => i.insightType === typeB && !toSuppress.has(i.id));
      if (a && b) {
        const weakerId = pickWeaker(a, b);
        if (weakerId) toSuppress.add(weakerId);
      }
    }
  }

  // ── Rule 2: Severity clash on same page ────────────────────────
  // If the same page has both a 'positive' and a 'critical' insight,
  // suppress the positive one (the critical signal takes priority).
  for (const [, insights] of byPage) {
    const positives = insights.filter(i => i.severity === 'positive' && !toSuppress.has(i.id));
    const criticals = insights.filter(i => i.severity === 'critical' && !toSuppress.has(i.id));
    if (positives.length > 0 && criticals.length > 0) {
      for (const p of positives) toSuppress.add(p.id);
    }
  }

  // ── Rule 3: Low-confidence suppression ─────────────────────────
  for (const insight of allInsights) {
    if (toSuppress.has(insight.id) || protectedIds.has(insight.id)) continue;

    if (insight.insightType === 'ranking_opportunity') {
      const d = (insight as AnalyticsInsight<'ranking_opportunity'>).data;
      if (d.impressions < MIN_RANKING_OPP_IMPRESSIONS || d.estimatedTrafficGain < MIN_RANKING_OPP_TRAFFIC_GAIN) {
        toSuppress.add(insight.id);
      }
    }

    if (insight.insightType === 'content_decay') {
      const d = (insight as AnalyticsInsight<'content_decay'>).data;
      if (Math.abs(d.baselineClicks - d.currentClicks) < MIN_DECAY_CLICK_LOSS) {
        toSuppress.add(insight.id);
      }
    }

    if (insight.insightType === 'ctr_opportunity') {
      const d = (insight as AnalyticsInsight<'ctr_opportunity'>).data;
      if (d.estimatedClickGap < MIN_CTR_OPP_CLICK_GAP) {
        toSuppress.add(insight.id);
      }
    }
  }

  // ── Execute suppression ────────────────────────────────────────
  const ids = Array.from(toSuppress);
  const deleted = suppressInsights(workspaceId, ids);
  if (deleted > 0) {
    log.info({ workspaceId, suppressed: deleted }, 'Insight validation pass: suppressed contradictory/low-confidence insights');
  }
  return deleted;
}
