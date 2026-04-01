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
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  RedirectDetail,
  SchemaValidationSummary,
  PerformanceSummary,
  PromptFormatOptions,
  PromptVerbosity,
  CannibalizationWarning,
  DecayAlert,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';

const log = createLogger('workspace-intelligence');

const stmts = createStmtCache(() => ({
  schemaErrorCount: db.prepare(
    `SELECT COUNT(*) as cnt FROM schema_validations WHERE workspace_id = ? AND status = 'errors'`,
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
    // Phase 3: remaining slices are stubbed — they return undefined
    case 'pageProfile':
    case 'clientSignals':
    case 'operational':
      log.debug({ workspaceId, slice }, 'Slice not yet implemented — skipping');
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

  return {
    strategy: ctx.strategy,
    brandVoice: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
    personas: workspace?.personas ?? [],
    knowledgeBase: ctx.knowledgeBlock,
  };
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

  return {
    summary,
    confidence: summary?.confidence ?? null,
    topActionTypes: summary?.overall.topActionTypes.slice(0, 5) ?? [],
    overallWinRate: summary?.overall.totalWinRate ?? 0,
    recentTrend: summary?.overall.recentTrend ?? null,
    playbooks,
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
    const subs = listContentSubscriptions(workspaceId) as any[];
    const activeSubs = subs.filter((s: any) => s.status === 'active');
    const totalPages = activeSubs.reduce((sum: number, s: any) => sum + (s.totalPages ?? s.postsPerMonth ?? 0), 0);
    subscriptions = { active: activeSubs.length, totalPages };
  } catch {
    // Non-critical — subscriptions optional
  }

  // Schema deployment
  let schemaDeployment: ContentPipelineSlice['schemaDeployment'];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    if (ws?.siteId) {
      const { getSchemaPlan } = await import('./schema-store.js');
      const { listPendingSchemas } = await import('./schema-queue.js');
      const plan = getSchemaPlan(ws.siteId) as any;
      const pending = listPendingSchemas(workspaceId) as any[];
      const planned = plan?.pages?.length ?? 0;
      const deployed = Math.max(0, planned - pending.length);
      const types = [...new Set((plan?.pages ?? []).map((p: any) => p.schemaType).filter(Boolean))] as string[];
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
    const matrices = listMatrices(workspaceId) as any[];
    for (const matrix of matrices.slice(0, 5)) {
      const report = detectMatrixCannibalization(workspaceId, matrix.id) as any;
      if (report?.conflicts) {
        for (const conflict of (report.conflicts as any[]).slice(0, 10)) {
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
    const decay = loadDecayAnalysis(workspaceId) as any;
    if (decay?.pages) {
      decayAlerts = (decay.pages as any[]).slice(0, 20).map((p: any) => ({
        pageUrl: p.url ?? p.pageUrl ?? '',
        clickDrop: p.clickDrop ?? 0,
        detectedAt: p.detectedAt ?? decay.analyzedAt ?? new Date().toISOString(),
        hasRefreshBrief: !!p.briefId,
        isRepeatDecay: false,
      }));
    }
  } catch {
    // Non-critical — decay data optional
  }

  // Suggested briefs count
  let suggestedBriefs = 0;
  try {
    const { getSuggestedBriefs } = await import('./suggested-briefs-store.js');
    const briefs = getSuggestedBriefs(workspaceId) as any[];
    suggestedBriefs = briefs.filter((b: any) => b.status === 'pending').length;
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
