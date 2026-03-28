/**
 * Insight Feedback Loop Orchestrator
 *
 * Pushes insight intelligence into Strategy and Content Pipeline.
 * Called after insight computation completes. Non-fatal — errors
 * are logged but never prevent insight computation from completing.
 */
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { StrategySignal, PipelineSignal } from '../shared/types/insights.js';

const log = createLogger('insight-feedback');

// Re-export signal types from shared boundary for backward compatibility
export type { StrategySignal, PipelineSignal };

// ── Orchestrator ──────────────────────────────────────────────────

/**
 * Push insight intelligence into Strategy and Content Pipeline.
 * Called after insight computation completes. Non-fatal.
 */
export function runFeedbackLoops(workspaceId: string): void {
  try {
    const insights = getInsights(workspaceId);
    if (!insights.length) return;

    const strategySignals = buildStrategySignals(insights);
    const pipelineSignals = buildPipelineSignals(insights);

    if (strategySignals.length > 0 || pipelineSignals.length > 0) {
      log.info({
        workspaceId,
        strategySignals: strategySignals.length,
        pipelineSignals: pipelineSignals.length,
      }, 'feedback loops generated signals');

      broadcastToWorkspace(workspaceId, 'intelligence_signals_updated', {
        strategyCount: strategySignals.length,
        pipelineCount: pipelineSignals.length,
      });
    }
  } catch (err) {
    log.error({ workspaceId, err }, 'feedback loop error — non-fatal, insights still saved');
  }
}

// ── Strategy signals ──────────────────────────────────────────────

export function buildStrategySignals(insights: AnalyticsInsight[]): StrategySignal[] {
  const signals: StrategySignal[] = [];

  for (const insight of insights) {
    // Ranking movers with positive momentum (gained >3 positions)
    if (insight.insightType === 'ranking_mover' && insight.data) {
      const data = insight.data as Record<string, unknown>;
      const posChange = (data.previousPosition as number ?? 0) - (data.currentPosition as number ?? 0);
      if (posChange > 3) {
        signals.push({
          type: 'momentum',
          keyword: (data.query as string) ?? 'unknown',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          detail: `Gained ${posChange} positions — consider adding to strategy`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }

    // Strategy misalignment
    if (insight.strategyAlignment === 'misaligned') {
      signals.push({
        type: 'misalignment',
        keyword: insight.strategyKeyword ?? 'unknown',
        pageUrl: insight.pageId ?? undefined,
        pageTitle: insight.pageTitle ?? undefined,
        detail: `Targeting "${insight.strategyKeyword}" but ranking for different terms`,
        insightId: insight.id,
        impactScore: insight.impactScore ?? 0,
      });
    }

    // Competitor gap → content gap suggestions
    if (insight.insightType === 'competitor_gap' && insight.data) {
      const data = insight.data as Record<string, unknown>;
      const ourPosition = data.ourPosition as number | null | undefined;
      const competitorPosition = data.competitorPosition as number | undefined;
      const detail = ourPosition != null
        ? `Competitor ranking position ${competitorPosition ?? '?'} for "${data.keyword}" — you rank #${ourPosition}, consider optimizing`
        : `Competitors ranking for "${data.keyword}" — no content targeting this`;
      signals.push({
        type: 'content_gap',
        keyword: (data.keyword as string) ?? 'unknown',
        detail,
        insightId: insight.id,
        impactScore: insight.impactScore ?? 0,
      });
    }
  }

  return signals.sort((a, b) => b.impactScore - a.impactScore);
}

// ── Pipeline signals ──────────────────────────────────────────────

export function buildPipelineSignals(insights: AnalyticsInsight[]): PipelineSignal[] {
  const signals: PipelineSignal[] = [];

  for (const insight of insights) {
    // High-impact ranking opportunities → suggested briefs
    if (insight.insightType === 'ranking_opportunity' && (insight.impactScore ?? 0) > 50) {
      if (!insight.pipelineStatus) {
        const data = insight.data as Record<string, unknown>;
        signals.push({
          type: 'suggested_brief',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          keyword: (data.query as string) ?? insight.strategyKeyword ?? undefined,
          detail: `Position ${data.currentPosition ?? '?'} with ${data.impressions ?? '?'} impressions — brief could push to page 1`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }

    // Content decay → refresh suggestions (critical or warning only)
    if (insight.insightType === 'content_decay') {
      if (insight.severity === 'critical' || insight.severity === 'warning') {
        const data = insight.data as Record<string, unknown>;
        signals.push({
          type: 'refresh_suggestion',
          pageUrl: insight.pageId ?? undefined,
          pageTitle: insight.pageTitle ?? undefined,
          detail: `Traffic declined ${data.deltaPercent ?? data.declinePercent ?? '?'}% — content refresh recommended`,
          insightId: insight.id,
          impactScore: insight.impactScore ?? 0,
        });
      }
    }
  }

  return signals.sort((a, b) => b.impactScore - a.impactScore);
}
