/**
 * keyword-strategy routes — extracted from server/index.ts
 *
 * @reads workspaces, page_keywords, strategy_history, keyword_feedback, snapshots, search_console, google_analytics, seo_provider, workspace_intelligence, workspace_pages, analytics_insights, local_seo_workspace_settings, local_seo_markets, local_visibility_snapshots
 * @writes page_keywords, strategy_history, keyword_feedback, tracked_keywords, workspaces, usage_tracking, intelligence_cache
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import { getTrackedKeywords } from '../rank-tracking.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { upsertAndCleanPageKeywords, listPageKeywords } from '../page-keywords.js';
import { listContentGaps, replaceAllContentGaps } from '../content-gaps.js';
import { listQuickWins, replaceAllQuickWins } from '../quick-wins.js';
import { listKeywordGaps, replaceAllKeywordGaps } from '../keyword-gaps.js';
import { listTopicClusters, replaceAllTopicClusters } from '../topic-clusters.js';
import { listCannibalizationIssues, replaceAllCannibalizationIssues } from '../cannibalization-issues.js';
import { assembleStoredKeywordStrategy } from '../keyword-strategy-assembler.js';
import { validate, z } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from '../db/json-validation.js';
import { strategyHistoryStrategySchema, strategyHistoryPageMapSchema, type StrategyHistoryStrategy } from '../schemas/workspace-schemas.js';
import { getInsights } from '../analytics-insights-store.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem } from '../../shared/types/workspace.js';
import { buildStrategySignals } from '../insight-feedback.js';
import { buildStrategyKeywordEvaluationContext } from '../keyword-strategy-context.js';
import {
  clearKeywordFeedback,
  getDeclinedKeywords,
  getRequestedKeywords,
  listAdminKeywordFeedback,
  notifyKeywordFeedbackChanged,
  saveBulkKeywordFeedback,
  saveKeywordFeedback,
} from '../keyword-feedback.js';
import { requireWorkspaceAccess } from '../auth.js';
import { isProgrammingError } from '../errors.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { hasActiveJob } from '../jobs.js';
import { generateKeywordStrategy, KeywordStrategyGenerationError, KEYWORD_STRATEGY_MAX_PAGE_CAP } from '../keyword-strategy-generation.js';
import { normalizeRuntimeSeoDataProvider } from '../seo-data-provider.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  adminBulkKeywordFeedbackSchema,
  adminKeywordFeedbackSchema,
  type AdminBulkKeywordFeedbackBody,
  type AdminKeywordFeedbackBody,
} from '../schemas/keyword-feedback.js';
import {
  attachKeywordStrategyUxToDiff,
  buildKeywordStrategyRefreshSummary,
  buildKeywordStrategyUxPayload,
} from '../keyword-strategy-ux.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../keyword-strategy-follow-ons.js';
import { getLocalStrategySyncStatus } from '../local-strategy-sync.js';
export { buildStrategyIntelligenceBlock, computeOpportunityScore, shouldFetchCompetitorData } from '../keyword-strategy-generation.js';

const log = createLogger('keyword-strategy');

function readSeoDataMode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidate = (body as { seoDataMode?: unknown }).seoDataMode;
  return typeof candidate === 'string' ? candidate : undefined;
}

function readSeoDataProvider(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidate = (body as { seoDataProvider?: unknown }).seoDataProvider;
  return typeof candidate === 'string' ? normalizeRuntimeSeoDataProvider(candidate) : undefined;
}

function serializeKeywordStrategy(
  strategy: KeywordStrategy,
  pageMap: ReturnType<typeof listPageKeywords>,
  contentGaps: ContentGap[],
  quickWins: QuickWin[],
  keywordGaps: KeywordGapItem[],
  topicClusters: TopicCluster[],
  cannibalization: CannibalizationItem[],
  strategyUx?: Awaited<ReturnType<typeof buildKeywordStrategyUxPayload>>,
) {
  // The five table-backed arrays are supplied by assembleStoredKeywordStrategy and
  // re-attached explicitly below, so they no longer need stripping here (the explicit
  // keys win over the spread). Only the legacy `semrushMode` alias must still be
  // dropped — it has no canonical replacement key and would otherwise leak.
  const rest: Record<string, unknown> = { ...strategy };
  delete rest.semrushMode;
  const seoDataStatus = strategy.seoDataStatus;
  return {
    ...rest,
    seoDataMode: strategy.seoDataMode ?? 'none',
    seoDataStatus: seoDataStatus ? {
      mode: seoDataStatus.mode,
      provider: seoDataStatus.provider,
      status: seoDataStatus.status,
      reasons: seoDataStatus.reasons ?? [],
      fallbackProviderAvailable: seoDataStatus.fallbackProviderAvailable ?? false,
    } : undefined,
    pageMap,
    contentGaps,
    quickWins,
    keywordGaps,
    topicClusters,
    cannibalization,
    strategyUx,
  };
}

// --- Keyword Strategy Generation (SSE progress) ---
router.post('/api/webflow/keyword-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const wantsStream = req.headers.accept === 'text/event-stream';
  let streamStarted = false;
  const routeKeepalive: { stop: (() => void) | null } = { stop: null };

  const ensureStream = () => {
    if (!wantsStream || streamStarted) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    streamStarted = true;
  };

  const writeSse = (event: unknown) => {
    ensureStream();
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy/writeSse: programming error');
    }
  };

  try {
    const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, req.params.workspaceId);
    if (activeJob) {
      res.status(409).json({ error: 'A keyword strategy is already being generated for this workspace', jobId: activeJob.id });
      return;
    }

    const requestedMaxPages = req.body?.maxPages == null ? undefined : Number(req.body.maxPages);
    if (requestedMaxPages != null && (!Number.isInteger(requestedMaxPages) || requestedMaxPages < 0)) {
      res.status(400).json({ error: 'maxPages must be a non-negative integer' });
      return;
    }
    if (requestedMaxPages != null && requestedMaxPages > KEYWORD_STRATEGY_MAX_PAGE_CAP) {
      res.status(400).json({ error: `maxPages must be between 0 and ${KEYWORD_STRATEGY_MAX_PAGE_CAP}` });
      return;
    }

    const competitorDomainsProvided = Array.isArray(req.body?.competitorDomains);
    const result = await generateKeywordStrategy({
      workspaceId: req.params.workspaceId,
      businessContext: typeof req.body?.businessContext === 'string' ? req.body.businessContext : undefined,
      mode: req.body?.mode === 'incremental' ? 'incremental' : 'full',
      seoDataMode: readSeoDataMode(req.body),
      seoDataProvider: readSeoDataProvider(req.body),
      competitorDomains: competitorDomainsProvided ? req.body.competitorDomains : undefined,
      competitorDomainsProvided,
      maxPages: requestedMaxPages,
      onProgress: wantsStream ? (event) => writeSse(event) : undefined,
      startKeepalive: wantsStream ? () => {
        ensureStream();
        const keepalive = setInterval(() => {
          try {
            res.write(`: keepalive\n\n`);
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy/keepalive: programming error');
          }
        }, 10_000);
        routeKeepalive.stop = () => clearInterval(keepalive);
        return routeKeepalive.stop;
      } : undefined,
    });

    if (wantsStream) {
      writeSse({ done: true, strategy: result.strategy, upToDate: result.upToDate });
      res.end();
      return;
    }
    if (result.upToDate) {
      res.json({ ok: true, upToDate: true, freshPageCount: result.freshPageCount ?? 0 });
      return;
    }
    res.json(result.strategy);
  } catch (err) {
    const generationError = err instanceof KeywordStrategyGenerationError
      ? err
      : new KeywordStrategyGenerationError(500, { error: err instanceof Error ? err.message : String(err) });
    if (wantsStream && streamStarted) {
      writeSse(generationError.payload);
      res.end();
      return;
    }
    res.status(generationError.statusCode).json(generationError.payload);
  } finally {
    routeKeepalive.stop?.();
  }
});

// Get stored keyword strategy (reassembles pageMap from page_keywords table).
// Returns a synthesized shell when ws.keywordStrategy is absent but page_keywords
// has rows — the per-page SEO Editor "Analyze" flow writes only to page_keywords,
// so Page Intelligence must be able to surface those rows without requiring a
// full strategy generation run. Short-circuits to null only when both sources
// are empty.
router.get('/api/webflow/keyword-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const strategy = ws.keywordStrategy;
    // Single read-path assembler (#2): table-as-truth + table-or-blob fallback,
    // returning null on the existing short-circuit (no blob + all tables empty).
    const assembled = assembleStoredKeywordStrategy(ws.id);
    if (!assembled) return res.json(null);
    const { pageMap, contentGaps, quickWins, keywordGaps, topicClusters, cannibalization } = assembled;
    if (!strategy) {
      const shellStrategyUx = await buildKeywordStrategyUxPayload({
        workspaceId: ws.id,
        workspaceName: ws.name,
        strategy: null,
        pageMap,
        contentGaps,
        keywordGaps,
        surface: 'admin',
      });
      shellStrategyUx.localSync = getLocalStrategySyncStatus(ws.id);
      return res.json({
        siteKeywords: [],
        opportunities: [],
        pageMap,
        contentGaps,
        quickWins,
        keywordGaps,
        topicClusters,
        cannibalization,
        strategyUx: shellStrategyUx,
        generatedAt: null,
      });
    }
    const strategyUx = await buildKeywordStrategyUxPayload({
      workspaceId: ws.id,
      workspaceName: ws.name,
      strategy,
      pageMap,
      contentGaps,
      keywordGaps,
      surface: 'admin',
    });
    strategyUx.localSync = getLocalStrategySyncStatus(ws.id);
    res.json(serializeKeywordStrategy(strategy, pageMap, contentGaps, quickWins, keywordGaps, topicClusters, cannibalization, strategyUx));
  } catch (err) {
    next(err);
  }
});

// Get strategy diff (compare current vs previous)
router.get('/api/webflow/keyword-strategy/:workspaceId/diff', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const current = ws.keywordStrategy;
    if (!current) return res.json(null);

    const prev = db.prepare('SELECT strategy_json, page_map_json, generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 1').get(ws.id) as { strategy_json: string; page_map_json: string; generated_at: string } | undefined;
    if (!prev) return res.json(null);

    const emptyPrevStrategy: StrategyHistoryStrategy = {};
    const prevStrategy = parseJsonSafe(prev.strategy_json, strategyHistoryStrategySchema, emptyPrevStrategy, {
      workspaceId: ws.id, field: 'strategy_json', table: 'strategy_history',
    });
    const prevPageMap = parseJsonSafeArray(prev.page_map_json, strategyHistoryPageMapSchema, {
      workspaceId: ws.id, field: 'page_map_json', table: 'strategy_history',
    });
    const currentPageMap = listPageKeywords(ws.id);
    const trackedKeywords = getTrackedKeywords(ws.id, { includeInactive: true });

    // Compute diffs
    const prevSiteKws = new Set<string>(prevStrategy.siteKeywords || []);
    const currSiteKws = new Set<string>(current.siteKeywords || []);
    const newKeywords = [...currSiteKws].filter((k: string) => !prevSiteKws.has(k));
    const lostKeywords = [...prevSiteKws].filter((k: string) => !currSiteKws.has(k));

    // Previous gaps come from the history snapshot (which now bakes in the
    // table state at save-time, see keyword-strategy-persistence.ts).
    // Current gaps come from the live content_gaps table - the blob no longer
    // carries them after #365 normalization.
    const currentContentGaps = listContentGaps(ws.id);
    const prevGapKws = new Set<string>((prevStrategy.contentGaps || []).flatMap((g) => (g.targetKeyword ? [g.targetKeyword] : [])));
    const currGapKws = new Set<string>(currentContentGaps.map((g) => g.targetKeyword));
    const newGaps = [...currGapKws].filter((k: string) => !prevGapKws.has(k));
    const resolvedGaps = [...prevGapKws].filter((k: string) => !currGapKws.has(k));

    // Page map changes
    const prevPageKws = new Map(prevPageMap.map((p: { pagePath: string; primaryKeyword: string }) => [p.pagePath, p.primaryKeyword]));
    const currPageKws = new Map(currentPageMap.map((p: { pagePath: string; primaryKeyword: string }) => [p.pagePath, p.primaryKeyword]));
    const keywordChanges: { pagePath: string; oldKeyword: string; newKeyword: string }[] = [];
    for (const [path, kw] of currPageKws) {
      const old = prevPageKws.get(path);
      if (old && old !== kw) keywordChanges.push({ pagePath: path, oldKeyword: old, newKeyword: kw });
    }

    const diff = {
      previousGeneratedAt: prev.generated_at,
      currentGeneratedAt: current.generatedAt,
      newKeywords,
      lostKeywords,
      newGaps,
      resolvedGaps,
      keywordChanges,
      prevSiteKeywordCount: prevSiteKws.size,
      currSiteKeywordCount: currSiteKws.size,
    };
    const summary = buildKeywordStrategyRefreshSummary({
      previousGeneratedAt: prev.generated_at,
      currentGeneratedAt: current.generatedAt,
      previousSiteKeywords: prevStrategy.siteKeywords ?? [],
      currentSiteKeywords: current.siteKeywords ?? [],
      previousContentGapKeywords: prevStrategy.contentGaps?.flatMap(gap => (gap.targetKeyword ? [gap.targetKeyword] : [])) ?? [],
      currentContentGapKeywords: currentContentGaps.map(gap => gap.targetKeyword),
      previousPageMap: prevPageMap,
      currentPageMap,
      trackedKeywords,
    });
    const keywordGapsFromTable = listKeywordGaps(ws.id);
    const keywordGaps = keywordGapsFromTable.length > 0 ? keywordGapsFromTable : (current.keywordGaps || []);
    const strategyUx = await buildKeywordStrategyUxPayload({
      workspaceId: ws.id,
      workspaceName: ws.name,
      strategy: current,
      pageMap: currentPageMap,
      contentGaps: currentContentGaps,
      keywordGaps,
      surface: 'admin',
      summary,
      trackedKeywords,
    });
    res.json(attachKeywordStrategyUxToDiff(diff, strategyUx));
  } catch (err) {
    next(err);
  }
});

// Update keyword strategy (manual edits)
const patchStrategySchema = z.object({
  pageMap: z.array(z.object({
    pagePath: z.string(),
    pageTitle: z.string(),
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()),
    searchIntent: z.string().optional(),
  }).passthrough()).optional(),
  siteKeywords: z.array(z.string()).optional(),
  contentGaps: z.array(z.object({
    topic: z.string(),
    targetKeyword: z.string(),
    intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']),
    priority: z.enum(['high', 'medium', 'low']),
    rationale: z.string(),
  }).passthrough()).optional(),
  quickWins: z.array(z.object({
    pagePath: z.string(),
    currentKeyword: z.string().optional(),
    action: z.string(),
    estimatedImpact: z.enum(['high', 'medium', 'low']).optional(),
    rationale: z.string().optional(),
    roiScore: z.number().optional(),
  }).strict()).optional(),
  keywordGaps: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
    competitorPosition: z.number(),
    competitorDomain: z.string(),
  }).strict()).optional(),
  topicClusters: z.array(z.object({
    topic: z.string(),
    keywords: z.array(z.string()),
    ownedCount: z.number(),
    totalCount: z.number(),
    coveragePercent: z.number(),
    avgPosition: z.number().optional(),
    topCompetitor: z.string().optional(),
    topCompetitorCoverage: z.number().optional(),
    gap: z.array(z.string()),
  }).strict()).optional(),
  cannibalization: z.array(z.object({
    keyword: z.string(),
    pages: z.array(z.object({
      path: z.string(),
      position: z.number().optional(),
      impressions: z.number().optional(),
      clicks: z.number().optional(),
      source: z.union([z.literal('keyword_map'), z.literal('gsc')]),
    }).strict()),
    severity: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]),
    recommendation: z.string(),
    canonicalPath: z.string().optional(),
    canonicalUrl: z.string().optional(),
    action: z.union([z.literal('canonical_tag'), z.literal('redirect_301'), z.literal('differentiate'), z.literal('noindex')]).optional(),
  }).strict()).optional(),
  opportunities: z.array(z.string()).optional(),
}).strict();

router.patch('/api/webflow/keyword-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(patchStrategySchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  let pageMapChanged = false;
  const applyPatch = db.transaction(() => {
    if (req.body.pageMap) {
      pageMapChanged = true;
      upsertAndCleanPageKeywords(ws.id, req.body.pageMap);
    }
    if (Array.isArray(req.body.contentGaps)) {
      replaceAllContentGaps(ws.id, req.body.contentGaps as ContentGap[]);
    }
    if (Array.isArray(req.body.quickWins)) {
      replaceAllQuickWins(ws.id, req.body.quickWins as QuickWin[]);
    }
    if (Array.isArray(req.body.keywordGaps)) {
      replaceAllKeywordGaps(ws.id, req.body.keywordGaps as KeywordGapItem[]);
    }
    if (Array.isArray(req.body.topicClusters)) {
      replaceAllTopicClusters(ws.id, req.body.topicClusters as TopicCluster[]);
    }
    if (Array.isArray(req.body.cannibalization)) {
      replaceAllCannibalizationIssues(ws.id, req.body.cannibalization as CannibalizationItem[]);
    }

    // Guard: table-backed-only edits must not fabricate a strategy blob.
    const {
      pageMap: _pm,
      contentGaps: _cg,
      quickWins: _qw,
      keywordGaps: _kg,
      topicClusters: _tc,
      cannibalization: _ci,
      ...rest
    } = req.body;
    const hasBlobFields = Object.keys(rest).length > 0;
    const blobExists = ws.keywordStrategy != null;
    let updated: KeywordStrategy | null = null;
    if (hasBlobFields || blobExists) {
      const preservedGeneratedAt = blobExists && !hasBlobFields
        ? ws.keywordStrategy?.generatedAt
        : undefined;
      updated = {
        ...(ws.keywordStrategy || {}),
        ...rest,
        generatedAt: preservedGeneratedAt ?? new Date().toISOString(),
      } as KeywordStrategy;
      delete (updated as { contentGaps?: unknown }).contentGaps;
      delete (updated as { quickWins?: unknown }).quickWins;
      delete (updated as { keywordGaps?: unknown }).keywordGaps;
      delete (updated as { topicClusters?: unknown }).topicClusters;
      delete (updated as { cannibalization?: unknown }).cannibalization;
      updateWorkspace(ws.id, { keywordStrategy: updated });
    }

    return {
      updated,
      responsePageMap: listPageKeywords(ws.id),
      responseContentGaps: listContentGaps(ws.id),
      responseQuickWins: listQuickWins(ws.id),
      responseKeywordGaps: listKeywordGaps(ws.id),
      responseTopicClusters: listTopicClusters(ws.id),
      responseCannibalization: listCannibalizationIssues(ws.id),
    };
  });
  const {
    updated,
    responsePageMap,
    responseContentGaps,
    responseQuickWins,
    responseKeywordGaps,
    responseTopicClusters,
    responseCannibalization,
  } = applyPatch.immediate();
  // Queue background rec regen after transaction commits (Task 1.2 — strategy PATCH must
  // trigger recommendation regeneration so stale recs don't linger after a strategy edit).
  queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id });
  if (pageMapChanged) {
    debouncedPageAnalysisInvalidate(ws.id, () => {
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
      invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
    });
  }
  invalidateIntelligenceCache(ws.id);
  // Broadcast strategy update so other surfaces (PageIntelligence, SeoEditor, other tabs)
  // invalidate their React Query caches. Without this, pageMap edits from PageIntelligence
  // leave KeywordStrategy/SeoEditor showing stale pageMap until staleTime expires.
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
    pageCount: responsePageMap.length,
    siteKeywords: updated?.siteKeywords?.length ?? 0,
    partial: !updated,
  });
  // Bridge #3: strategy updated — debounced intelligence invalidation
  debouncedStrategyInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
  });
  // Respond with reassembled strategy. When no blob was written and none previously existed,
  // surface a synthesized shell (same shape as GET) so the client can render pageMap
  // without assuming a real strategy.
  if (updated) {
    res.json({
      ...updated,
      pageMap: responsePageMap,
      contentGaps: responseContentGaps,
      quickWins: responseQuickWins,
      keywordGaps: responseKeywordGaps,
      topicClusters: responseTopicClusters,
      cannibalization: responseCannibalization,
    });
  } else {
    res.json({
      siteKeywords: [],
      opportunities: [],
      pageMap: responsePageMap,
      contentGaps: responseContentGaps,
      quickWins: responseQuickWins,
      keywordGaps: responseKeywordGaps,
      topicClusters: responseTopicClusters,
      cannibalization: responseCannibalization,
      generatedAt: null,
    });
  }
});

// ── Keyword Feedback (approve/decline) ──────────────────────────

// Admin: list all feedback for workspace
router.get('/api/webflow/keyword-feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(listAdminKeywordFeedback(ws.id));
});

// Admin or client: submit feedback on a keyword
// activity-ok: keyword approve/decline is transient feedback state; approved tracking writes are logged separately.
router.post('/api/webflow/keyword-feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(adminKeywordFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source, declinedBy } = req.body as AdminKeywordFeedbackBody;
  const { response, trackedKeyword } = saveKeywordFeedback({
    workspaceId: ws.id,
    keyword,
    status,
    reason,
    source,
    declinedBy,
  });

  if (trackedKeyword) {
    addActivity(ws.id, 'rank_tracking_updated', 'Tracked keyword approved', `"${trackedKeyword}" added to rank tracking from keyword approval`, {
      keyword: trackedKeyword,
      source: response.source,
      action: 'feedback_approved',
    });
    broadcastToWorkspace(ws.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
      keyword: trackedKeyword,
      action: 'feedback_approved',
      source: 'admin_feedback',
    });
  }

  log.info(`Keyword feedback: "${response.keyword}" → ${status} for workspace ${ws.id}${reason ? ` (reason: ${reason})` : ''}`);
  notifyKeywordFeedbackChanged(ws.id, { keyword: response.keyword, status: response.status, source: response.source });
  res.json(response);
});

// Bulk feedback (approve/decline multiple keywords at once)
// activity-ok: keyword approve/decline is transient feedback state; approved tracking writes are logged separately.
router.post('/api/webflow/keyword-feedback/:workspaceId/bulk', requireWorkspaceAccess('workspaceId'), validate(adminBulkKeywordFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keywords, declinedBy } = req.body as AdminBulkKeywordFeedbackBody;
  const { response, trackedKeywords } = saveBulkKeywordFeedback({
    workspaceId: ws.id,
    keywords,
    declinedBy,
  });

  log.info(`Bulk keyword feedback: ${keywords.length} keywords for workspace ${ws.id}`);
  notifyKeywordFeedbackChanged(ws.id, { updated: response.updated });
  if (trackedKeywords.length > 0) {
    addActivity(ws.id, 'rank_tracking_updated', 'Tracked keywords approved', `${trackedKeywords.length} approved keywords added to rank tracking`, {
      keywords: trackedKeywords,
      count: trackedKeywords.length,
      action: 'feedback_bulk_approved',
    });
    broadcastToWorkspace(ws.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
      action: 'feedback_bulk_approved',
      source: 'admin_feedback',
      keywords: trackedKeywords,
      count: trackedKeywords.length,
    });
  }
  res.json(response);
});

// Delete feedback (un-decline a keyword)
// broadcast-ok: notifyKeywordFeedbackChanged broadcasts strategy/signal invalidation after real feedback deletes.
// activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event.
router.delete('/api/webflow/keyword-feedback/:workspaceId/:keyword', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const result = clearKeywordFeedback(ws.id, decodeURIComponent(req.params.keyword));
  notifyKeywordFeedbackChanged(ws.id, {
    keyword: result.deleted,
    status: 'cleared',
    previousStatus: result.previousStatus,
    source: result.source,
  });
  res.json(result);
});

// --- Intelligence Signals ---
// GET /api/webflow/keyword-strategy/:workspaceId/signals

router.get('/api/webflow/keyword-strategy/:workspaceId/signals', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const insights = getInsights(ws.id);
    try {
      const intelligence = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext', 'clientSignals'] });
      const keywordEvaluationContext = buildStrategyKeywordEvaluationContext({
        workspaceId: ws.id,
        workspaceName: ws.name,
        businessContext: ws.keywordStrategy?.businessContext,
        seoContext: intelligence.seoContext,
        clientSignals: intelligence.clientSignals,
        declinedKeywords: [...new Set([...(intelligence.clientSignals?.keywordFeedback.rejected ?? []), ...getDeclinedKeywords(ws.id)])],
        requestedKeywords: getRequestedKeywords(ws.id),
        approvedKeywords: intelligence.clientSignals?.keywordFeedback.approved ?? [],
        strictBusinessFit: true,
      });
      const signals = buildStrategySignals(insights, { keywordEvaluationContext });
      return res.json({ signals });
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'Failed to build keyword context for strategy signals; returning unfiltered signals');
      return res.json({ signals: buildStrategySignals(insights) });
    }
  } catch (err) {
    log.error({ err, workspaceId: ws.id }, 'Failed to build strategy signals');
    res.json({ signals: [] });
  }
});

export default router;
