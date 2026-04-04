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
  ContentPipelineSummary,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';
import type { TrackedAction } from '../shared/types/outcome-tracking.js';
import type { Workspace, AudiencePersona } from '../shared/types/workspace.js';
import type { PageKeywordMap } from '../shared/types/workspace.js';
import type { ContentSubscription, ContentMatrix, GeneratedPost } from '../shared/types/content.js';
import type { SchemaSitePlan } from '../shared/types/schema-plan.js';
import type { RecommendationSet } from '../shared/types/recommendations.js';
import type { ApprovalBatch } from '../shared/types/approvals.js';
import type { ChurnSignal } from './churn-signals.js';
import { listClientSignals, countNewSignals, countAllSignals } from './client-signals-store.js';
import type { DecayAnalysis } from './content-decay.js';
import type { AuditSnapshot } from './reports.js';
import type { ROIData } from './roi.js';
import type { SeoChangeEvent } from './seo-change-tracker.js';
import type { CannibalizationReport } from './cannibalization-detection.js';
import type { Annotation as AnalyticsAnnotation } from './analytics-annotations.js';
import type { Annotation as TimelineAnnotation } from './annotations.js';
import type { ActionOutcome, ActionPlaybook } from '../shared/types/outcome-tracking.js';
import type { SafeClientUser } from '../shared/types/users.js';
import type { ClientRequest } from '../shared/types/requests.js';
import type { ContentBrief } from '../shared/types/content.js';
import type { WorkOrder } from '../shared/types/payments.js';
import type { RankEntry } from './rank-tracking.js';
import type { FeedbackItem } from './feedback.js';
import type { SessionSummary } from './chat-memory.js';
import type { ActivityEntry } from './activity-log.js';
import type { Job } from './jobs.js';
import type { SchemaValidation } from './schema-validator.js';
import type { SiteNode } from './site-architecture.js';
import type { PageSeoResult, SeoIssue } from './audit-page.js';
import type { Snapshot } from './performance-store.js';

const log = createLogger('workspace-intelligence');

