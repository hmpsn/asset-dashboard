import type {
  ClientIntelligence,
  ClientInsightsSummary,
  ClientPipelineStatus,
  ClientLearningHighlights,
  ClientSiteHealthSummary,
  ClientDecayAlert,
  ClientCopyPipelineStatus,
  ClientKeywordFeedbackSummary,
  InsightsSlice,
  ContentPipelineSlice,
  LearningsSlice,
  SiteHealthSlice,
  SeoContextSlice,
  ClientSignalsSlice,
  RankTrackingSummary,
  DecayAlert,
  IntelligenceSlice,
  WorkspaceIntelligence,
} from '../shared/types/intelligence.js';

export type ClientIntelligenceTier = ClientIntelligence['tier'];
export type ClientIntelligenceSlice =
  | 'insights'
  | 'contentPipeline'
  | 'learnings'
  | 'siteHealth'
  | 'seoContext'
  | 'clientSignals';

const ADMIN_ONLY_INSIGHT_TYPES = new Set(['strategy_alignment']);

export function clientIntelligenceSlicesForTier(
  tier: ClientIntelligenceTier,
): readonly ClientIntelligenceSlice[] {
  return [
    'insights',
    'contentPipeline',
    ...(tier !== 'free' ? (['learnings', 'seoContext', 'clientSignals'] as const) : []),
    ...(tier === 'premium' ? (['siteHealth'] as const) : []),
  ] as const satisfies readonly IntelligenceSlice[];
}

export function buildClientIntelligenceView(
  intel: WorkspaceIntelligence,
  tier: ClientIntelligenceTier,
): ClientIntelligence {
  return {
    workspaceId: intel.workspaceId,
    assembledAt: intel.assembledAt,
    tier,
    insightsSummary: intel.insights ? summarizeInsightsForClient(intel.insights) : null,
    pipelineStatus: intel.contentPipeline ? formatPipelineForClient(intel.contentPipeline) : null,
    ...(tier !== 'free' && {
      learningHighlights: intel.learnings?.availability === 'ready' ? formatLearningsForClient(intel.learnings) : null,
      rankTrackingSummary: intel.seoContext ? formatRankTrackingForClient(intel.seoContext) : null,
      serpOpportunities: intel.seoContext ? countSerpOpportunities(intel.seoContext) : null,
      compositeHealthScore: intel.clientSignals?.compositeHealthScore ?? null,
      compositeHealthBreakdown: intel.clientSignals?.compositeHealthBreakdown ?? null,
      keywordFeedbackSummary: formatKeywordFeedbackForClient(intel.clientSignals),
      weCalledIt: intel.learnings?.availability === 'ready' ? (intel.learnings.weCalledIt ?? []) : [],
      copyPipelineStatus: intel.contentPipeline
        ? formatCopyPipelineForClient(intel.contentPipeline)
        : null,
    }),
    ...(tier === 'premium' && {
      siteHealthSummary: intel.siteHealth ? formatSiteHealthForClient(intel.siteHealth) : null,
      contentDecayAlerts: intel.contentPipeline ? formatDecayAlertsForClient(intel.contentPipeline) : null,
    }),
  };
}

function summarizeInsightsForClient(insights: InsightsSlice): ClientInsightsSummary {
  // G3: byType is capped at 25/type (and `all` at 100) — neither may drive counts.
  // The summary's pinned contracts need jointly-filtered PRE-cap totals: exclude
  // admin-only insight types (scrub) AND positive severity (not actionable priority
  // items — counting them would create a gap vs. highPriority + mediumPriority that
  // clients would have no way to explain). `countsByTypeBySeverity` is the full
  // pre-cap type×severity matrix computed in the assembler, so these counts stay
  // exact on workspaces of any size; total = high + medium by construction.
  let highPriority = 0;
  let mediumPriority = 0;
  for (const [type, severityCounts] of Object.entries(insights.countsByTypeBySeverity)) {
    if (ADMIN_ONLY_INSIGHT_TYPES.has(type) || !severityCounts) continue;
    highPriority += (severityCounts.critical ?? 0) + (severityCounts.warning ?? 0);
    mediumPriority += severityCounts.opportunity ?? 0;
  }
  return {
    total: highPriority + mediumPriority,
    highPriority,
    mediumPriority,
    topInsights: insights.topByImpact
      .filter(i => !ADMIN_ONLY_INSIGHT_TYPES.has(i.insightType) && i.severity !== 'positive')
      .slice(0, 3)
      .map(i => ({ title: i.pageTitle ?? i.insightType, type: i.insightType })),
  };
}

function formatPipelineForClient(pipeline: ContentPipelineSlice): ClientPipelineStatus {
  const inProgressBriefStatuses = ['in_review', 'ai_generated', 'draft'];
  // GeneratedPost has never used the stale `in_review` / `scheduled` literals.
  // Scheduling is represented by plannedPublishAt; lifecycle review is `review`.
  const inProgressPostStatuses = ['generating', 'needs_attention', 'draft', 'review'];
  return {
    briefs: {
      total: pipeline.briefs.total,
      inProgress: inProgressBriefStatuses.reduce(
        (sum, k) => sum + (pipeline.briefs.byStatus[k] ?? 0), 0,
      ),
    },
    posts: {
      total: pipeline.posts.total,
      inProgress: inProgressPostStatuses.reduce(
        (sum, k) => sum + (pipeline.posts.byStatus[k] ?? 0), 0,
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

function formatRankTrackingForClient(seoContext: SeoContextSlice): RankTrackingSummary | null {
  const rt = seoContext.rankTracking;
  if (!rt) return null;
  return {
    trackedKeywords: rt.trackedKeywords,
    avgPosition: rt.avgPosition,
    positionChanges: rt.positionChanges,
  };
}

function formatDecayAlertsForClient(pipeline: ContentPipelineSlice): ClientDecayAlert[] | null {
  const alerts = pipeline.decayAlerts;
  if (!alerts || alerts.length === 0) return null;
  return alerts.slice(0, 10).map((a: DecayAlert) => ({
    pageUrl: a.pageUrl,
    clickDrop: a.clickDrop,
    detectedAt: a.detectedAt,
    hasRefreshBrief: a.hasRefreshBrief,
  }));
}

function countSerpOpportunities(seoContext: SeoContextSlice): number | null {
  const sf = seoContext.serpFeatures;
  if (!sf) return null;
  return sf.featuredSnippets + sf.peopleAlsoAsk + sf.videoCarousel + sf.aiOverview + (sf.localPack ? 1 : 0);
}

function formatCopyPipelineForClient(pipeline: ContentPipelineSlice): ClientCopyPipelineStatus | null {
  const cp = pipeline.copyPipeline;
  if (!cp || cp.totalSections === 0) return null;
  return {
    totalSections: cp.totalSections,
    approvedSections: cp.approvedSections,
    inReviewSections: cp.clientReviewSections,
    approvalRate: cp.approvalRate,
  };
}

function formatKeywordFeedbackForClient(
  clientSignals: ClientSignalsSlice | undefined,
): ClientKeywordFeedbackSummary | null {
  const feedback = clientSignals?.keywordFeedback;
  if (!feedback) return null;
  const approvedCount = feedback.approved.length;
  const rejectedCount = feedback.rejected.length;
  if (approvedCount + rejectedCount === 0) return null;

  return {
    approvedCount,
    rejectedCount,
    approveRate: feedback.patterns.approveRate,
    approvedSamples: feedback.approved.slice(0, 3),
    rejectedSamples: feedback.rejected.slice(0, 3),
    rejectionReasons: feedback.patterns.topRejectionReasons.slice(0, 3),
  };
}
