import type { InsightSeverity, InsightType } from '../../../shared/types/analytics.js';
import { deleteStaleInsightsByType, upsertInsight } from '../../analytics-insights-store.js';
import { loadDecayAnalysis } from '../../content-decay.js';
import { buildEnrichmentContext, enrichInsight } from '../../insight-enrichment.js';
import { createLogger } from '../../logger.js';
import { toInsightPageId } from '../../helpers.js';
import { MIN_DECAY_ABSOLUTE_LOSS, MIN_DECAY_BASELINE_CLICKS } from './constants.js';
import { validateInsightBatch } from './validation.js';

const log = createLogger('analytics-intelligence');

// ── Content Decay Insight Refresh ────────────────────────────────
// Lightweight refresh of just the content_decay insight type.
// Called after analyzeContentDecay() to immediately sync the insights
// cache with fresh decay data, avoiding the 24-hour staleness window.

export async function refreshContentDecayInsights(workspaceId: string): Promise<void> {
  const decayAnalysis = loadDecayAnalysis(workspaceId);
  const cycleStart = new Date().toISOString();

  if (decayAnalysis && decayAnalysis.decayingPages.length > 0) {
    const enrichCtx = await buildEnrichmentContext(workspaceId);

    const significantDecay = decayAnalysis.decayingPages.filter(p =>
      p.previousClicks >= MIN_DECAY_BASELINE_CLICKS &&
      Math.abs(p.previousClicks - p.currentClicks) >= MIN_DECAY_ABSOLUTE_LOSS
    );

    for (const page of significantDecay) {
      const severity: InsightSeverity =
        page.severity === 'critical' ? 'critical'
        : page.severity === 'warning' ? 'warning'
        : 'opportunity';
      const enrichment = enrichInsight(
        { pageId: toInsightPageId(page.page), insightType: 'content_decay' as InsightType, severity, data: { baselineClicks: page.previousClicks, currentClicks: page.currentClicks, deltaPercent: page.clickDeclinePct, baselinePeriod: 'previous_30d', currentPeriod: 'current_30d' } },
        enrichCtx,
      );
      const { data: _enrichedData, ...enrichmentRest } = enrichment;
      void _enrichedData;
      upsertInsight({
        ...enrichmentRest,
        workspaceId,
        pageId: toInsightPageId(page.page),
        insightType: 'content_decay',
        data: {
          baselineClicks: page.previousClicks,
          currentClicks: page.currentClicks,
          deltaPercent: page.clickDeclinePct,
          baselinePeriod: 'previous_30d',
          currentPeriod: 'current_30d',
        },
        severity,
      });
    }

    log.info({ workspaceId, count: significantDecay.length }, 'Refreshed content decay insights from fresh analysis');
  }

  // Prune stale decay insights that were not updated in this cycle
  deleteStaleInsightsByType(workspaceId, 'content_decay', cycleStart);

  // Run the same quality gate as the full computation path to suppress
  // contradictory, duplicate, and low-confidence insights.
  validateInsightBatch(workspaceId);
}
