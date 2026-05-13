/**
 * keyword-strategy routes — extracted from server/index.ts
 *
 * @reads workspaces, page_keywords, strategy_history, keyword_feedback, snapshots, search_console, google_analytics, seo_provider, workspace_intelligence, workspace_pages, analytics_insights
 * @writes page_keywords, strategy_history, keyword_feedback, tracked_keywords, workspaces, usage_tracking, intelligence_cache
 */
import { Router } from 'express';

const router = Router();

import { addTrackedKeyword } from '../rank-tracking.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { upsertAndCleanPageKeywords, listPageKeywords } from '../page-keywords.js';
import { listContentGaps, replaceAllContentGaps } from '../content-gaps.js';
import { listQuickWins, replaceAllQuickWins } from '../quick-wins.js';
import { listKeywordGaps, replaceAllKeywordGaps } from '../keyword-gaps.js';
import { listTopicClusters, replaceAllTopicClusters } from '../topic-clusters.js';
import { listCannibalizationIssues, replaceAllCannibalizationIssues } from '../cannibalization-issues.js';
import { validate, z } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { getInsights } from '../analytics-insights-store.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem } from '../../shared/types/workspace.js';
import { buildStrategySignals } from '../insight-feedback.js';
import { requireWorkspaceAccess } from '../auth.js';
import { isProgrammingError } from '../errors.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { hasActiveJob } from '../jobs.js';
import { generateKeywordStrategy, KeywordStrategyGenerationError } from '../keyword-strategy-generation.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  adminBulkKeywordFeedbackSchema,
  adminKeywordFeedbackSchema,
  type AdminBulkKeywordFeedbackBody,
  type AdminKeywordFeedbackBody,
} from '../schemas/keyword-feedback.js';
export { buildStrategyIntelligenceBlock, computeOpportunityScore, shouldFetchCompetitorData } from '../keyword-strategy-generation.js';

const log = createLogger('keyword-strategy');

function readSeoDataMode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidate = (body as { seoDataMode?: unknown; semrushMode?: unknown }).seoDataMode
    ?? (body as { seoDataMode?: unknown; semrushMode?: unknown }).semrushMode;
  return typeof candidate === 'string' ? candidate : undefined;
}

