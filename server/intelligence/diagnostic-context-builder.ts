import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
import type {
  ConcurrentAnomaly,
  ExistingInsightSummary,
} from '../../shared/types/diagnostics.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence } from '../workspace-intelligence.js';
import { listAllInsightsFromSlice } from './insights-slice.js';

export interface DiagnosticInsightResolution {
  allInsights: AnalyticsInsight[];
  anomalyInsight: AnalyticsInsight | null;
}

export interface DiagnosticIntelligenceContext {
  intelligence: WorkspaceIntelligence | null;
  allInsights: AnalyticsInsight[];
  concurrentAnomalies: ConcurrentAnomaly[];
  existingInsights: ExistingInsightSummary[];
}

function toAnomalyData(insight: AnalyticsInsight): AnomalyDigestData {
  return insight.data as unknown as AnomalyDigestData;
}

export async function resolveDiagnosticAnomalyInsight(
  workspaceId: string,
  insightId: string,
): Promise<DiagnosticInsightResolution> {
  let intelligence: WorkspaceIntelligence | null = null;
  try {
    intelligence = await buildWorkspaceIntelligence(workspaceId, {
      slices: ['insights'],
    });
  } catch (err) {
    void err;
  }
  let allInsights = intelligence?.insights ? listAllInsightsFromSlice(intelligence.insights) : [];
  if (!allInsights.some((i) => i.id === insightId)) {
    try {
      const { getInsights } = await import('../analytics-insights-store.js'); // dynamic-import-ok - diagnostics fallback: freshly-created anomaly insights may not be in the cached slice yet.
      const directInsights = getInsights(workspaceId);
      const byId = new Map<string, AnalyticsInsight>();
      for (const insight of allInsights) byId.set(insight.id, insight);
      for (const insight of directInsights) byId.set(insight.id, insight);
      allInsights = [...byId.values()];
    } catch (err) {
      // The caller handles a missing anomaly uniformly; this fallback only prevents stale-cache misses.
      void err;
    }
  }
  return {
    allInsights,
    anomalyInsight: allInsights.find((i) => i.id === insightId) ?? null,
  };
}

export async function buildDiagnosticIntelligenceContext(
  workspaceId: string,
  opts: {
    pagePath?: string | null;
    currentInsightId?: string;
    includeBacklinks?: boolean;
  } = {},
): Promise<DiagnosticIntelligenceContext> {
  let intelligence: WorkspaceIntelligence | null = null;
  try {
    intelligence = await buildWorkspaceIntelligence(workspaceId, {
      slices: ['seoContext', 'insights', 'operational', ...(opts.pagePath ? ['pageProfile' as const] : [])],
      pagePath: opts.pagePath ?? undefined,
      enrichWithBacklinks: opts.includeBacklinks,
    });
  } catch (err) {
    void err;
  }

  const allInsights = intelligence?.insights ? listAllInsightsFromSlice(intelligence.insights) : [];
  const concurrentAnomalies: ConcurrentAnomaly[] = allInsights
    .filter((i) => i.insightType === 'anomaly_digest' && i.id !== opts.currentInsightId)
    .slice(0, 10)
    .map((i) => ({
      type: toAnomalyData(i).anomalyType ?? 'unknown',
      page: i.pageId ?? 'site-level',
      severity: i.severity,
    }));

  const existingInsights: ExistingInsightSummary[] = opts.pagePath
    ? allInsights
        .filter((i) => i.pageId === opts.pagePath && i.insightType !== 'anomaly_digest')
        .slice(0, 10)
        .map((i) => ({
          type: i.insightType,
          severity: i.severity,
          summary: i.pageTitle ?? i.insightType,
        }))
    : [];

  return {
    intelligence,
    allInsights,
    concurrentAnomalies,
    existingInsights,
  };
}
