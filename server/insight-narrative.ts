// server/insight-narrative.ts
import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { ClientInsight } from '../shared/types/narrative.js';
import {
  buildClientInsightStory,
  isClientInsightExcluded,
} from './signal-story-registry.js';

const log = createLogger('insight-narrative');

export function buildClientInsights(workspaceId: string): ClientInsight[] {
  const insights = getInsights(workspaceId);
  return insights
    .filter(i => isClientRelevant(i))
    .map(i => toClientInsight(i))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 15);
}

function isClientRelevant(insight: AnalyticsInsight): boolean {
  if ((insight.impactScore ?? 0) < 20) return false;
  if (isClientInsightExcluded(insight.insightType)) return false;
  return true;
}

function toClientInsight(insight: AnalyticsInsight): ClientInsight {
  const title = insight.pageTitle ?? 'your website';
  const content = buildClientInsightStory(insight)
    ?? {
      headline: `Update on ${title}`,
      narrative: `We identified something worth noting about this page and are evaluating next steps.`,
      impact: undefined,
    };

  log.debug({ workspaceId: insight.workspaceId, insightId: insight.id, insightType: insight.insightType }, 'mapped insight to client narrative');

  return {
    id: insight.id,
    type: insight.insightType,
    severity: insight.severity,
    domain: insight.domain ?? 'cross',
    headline: content.headline,
    narrative: content.narrative,
    impact: content.impact,
    actionTaken: insight.resolutionNote ?? undefined,
    impactScore: insight.impactScore ?? 0,
  };
}
