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
  removeTrackedKeyword,
  togglePinKeyword,
  storeRankSnapshot,
  getRankHistory,
  getLatestRanks,
} from '../rank-tracking.js';
import { getSearchOverview } from '../search-console.js';
import { getWorkspace } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { GSC_METRIC_WINDOW_DAYS } from '../../shared/keyword-window.js';

const router = Router();

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
router.delete('/api/rank-tracking/:workspaceId/keywords/:query', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const query = decodeURIComponent(req.params.query);
  const normalizedQuery = normalizeKeywordQuery(query);
  const wasTracked = getTrackedKeywords(req.params.workspaceId).some(keyword => sameKeyword(keyword.query, query));
  const keywords = removeTrackedKeyword(req.params.workspaceId, query);
  if (wasTracked) {
    addActivity(req.params.workspaceId, 'rank_tracking_updated', 'Tracked keyword removed', `"${normalizedQuery}" removed from rank tracking`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, { keyword: normalizedQuery, action: 'removed', source: 'manual' });
  }
  res.json(keywords);
});

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

// Get rank history (for charting)
router.get('/api/rank-tracking/:workspaceId/history', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const limit = parseHistoryLimit(req.query.limit);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
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
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Public: client can view latest ranks
router.get('/api/public/rank-tracking/:workspaceId/latest', requireAuthenticatedClientPortalAuth(), (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

export default router;
