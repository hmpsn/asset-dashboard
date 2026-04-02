// server/workspace-intelligence.ts
// Core intelligence assembler — query-time assembly of all subsystem data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';
import { invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { z } from './middleware/validate.js';
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  PageProfileSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  RedirectDetail,
  SchemaValidationSummary,
  PerformanceSummary,
  PromptFormatOptions,
  PromptVerbosity,
  CannibalizationWarning,
  DecayAlert,
  ClientSignalsSlice,
  ChurnSignalSummary,
  EngagementMetrics,
  OperationalSlice,
  InsightAcceptanceRate,
  ROIAttribution,
  WeCalledItEntry,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';
import type { TrackedAction } from '../shared/types/outcome-tracking.js';
import type { Workspace } from '../shared/types/workspace.js';
import type { PageKeywordMap } from '../shared/types/workspace.js';
import type { ContentSubscription, ContentMatrix, GeneratedPost } from '../shared/types/content.js';
import type { SchemaSitePlan } from '../shared/types/schema-plan.js';
import type { RecommendationSet } from '../shared/types/recommendations.js';
import type { ApprovalBatch } from '../shared/types/approvals.js';
import type { ChurnSignal } from './churn-signals.js';
import type { DecayAnalysis } from './content-decay.js';
import type { AuditSnapshot } from './reports.js';
import type { ROIData } from './roi.js';
import type { SeoChangeEvent } from './seo-change-tracker.js';
import type { CannibalizationReport } from './cannibalization-detection.js';
import type { Annotation as AnalyticsAnnotation } from './analytics-annotations.js';
import type { Annotation as TimelineAnnotation } from './annotations.js';

const log = createLogger('workspace-intelligence');

const stmts = createStmtCache(() => ({
  schemaErrorCount: db.prepare(
    `SELECT COUNT(*) as cnt FROM schema_validations WHERE workspace_id = ? AND status = 'errors'`,
  ),
  strategyHistory: db.prepare(
    'SELECT created_at, change_description FROM strategy_history WHERE workspace_id = ? ORDER BY created_at DESC',
  ),
  keywordFeedbackApproved: db.prepare(
    'SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
  ),
  keywordFeedbackDeclined: db.prepare(
    'SELECT keyword, reason FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
  ),
  contentGapVotes: db.prepare(
    'SELECT keyword, COUNT(*) as cnt FROM content_gap_votes WHERE workspace_id = ? GROUP BY keyword ORDER BY cnt DESC',
  ),
  clientBusinessPriorities: db.prepare(
    'SELECT priorities FROM client_business_priorities WHERE workspace_id = ?',
  ),
}));

// ── Cache (§13, §33) ───────────────────────────────────────────────────

const intelligenceCache = new LRUCache<WorkspaceIntelligence>(200);
const INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Assembly ────────────────────────────────────────────────────────────

const ALL_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
];

export async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<WorkspaceIntelligence> {
  const cacheKey = buildCacheKey(workspaceId, opts);

  // Check cache
  const cached = intelligenceCache.get(cacheKey);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: false }, 'Intelligence cache hit');
    return cached.data;
  }
  if (cached?.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: true }, 'Intelligence cache hit (stale)');
  }

  // Single-flight dedup (§13)
  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const requestedSlices = opts?.slices ?? ALL_SLICES;

    const result: WorkspaceIntelligence = {
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
    };

    // Assemble each requested slice independently (§12)
    for (const slice of requestedSlices) {
      try {
        await assembleSlice(result, workspaceId, slice, opts);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
        // result[slice] remains undefined — consumers check for presence
      }
    }

    // Cache the result
    intelligenceCache.set(cacheKey, result, INTELLIGENCE_CACHE_TTL);

    // Observability (§18)
    log.info({
      workspaceId,
      assembly_ms: Date.now() - start,
      slices_requested: requestedSlices,
      slices_returned: Object.keys(result).filter(k => !['version', 'workspaceId', 'assembledAt'].includes(k)),
    }, 'Intelligence assembled');

    return result;
  });
}

// ── Slice assemblers ────────────────────────────────────────────────────

async function assembleSlice(
  result: WorkspaceIntelligence,
  workspaceId: string,
  slice: IntelligenceSlice,
  opts?: IntelligenceOptions,
): Promise<void> {
  switch (slice) {
    case 'seoContext':
      result.seoContext = await assembleSeoContext(workspaceId, opts);
      break;
    case 'insights':
      result.insights = await assembleInsights(workspaceId, opts);
      break;
    case 'learnings':
      result.learnings = await assembleLearnings(workspaceId, opts);
      break;
    case 'contentPipeline':
      result.contentPipeline = await assembleContentPipeline(workspaceId);
      break;
    case 'siteHealth':
      try {
        result.siteHealth = await Promise.race([
          assembleSiteHealth(workspaceId, opts),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('siteHealth assembler timed out')), 5000),
          ),
        ]);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'siteHealth slice assembly failed — skipping');
      }
      break;
    case 'clientSignals':
      result.clientSignals = await assembleClientSignals(workspaceId, opts);
      break;
    case 'operational':
      result.operational = await assembleOperational(workspaceId, opts);
      break;
    case 'pageProfile':
      if (opts?.pagePath) {
        result.pageProfile = await assemblePageProfile(workspaceId, opts.pagePath, opts);
      }
      break;
  }
}

