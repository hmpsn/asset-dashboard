/**
 * activity routes — extracted from server/index.ts
 */
import { Router } from 'express';
import { requireClientPortalAuth } from '../middleware.js';
import { requireWorkspaceAccessFromBody, requireWorkspaceAccessFromQuery } from '../auth.js';

const router = Router();

import { addActivity, listActivity, listClientActivity } from '../activity-log.js';

function parseLimit(rawLimit: unknown): number | null {
  if (rawLimit == null) return 50;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) return null;
  return limit;
}

// --- Activity Log ---
// Public: client views activity for their workspace
router.get('/api/public/activity/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const limit = parseLimit(req.query.limit);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  res.json(listClientActivity(req.params.workspaceId, limit));
});

// Internal: list activity (optionally filtered by workspace)
router.get('/api/activity', requireWorkspaceAccessFromQuery(), (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  const limit = parseLimit(req.query.limit);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  res.json(listActivity(wsId, limit));
});

// Internal: manually add an activity entry
router.post('/api/activity', requireWorkspaceAccessFromBody(), (req, res) => {
  const { workspaceId, type, title, description } = req.body;
  if (!workspaceId || !type || !title) return res.status(400).json({ error: 'workspaceId, type, and title required' });
  const entry = addActivity(workspaceId, type, title, description);
  res.json(entry);
});

export default router;
