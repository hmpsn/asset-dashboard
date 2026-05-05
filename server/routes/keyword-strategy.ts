/**
 * keyword-strategy routes — extracted from server/index.ts
 *
 * @reads workspaces, page_keywords, strategy_history, keyword_feedback, snapshots, search_console, google_analytics, seo_provider, workspace_intelligence, workspace_pages, analytics_insights
 * @writes page_keywords, strategy_history, keyword_feedback, tracked_keywords, workspaces, usage_tracking, intelligence_cache
 */
import { Router } from 'express';

const router = Router();

import { addTrackedKeyword } from '../rank-tracking.js';
import { clearSeoContextCache } from '../seo-context.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { upsertAndCleanPageKeywords, listPageKeywords } from '../page-keywords.js';
import { validate, z } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { getInsights } from '../analytics-insights-store.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';
import { buildStrategySignals } from '../insight-feedback.js';
import { requireWorkspaceAccess } from '../auth.js';
import { isProgrammingError } from '../errors.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { hasActiveJob } from '../jobs.js';
import { generateKeywordStrategy, KeywordStrategyGenerationError } from '../keyword-strategy-generation.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
export { buildStrategyIntelligenceBlock, computeOpportunityScore, shouldFetchCompetitorData } from '../keyword-strategy-generation.js';

const log = createLogger('keyword-strategy');

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
      semrushMode: typeof req.body?.semrushMode === 'string' ? req.body.semrushMode : undefined,
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
  if (!strategy && pageMap.length === 0) return res.json(null);
  if (!strategy) {
    return res.json({
      siteKeywords: [],
      opportunities: [],
      pageMap,
      generatedAt: null,
    });
  }
  res.json({ ...strategy, pageMap });
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

  const prevGapKws = new Set<string>((prevStrategy.contentGaps || []).map((g: { targetKeyword: string }) => g.targetKeyword));
  const currGapKws = new Set<string>((current.contentGaps || []).map((g: { targetKeyword: string }) => g.targetKeyword));
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
  quickWins: z.array(z.any()).optional(),
  opportunities: z.array(z.string()).optional(),
}).strict();

router.patch('/api/webflow/keyword-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(patchStrategySchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  // If pageMap is being updated, save to dedicated table
  if (req.body.pageMap) {
    upsertAndCleanPageKeywords(ws.id, req.body.pageMap);
    // Bridge #5: page keywords replaced — invalidate page caches
    debouncedPageAnalysisInvalidate(ws.id, () => {
      clearSeoContextCache(ws.id);
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
      invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
    });
  }
  // Save non-pageMap fields to workspace blob.
  // Guard: if the workspace has no existing strategy blob AND the patch only updates pageMap
  // (no siteKeywords/opportunities/etc.), don't silently fabricate a blob with just a timestamp —
  // that would promote a shell-state workspace to a "real" strategy without any AI-generated content.
  // This matters for callers like PageIntelligence that only patch pageMap.
  const { pageMap: _pm, ...rest } = req.body;
  const hasBlobFields = Object.keys(rest).length > 0;
  const blobExists = ws.keywordStrategy != null;
  let updated: KeywordStrategy | null = null;
  if (hasBlobFields || blobExists) {
    // Only bump generatedAt when strategy-level fields change. A pure-pageMap patch on an
    // existing blob should preserve the original generation timestamp — otherwise the
    // KeywordStrategy panel misleadingly shows "Generated [today]" for every per-page edit.
    const preservedGeneratedAt = blobExists && !hasBlobFields
      ? ws.keywordStrategy?.generatedAt
      : undefined;
    updated = {
      ...(ws.keywordStrategy || {}),
      ...rest,
      generatedAt: preservedGeneratedAt ?? new Date().toISOString(),
    } as KeywordStrategy;
    updateWorkspace(ws.id, { keywordStrategy: updated });
  }
  clearSeoContextCache(ws.id);
  invalidateIntelligenceCache(ws.id);
  // Broadcast strategy update so other surfaces (PageIntelligence, SeoEditor, other tabs)
  // invalidate their React Query caches. Without this, pageMap edits from PageIntelligence
  // leave KeywordStrategy/SeoEditor showing stale pageMap until staleTime expires.
  const responsePageMap = listPageKeywords(ws.id);
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
    res.json({ ...updated, pageMap: responsePageMap });
  } else {
    res.json({
      siteKeywords: [],
      opportunities: [],
      pageMap: responsePageMap,
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
const feedbackSchema = z.object({
  keyword: z.string().min(1),
  status: z.enum(['approved', 'declined', 'requested']),
  reason: z.string().optional(),
  source: z.enum(['content_gap', 'page_map', 'opportunity', 'topic_cluster', 'keyword_gap']).optional(),
  declinedBy: z.string().optional(),
});

// broadcast-ok: keyword feedback is internal bookkeeping, not workspace content — no real-time update needed // activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.post('/api/webflow/keyword-feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(feedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source, declinedBy } = req.body;
  const kw = keyword.toLowerCase().trim();

  db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `).run(ws.id, kw, status, reason || null, source || 'content_gap', declinedBy || null);

  if (status === 'approved') addTrackedKeyword(ws.id, kw);

  log.info(`Keyword feedback: "${kw}" → ${status} for workspace ${ws.id}${reason ? ` (reason: ${reason})` : ''}`);
  res.json({ keyword: kw, status, reason: reason || null });
});

// Bulk feedback (approve/decline multiple keywords at once)
const bulkFeedbackSchema = z.object({
  keywords: z.array(z.object({
    keyword: z.string().min(1),
    status: z.enum(['approved', 'declined', 'requested']),
    reason: z.string().optional(),
    source: z.string().optional(),
  })).min(1).max(100),
  declinedBy: z.string().optional(),
});

// broadcast-ok: keyword feedback is internal bookkeeping, not workspace content — no real-time update needed // activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.post('/api/webflow/keyword-feedback/:workspaceId/bulk', requireWorkspaceAccess('workspaceId'), validate(bulkFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const stmt = db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `);

  const insert = db.transaction((items: typeof req.body.keywords) => {
    for (const item of items) {
      stmt.run(ws.id, item.keyword.toLowerCase().trim(), item.status, item.reason || null, item.source || 'content_gap', req.body.declinedBy || null);
    }
  });
  insert(req.body.keywords);

  for (const item of req.body.keywords) {
    if (item.status === 'approved') addTrackedKeyword(ws.id, item.keyword.toLowerCase().trim());
  }

  log.info(`Bulk keyword feedback: ${req.body.keywords.length} keywords for workspace ${ws.id}`);
  res.json({ updated: req.body.keywords.length });
});

// Delete feedback (un-decline a keyword)
// broadcast-ok: keyword feedback is internal bookkeeping, not workspace content — no real-time update needed // activity-ok: keyword approve/decline is transient feedback state, not a workspace activity event
router.delete('/api/webflow/keyword-feedback/:workspaceId/:keyword', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const kw = decodeURIComponent(req.params.keyword).toLowerCase().trim();
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').run(ws.id, kw);
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