async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { buildSeoContext } = await import('./seo-context.js');
  const { getWorkspace } = await import('./workspaces.js');
  // Pass _skipShadow to prevent circular recursion:
  // buildWorkspaceIntelligence → assembleSeoContext → buildSeoContext → shadow mode → buildWorkspaceIntelligence → ∞
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all', { _skipShadow: true });
  const workspace = getWorkspace(workspaceId);

  const base: SeoContextSlice = {
    strategy: ctx.strategy,
    brandVoice: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
    personas: workspace?.personas ?? [],
    knowledgeBase: ctx.knowledgeBlock,
  };

  // Rank tracking enrichment
  try {
    const { getTrackedKeywords, getLatestRanks } = await import('./rank-tracking.js');
    const tracked = getTrackedKeywords(workspaceId);
    const latest = getLatestRanks(workspaceId);
    const improved = latest.filter((k: any) => (k.change ?? 0) < 0).length;
    const declined = latest.filter((k: any) => (k.change ?? 0) > 0).length;
    const stable = latest.length - improved - declined;
    const positions = latest.map((k: any) => k.position).filter((p: number) => p > 0);
    const avgPosition = positions.length > 0
      ? positions.reduce((a: number, b: number) => a + b, 0) / positions.length
      : null;

    base.rankTracking = {
      trackedKeywords: tracked.length,
      avgPosition,
      positionChanges: { improved, declined, stable },
    };
  } catch {
    // Rank tracking optional
  }

  // Business profile from workspace settings
  try {
    const profile = (workspace as any)?.businessProfile;
    if (profile && typeof profile === 'object') {
      base.businessProfile = {
        industry: profile.industry ?? '',
        goals: Array.isArray(profile.goals) ? profile.goals : [],
        targetAudience: profile.targetAudience ?? '',
      };
    }
  } catch {
    // Business profile optional
  }

  // Strategy history
  try {
    const rows = stmts().strategyHistory.all(workspaceId) as Array<{ created_at: string; change_description: string }>;
    if (rows.length > 0) {
      const recentChanges = rows.slice(0, 5).map(r => r.change_description?.toLowerCase() ?? '');
      const expanding = recentChanges.filter(c => c.includes('add') || c.includes('expand') || c.includes('new')).length;
      const narrowing = recentChanges.filter(c => c.includes('remove') || c.includes('narrow') || c.includes('focus')).length;
      const trajectory = expanding > narrowing ? 'expanding' : narrowing > expanding ? 'narrowing' : 'stable';
      base.strategyHistory = {
        revisionsCount: rows.length,
        lastRevisedAt: rows[0].created_at,
        trajectory,
      };
    }
  } catch {
    // Strategy history table may not exist
  }

  return base;
}

async function assembleInsights(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<InsightsSlice> {
  const { getInsights } = await import('./analytics-insights-store.js');
  const all: AnalyticsInsight[] = getInsights(workspaceId);

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
    forPage = capped.filter(i => i.pageId === opts.pagePath);
  }

  return { all: capped, byType, bySeverity, topByImpact, forPage };
}

async function assembleLearnings(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<LearningsSlice> {
  // Only assemble if feature flag is enabled
  if (!isFeatureEnabled('outcome-ai-injection')) {
    return {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
    };
  }

  const { getWorkspaceLearnings } = await import('./workspace-learnings.js');
  const { getPlaybooks } = await import('./outcome-playbooks.js');
  const summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
  const playbooks = getPlaybooks(workspaceId);

  // ROI attribution enrichment
  let roiAttribution: ROIAttribution[] = [];
  try {
    const { getROIHighlights } = await import('./roi-attribution.js');
    const highlights = getROIHighlights(workspaceId, 10);
    roiAttribution = highlights.map((h: any) => ({
      actionId: h.id ?? '',
      pageUrl: h.pageUrl ?? '',
      actionType: h.actionType ?? '',
      clicksBefore: h.clicksBefore ?? 0,
      clicksAfter: h.clicksAfter ?? 0,
      clickGain: h.clickGain ?? ((h.clicksAfter ?? 0) - (h.clicksBefore ?? 0)),
      measuredAt: h.measuredAt ?? '',
    }));
  } catch {
    // ROI attribution optional
  }

  // WeCalledIt entries — actions with strong_win outcomes
  let weCalledIt: WeCalledItEntry[] = [];
  try {
    const { getActionsByWorkspace, getOutcomesForAction } = await import('./outcome-tracking.js');
    const actions = getActionsByWorkspace(workspaceId);
    for (const action of actions.slice(0, 50)) {
      const outcomes = getOutcomesForAction(action.id);
      const strongWin = outcomes.find((o: any) => o.score === 'strong_win');
      if (strongWin) {
        weCalledIt.push({
          actionId: action.id,
          prediction: `${(action as any).actionType} on ${(action as any).pageUrl ?? 'site'}`,
          outcome: 'strong_win',
          score: 'strong_win',
          pageUrl: (action as any).pageUrl ?? '',
          measuredAt: (strongWin as any).measuredAt ?? '',
        });
      }
      if (weCalledIt.length >= 5) break;
    }
  } catch {
    // Outcome data optional
  }

  return {
    summary,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
    roiAttribution,
    weCalledIt,
  };
}

async function assembleContentPipeline(workspaceId: string): Promise<ContentPipelineSlice> {
  const { getContentPipelineSummary } = await import('./workspace-data.js');
  const summary = getContentPipelineSummary(workspaceId);

  // Coverage gaps: strategy keywords without any brief
  let coverageGaps: string[] = [];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    const strategyKeywords: string[] = ws?.keywordStrategy?.siteKeywords?.map((k: string | { keyword: string }) =>
      typeof k === 'string' ? k : k.keyword,
    ) ?? [];
    const { listBriefs } = await import('./content-brief.js');
    const briefs = listBriefs(workspaceId);
    const briefKeywords = new Set(briefs.map(b => b.targetKeyword?.trim().toLowerCase()));
    coverageGaps = strategyKeywords
      .filter(kw => !briefKeywords.has(kw.trim().toLowerCase()))
      .slice(0, 10);
  } catch {
    // Non-critical — empty gaps is acceptable
  }

  // Subscriptions
  let subscriptions: ContentPipelineSlice['subscriptions'];
  try {
    const { listContentSubscriptions } = await import('./content-subscriptions.js');
    const subs: ContentSubscription[] = listContentSubscriptions(workspaceId);
    const activeSubs = subs.filter(s => s.status === 'active');
    const totalPages = activeSubs.reduce((sum, s) => sum + (s.postsPerMonth ?? 0), 0);
    subscriptions = { active: activeSubs.length, totalPages };
  } catch {
    // Non-critical — subscriptions optional
  }

  // Schema deployment
  let schemaDeployment: ContentPipelineSlice['schemaDeployment'];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const { getSchemaPlan } = await import('./schema-store.js');
      const { listPendingSchemas } = await import('./schema-queue.js');
      const plan: SchemaSitePlan | null = getSchemaPlan(ws.webflowSiteId);
      const pending = listPendingSchemas(workspaceId);
      const planned = plan?.pageRoles?.length ?? 0;
      const deployed = Math.max(0, planned - pending.length);
      const types = [...new Set((plan?.pageRoles ?? []).map(p => p.primaryType).filter(Boolean))];
      schemaDeployment = { planned, deployed, types };
    }
  } catch {
    // Non-critical — schema deployment optional
  }

  // Cannibalization warnings
  let cannibalizationWarnings: CannibalizationWarning[] = [];
  try {
    const { listMatrices } = await import('./content-matrices.js');
    const { detectMatrixCannibalization } = await import('./cannibalization-detection.js');
    const matrices: ContentMatrix[] = listMatrices(workspaceId);
    for (const matrix of matrices.slice(0, 5)) {
      const report: CannibalizationReport = detectMatrixCannibalization(workspaceId, matrix.id);
      if (report?.conflicts) {
        for (const conflict of report.conflicts.slice(0, 10)) {
          cannibalizationWarnings.push({
            keyword: conflict.keyword ?? '',
            pages: conflict.pages ?? [],
            severity: conflict.severity ?? 'low',
          });
        }
      }
    }
  } catch {
    // Non-critical — cannibalization detection optional
  }

  // Decay alerts
  let decayAlerts: DecayAlert[] = [];
  try {
    const { loadDecayAnalysis } = await import('./content-decay.js');
    const decay: DecayAnalysis | null = loadDecayAnalysis(workspaceId);
    if (decay?.decayingPages) {
      decayAlerts = decay.decayingPages.slice(0, 20).map(p => ({
        pageUrl: p.page ?? '',
        clickDrop: p.clickDeclinePct ?? 0,
        detectedAt: p.detectedAt ?? decay.analyzedAt ?? new Date().toISOString(),
        hasRefreshBrief: !!p.refreshRecommendation,
        isRepeatDecay: p.isRepeatDecay ?? false,
      }));
    }
  } catch {
    // Non-critical — decay data optional
  }

  // Suggested briefs count
  let suggestedBriefs = 0;
  try {
    const { listSuggestedBriefs } = await import('./suggested-briefs-store.js');
    const briefs = listSuggestedBriefs(workspaceId);
    suggestedBriefs = briefs.filter(b => b.status === 'pending').length;
  } catch {
    // Non-critical — suggested briefs optional
  }

  return {
    briefs: summary.briefs,
    posts: summary.posts,
    matrices: summary.matrices,
    requests: summary.requests,
    workOrders: summary.workOrders,
    coverageGaps,
    seoEdits: summary.seoEdits,
    subscriptions,
    schemaDeployment,
    cannibalizationWarnings,
    decayAlerts,
    suggestedBriefs,
  };
}

