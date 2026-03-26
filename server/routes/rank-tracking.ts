/**
 * rank-tracking routes — extracted from server/index.ts
 */
import { Router } from 'express';
import { addActivity } from '../activity-log.js';
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
import { requireWorkspaceAccess } from '../auth.js';

const router = Router();

// --- Rank Tracking ---
// Get tracked keywords for a workspace
router.get('/api/rank-tracking/:workspaceId/keywords', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getTrackedKeywords(req.params.workspaceId));
});

// Add a tracked keyword
router.post('/api/rank-tracking/:workspaceId/keywords', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { query, pinned } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  res.json(addTrackedKeyword(req.params.workspaceId, query, pinned));
});

// Remove a tracked keyword
router.delete('/api/rank-tracking/:workspaceId/keywords/:query', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(removeTrackedKeyword(req.params.workspaceId, decodeURIComponent(req.params.query)));
});

// Toggle pin on a tracked keyword
router.patch('/api/rank-tracking/:workspaceId/keywords/:query/pin', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(togglePinKeyword(req.params.workspaceId, decodeURIComponent(req.params.query)));
});

// Capture a rank snapshot from current GSC data
router.post('/api/rank-tracking/:workspaceId/snapshot', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws?.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property linked' });
    const overview = await getSearchOverview(ws.id, ws.gscPropertyUrl, 7);
    const date = new Date().toISOString().split('T')[0];
    const queries = overview.topQueries.map(q => ({
      query: q.query, position: q.position, clicks: q.clicks, impressions: q.impressions, ctr: q.ctr,
    }));
    storeRankSnapshot(req.params.workspaceId, date, queries);
    addActivity(req.params.workspaceId, 'rank_snapshot', 'Rank snapshot captured', `${queries.length} keyword positions recorded for ${date}`);
    res.json({ date, count: queries.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to capture snapshot' });
  }
});

// Get rank history (for charting)
router.get('/api/rank-tracking/:workspaceId/history', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const limit = parseInt(req.query.limit as string) || 90;
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Get latest ranks with change indicators
router.get('/api/rank-tracking/:workspaceId/latest', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

// Public: client can view rank history
router.get('/api/public/rank-tracking/:workspaceId/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 90;
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Public: client can view latest ranks
router.get('/api/public/rank-tracking/:workspaceId/latest', (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

export default router;