const stmts = createStmtCache(() => ({
  schemaErrorCount: db.prepare(
    `SELECT COUNT(*) as cnt FROM schema_validations WHERE workspace_id = ? AND status = 'errors'`,
  ),
  strategyHistory: db.prepare(
    'SELECT generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC',
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
  const { buildSeoContext, getRawBrandVoice, getRawKnowledge } = await import('./seo-context.js');
  const { getWorkspace } = await import('./workspaces.js');
  // Pass _skipShadow to prevent circular recursion:
  // buildWorkspaceIntelligence → assembleSeoContext → buildSeoContext → shadow mode → buildWorkspaceIntelligence → ∞
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all', { _skipShadow: true });
  const workspace = getWorkspace(workspaceId);

  // Populate pageMap from the page_keywords table (not from the stored keyword_strategy column,
  // which has pageMap stripped before storage — it only exists at the route layer).
  let livePageMap: Awaited<ReturnType<typeof import('./page-keywords.js').listPageKeywords>> = [];
  try {
    const { listPageKeywords } = await import('./page-keywords.js');
    livePageMap = listPageKeywords(workspaceId);
  } catch (pkErr) {
    log.warn({ err: pkErr, workspaceId }, 'assembleSeoContext: listPageKeywords failed, falling back to stored pageMap');
  }

  const base: SeoContextSlice = {
    strategy: ctx.strategy
      ? { ...ctx.strategy, pageMap: livePageMap.length > 0 ? livePageMap : ctx.strategy.pageMap }
      : ctx.strategy,
    // Store RAW values (no headers). Callers that need formatted blocks use
    // formatBrandVoiceForPrompt() / formatKnowledgeBaseForPrompt() from this module.
    // This prevents double-formatting when formatSeoContextSection adds its own prefixes.
    brandVoice: getRawBrandVoice(workspaceId),
    businessContext: ctx.businessContext,
    personas: workspace?.personas ?? [],
    knowledgeBase: getRawKnowledge(workspaceId),
  };

  // Page-specific keywords — populate from strategy.pageMap when pagePath is provided
  if (opts?.pagePath && base.strategy?.pageMap?.length) {
    const pagePathLower = opts.pagePath.toLowerCase();
    const pageKw = base.strategy.pageMap.find(p => p.pagePath.toLowerCase() === pagePathLower);
    if (pageKw) base.pageKeywords = pageKw;
  }

  // Rank tracking enrichment
  try {
    const { getTrackedKeywords, getLatestRanks } = await import('./rank-tracking.js');
    const tracked = getTrackedKeywords(workspaceId);
    const latest: RankEntry[] = getLatestRanks(workspaceId);
    const improved = latest.filter(k => (k.change ?? 0) < 0).length; // negative = position number decreased = moved up in SERPs
    const declined = latest.filter(k => (k.change ?? 0) > 0).length; // positive = position number increased = dropped in SERPs
    const stable = latest.length - improved - declined;
    const positions = latest.map(k => k.position).filter(p => p > 0);
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

  // Business profile from structured intelligence editor (Phase 3B)
  const iProfile = workspace?.intelligenceProfile;
  if (iProfile && (iProfile.industry || (iProfile.goals && iProfile.goals.length > 0) || iProfile.targetAudience)) {
    base.businessProfile = {
      industry: iProfile.industry ?? '',
      goals: Array.isArray(iProfile.goals) ? iProfile.goals : [],
      targetAudience: iProfile.targetAudience ?? '',
    };
  }

  // Strategy history
  try {
    const rows = stmts().strategyHistory.all(workspaceId) as Array<{ generated_at: string }>;
    if (rows.length > 0) {
      base.strategyHistory = {
        revisionsCount: rows.length,
        lastRevisedAt: rows[0].generated_at,
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
  let all: AnalyticsInsight[] = [];
  try {
    const { getInsights } = await import('./analytics-insights-store.js');
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

  let summary: ReturnType<Awaited<typeof import('./workspace-learnings.js')>['getWorkspaceLearnings']> | undefined;
  let playbooks: ReturnType<Awaited<typeof import('./outcome-playbooks.js')>['getPlaybooks']> = [];
  try {
    const { getWorkspaceLearnings } = await import('./workspace-learnings.js');
    const { getPlaybooks } = await import('./outcome-playbooks.js');
    summary = getWorkspaceLearnings(workspaceId, opts?.learningsDomain ?? 'all');
    playbooks = getPlaybooks(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleLearnings: core data load failed, degrading to empty learnings');
  }

  // ROI attribution enrichment
  let roiAttribution: ROIAttribution[] = [];
  try {
    const { getROIAttributionsRaw } = await import('./roi-attribution.js');
    const rows = getROIAttributionsRaw(workspaceId, 10);
    roiAttribution = rows.map(h => ({
      actionId: h.id,
      pageUrl: h.pageUrl,
      actionType: h.actionType,
      clicksBefore: h.clicksBefore,
      clicksAfter: h.clicksAfter,
      clickGain: h.clickGain,
      measuredAt: h.measuredAt,
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
      if (weCalledIt.length >= 5) break; // guard before DB call to avoid redundant queries
      const outcomes: ActionOutcome[] = getOutcomesForAction(action.id);
      const strongWin = outcomes.find(o => o.score === 'strong_win');
      if (strongWin) {
        weCalledIt.push({
          actionId: action.id,
          prediction: `${action.actionType} on ${action.pageUrl ?? 'site'}`,
          outcome: 'strong_win',
          score: 'strong_win',
          pageUrl: action.pageUrl ?? '',
          measuredAt: strongWin.measuredAt ?? '',
        });
      }
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
  let summary: ContentPipelineSummary = {
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  };
  try {
    const { getContentPipelineSummary } = await import('./workspace-data.js');
    summary = getContentPipelineSummary(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleContentPipeline: getContentPipelineSummary failed, degrading to empty slice');
  }

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
        detectedAt: decay.analyzedAt ?? new Date().toISOString(),
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
      title: s.title,
      description: s.description,
    }));
    // ChurnSignal.severity is 'critical' | 'warning' | 'positive' — map to churnRisk levels
    const criticalCount = signals.filter(s => s.severity === 'critical').length;
    const warningCount = signals.filter(s => s.severity === 'warning').length;
    const riskSignalCount = criticalCount + warningCount;
    churnRisk = criticalCount > 0 ? 'high' : warningCount >= 2 ? 'medium' : riskSignalCount > 0 ? 'low' : null;
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
    const users: SafeClientUser[] = listClientUsers(workspaceId);
    const latestLogin = users
      .map(u => u.lastLoginAt)
      .filter((v): v is string => !!v)
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
    feedbackItems = items.slice(0, 10).map((f: FeedbackItem) => ({
      id: f.id,
      type: f.type ?? 'general',
      status: f.status ?? 'new',
      createdAt: f.createdAt ?? '',
    }));
  } catch {
    // Feedback optional
  }

  // Service requests
  let serviceRequests = { pending: 0, total: 0 };
  try {
    const { listRequests } = await import('./requests.js');
    const reqs: ClientRequest[] = listRequests(workspaceId);
    serviceRequests = {
      pending: reqs.filter(r => r.status === 'new' || r.status === 'in_review').length,
      total: reqs.length,
    };
  } catch {
    // Requests optional
  }

  // Intent signals from client chat
  let intentSignals: ClientSignalsSlice['intentSignals'];
  try {
    const signals = listClientSignals(workspaceId);
    const newCount = countNewSignals(workspaceId);
    // Use countAllSignals for totalCount — listClientSignals is capped at LIMIT 100
    const totalCount = countAllSignals(workspaceId);
    intentSignals = {
      newCount,
      totalCount,
      recentTypes: signals.slice(0, 5).map(s => s.type),
    };
  } catch (err) {
    // client_signals table may not exist on older DBs — degrade gracefully
    log.debug({ err }, 'client_signals unavailable for intelligence assembly');
  }

  // Recent chat topics
  let recentChatTopics: string[] = [];
  try {
    const { listSessions } = await import('./chat-memory.js');
    const sessions = listSessions(workspaceId, 'client');
    recentChatTopics = sessions
      .slice(0, 5)
      .map((s: SessionSummary) => s.title ?? '')
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
    intentSignals,
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
    recentActivity = activity.map((a: ActivityEntry) => ({
      type: a.type ?? '',
      description: a.title ?? a.description ?? '',
      timestamp: a.createdAt ?? '',
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
    pendingJobs = jobs.filter((j: Job) => j.status === 'pending' || j.status === 'running').length;
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
    const wsActions: TrackedAction[] = pending.filter((a: TrackedAction) => a.workspaceId === workspaceId);
    let oldestAge: number | null = null;
    if (wsActions.length > 0) {
      const oldest = wsActions.reduce((min, a) =>
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
    detectedPlaybooks = playbooks.slice(0, 5).map((p: ActionPlaybook) => p.name ?? '').filter(Boolean);
  } catch {
    // Playbooks optional
  }

  // Work orders
  let workOrders: OperationalSlice['workOrders'] = { active: 0, pending: 0 };
  try {
    const { listWorkOrders } = await import('./work-orders.js');
    const orders = listWorkOrders(workspaceId);
    workOrders = {
      active: orders.filter((o: WorkOrder) => o.status === 'in_progress').length,
      pending: orders.filter((o: WorkOrder) => o.status === 'pending').length,
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
    const confirmed = insights.filter(i => i.resolutionStatus === 'resolved' || i.resolutionStatus === 'in_progress').length;
    const dismissed = insights.filter(i => i.resolutionStatus === 'dismissed').length;
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
  const include = opts?.sections ? new Set(opts.sections) : null;
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
  const hasData = hasSeoContent || intelligence.insights?.all.length || intelligence.learnings?.summary || intelligence.pageProfile;
  if (!hasData) {
    sections.push('This workspace is newly onboarded. Limited data available.');
    if (intelligence.seoContext?.brandVoice) {
      sections.push(`Brand voice: ${intelligence.seoContext.brandVoice}`);
    }
    sections.push('Recommendation: Focus on establishing baseline data before making optimization decisions.');
    return sections.join('\n');
  }

  // SEO Context
  if (intelligence.seoContext && (!include || include.has('seoContext'))) {
    sections.push(formatSeoContextSection(intelligence.seoContext, verbosity));
  }

  // Insights
  if (intelligence.insights && intelligence.insights.all.length > 0 && (!include || include.has('insights'))) {
    sections.push(formatInsightsSection(intelligence.insights, verbosity));
  }

  // Learnings
  if (intelligence.learnings && (!include || include.has('learnings'))) {
    sections.push(formatLearningsSection(intelligence.learnings, verbosity, opts?.learningsDomain ?? 'all'));
  }

  // Page Profile
  if (intelligence.pageProfile && (!include || include.has('pageProfile'))) {
    sections.push(formatPageProfileSection(intelligence.pageProfile, verbosity));
  }

  // Content Pipeline
  if (intelligence.contentPipeline && (!include || include.has('contentPipeline'))) {
    sections.push(formatContentPipelineSection(intelligence.contentPipeline, verbosity));
  }

  // Site Health
  if (intelligence.siteHealth && (!include || include.has('siteHealth'))) {
    sections.push(formatSiteHealthSection(intelligence.siteHealth, verbosity));
  }

  // Client Signals
  if (intelligence.clientSignals && (!include || include.has('clientSignals'))) {
    sections.push(formatClientSignalsSection(intelligence.clientSignals, verbosity));
  }

  // Operational
  if (intelligence.operational && (!include || include.has('operational'))) {
    sections.push(formatOperationalSection(intelligence.operational, verbosity));
  }

  // Apply tokenBudget truncation if requested (§20 priority chain)
  const tokenBudget = opts?.tokenBudget;
  if (tokenBudget && tokenBudget > 0) {
    return applyTokenBudget(sections, intelligence, tokenBudget);
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Type-safe convenience wrapper: assembles the requested slices and formats them
 * in a single call, guaranteeing that sections === slices (no mismatch possible).
 *
 * Use this instead of separate buildWorkspaceIntelligence + formatForPrompt calls
 * whenever you want all assembled slices included in the prompt context.
 * If you need the raw intelligence object for field access alongside the prompt
 * text, call buildWorkspaceIntelligence + formatForPrompt directly.
 */
export async function buildIntelPrompt(
  workspaceId: string,
  slices: IntelligenceSlice[],
  opts?: Omit<IntelligenceOptions, 'slices'> & Pick<PromptFormatOptions, 'verbosity' | 'tokenBudget' | 'learningsDomain'>,
): Promise<string> {
  const intel = await buildWorkspaceIntelligence(workspaceId, { ...opts, slices });
  return formatForPrompt(intel, { verbosity: opts?.verbosity, sections: slices, tokenBudget: opts?.tokenBudget, learningsDomain: opts?.learningsDomain });
}

/**
 * Token budget truncation — §20 priority chain:
 * 1. Drop `operational` first (lowest value density)
 * 2. Truncate `insights` to top 5
 * 3. Drop `clientSignals`
 * 4. Summarize `learnings` to one line
 * 5. Never drop `seoContext`
 */
function applyTokenBudget(
  sections: string[],
  intelligence: WorkspaceIntelligence,
  budget: number,
): string {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  let current = sections.filter(Boolean);
  let output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 1: Drop operational
  current = current.filter(s => !s.startsWith('## Operational'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 2: Truncate insights to top 5
  current = current.map(s => {
    if (s.startsWith('## Active Insights')) {
      const lines = s.split('\n');
      const header = lines.filter(l => !l.startsWith('- ['));
      const items = lines.filter(l => l.startsWith('- ['));
      return [...header, ...items.slice(0, 5)].join('\n');
    }
    return s;
  });
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 3: Drop clientSignals
  current = current.filter(s => !s.startsWith('## Client Signals'));
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 4: Summarize learnings to one line
  current = current.map(s => {
    if (s.startsWith('## Outcome Learnings') && intelligence.learnings) {
      const rate = intelligence.learnings.overallWinRate;
      return `## Outcome Learnings\nWin rate: ${pct(rate)}${intelligence.learnings.recentTrend ? ` (${intelligence.learnings.recentTrend})` : ''}`;
    }
    return s;
  });
  output = current.join('\n\n');
  if (estimateTokens(output) <= budget) return output;

  // Step 5: Drop everything except seoContext (never dropped)
  const seoOnly = current.filter(s =>
    s.startsWith('[Workspace Intelligence]') || s.startsWith('## SEO Context'),
  );
  return seoOnly.join('\n\n');
}

/** Safely format a 0-1 rate as a percentage string. Returns 'n/a' for NaN/null/undefined. */
function pct(rate: number | null | undefined): string {
  if (rate == null || isNaN(rate)) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}

/**
 * Renders SeoContextSlice as a `## SEO Context` summary block for formatForPrompt().
 *
 * TWO-PATH FORMAT SPLIT: Callers using formatForPrompt() get this combined block.
 * Callers that need individual fields at different prompt positions use the standalone
 * helpers instead: formatBrandVoiceForPrompt(), formatKeywordsForPrompt(), etc.
 * These intentionally produce DIFFERENT output (standalone helpers add emphatic standalone
 * headers; this function renders compact inline labels within the ## SEO Context block).
 */
function formatSeoContextSection(ctx: SeoContextSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## SEO Context'];

  if (ctx.businessContext) lines.push(`Business: ${ctx.businessContext}`);
  // Emphatic brand voice directive — AI models respond to capitalized instructional headers
  if (ctx.brandVoice) lines.push(`BRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${ctx.brandVoice}`);

  // Personas — always include when present
  // Must match formatPersonasForPrompt (standalone helper) for content parity
  if (ctx.personas && ctx.personas.length > 0) {
    if (verbosity === 'compact') {
      // Compact: names + buying stage only
      lines.push(`Personas: ${ctx.personas.map(p => `${p.name}${p.buyingStage ? ` (${p.buyingStage})` : ''}`).join(', ')}`);
    } else {
      // Standard + detailed: full persona detail (pain points, goals, objections)
      // AI models need this context to write audience-relevant content
      lines.push('TARGET AUDIENCE PERSONAS:');
      for (const p of ctx.personas) {
        const parts = [`  **${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
        if (p.painPoints?.length) parts.push(`    Pain points: ${p.painPoints.join('; ')}`);
        if (p.goals?.length) parts.push(`    Goals: ${p.goals.join('; ')}`);
        if (p.objections?.length) parts.push(`    Objections: ${p.objections.join('; ')}`);
        if (p.preferredContentFormat) parts.push(`    Prefers: ${p.preferredContentFormat}`);
        lines.push(parts.join('\n'));
      }
    }
  }

  // Knowledge base — emphatic header at all verbosity levels
  if (ctx.knowledgeBase) {
    if (verbosity === 'compact') {
      const summary = ctx.knowledgeBase.length > 80 ? ctx.knowledgeBase.slice(0, 80) + '...' : ctx.knowledgeBase;
      lines.push(`BUSINESS KNOWLEDGE BASE:\n${summary}`);
    } else {
      lines.push(`BUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${ctx.knowledgeBase}`);
    }
  }

  // Business profile — at standard+ verbosity
  if (ctx.businessProfile && verbosity !== 'compact') {
    const bp = ctx.businessProfile;
    lines.push(`Industry: ${bp.industry}${bp.targetAudience ? ` | Audience: ${bp.targetAudience}` : ''}`);
    if (bp.goals.length > 0 && verbosity === 'detailed') {
      lines.push(`Goals: ${bp.goals.join(', ')}`);
    }
  }

  // Rank tracking — at standard+ verbosity
  if (ctx.rankTracking && verbosity !== 'compact') {
    const rt = ctx.rankTracking;
    lines.push(`Rank tracking: ${rt.trackedKeywords} keywords, avg position ${rt.avgPosition?.toFixed(1) ?? 'n/a'} (↑${rt.positionChanges.improved} ↓${rt.positionChanges.declined})`);
  }

  // Site keywords — always include when present; compact shows fewer
  if (ctx.strategy?.siteKeywords?.length) {
    const kw = verbosity === 'compact'
      ? ctx.strategy.siteKeywords.slice(0, 3).join(', ')
      : ctx.strategy.siteKeywords.slice(0, 8).join(', ');
    lines.push(`Site target keywords: ${kw}`);
  }

  // Page-specific keyword targeting — when pagePath was provided, show the page's own keywords
  if (ctx.pageKeywords) {
    const pk = ctx.pageKeywords;
    lines.push(`THIS PAGE'S TARGET: "${pk.primaryKeyword}"`);
    if (pk.secondaryKeywords?.length) {
      lines.push(`  Secondary: ${pk.secondaryKeywords.join(', ')}`);
    }
    if (pk.searchIntent) {
      lines.push(`  Intent: ${pk.searchIntent}`);
    }
  }

  if (ctx.strategyHistory && verbosity === 'detailed') {
    lines.push(`Strategy: revised ${ctx.strategyHistory.revisionsCount}x, last ${ctx.strategyHistory.lastRevisedAt.slice(0, 10)}`);
  }

  // Return empty string rather than a bare header when no content was added
  if (lines.length === 1) return '';

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

function formatLearningsSection(learnings: LearningsSlice, verbosity: PromptVerbosity, domain: 'content' | 'strategy' | 'technical' | 'all' = 'all'): string {
  // Guard must be verbosity-aware: only pass if there's content that will actually render
  // at the requested verbosity. roiAttribution and weCalledIt are standard/detailed-only.
  const hasBaseContent = !!learnings.recentTrend || !!learnings.confidence || learnings.overallWinRate > 0;
  const hasStandardContent = learnings.topActionTypes.length > 0 || (learnings.weCalledIt?.length ?? 0) > 0;
  const hasDetailedContent = (learnings.roiAttribution?.length ?? 0) > 0 || !!learnings.summary?.content || !!learnings.summary?.strategy || !!learnings.summary?.technical;
  const willRender =
    hasBaseContent ||
    ((verbosity === 'standard' || verbosity === 'detailed') && hasStandardContent) ||
    (verbosity === 'detailed' && hasDetailedContent);
  if (!willRender) return '';

  const lines: string[] = [];
  const summary = learnings.summary;

  // Header with scored actions count (matches old formatLearningsForPrompt)
  const totalActions = summary?.totalScoredActions ?? 0;
  lines.push(`## Outcome Learnings${totalActions > 0 ? ` (${totalActions} tracked outcomes, ${learnings.confidence ?? 'unknown'} confidence)` : ''}`);

  if (learnings.recentTrend && learnings.recentTrend !== 'stable') lines.push(`Trend: ${learnings.recentTrend}`);

  // Overall win rate with strong wins (matches old: "62% (28% strong wins)")
  if (learnings.overallWinRate > 0) {
    const strongRate = summary?.overall?.strongWinRate;
    const strongSuffix = strongRate != null ? ` (${pct(strongRate)} strong wins)` : '';
    lines.push(`Overall win rate: ${pct(learnings.overallWinRate)}${strongSuffix}`);
  }

  if (verbosity === 'detailed' || verbosity === 'standard') {
    if (learnings.topActionTypes.length > 0) {
      lines.push('Win rates by action type:');
      for (const { type, winRate, count } of learnings.topActionTypes) {
        lines.push(`  ${type}: ${pct(winRate)} (${count} actions)`);
      }
    }

    // Domain-specific learnings from summary
    // Domain filtering: only render domains matching the requested learningsDomain
    if (summary && verbosity === 'detailed') {
      // Content learnings
      if ((domain === 'content' || domain === 'all') && summary.content) {
        const c = summary.content;
        const topFormats = Object.entries(c.winRateByFormat)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        if (topFormats.length >= 2) {
          const [f1, r1] = topFormats[0];
          const [f2, r2] = topFormats[1];
          lines.push(`${f1.replace(/_/g, ' ')} outperforms ${f2.replace(/_/g, ' ')} (${pct(r1)} vs ${pct(r2)} win rate)`);
        }
        if (c.avgDaysToPage1 != null) lines.push(`Content reaches page 1 in ~${c.avgDaysToPage1} days on average`);
        if (c.refreshRecoveryRate > 0) lines.push(`Content refreshes recover traffic ${pct(c.refreshRecoveryRate)} of the time`);
        if (c.bestPerformingTopics.length > 0) lines.push(`Best performing topics: ${c.bestPerformingTopics.slice(0, 3).join(', ')}`);
      }

      // Strategy learnings
      if ((domain === 'strategy' || domain === 'all') && summary.strategy) {
        const s = summary.strategy;
        const topDifficulty = Object.entries(s.winRateByDifficultyRange).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topDifficulty.length > 0) {
          const [range, rate] = topDifficulty[0];
          lines.push(`Keywords with difficulty ${range} have highest win rate (${pct(rate)})`);
        }
        if (s.keywordVolumeSweetSpot) lines.push(`Optimal keyword volume range: ${s.keywordVolumeSweetSpot.min}–${s.keywordVolumeSweetSpot.max}/month`);
        if (s.bestIntentTypes.length > 0) lines.push(`Best intent types: ${s.bestIntentTypes.join(', ')}`);
      }

      // Technical learnings
      if ((domain === 'technical' || domain === 'all') && summary.technical) {
        const t = summary.technical;
        const topFix = Object.entries(t.winRateByFixType).sort((a, b) => b[1] - a[1]).slice(0, 1);
        if (topFix.length > 0) {
          const [fixType, rate] = topFix[0];
          lines.push(`${fixType.replace(/_/g, ' ')} has highest technical win rate (${pct(rate)})`);
        }
        if (t.schemaTypesWithRichResults.length > 0) lines.push(`Schema types producing rich results: ${t.schemaTypesWithRichResults.join(', ')}`);
        if (t.avgHealthScoreImprovement > 0) lines.push(`Average health score improvement: +${t.avgHealthScoreImprovement}`);
        if (t.internalLinkEffectiveness > 0) lines.push(`Internal link additions improve rankings ${pct(t.internalLinkEffectiveness)} of the time`);
      }
    }

    // WeCalledIt proven predictions
    if (learnings.weCalledIt && learnings.weCalledIt.length > 0) {
      lines.push('Proven predictions:');
      for (const entry of learnings.weCalledIt.slice(0, verbosity === 'detailed' ? 5 : 3)) {
        lines.push(`  - ${entry.prediction} → ${entry.score}${entry.pageUrl ? ` (${entry.pageUrl})` : ''}`);
      }
    }

    // ROI attribution — detailed only
    if (learnings.roiAttribution && learnings.roiAttribution.length > 0 && verbosity === 'detailed') {
      lines.push('ROI highlights:');
      for (const roi of learnings.roiAttribution.slice(0, 5)) {
        lines.push(`  - ${roi.actionType} on ${roi.pageUrl}: +${roi.clickGain ?? 0} clicks`);
      }
    }

    if (learnings.playbooks?.length > 0 && verbosity === 'detailed') {
      lines.push(`Playbooks: ${learnings.playbooks.slice(0, 3).map(p => p.name).join(', ')}`);
    }
  }

  // Cap at 25 content lines to stay within token budget
  if (lines.length > 25) {
    return [...lines.slice(0, 25), '  (additional learnings truncated)'].join('\n');
  }

  return lines.join('\n');
}

function formatContentPipelineSection(pipeline: ContentPipelineSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Content Pipeline'];

  lines.push(`Briefs: ${pipeline.briefs.total}, Posts: ${pipeline.posts.total}, Matrices: ${pipeline.matrices.total}`);

  if (verbosity !== 'compact') {
    if (pipeline.coverageGaps.length > 0) {
      lines.push(`Coverage gaps: ${pipeline.coverageGaps.slice(0, 5).join(', ')}`);
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push(`Decay alerts: ${pipeline.decayAlerts.length} pages declining`);
    }
    if (pipeline.subscriptions) {
      lines.push(`Subscriptions: ${pipeline.subscriptions.active} active, ${pipeline.subscriptions.totalPages} pages`);
    }
    if (pipeline.requests && (pipeline.requests.pending > 0 || pipeline.requests.inProgress > 0)) {
      lines.push(`Content requests: ${pipeline.requests.pending} pending, ${pipeline.requests.inProgress} in progress`);
    }
    if (pipeline.workOrders?.active > 0) {
      lines.push(`Work orders: ${pipeline.workOrders.active} active`);
    }
    if (pipeline.seoEdits && (pipeline.seoEdits.pending > 0 || pipeline.seoEdits.applied > 0)) {
      lines.push(`SEO edits: ${pipeline.seoEdits.pending} pending, ${pipeline.seoEdits.applied} applied`);
    }
  }

  if (verbosity === 'detailed') {
    const bs = pipeline.briefs.byStatus;
    lines.push(`Brief status: ${Object.entries(bs).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    const ps = pipeline.posts.byStatus;
    lines.push(`Post status: ${Object.entries(ps).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    lines.push(`Matrix: ${pipeline.matrices.cellsPublished}/${pipeline.matrices.cellsPlanned} cells published`);
    if (pipeline.schemaDeployment) {
      lines.push(`Schema: ${pipeline.schemaDeployment.deployed}/${pipeline.schemaDeployment.planned} deployed`);
    }
    if (pipeline.cannibalizationWarnings && pipeline.cannibalizationWarnings.length > 0) {
      lines.push('Keyword cannibalization:');
      for (const cw of pipeline.cannibalizationWarnings.slice(0, 5)) {
        lines.push(`  - "${cw.keyword}" [${cw.severity}]: ${cw.pages.join(', ')}`);
      }
    }
    if (pipeline.decayAlerts && pipeline.decayAlerts.length > 0) {
      lines.push('Decay alert details:');
      for (const da of pipeline.decayAlerts.slice(0, 5)) {
        lines.push(`  - ${da.pageUrl}: -${da.clickDrop}% clicks${da.isRepeatDecay ? ' (repeat decay)' : ''}`);
      }
    }
  }

  return lines.join('\n');
}

function formatSiteHealthSection(health: SiteHealthSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Site Health'];

  lines.push(`Audit score: ${health.auditScore ?? 'n/a'}${health.auditScoreDelta != null ? ` (${health.auditScoreDelta >= 0 ? '+' : ''}${health.auditScoreDelta})` : ''}`);
  if (health.anomalyCount != null && health.anomalyCount > 0) {
    lines.push(`Critical issues: ${health.anomalyCount} anomalies`);
  }

  if (verbosity !== 'compact') {
    if (health.performanceSummary?.score != null) {
      lines.push(`Performance: ${health.performanceSummary.score}/100`);
    }
    lines.push(`Links: ${health.deadLinks} dead, ${health.redirectChains} redirect chains, ${health.orphanPages} orphan pages`);
    if (health.anomalyTypes && health.anomalyTypes.length > 0) {
      lines.push(`Anomaly types: ${health.anomalyTypes.join(', ')}`);
    }
  }

  if (verbosity === 'detailed') {
    if (health.schemaErrors > 0) lines.push(`Schema errors: ${health.schemaErrors}`);
    if (health.seoChangeVelocity != null) lines.push(`SEO change velocity: ${health.seoChangeVelocity} changes (30d)`);
    if (health.cwvPassRate.mobile != null) lines.push(`CWV pass rate: mobile ${pct(health.cwvPassRate.mobile)}, desktop ${health.cwvPassRate.desktop != null ? pct(health.cwvPassRate.desktop) : 'n/a'}`);
    if (health.schemaValidation) {
      lines.push(`Schema validation: ${health.schemaValidation.valid} valid, ${health.schemaValidation.warnings} warnings, ${health.schemaValidation.errors} errors`);
    }
    if (health.performanceSummary) {
      const perfParts: string[] = [];
      if (health.performanceSummary.avgLcp != null) perfParts.push(`LCP: ${health.performanceSummary.avgLcp.toFixed(1)}s`);
      if (health.performanceSummary.avgFid != null) perfParts.push(`FID: ${health.performanceSummary.avgFid}ms`);
      if (health.performanceSummary.avgCls != null) perfParts.push(`CLS: ${health.performanceSummary.avgCls.toFixed(2)}`);
      if (perfParts.length > 0) lines.push(`Core Web Vitals: ${perfParts.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatClientSignalsSection(signals: ClientSignalsSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Client Signals'];

  lines.push(`Churn risk: ${signals.churnRisk ?? 'unknown'}`);
  if (signals.roi) {
    lines.push(`ROI: $${signals.roi.organicValue} organic value, ${signals.roi.growth > 0 ? '+' : ''}${signals.roi.growth}% growth (${signals.roi.period})`);
  }
  if (signals.compositeHealthScore != null) {
    lines.push(`Health score: ${signals.compositeHealthScore}/100`);
  }

  if (verbosity !== 'compact') {
    if (signals.engagement) {
      lines.push(`Engagement: ${signals.engagement.loginFrequency} login frequency, ${signals.engagement.chatSessionCount} chat sessions`);
    }
    if (signals.approvalPatterns.approvalRate > 0) {
      lines.push(`Approval rate: ${pct(signals.approvalPatterns.approvalRate)}`);
    }
    if (signals.businessPriorities.length > 0) {
      lines.push(`Business priorities: ${signals.businessPriorities.join('; ')}`);
    }
    if (signals.serviceRequests) {
      lines.push(`Service requests: ${signals.serviceRequests.pending} pending, ${signals.serviceRequests.total} total`);
    }
  }

  if (verbosity === 'detailed') {
    if (signals.churnSignals && signals.churnSignals.length > 0) {
      lines.push('Churn signals:');
      for (const s of signals.churnSignals.slice(0, 5)) {
        lines.push(`  - [${s.severity}] ${s.title}: ${s.description}`);
      }
    }
    if (signals.feedbackItems && signals.feedbackItems.length > 0) {
      const openCount = signals.feedbackItems.filter(f => f.status === 'new').length;
      lines.push(`Feedback: ${signals.feedbackItems.length} items (${openCount} open)`);
    }
    if (signals.recentChatTopics.length > 0) {
      lines.push(`Recent topics: ${signals.recentChatTopics.join(', ')}`);
    }
    if (signals.keywordFeedback.approved.length > 0 || signals.keywordFeedback.rejected.length > 0) {
      lines.push(`Keyword feedback: ${pct(signals.keywordFeedback.patterns.approveRate)} approve rate`);
      if (signals.keywordFeedback.approved.length > 0) {
        lines.push(`  Approved: ${signals.keywordFeedback.approved.slice(0, 5).join(', ')}`);
      }
      if (signals.keywordFeedback.patterns.topRejectionReasons.length > 0) {
        lines.push(`  Top rejection reasons: ${signals.keywordFeedback.patterns.topRejectionReasons.join(', ')}`);
      }
    }
    if (signals.contentGapVotes.length > 0) {
      lines.push(`Content gap votes: ${signals.contentGapVotes.slice(0, 5).map(v => `${v.topic} (${v.votes})`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatOperationalSection(ops: OperationalSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = ['## Operational'];

  const approvals = ops.approvalQueue?.pending ?? 0;
  const actions = ops.actionBacklog?.pendingMeasurement ?? 0;
  const recs = (ops.recommendationQueue?.fixNow ?? 0) + (ops.recommendationQueue?.fixSoon ?? 0) + (ops.recommendationQueue?.fixLater ?? 0);
  lines.push(`Pending: ${approvals} approvals, ${actions} actions awaiting measurement, ${recs} recommendations`);

  if (verbosity !== 'compact') {
    if (ops.recommendationQueue) {
      lines.push(`Recommendations: ${ops.recommendationQueue.fixNow} fix now, ${ops.recommendationQueue.fixSoon} fix soon, ${ops.recommendationQueue.fixLater} fix later`);
    }
    if (ops.recentActivity.length > 0) {
      lines.push(`Recent: ${ops.recentActivity.slice(0, 3).map(a => a.description).join('; ')}`);
    }
    if (ops.timeSaved) {
      lines.push(`Time saved: ${ops.timeSaved.totalMinutes} minutes`);
    }
    if (ops.pendingJobs > 0) {
      lines.push(`Background jobs: ${ops.pendingJobs} pending`);
    }
    if (ops.workOrders) {
      lines.push(`Work orders: ${ops.workOrders.active} active, ${ops.workOrders.pending} pending`);
    }
  }

  if (verbosity === 'detailed') {
    if (ops.detectedPlaybooks && ops.detectedPlaybooks.length > 0) {
      lines.push(`Detected playbooks: ${ops.detectedPlaybooks.slice(0, 3).join(', ')}`);
    }
    if (ops.timeSaved?.byFeature) {
      lines.push('Time saved by feature:');
      for (const [feature, minutes] of Object.entries(ops.timeSaved.byFeature).slice(0, 5)) {
        lines.push(`  ${feature}: ${minutes} min`);
      }
    }
    if (ops.annotations.length > 0) {
      lines.push('Timeline annotations:');
      for (const a of ops.annotations.slice(0, 5)) {
        lines.push(`  - ${a.date}: ${a.label}`);
      }
    }
    if (ops.insightAcceptanceRate) {
      lines.push(`Insight acceptance rate: ${pct(ops.insightAcceptanceRate.rate)} (${ops.insightAcceptanceRate.confirmed}/${ops.insightAcceptanceRate.totalShown})`);
    }
  }

  return lines.join('\n');
}

function formatPageProfileSection(profile: PageProfileSlice, verbosity: PromptVerbosity): string {
  const lines: string[] = [`## Page Profile: ${profile.pagePath}`];

  lines.push(`Keyword: ${profile.primaryKeyword ?? 'none'} | Health: ${profile.optimizationScore ?? 'n/a'}`);

  if (verbosity !== 'compact') {
    if (profile.rankHistory.current != null) {
      lines.push(`Position: ${profile.rankHistory.current} (${profile.rankHistory.trend})`);
    }
    if (profile.actions.length > 0) {
      lines.push(`Actions: ${profile.actions.length} tracked`);
    }
  }

  if (verbosity === 'detailed') {
    if (profile.optimizationIssues?.length > 0) {
      lines.push('Optimization issues:');
      for (const issue of profile.optimizationIssues.slice(0, 5)) {
        lines.push(`  - ${issue}`);
      }
    }
    if (profile.recommendations.length > 0) {
      lines.push('Recommendations:');
      for (const rec of profile.recommendations.slice(0, 5)) {
        lines.push(`  - ${rec}`);
      }
    }
    if (profile.contentGaps.length > 0) {
      lines.push('Content gaps:');
      for (const gap of profile.contentGaps.slice(0, 3)) {
        lines.push(`  - ${gap}`);
      }
    }
    if (profile.primaryKeywordPresence) {
      const p = profile.primaryKeywordPresence;
      const missing = (['inTitle', 'inMeta', 'inContent', 'inSlug'] as const)
        .filter(k => !p[k])
        .map(k => ({ inTitle: 'title', inMeta: 'meta', inContent: 'content', inSlug: 'slug' }[k]));
      if (missing.length > 0) lines.push(`Keyword missing from: ${missing.join(', ')}`);
    }
    if (profile.competitorKeywords?.length) {
      lines.push(`Competitor keywords: ${profile.competitorKeywords.slice(0, 5).join(', ')}`);
    }
    if (profile.topicCluster) lines.push(`Topic cluster: ${profile.topicCluster}`);
    if (profile.estimatedDifficulty) lines.push(`Difficulty: ${profile.estimatedDifficulty}`);
    if (profile.auditIssues?.length > 0) {
      lines.push(`Structural audit issues: ${profile.auditIssues.length}`);
    }
    lines.push(`Schema: ${profile.schemaStatus} | Content: ${profile.contentStatus ?? 'none'} | CWV: ${profile.cwvStatus ?? 'n/a'}`);
    if (profile.linkHealth) {
      lines.push(`Links: ${profile.linkHealth.inbound} inbound, ${profile.linkHealth.outbound} outbound${profile.linkHealth.orphan ? ' ⚠ orphan page' : ''}`);
    }
    if (profile.seoEdits?.currentTitle) {
      lines.push(`Current title: ${profile.seoEdits.currentTitle}`);
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
    const primaryKw = pageKw?.primaryKeyword?.toLowerCase();
    const pageRank: RankEntry | undefined = primaryKw
      ? latest.find(k => k.query.toLowerCase() === primaryKw)
      : undefined;
    if (pageRank) {
      current = pageRank.position ?? current;
      const change = pageRank.change ?? 0;
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
        const pagData = (snap.audit.pages as PageSeoResult[]).find(p => p.url === pagePath || p.slug === pagePath);
        if (pagData?.issues) {
          auditIssues = pagData.issues.map((i: SeoIssue) => i.message).filter(Boolean);
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
    const validations: SchemaValidation[] = getValidations(workspaceId);
    const pageValidation = validations.find(v => v.pageId === pagePath);
    if (pageValidation) {
      const status = pageValidation.status;
      schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
    }
  } catch {
    schemaStatus = 'none';
  }

  // Link health — SiteNode doesn't carry link counts; use orphanPaths from architecture result
  let linkHealth = { inbound: 0, outbound: 0, orphan: false };
  try {
    const { getCachedArchitecture, flattenTree } = await import('./site-architecture.js');
    const arch = await Promise.race([
      getCachedArchitecture(workspaceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (arch) {
      const nodes: SiteNode[] = flattenTree(arch.tree);
      const nodeExists = nodes.some(n => n.path === pagePath);
      if (nodeExists) {
        linkHealth = {
          inbound: 0, // Not available from site architecture tree
          outbound: 0,
          orphan: arch.orphanPaths?.includes(pagePath) ?? false,
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
    const briefs: ContentBrief[] = listBriefs(workspaceId);
    // ContentBrief matches pages via targetKeyword, not URL
    const primaryKw = pageKw?.primaryKeyword?.toLowerCase();
    const hasBrief = primaryKw ? briefs.some(b => b.targetKeyword?.toLowerCase() === primaryKw) : false;
    const matchingBrief = primaryKw ? briefs.find(b => b.targetKeyword?.toLowerCase() === primaryKw) : undefined;

    let hasPost = false;
    let isPublished = false;
    try {
      const { listPosts } = await import('./content-posts-db.js');
      const posts: GeneratedPost[] = listPosts(workspaceId);
      // GeneratedPost links to a brief via briefId; match if the brief targets this page's keyword
      if (matchingBrief) {
        hasPost = posts.some(p => p.briefId === matchingBrief.id);
        isPublished = posts.some(p => p.briefId === matchingBrief.id && p.status === 'approved');
      }
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

  // contentGaps — prefer per-page AI keyword analysis (same source as old buildPageAnalysisContext),
  // fall back to strategy content gaps filtered by keyword if page analysis hasn't run yet.
  let contentGaps: string[] = pageKw?.contentGaps ?? [];
  if (contentGaps.length === 0) {
    try {
      const { getWorkspace: getWsForGaps } = await import('./workspaces.js');
      const wsForGaps = getWsForGaps(workspaceId);
      const allGaps = wsForGaps?.keywordStrategy?.contentGaps ?? [];
      if (allGaps.length > 0) {
        const primaryKwLower = pageKw?.primaryKeyword?.toLowerCase();
        const matched = primaryKwLower
          ? allGaps.filter(g => g.targetKeyword?.toLowerCase() === primaryKwLower)
          : [];
        const source = matched.length > 0 ? matched : allGaps;
        contentGaps = source.slice(0, 5).map(g => g.topic).filter(Boolean);
      }
    } catch {
      contentGaps = [];
    }
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
        const result = speedSnap.result as { pages?: Array<{ url?: string; slug?: string; score?: number }> }; // as-any-ok: untyped PageSpeed JSON blob
        const pages = result.pages ?? [];
        const pageData = pages.find(p => p.url === pagePath || p.slug === pagePath);
        if (pageData?.score != null) {
          cwvStatus = pageData.score >= 90 ? 'good' : pageData.score >= 50 ? 'needs_improvement' : 'poor';
        }
      }
    }
  } catch {
    cwvStatus = null;
  }

  // Merge platform recs with AI keyword analysis recs — both are page-relevant.
  // pageKw.recommendations come from the per-page AI keyword analysis job.
  const kwRecs = pageKw?.recommendations ?? [];
  const allRecommendations = kwRecs.length > 0
    ? [...kwRecs, ...recommendations.filter(r => !kwRecs.includes(r))]
    : recommendations;

  return {
    pagePath,
    primaryKeyword: pageKw?.primaryKeyword ?? null,
    searchIntent: pageKw?.searchIntent ?? null,
    optimizationScore: pageKw?.optimizationScore ?? null,
    recommendations: allRecommendations,
    contentGaps,
    insights,
    actions,
    auditIssues,
    optimizationIssues: pageKw?.optimizationIssues ?? [],
    primaryKeywordPresence: pageKw?.primaryKeywordPresence ?? null,
    competitorKeywords: pageKw?.competitorKeywords ?? [],
    topicCluster: pageKw?.topicCluster ?? null,
    estimatedDifficulty: pageKw?.estimatedDifficulty ?? null,
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

// ── Formatting helpers for migrated callers (Phase 3B) ───────────────────
// These produce prompt-ready text from intelligence slice data, matching the
// output format of the legacy mini-builders in seo-context.ts.

/**
 * Format raw brand voice text into a prompt block matching buildSeoContext().brandVoiceBlock format.
 * Required because seoContext.brandVoice stores the RAW voice text (no header).
 */
export function formatBrandVoiceForPrompt(brandVoice: string | null | undefined): string {
  if (!brandVoice?.trim()) return '';
  return `\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${brandVoice}`;
}

/**
 * Format raw knowledge base text into a prompt block matching buildSeoContext().knowledgeBlock format.
 * Required because seoContext.knowledgeBase stores the RAW knowledge text (no header).
 */
export function formatKnowledgeBaseForPrompt(knowledgeBase: string | null | undefined): string {
  if (!knowledgeBase?.trim()) return '';
  return `\n\nBUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${knowledgeBase}`;
}

/**
 * Format site keywords into a prompt block matching buildSeoContext().keywordBlock format.
 * Used by migrated callers to replace buildSeoContext() with buildWorkspaceIntelligence().
 */
export function formatKeywordsForPrompt(seo: SeoContextSlice | null | undefined): string {
  if (!seo?.strategy) return '';

  let keywordBlock = '';

  // Site-level keywords (matches seo-context.ts line 111-112)
  const siteKw = seo.strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context (matches seo-context.ts line 115-118)
  const businessContext = seo.businessContext || seo.strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords from pageKeywords slice field (matches seo-context.ts line 121-133)
  const pageKw = seo.pageKeywords;
  if (pageKw) {
    keywordBlock += `\n\nTHIS PAGE'S TARGET (overrides general context):`;
    keywordBlock += `\nPrimary keyword: "${pageKw.primaryKeyword}"`;
    if (pageKw.secondaryKeywords?.length) {
      keywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
    }
    if (pageKw.searchIntent) {
      keywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
    }
    keywordBlock += `\nIMPORTANT: If this page's keywords reference a specific location (city, state, region), ALWAYS use THAT location. Do NOT substitute the business headquarters or a different location from the general business context. The page-level keyword is the authoritative signal for what this page targets.`;
  }

  if (!keywordBlock) return '';
  return `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
}

/**
 * Format audience personas into a prompt block matching buildSeoContext().personasBlock format.
 * Used by migrated callers to replace buildSeoContext() with buildWorkspaceIntelligence().
 */
export function formatPersonasForPrompt(personas: AudiencePersona[] | null | undefined): string {
  if (!personas?.length) return '';

  // Matches buildPersonasContext() in seo-context.ts lines 322-331
  const personaStr = personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
}

/**
 * Format page keyword map into a prompt block matching buildKeywordMapContext() format.
 * If pagePath is provided, includes only the matching page's data. Otherwise includes all pages.
 * Used by migrated callers to replace buildKeywordMapContext() with buildWorkspaceIntelligence().
 */
export function formatPageMapForPrompt(seo: SeoContextSlice | null | undefined, pagePath?: string): string {
  if (!seo?.strategy?.pageMap?.length) return '';

  const pagePathLower = pagePath?.toLowerCase();
  const pageMap = pagePathLower
    ? seo.strategy.pageMap.filter(p => p.pagePath.toLowerCase() === pagePathLower)
    : seo.strategy.pageMap;

  if (!pageMap.length) return '';

  // Matches buildKeywordMapContext() in seo-context.ts lines 395-399
  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}