async function assembleSiteHealth(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<SiteHealthSlice> {
  const { getWorkspace } = await import('./workspaces.js');
  const workspace = getWorkspace(workspaceId);
  const siteId = workspace?.webflowSiteId ?? null;

  // Defaults — each source fills in what it can
  let auditScore: number | null = null;
  let auditScoreDelta: number | null = null;
  let deadLinks = 0;
  let redirectChains = 0;
  let schemaErrors = 0;
  let orphanPages = 0;
  const cwvPassRate: { mobile: number | null; desktop: number | null } = { mobile: null, desktop: null };
  let redirectDetails: RedirectDetail[] | undefined;
  let schemaValidation: SchemaValidationSummary | undefined;
  let performanceSummary: PerformanceSummary | null | undefined;
  let anomalyCount = 0;
  let anomalyTypes: string[] = [];
  let seoChangeVelocity = 0;

  // ── Audit snapshot (reports.ts) ──────────────────────────────────────
  if (siteId) {
    try {
      const { getLatestSnapshot, listSnapshots } = await import('./reports.js');
      const latest = getLatestSnapshot(siteId);
      if (latest) {
        auditScore = latest.audit.siteScore ?? null;
        // Delta: compare with previous snapshot
        const summaries = listSnapshots(siteId);
        if (summaries.length >= 2) {
          const prevScore = summaries[1].siteScore;
          auditScoreDelta = auditScore !== null ? auditScore - prevScore : null;
        } else if (latest.previousScore !== undefined) {
          auditScoreDelta = auditScore !== null ? auditScore - latest.previousScore : null;
        }
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: audit snapshot failed — skipping');
    }
  }

  // ── Dead links (performance-store.ts / getLinkCheck) ────────────────
  if (siteId) {
    try {
      const { getLinkCheck } = await import('./performance-store.js');
      const linkSnap = getLinkCheck(siteId);
      if (linkSnap?.result) {
        const result = linkSnap.result as { deadLinks?: unknown[] };
        deadLinks = Array.isArray(result.deadLinks) ? result.deadLinks.length : 0;
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: link check failed — skipping');
    }
  }

  // ── PageSpeed / CWV (performance-store.ts / getPageSpeed) ───────────
  if (siteId) {
    try {
      const { getPageSpeed } = await import('./performance-store.js');
      const speedSnap = getPageSpeed(siteId);
      if (speedSnap?.result) {
        const siteSpeed = speedSnap.result as {
          pages?: Array<{ score?: number; vitals?: { LCP?: number | null; FID?: number | null; CLS?: number | null } }>;
          averageScore?: number;
          averageVitals?: { LCP?: number | null; FID?: number | null; CLS?: number | null };
        };
        // CWV pass rate: % of pages with score >= 90
        const pages = siteSpeed.pages ?? [];
        if (pages.length > 0) {
          const passing = pages.filter(p => (p.score ?? 0) >= 90).length;
          const rate = passing / pages.length;
          cwvPassRate.mobile = rate;
        }
        // Performance summary from averageVitals
        if (siteSpeed.averageVitals) {
          performanceSummary = {
            avgLcp: siteSpeed.averageVitals.LCP ?? null,
            avgFid: siteSpeed.averageVitals.FID ?? null,
            avgCls: siteSpeed.averageVitals.CLS ?? null,
            score: siteSpeed.averageScore ?? null,
          };
        }
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: pagespeed failed — skipping');
    }
  }

  // ── Redirect chains (redirect-store.ts) ─────────────────────────────
  if (siteId) {
    try {
      const { getRedirectSnapshot } = await import('./redirect-store.js');
      const redirSnap = getRedirectSnapshot(siteId);
      if (redirSnap?.result) {
        redirectChains = redirSnap.result.summary.chainsDetected ?? 0;
        // Map chains to RedirectDetail[]
        redirectDetails = (redirSnap.result.chains ?? []).map(chain => ({
          url: chain.originalUrl,
          target: chain.finalUrl,
          chainDepth: chain.totalHops,
          status: chain.hops[0]?.status ?? 301,
        }));
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: redirect snapshot failed — skipping');
    }
  }

  // ── Orphan pages (site-architecture.ts) ─────────────────────────────
  try {
    const { getCachedArchitecture, flattenTree } = await import('./site-architecture.js');
    const arch = await Promise.race([
      getCachedArchitecture(workspaceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (arch) {
      orphanPages = arch.orphanPaths?.length ?? 0;
      // Verify via flattenTree if orphanPaths is empty but tree has isolated nodes
      if (orphanPages === 0) {
        const nodes = flattenTree(arch.tree);
        orphanPages = nodes.filter(n => n.source === 'existing' && n.hasContent && n.depth === 1 && n.children.length === 0).length;
      }
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: site architecture failed — skipping');
  }

  // ── Schema errors (schema-validator.ts) ─────────────────────────────
  try {
    const { getValidations } = await import('./schema-validator.js');
    const validations = getValidations(workspaceId);
    if (validations.length > 0) {
      let valid = 0;
      let warnings = 0;
      let errors = 0;
      for (const v of validations) {
        if (v.status === 'valid') valid++;
        else if (v.status === 'warnings') warnings++;
        else if (v.status === 'errors') errors++;
      }
      schemaValidation = { valid, warnings, errors };
      schemaErrors = errors; // count of pages with errors status
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: schema validation failed — skipping');
  }

  // ── Anomaly count (anomaly-detection.ts) ─────────────────────────────
  try {
    // NOTE: dynamic import required — anomaly-detection.ts statically imports from this module
    const { listAnomalies } = await import('./anomaly-detection.js');
    const anomalies = listAnomalies(workspaceId);
    anomalyCount = anomalies.length;
    anomalyTypes = [...new Set(anomalies.map(a => a.type))];
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: anomaly detection failed — skipping');
  }

  // ── SEO change velocity (seo-change-tracker.ts) ──────────────────────
  try {
    const { getSeoChanges } = await import('./seo-change-tracker.js');
    // Pass 500 limit — the second param is a row limit, not days.
    // Active workspaces may exceed the default 100-row cap within 30 days.
    const changes = getSeoChanges(workspaceId, 500);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    seoChangeVelocity = changes.filter(c => c.changedAt >= thirtyDaysAgo).length;
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: seo change tracker failed — skipping');
  }

  return {
    auditScore,
    auditScoreDelta,
    deadLinks,
    redirectChains,
    schemaErrors,
    orphanPages,
    cwvPassRate,
    redirectDetails,
    schemaValidation,
    performanceSummary,
    anomalyCount,
    anomalyTypes,
    seoChangeVelocity,
  };
}

async function assembleClientSignals(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<ClientSignalsSlice> {
  // Keyword feedback (DB direct — no store module)
  let keywordFeedback: ClientSignalsSlice['keywordFeedback'] = { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } };
  try {
    const approvedRows = stmts().keywordFeedbackApproved.all(workspaceId, 'approved') as { keyword: string }[];
    const rejectedRows = stmts().keywordFeedbackDeclined.all(workspaceId, 'declined') as { keyword: string; reason?: string }[];
    const total = approvedRows.length + rejectedRows.length;
    const reasons = rejectedRows.map(r => r.reason).filter(Boolean) as string[];
    const reasonCounts = new Map<string, number>();
    for (const r of reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    const topRejectionReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason]) => reason);
    keywordFeedback = {
      approved: approvedRows.map(r => r.keyword),
      rejected: rejectedRows.map(r => r.keyword),
      patterns: { approveRate: total > 0 ? approvedRows.length / total : 0, topRejectionReasons },
    };
  } catch (err) {
    log.debug({ workspaceId, err }, 'Keyword feedback table unavailable — skipping');
  }

  // Content gap votes (DB direct)
  let contentGapVotes: { topic: string; votes: number }[] = [];
  try {
    const rows = stmts().contentGapVotes.all(workspaceId) as { keyword: string; cnt: number }[];
    contentGapVotes = rows.map(r => ({ topic: r.keyword, votes: r.cnt }));
  } catch {
    // Table may not exist
  }

  // Business priorities (DB direct)
  let businessPriorities: string[] = [];
  try {
    const row = stmts().clientBusinessPriorities.get(workspaceId) as { priorities: string } | undefined;
    if (row) {
      businessPriorities = parseJsonSafe(row.priorities, z.array(z.string()), 'client_business_priorities') ?? [];
    }
  } catch {
    // Table may not exist or bad JSON
  }

  // Churn signals
  let churnSignals: ChurnSignalSummary[] = [];
  let churnRisk: ClientSignalsSlice['churnRisk'] = null;
  let churnFetchSucceeded = false;
  try {
    // NOTE: dynamic import required — churn-signals.ts statically imports from this module
    const { listChurnSignals } = await import('./churn-signals.js');
    // listChurnSignals already filters to undismissed signals via SQL (WHERE dismissed_at IS NULL)
    const signals: ChurnSignal[] = listChurnSignals(workspaceId);
    churnFetchSucceeded = true;
    churnSignals = signals.map(s => ({
      type: s.type,
      severity: s.severity,
      detectedAt: s.detectedAt,
    }));
    // ChurnSignal.severity is 'critical' | 'warning' | 'positive' — map to churnRisk levels
    const criticalCount = signals.filter(s => s.severity === 'critical').length;
    const warningCount = signals.filter(s => s.severity === 'warning').length;
    churnRisk = criticalCount > 0 ? 'high' : warningCount >= 2 ? 'medium' : signals.length > 0 ? 'low' : null;
  } catch {
    // Churn signals optional — churnFetchSucceeded stays false
  }

  // Approval patterns
  let approvalPatterns = { approvalRate: 0, avgResponseTime: null as number | null };
  try {
    const { listBatches } = await import('./approvals.js');
    const batches: ApprovalBatch[] = listBatches(workspaceId);
    let approved = 0, total = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        total++;
        if (item.status === 'approved') approved++;
      }
    }
    approvalPatterns = {
      approvalRate: total > 0 ? approved / total : 0,
      avgResponseTime: null,
    };
  } catch {
    // Approvals optional
  }

  // Engagement metrics
  let engagement: EngagementMetrics = { lastLoginAt: null, loginFrequency: 'inactive', chatSessionCount: 0, portalUsage: null };
  try {
    const { listClientUsers } = await import('./client-users.js');
    const users = listClientUsers(workspaceId);
    const latestLogin = users
      .map(u => (u as any).lastLoginAt as string | undefined)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

    let loginFrequency: EngagementMetrics['loginFrequency'] = 'inactive';
    if (latestLogin) {
      const daysSinceLogin = (Date.now() - new Date(latestLogin).getTime()) / (24 * 60 * 60 * 1000);
      loginFrequency = daysSinceLogin <= 2 ? 'daily' : daysSinceLogin <= 8 ? 'weekly' : daysSinceLogin <= 35 ? 'monthly' : 'inactive';
    }

    let chatSessionCount = 0;
    try {
      const { getMonthlyConversationCount } = await import('./chat-memory.js');
      chatSessionCount = getMonthlyConversationCount(workspaceId, 'client');
    } catch {
      // Chat memory optional
    }

    engagement = {
      lastLoginAt: latestLogin,
      loginFrequency,
      chatSessionCount,
      portalUsage: null,
    };
  } catch {
    // Client users optional
  }

  // ROI data
  let roi: ClientSignalsSlice['roi'] = null;
  try {
    const { computeROI } = await import('./roi.js');
    const roiData: ROIData | null = computeROI(workspaceId);
    if (roiData) {
      roi = {
        organicValue: roiData.organicTrafficValue,
        growth: roiData.growthPercent ?? 0,
        period: 'monthly',
      };
    }
  } catch {
    // ROI data optional
  }

  // Feedback items
  let feedbackItems: ClientSignalsSlice['feedbackItems'] = [];
  try {
    const { listFeedback } = await import('./feedback.js');
    const items = listFeedback(workspaceId);
    feedbackItems = items.slice(0, 10).map((f: any) => ({
      id: f.id,
      type: f.type ?? 'general',
      status: f.status ?? 'open',
      createdAt: f.createdAt ?? '',
    }));
  } catch {
    // Feedback optional
  }

  // Service requests
  let serviceRequests = { pending: 0, total: 0 };
  try {
    const { listRequests } = await import('./requests.js');
    const reqs = listRequests(workspaceId);
    serviceRequests = {
      pending: reqs.filter((r: any) => r.status === 'pending' || r.status === 'open').length,
      total: reqs.length,
    };
  } catch {
    // Requests optional
  }

  // Recent chat topics
  let recentChatTopics: string[] = [];
  try {
    const { listSessions } = await import('./chat-memory.js');
    const sessions = listSessions(workspaceId, 'client');
    recentChatTopics = sessions
      .slice(0, 5)
      .map((s: any) => s.topic ?? s.title ?? '')
      .filter(Boolean);
  } catch {
    // Chat memory optional
  }

  // Composite health score (40% churn + 30% ROI + 30% engagement)
  // Weights are normalized to available components so missing data doesn't drag the score down.
  let compositeHealthScore: number | null = null;
  {
    let totalWeight = 0;
    let weightedSum = 0;
    let components = 0;

    // Churn component (weight 0.4) — only include if churn subsystem loaded successfully
    if (churnFetchSucceeded) {
      const churnScore = churnRisk === 'high' ? 0 : churnRisk === 'medium' ? 30 : churnRisk === 'low' ? 60 : 100;
      weightedSum += churnScore * 0.4;
      totalWeight += 0.4;
      components++;
    }
    // ROI component (weight 0.3)
    if (roi) {
      const roiScore = roi.growth > 10 ? 100 : roi.growth > 0 ? 70 : roi.growth === 0 ? 40 : 0;
      weightedSum += roiScore * 0.3;
      totalWeight += 0.3;
      components++;
    }
    // Engagement component (weight 0.3)
    if (engagement.loginFrequency !== 'inactive') {
      const engagementScore = engagement.loginFrequency === 'daily' ? 100 : engagement.loginFrequency === 'weekly' ? 70 : 40;
      weightedSum += engagementScore * 0.3;
      totalWeight += 0.3;
      components++;
    }

    if (components >= 2 && totalWeight > 0) {
      compositeHealthScore = Math.round(weightedSum / totalWeight);
    }
  }

  return {
    keywordFeedback,
    contentGapVotes,
    businessPriorities,
    approvalPatterns,
    recentChatTopics,
    churnRisk,
    churnSignals,
    roi,
    engagement,
    compositeHealthScore,
    feedbackItems,
    serviceRequests,
  };
}

async function assembleOperational(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<OperationalSlice> {
  // Recent activity
  let recentActivity: OperationalSlice['recentActivity'] = [];
  try {
    const { listActivity } = await import('./activity-log.js');
    const activity = listActivity(workspaceId, 20);
    recentActivity = activity.map((a: any) => ({
      type: a.type ?? '',
      description: a.title ?? a.description ?? '',
      timestamp: a.timestamp ?? a.createdAt ?? '',
    }));
  } catch {
    // Activity log optional
  }

  // Annotations (merge both sources)
  let annotations: OperationalSlice['annotations'] = [];
  try {
    const { getAnnotations } = await import('./analytics-annotations.js');
    const analyticsAnnotations: AnalyticsAnnotation[] = getAnnotations(workspaceId);
    annotations = analyticsAnnotations.slice(0, 20).map(a => ({
      date: a.date ?? '',
      label: a.label ?? '',
    }));
  } catch {
    // Analytics annotations optional
  }
  try {
    const { listAnnotations } = await import('./annotations.js');
    const timelineAnnotations: TimelineAnnotation[] = listAnnotations(workspaceId);
    for (const a of timelineAnnotations.slice(0, 10)) {
      annotations.push({ date: a.date ?? '', label: a.label ?? '' });
    }
  } catch {
    // Timeline annotations optional
  }

  // Pending jobs
  let pendingJobs = 0;
  try {
    const { listJobs } = await import('./jobs.js');
    const jobs = listJobs(workspaceId);
    pendingJobs = jobs.filter((j: any) => j.status === 'pending' || j.status === 'running').length;
  } catch {
    // Jobs optional
  }

  // Time saved (usage tracking)
  let timeSaved: OperationalSlice['timeSaved'] = null;
  try {
    const { getUsageSummary } = await import('./usage-tracking.js');
    const { getWorkspace } = await import('./workspaces.js');
    const ws: Workspace | undefined = getWorkspace(workspaceId);
    const tier = ws?.tier ?? 'free';
    const summary = getUsageSummary(workspaceId, tier);
    let totalMinutes = 0;
    const byFeature: Record<string, number> = {};
    for (const [feature, data] of Object.entries(summary)) {
      const minutes = (data.used ?? 0) * 5;
      totalMinutes += minutes;
      if (minutes > 0) byFeature[feature] = minutes;
    }
    if (totalMinutes > 0) {
      timeSaved = { totalMinutes, byFeature };
    }
  } catch {
    // Usage tracking optional
  }

  // Approval queue
  let approvalQueue: OperationalSlice['approvalQueue'] = { pending: 0, oldestAge: null };
  try {
    const { listBatches } = await import('./approvals.js');
    const batches: ApprovalBatch[] = listBatches(workspaceId);
    let pending = 0;
    let oldestMs = 0;
    for (const batch of batches) {
      for (const item of batch.items ?? []) {
        if (item.status === 'pending') {
          pending++;
          const age = Date.now() - new Date(item.createdAt ?? '').getTime();
          if (age > oldestMs) oldestMs = age;
        }
      }
    }
    approvalQueue = { pending, oldestAge: pending > 0 ? Math.round(oldestMs / (60 * 60 * 1000)) : null };
  } catch {
    // Approvals optional
  }

  // Recommendation queue
  let recommendationQueue = { fixNow: 0, fixSoon: 0, fixLater: 0 };
  try {
    const { loadRecommendations } = await import('./recommendations.js');
    const recSet: RecommendationSet | null = loadRecommendations(workspaceId);
    if (recSet?.recommendations) {
      for (const rec of recSet.recommendations) {
        if (rec.status === 'pending' || !rec.status) {
          if (rec.priority === 'fix_now') recommendationQueue.fixNow++;
          else if (rec.priority === 'fix_soon') recommendationQueue.fixSoon++;
          else recommendationQueue.fixLater++;
        }
      }
    }
  } catch {
    // Recommendations optional
  }

  // Action backlog
  let actionBacklog: OperationalSlice['actionBacklog'] = { pendingMeasurement: 0, oldestAge: null };
  try {
    const { getPendingActions } = await import('./outcome-tracking.js');
    const pending = getPendingActions();
    const wsActions = pending.filter((a: any) => a.workspaceId === workspaceId);
    let oldestAge: number | null = null;
    if (wsActions.length > 0) {
      const oldest = wsActions.reduce((min: any, a: any) =>
        new Date(a.createdAt).getTime() < new Date(min.createdAt).getTime() ? a : min,
      );
      oldestAge = Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    }
    actionBacklog = { pendingMeasurement: wsActions.length, oldestAge };
  } catch {
    // Outcome tracking optional
  }

  // Detected playbooks
  let detectedPlaybooks: string[] = [];
  try {
    const { getPlaybooks } = await import('./outcome-playbooks.js');
    const playbooks = getPlaybooks(workspaceId);
    detectedPlaybooks = playbooks.slice(0, 5).map((p: any) => p.pattern ?? p.name ?? '').filter(Boolean);
  } catch {
    // Playbooks optional
  }

  // Work orders
  let workOrders: OperationalSlice['workOrders'] = { active: 0, pending: 0 };
  try {
    const { listWorkOrders } = await import('./work-orders.js');
    const orders = listWorkOrders(workspaceId);
    workOrders = {
      active: orders.filter((o: any) => o.status === 'active').length,
      pending: orders.filter((o: any) => o.status === 'pending').length,
    };
  } catch {
    // Work orders optional
  }

  // Insight acceptance rate
  let insightAcceptanceRate: InsightAcceptanceRate | null = null;
  try {
    const { getInsights } = await import('./analytics-insights-store.js');
    const insights = getInsights(workspaceId);
    const totalShown = insights.length;
    const confirmed = insights.filter((i: any) => i.resolutionStatus === 'resolved' || i.resolutionStatus === 'in_progress').length;
    const dismissed = insights.filter((i: any) => i.resolutionStatus === 'dismissed').length;
    if (totalShown > 0) {
      insightAcceptanceRate = {
        totalShown,
        confirmed,
        dismissed,
        rate: confirmed / totalShown,
      };
    }
  } catch {
    // Insight feedback optional
  }

  return {
    recentActivity,
    annotations,
    pendingJobs,
    timeSaved,
    approvalQueue,
    recommendationQueue,
    actionBacklog,
    detectedPlaybooks,
    workOrders,
    insightAcceptanceRate,
  };
}

// ── Prompt formatter (§3 section 2c) ────────────────────────────────────

export function formatForPrompt(
  intelligence: WorkspaceIntelligence,
  opts?: PromptFormatOptions,
): string {
  const verbosity = opts?.verbosity ?? 'standard';
  const sections: string[] = [];

  sections.push('[Workspace Intelligence]');

  // Cold-start detection (§29)
  // Check for meaningful content, not just object existence — seoContext is always
  // assembled as an object, so truthy-check on it would always pass.
  const hasSeoContent = intelligence.seoContext && (
    intelligence.seoContext.strategy ||
    intelligence.seoContext.brandVoice ||
    intelligence.seoContext.businessContext ||
    intelligence.seoContext.knowledgeBase ||
    (intelligence.seoContext.personas && intelligence.seoContext.personas.length > 0)
  );
  const hasData = hasSeoContent || intelligence.insights?.all.length || intelligence.learnings?.summary;
  if (!hasData) {
    sections.push('This workspace is newly onboarded. Limited data available.');
    if (intelligence.seoContext?.brandVoice) {
      sections.push(`Brand voice: ${intelligence.seoContext.brandVoice}`);
    }
    sections.push('Recommendation: Focus on establishing baseline data before making optimization decisions.');
    return sections.join('\n');
  }

  // SEO Context
  if (intelligence.seoContext) {
    sections.push(formatSeoContextSection(intelligence.seoContext, verbosity));
  }

  // Insights
  if (intelligence.insights && intelligence.insights.all.length > 0) {
    sections.push(formatInsightsSection(intelligence.insights, verbosity));
  }

  // Learnings
  if (intelligence.learnings) {
    sections.push(formatLearningsSection(intelligence.learnings, verbosity));
  }

  return sections.filter(Boolean).join('\n\n');
}

function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.brandVoice) lines.push(`Brand voice: ${ctx.brandVoice}`);
  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);

  if (verbosity === 'detailed') {
    if (ctx.knowledgeBase) lines.push(`Knowledge: ${ctx.knowledgeBase}`);
    if (ctx.strategy) lines.push(`Strategy: ${ctx.strategy.siteKeywords?.length ?? 0} site keywords`);
  }

  return lines.join('\n');
}

function formatInsightsSection(insights: InsightsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Active Insights'];
  const { bySeverity } = insights;

  lines.push(`Summary: ${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.opportunity} opportunity, ${bySeverity.positive} positive`);

  const limit = verbosity === 'compact' ? 3 : verbosity === 'standard' ? 5 : 10;
  const top = insights.topByImpact.length > 0 ? insights.topByImpact : insights.all;
  for (const insight of top.slice(0, limit)) {
    lines.push(`- [${insight.severity}] ${insight.insightType}: impact ${insight.impactScore ?? 'n/a'}${insight.pageId ? ` (${insight.pageId})` : ''}`);
  }

  return lines.join('\n');
}

function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity): string {
  if (!learnings.summary && learnings.topActionTypes.length === 0) return '';

  const lines: string[] = ['## Outcome Learnings'];

  if (learnings.recentTrend) lines.push(`Trend: ${learnings.recentTrend}`);
  if (learnings.confidence) lines.push(`Confidence: ${learnings.confidence}`);
  if (learnings.overallWinRate > 0) lines.push(`Overall win rate: ${Math.round(learnings.overallWinRate * 100)}%`);

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${Math.round(winRate * 100)}% (${count} actions)`);
      }
    }
  }

  return lines.join('\n');
}

// ── Page Profile assembler ──────────────────────────────────────────────

async function assemblePageProfile(
  workspaceId: string,
  pagePath: string,
  _opts?: IntelligenceOptions,
): Promise<PageProfileSlice> {
  // Page keywords (primary source)
  let pageKw: PageKeywordMap | undefined;
  try {
    const { getPageKeyword } = await import('./page-keywords.js');
    pageKw = getPageKeyword(workspaceId, pagePath);
  } catch {
    // page-keywords optional
  }

  // Rank history
  let current: number | null = pageKw?.currentPosition ?? null;
  let previous: number | null = pageKw?.previousPosition ?? null;
  let trend: 'up' | 'down' | 'stable' = 'stable';
  try {
    const { getLatestRanks } = await import('./rank-tracking.js');
    const latest = getLatestRanks(workspaceId);
    const pageRank = latest.find((k: any) => k.query === pageKw?.primaryKeyword);
    if (pageRank) {
      current = (pageRank as any).position ?? current;
      const change = (pageRank as any).change ?? 0;
      trend = change < 0 ? 'up' : change > 0 ? 'down' : 'stable';
    } else if (current != null && previous != null) {
      // Rank tracking has no match for this keyword — fall back to page-keywords data
      trend = current < previous ? 'up' : current > previous ? 'down' : 'stable';
    }
  } catch {
    // Rank tracking module failed — fall back to page-keywords data
    if (current != null && previous != null) {
      trend = current < previous ? 'up' : current > previous ? 'down' : 'stable';
    }
  }
  // best = lowest position number seen (lower is better in SEO)
  const best = (current != null && previous != null) ? Math.min(current, previous)
    : current ?? previous;

  // Recommendations for this page
  let recommendations: string[] = [];
  try {
    const { loadRecommendations } = await import('./recommendations.js');
    const recSet = loadRecommendations(workspaceId);
    const recSetPP: RecommendationSet | null = loadRecommendations(workspaceId);
    if (recSetPP?.recommendations) {
      recommendations = recSetPP.recommendations
        .filter(r => r.affectedPages?.includes(pagePath) && (r.status === 'pending' || !r.status))
        .map(r => r.title ?? r.description ?? '')
        .filter(Boolean);
    }
  } catch {
    // Recommendations optional
  }

  // Page-specific insights
  let insights: AnalyticsInsight[] = [];
  try {
    const { getInsights } = await import('./analytics-insights-store.js');
    const all = getInsights(workspaceId);
    insights = all.filter(i => i.pageId === pagePath).slice(0, 10);
  } catch {
    // Insights optional
  }

  // Page actions
  let actions: TrackedAction[] = [];
  try {
    const { getActionsByPage } = await import('./outcome-tracking.js');
    actions = getActionsByPage(workspaceId, pagePath);
  } catch {
    // Actions optional
  }

  // Audit issues for this page
  let auditIssues: string[] = [];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const { getLatestSnapshot } = await import('./reports.js');
      const snap = getLatestSnapshot(ws.webflowSiteId);
      if (snap?.audit?.pages) {
        const pagData = (snap.audit.pages as any[]).find((p: any) => p.url === pagePath || p.slug === pagePath);
        if (pagData?.issues) {
          auditIssues = pagData.issues.map((i: any) => i.message ?? i.title ?? '').filter(Boolean);
        }
      }
    }
  } catch {
    // Audit data optional
  }

  // Schema status
  let schemaStatus: PageProfileSlice['schemaStatus'] = 'none';
  try {
    const { getValidations } = await import('./schema-validator.js');
    const validations = getValidations(workspaceId);
    const pageValidation = validations.find((v: any) => v.url === pagePath || v.pageUrl === pagePath);
    if (pageValidation) {
      const status = (pageValidation as any).status ?? 'none';
      schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
    }
  } catch {
    schemaStatus = 'none';
  }

  // Link health
  let linkHealth = { inbound: 0, outbound: 0, orphan: false };
  try {
    const { getCachedArchitecture, flattenTree } = await import('./site-architecture.js');
    const arch = await Promise.race([
      getCachedArchitecture(workspaceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (arch?.tree) {
      const nodes = flattenTree(arch.tree);
      const node = nodes.find((n: any) => n.path === pagePath || n.slug === pagePath);
      if (node) {
        linkHealth = {
          inbound: (node as any).inboundLinks ?? 0,
          outbound: (node as any).outboundLinks ?? 0,
          orphan: (node as any).orphan ?? false,
        };
      }
    }
  } catch {
    // Architecture optional
  }

  // SEO edits
  let seoEdits = { currentTitle: '', currentMeta: '', lastEditedAt: null as string | null };
  try {
    const { getSeoChanges } = await import('./seo-change-tracker.js');
    const changes: SeoChangeEvent[] = getSeoChanges(workspaceId, 50);
    const pageChanges = changes.filter(c => c.pageSlug === pagePath || c.pageId === pagePath);
    if (pageChanges.length > 0) {
      seoEdits.lastEditedAt = pageChanges[0].changedAt ?? null;
    }
    seoEdits.currentTitle = pageKw?.pageTitle ?? '';
    seoEdits.currentMeta = '';
  } catch {
    // SEO changes optional
  }

  // Content status
  let contentStatus: PageProfileSlice['contentStatus'] = null;
  try {
    const { listBriefs } = await import('./content-brief.js');
    const briefs = listBriefs(workspaceId);
    const hasBrief = briefs.some((b: any) => b.pageUrl === pagePath || b.targetUrl === pagePath);

    let hasPost = false;
    let isPublished = false;
    try {
      const { listPosts } = await import('./content-posts-db.js');
      const posts = listPosts(workspaceId);
      hasPost = posts.some((p: any) => p.pageUrl === pagePath || p.targetUrl === pagePath);
      isPublished = posts.some((p: any) =>
        ((p as any).pageUrl === pagePath || (p as any).targetUrl === pagePath) && (p as any).status === 'published',
      );
    } catch {
      // Posts optional
    }

    let isDecaying = false;
    try {
      const { loadDecayAnalysis } = await import('./content-decay.js');
      const decayPP: DecayAnalysis | null = loadDecayAnalysis(workspaceId);
      isDecaying = decayPP?.decayingPages?.some(d => d.page === pagePath) ?? false;
    } catch {
      // Decay optional
    }

    contentStatus = isDecaying ? 'decay_detected' : isPublished ? 'published' : hasPost ? 'has_post' : hasBrief ? 'has_brief' : null;
  } catch {
    contentStatus = null;
  }

  // CWV status
  let cwvStatus: PageProfileSlice['cwvStatus'] = null;
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const { getPageSpeed } = await import('./performance-store.js');
      const speedSnap = getPageSpeed(ws.webflowSiteId);
      if (speedSnap?.result) {
        const pages = (speedSnap.result as any).pages ?? [];
        const pageData = pages.find((p: any) => p.url === pagePath || p.slug === pagePath);
        if (pageData?.score != null) {
          cwvStatus = pageData.score >= 90 ? 'good' : pageData.score >= 50 ? 'needs_improvement' : 'poor';
        }
      }
    }
  } catch {
    cwvStatus = null;
  }

  return {
    pagePath,
    primaryKeyword: pageKw?.primaryKeyword ?? null,
    searchIntent: pageKw?.searchIntent ?? null,
    optimizationScore: pageKw?.optimizationScore ?? null,
    recommendations,
    contentGaps: [],
    insights,
    actions,
    auditIssues,
    schemaStatus,
    linkHealth,
    seoEdits,
    rankHistory: { current, best, trend },
    contentStatus,
    cwvStatus,
  };
}

// ── Cache management ────────────────────────────────────────────────────

function buildCacheKey(workspaceId: string, opts?: IntelligenceOptions): string {
  const slices = [...(opts?.slices ?? ALL_SLICES)].sort().join(',');
  const page = opts?.pagePath ?? '';
  const domain = opts?.learningsDomain ?? 'all';
  return `intelligence:${workspaceId}:${slices}:${page}:${domain}`;
}

/** Invalidate all cached intelligence for a workspace */
export function invalidateIntelligenceCache(workspaceId: string): void {
  // Invalidate in-memory LRU
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  // Invalidate persistent sub-cache
  try {
    invalidateSubCachePrefix(workspaceId, ''); // empty prefix = all keys for this workspace
  } catch {
    // Table may not exist yet — non-critical
  }

  // Broadcast to frontend so useWorkspaceIntelligence invalidates its React Query cache
  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId,
      invalidatedAt: new Date().toISOString(),
    });
  } catch {
    // Broadcasting is best-effort — don't fail cache invalidation
  }

  log.info({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent + broadcast)');
}

/** Cache stats for health endpoint (§18) */
export function getIntelligenceCacheStats() {
  return intelligenceCache.stats();
}
