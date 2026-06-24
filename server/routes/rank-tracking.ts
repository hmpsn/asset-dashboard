/**
 * rank-tracking routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { requireAuthenticatedClientPortalAuth } from '../middleware.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import {
  getTrackedKeywords,
  addTrackedKeyword,
  togglePinKeyword,
  storeRankSnapshot,
  getRankHistory,
  getLatestRanks,
} from '../rank-tracking.js';
import { getSearchOverview } from '../search-console.js';
import { getWorkspace, computeEffectiveTier } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { GSC_METRIC_WINDOW_DAYS } from '../../shared/keyword-window.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { createJob, hasActiveJob, registerAbort, updateJob } from '../jobs.js';
import { assertCreditBudget, CreditBudgetError } from '../credit-budget-gate.js';
import { runNationalSerpRefreshJob } from '../national-serp.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { createLogger } from '../logger.js';

const router = Router();
const log = createLogger('rank-tracking-routes');

function parseHistoryLimit(rawLimit: unknown): number | null {
  if (rawLimit == null) return 90;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) return null;
  return limit;
}

function normalizeKeywordQuery(query: string): string {
  return keywordComparisonKey(query);
}

function sameKeyword(a: string, b: string): boolean {
  return normalizeKeywordQuery(a) === normalizeKeywordQuery(b);
}

function collectQueryParamValues(rawValue: unknown): string[] {
  if (typeof rawValue === 'string') return [rawValue];
  if (Array.isArray(rawValue)) return rawValue.flatMap(collectQueryParamValues);
  return [];
}

function parseHistoryQueryFilters(query: Record<string, unknown>): string[] | undefined {
  const repeatedQueries = collectQueryParamValues(query.query)
    .map(value => value.trim())
    .filter(Boolean);
  if (repeatedQueries.length > 0) return repeatedQueries;

  const legacyQueries = collectQueryParamValues(query.queries)
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
  return legacyQueries.length > 0 ? legacyQueries : undefined;
}

// --- Rank Tracking ---
// Get tracked keywords for a workspace
router.get('/api/rank-tracking/:workspaceId/keywords', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getTrackedKeywords(req.params.workspaceId));
});

// Add a tracked keyword
router.post('/api/rank-tracking/:workspaceId/keywords', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { query, pinned } = req.body;
  if (typeof query !== 'string') return res.status(400).json({ error: 'query required' });
  const normalizedQuery = normalizeKeywordQuery(query);
  if (!normalizedQuery) return res.status(400).json({ error: 'query required' });
  const wasTracked = getTrackedKeywords(req.params.workspaceId).some(keyword => sameKeyword(keyword.query, query));
  const keywords = addTrackedKeyword(req.params.workspaceId, query.trim(), {
    pinned: Boolean(pinned),
    source: TRACKED_KEYWORD_SOURCE.MANUAL,
  });
  if (!wasTracked) {
    addActivity(req.params.workspaceId, 'rank_tracking_updated', 'Tracked keyword added', `"${normalizedQuery}" added to rank tracking`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, { keyword: normalizedQuery, action: 'added', source: 'manual' });
  }
  res.json(keywords);
});

// Remove a tracked keyword
// Toggle pin on a tracked keyword
router.patch('/api/rank-tracking/:workspaceId/keywords/:query/pin', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const query = decodeURIComponent(req.params.query);
  const normalizedQuery = normalizeKeywordQuery(query);
  const wasTracked = getTrackedKeywords(req.params.workspaceId).some(keyword => sameKeyword(keyword.query, query));
  const keywords = togglePinKeyword(req.params.workspaceId, query);
  if (wasTracked) {
    addActivity(req.params.workspaceId, 'rank_tracking_updated', 'Tracked keyword pin updated', `"${normalizedQuery}" pin status changed`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, { keyword: normalizedQuery, action: 'pin_toggled', source: 'manual' });
  }
  res.json(keywords);
});

// Capture a rank snapshot from current GSC data
router.post('/api/rank-tracking/:workspaceId/snapshot', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws?.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property linked' });
    if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked — connect a site in Workspace Settings to enable rank tracking' });
    // Use the SAME window as the daily scheduler (GSC_METRIC_WINDOW_DAYS) so a
    // manual capture cannot silently swing the displayed clicks/impressions vs
    // the scheduled snapshot — both UPSERT into rank_snapshots under the same
    // date key (kills the ~4× swing the 7-vs-28 mismatch caused).
    const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, GSC_METRIC_WINDOW_DAYS);
    const date = new Date().toISOString().split('T')[0];
    const queries = overview.topQueries.map(q => ({
      query: q.query, position: q.position, clicks: q.clicks, impressions: q.impressions, ctr: q.ctr,
    }));
    storeRankSnapshot(req.params.workspaceId, date, queries);
    addActivity(req.params.workspaceId, 'rank_snapshot', 'Rank snapshot captured', `${queries.length} keyword positions recorded for ${date}`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, { action: 'snapshot', count: queries.length, date });
    res.json({ date, count: queries.length });
  } catch (err) {
    next(err);
  }
});

// Trigger a national SERP rank refresh (SEO Decision Engine P6 / national-serp-tracking).
// Manual-trigger for P6 (no cron in this unit). Gated: feature flag → tier (Growth+) →
// observe-only budget gate → global + per-workspace job serialization. Fire-and-forget.
router.post('/api/rank-tracking/:workspaceId/refresh-national', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;

  // Flag gate — when off, the route does no work and returns a clean "not enabled" 404.
  if (!isFeatureEnabled('national-serp-tracking', workspaceId)) {
    return res.status(404).json({ error: 'National SERP tracking is not enabled' });
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Tier gate — Growth + Premium only (owner decision); Free is excluded.
  const tier = computeEffectiveTier(ws);
  if (tier !== 'growth' && tier !== 'premium') {
    return res.status(403).json({ error: 'National SERP tracking requires a Growth or Premium plan' });
  }

  // P5 budget gate at route entry — observe-only at launch (logs the would-block, returns).
  // Wrapped so that if enforcement is later enabled, an over-budget workspace is logged and
  // the refresh still proceeds (enforcement posture for this route is observe-only by decision).
  try {
    assertCreditBudget(workspaceId, 'national_serp', tier);
  } catch (err) {
    if (err instanceof CreditBudgetError) {
      log.warn({ workspaceId, tier }, 'national-serp refresh: credit budget would-block at route entry (proceeding — observe-only)');
    } else {
      throw err;
    }
  }

  // Per-workspace serialization.
  const active = hasActiveJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, workspaceId);
  if (active) return res.status(409).json({ error: 'A national SERP refresh is already running for this workspace', jobId: active.id });

  // Global cross-workspace coalescing — each refresh holds advanced-SERP responses in memory;
  // on memory-constrained hosts concurrent refreshes from different workspaces stack and OOM the
  // process. Serialize globally: only one national SERP refresh runs at a time platform-wide.
  const globalActive = hasActiveJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH);
  if (globalActive) {
    return res.status(409).json({
      error: 'Another workspace is currently running a national SERP refresh — please wait for it to complete',
      jobId: globalActive.id,
      blockingWorkspaceId: globalActive.workspaceId,
    });
  }

  const job = createJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, {
    workspaceId,
    message: 'Preparing national SERP rank refresh...',
  });
  registerAbort(job.id);
  res.json({ jobId: job.id });
  // .catch() (not void) so any unexpected throw becomes a logged error + failed job rather than
  // an unhandled rejection that crashes the process.
  runNationalSerpRefreshJob(workspaceId, job.id).catch(err => {
    log.error({ err, jobId: job.id, workspaceId }, 'national-serp refresh: unhandled error escaped job runner — marking failed');
    updateJob(job.id, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'National SERP refresh failed unexpectedly',
    });
  });
});

// Get rank history (for charting)
router.get('/api/rank-tracking/:workspaceId/history', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const limit = parseHistoryLimit(req.query.limit);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  const queries = parseHistoryQueryFilters(req.query);
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Get latest ranks with change indicators
router.get('/api/rank-tracking/:workspaceId/latest', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

// Public: client can view rank history. requireAuthenticatedClientPortalAuth
// guarantees an authenticated session even on workspaces with no
// clientPassword set — without it, the global app gate at server/app.ts:262
// would short-circuit on passwordless workspaces and leak rank data.
router.get('/api/public/rank-tracking/:workspaceId/history', requireAuthenticatedClientPortalAuth(), (req, res) => {
  const limit = parseHistoryLimit(req.query.limit);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  const queries = parseHistoryQueryFilters(req.query);
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Public: client can view latest ranks
router.get('/api/public/rank-tracking/:workspaceId/latest', requireAuthenticatedClientPortalAuth(), (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

export default router;
