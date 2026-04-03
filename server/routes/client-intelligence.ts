/**
 * client-intelligence.ts — Client-facing intelligence endpoint
 * Spec: docs/superpowers/specs/unified-workspace-intelligence.md §23
 *
 * Tier-gated, scrubbed view of WorkspaceIntelligence. NEVER returns:
 * knowledgeBase, brandVoice, churnRisk, impact_score, operational slice,
 * strategy_alignment insight type, or bridge source tags.
 */
import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { buildWorkspaceIntelligence } from '../workspace-intelligence.js';
import { createLogger } from '../logger.js';
import type {
  ClientIntelligence,
  ClientInsightsSummary,
  ClientPipelineStatus,
  ClientLearningHighlights,
  ClientSiteHealthSummary,
  InsightsSlice,
  ContentPipelineSlice,
  LearningsSlice,
  SiteHealthSlice,
} from '../../shared/types/intelligence.js';

const router = Router();
const log = createLogger('client-intelligence');

// Admin-only insight types never shown to clients
const ADMIN_ONLY_INSIGHT_TYPES = new Set(['strategy_alignment']);

function summarizeInsightsForClient(insights: InsightsSlice): ClientInsightsSummary {
  // Exclude positive-severity insights: they aren't actionable priority items and
  // including them in 'total' would create a gap vs. highPriority + mediumPriority
  // that clients would have no way to explain.
  const visible = insights.all.filter(
    i => !ADMIN_ONLY_INSIGHT_TYPES.has(i.insightType) && i.severity !== 'positive',
  );
  return {
    total: visible.length,
    highPriority: visible.filter(i => i.severity === 'critical' || i.severity === 'warning').length,
    mediumPriority: visible.filter(i => i.severity === 'opportunity').length,
    topInsights: insights.topByImpact
      .filter(i => !ADMIN_ONLY_INSIGHT_TYPES.has(i.insightType))
      .slice(0, 3)
      .map(i => ({ title: i.pageTitle ?? i.insightType, type: i.insightType })),
  };
}

function formatPipelineForClient(pipeline: ContentPipelineSlice): ClientPipelineStatus {
  const inProgressBriefStatuses = ['in_review', 'ai_generated', 'draft'];
  const inProgressPostStatuses = ['draft', 'in_review', 'scheduled'];
  return {
    briefs: {
      total: pipeline.briefs.total,
      inProgress: inProgressBriefStatuses.reduce(
        (sum, k) => sum + (pipeline.briefs.byStatus[k] ?? 0), 0
      ),
    },
    posts: {
      total: pipeline.posts.total,
      inProgress: inProgressPostStatuses.reduce(
        (sum, k) => sum + (pipeline.posts.byStatus[k] ?? 0), 0
      ),
    },
    pendingApprovals: pipeline.seoEdits.inReview,
  };
}

function formatLearningsForClient(learnings: LearningsSlice): ClientLearningHighlights {
  return {
    overallWinRate: learnings.overallWinRate,
    topActionType: learnings.topActionTypes[0]?.type ?? null,
    recentWins: learnings.weCalledIt?.length ?? 0,
  };
}

function formatSiteHealthForClient(health: SiteHealthSlice): ClientSiteHealthSummary {
  const { mobile, desktop } = health.cwvPassRate;
  const definedRates = [mobile, desktop].filter((r): r is number => r !== null);
  const avgPassRate = definedRates.length > 0
    ? definedRates.reduce((a, b) => a + b, 0) / definedRates.length
    : null;

  return {
    auditScore: health.auditScore,
    auditScoreDelta: health.auditScoreDelta,
    cwvPassRatePct: avgPassRate !== null ? Math.round(avgPassRate * 100) : null,
    deadLinks: health.deadLinks,
  };
}

// GET /api/public/intelligence/:workspaceId
router.get('/api/public/intelligence/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const tier = (ws.tier ?? 'free') as 'free' | 'growth' | 'premium';

  const slices: Array<'insights' | 'contentPipeline' | 'learnings' | 'siteHealth'> = [
    'insights',
    'contentPipeline',
    ...(tier !== 'free' ? (['learnings'] as const) : []),
    ...(tier === 'premium' ? (['siteHealth'] as const) : []),
  ];

  try {
    const intel = await buildWorkspaceIntelligence(ws.id, { slices });

    const response: ClientIntelligence = {
      workspaceId: ws.id,
      assembledAt: intel.assembledAt,
      tier,
      insightsSummary: intel.insights ? summarizeInsightsForClient(intel.insights) : null,
      pipelineStatus: intel.contentPipeline ? formatPipelineForClient(intel.contentPipeline) : null,
      ...(tier !== 'free' && {
        learningHighlights: intel.learnings ? formatLearningsForClient(intel.learnings) : null,
      }),
      ...(tier === 'premium' && {
        siteHealthSummary: intel.siteHealth ? formatSiteHealthForClient(intel.siteHealth) : null,
      }),
    };

    return res.json(response);
  } catch (err) {
    log.error({ workspaceId: ws.id, err }, 'Client intelligence assembly failed');
    return res.status(500).json({ error: 'Intelligence unavailable — try again shortly' });
  }
});

export default router;