function serializeKeywordStrategy(
  strategy: KeywordStrategy,
  pageMap: ReturnType<typeof listPageKeywords>,
  contentGaps: ContentGap[],
  quickWins: QuickWin[],
  keywordGaps: KeywordGapItem[],
  topicClusters: TopicCluster[],
  cannibalization: CannibalizationItem[],
) {
  // Strip any stale table-backed fields left in the blob in favor of
  // the table-backed sources —
  // the migration on startup removes it from the blob, but be defensive
  // against callers that still mutate the blob in-memory.
  const {
    semrushMode,
    contentGaps: _staleGaps,
    quickWins: _staleQuickWins,
    keywordGaps: _staleKeywordGaps,
    topicClusters: _staleTopicClusters,
    cannibalization: _staleCannibalization,
    ...rest
  } = strategy;
  return {
    ...rest,
    seoDataMode: strategy.seoDataMode ?? semrushMode ?? 'none',
    pageMap,
    contentGaps,
    quickWins,
    keywordGaps,
    topicClusters,
    cannibalization,
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

    const competitorDomainsProvided = Array.isArray(req.body?.competitorDomains);
    const result = await generateKeywordStrategy({
      workspaceId: req.params.workspaceId,
      businessContext: typeof req.body?.businessContext === 'string' ? req.body.businessContext : undefined,
      mode: req.body?.mode === 'incremental' ? 'incremental' : 'full',
      seoDataMode: readSeoDataMode(req.body),
      competitorDomains: competitorDomainsProvided ? req.body.competitorDomains : undefined,
      competitorDomainsProvided,
      maxPages: req.body?.maxPages != null ? Number(req.body.maxPages) : undefined,
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
router.get('/api/webflow/keyword-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const strategy = ws.keywordStrategy;
  const pageMap = listPageKeywords(ws.id);
  const contentGaps = listContentGaps(ws.id);
  const quickWinsFromTable = listQuickWins(ws.id);
  const quickWins = quickWinsFromTable.length > 0 ? quickWinsFromTable : (strategy?.quickWins || []);
  const keywordGapsFromTable = listKeywordGaps(ws.id);
  const keywordGaps = keywordGapsFromTable.length > 0 ? keywordGapsFromTable : (strategy?.keywordGaps || []);
  const topicClustersFromTable = listTopicClusters(ws.id);
  const topicClusters = topicClustersFromTable.length > 0 ? topicClustersFromTable : (strategy?.topicClusters || []);
  const cannibalizationFromTable = listCannibalizationIssues(ws.id);
  const cannibalization = cannibalizationFromTable.length > 0 ? cannibalizationFromTable : (strategy?.cannibalization || []);
  if (!strategy && pageMap.length === 0 && contentGaps.length === 0 && quickWins.length === 0 && keywordGaps.length === 0 && topicClusters.length === 0 && cannibalization.length === 0) return res.json(null);
  if (!strategy) {
    return res.json({
      siteKeywords: [],
      opportunities: [],
      pageMap,
      contentGaps,
      quickWins,
      keywordGaps,
      topicClusters,
      cannibalization,
      generatedAt: null,
    });
  }
  res.json(serializeKeywordStrategy(strategy, pageMap, contentGaps, quickWins, keywordGaps, topicClusters, cannibalization));
});

// Get strategy diff (compare current vs previous)
router.get('/api/webflow/keyword-strategy/:workspaceId/diff', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const current = ws.keywordStrategy;
  if (!current) return res.json(null);

  const prev = db.prepare('SELECT strategy_json, page_map_json, generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 1').get(ws.id) as { strategy_json: string; page_map_json: string; generated_at: string } | undefined;
  if (!prev) return res.json(null);

  type PrevStrategyShape = {
    siteKeywords?: string[];
    contentGaps?: { targetKeyword: string }[];
  };
  const prevStrategy = parseJsonFallback<PrevStrategyShape>(prev.strategy_json, {});
  const prevPageMap = parseJsonFallback<Array<{ pagePath: string; primaryKeyword: string }>>(prev.page_map_json, []);
  const currentPageMap = listPageKeywords(ws.id);

  // Compute diffs
  const prevSiteKws = new Set<string>(prevStrategy.siteKeywords || []);
  const currSiteKws = new Set<string>(current.siteKeywords || []);
  const newKeywords = [...currSiteKws].filter((k: string) => !prevSiteKws.has(k));
  const lostKeywords = [...prevSiteKws].filter((k: string) => !currSiteKws.has(k));

  // Previous gaps come from the history snapshot (which now bakes in the
  // table state at save-time, see keyword-strategy-persistence.ts).
  // Current gaps come from the live content_gaps table — the blob no longer
  // carries them after #365 normalization.
  const currentContentGaps = listContentGaps(ws.id);
  const prevGapKws = new Set<string>((prevStrategy.contentGaps || []).map((g: { targetKeyword: string }) => g.targetKeyword));
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

  res.json({
    previousGeneratedAt: prev.generated_at,
    currentGeneratedAt: current.generatedAt,
    newKeywords,
    lostKeywords,
    newGaps,
    resolvedGaps,
    keywordChanges,
    prevSiteKeywordCount: prevSiteKws.size,
    currSiteKeywordCount: currSiteKws.size,
  });
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
  contentGaps: z.array(z.any()).optional(),
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
  } = applyPatch();
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

/** Get all keyword feedback for a workspace */
function getAllFeedback(workspaceId: string) {
  return db.prepare('SELECT * FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId);
}

// Admin: list all feedback for workspace
router.get('/api/webflow/keyword-feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(getAllFeedback(ws.id));
});

// Admin or client: submit feedback on a keyword
// activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.post('/api/webflow/keyword-feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(adminKeywordFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source, declinedBy } = req.body as AdminKeywordFeedbackBody;
  const kw = keyword.toLowerCase().trim();

  db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `).run(ws.id, kw, status, reason || null, source, declinedBy || null);

  if (status === 'approved') addTrackedKeyword(ws.id, kw);

  log.info(`Keyword feedback: "${kw}" → ${status} for workspace ${ws.id}${reason ? ` (reason: ${reason})` : ''}`);
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { keyword: kw, status, source });
  res.json({ keyword: kw, status, reason: reason || null });
});

// Bulk feedback (approve/decline multiple keywords at once)
// activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.post('/api/webflow/keyword-feedback/:workspaceId/bulk', requireWorkspaceAccess('workspaceId'), validate(adminBulkKeywordFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keywords, declinedBy } = req.body as AdminBulkKeywordFeedbackBody;

  const stmt = db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `);

  const insert = db.transaction((items: AdminBulkKeywordFeedbackBody['keywords']) => {
    for (const item of items) {
      stmt.run(ws.id, item.keyword.toLowerCase().trim(), item.status, item.reason || null, item.source, declinedBy || null);
    }
  });
  insert(keywords);

  for (const item of keywords) {
    if (item.status === 'approved') addTrackedKeyword(ws.id, item.keyword.toLowerCase().trim());
  }

  log.info(`Bulk keyword feedback: ${keywords.length} keywords for workspace ${ws.id}`);
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { updated: keywords.length });
  res.json({ updated: keywords.length });
});

// Delete feedback (un-decline a keyword)
// activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.delete('/api/webflow/keyword-feedback/:workspaceId/:keyword', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const kw = decodeURIComponent(req.params.keyword).toLowerCase().trim();
  const removeFeedback = db.transaction(() => {
    const existing = db.prepare('SELECT keyword, status, source FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').get(ws.id, kw) as { keyword: string; status: string; source: string | null } | undefined; // txn-ok: read-before-delete and delete are enclosed by removeFeedback transaction
    db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').run(ws.id, kw);
    return existing;
  });
  const existing = removeFeedback();
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, { keyword: kw, status: 'cleared', previousStatus: existing?.status ?? null, source: existing?.source ?? null });
  res.json({ deleted: kw });
});

// --- Intelligence Signals ---
// GET /api/webflow/keyword-strategy/:workspaceId/signals

router.get('/api/webflow/keyword-strategy/:workspaceId/signals', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const insights = getInsights(ws.id);
    const signals = buildStrategySignals(insights);
    res.json({ signals });
  } catch (err) {
    log.error({ err, workspaceId: ws.id }, 'Failed to build strategy signals');
    res.json({ signals: [] });
  }
});

export default router;
