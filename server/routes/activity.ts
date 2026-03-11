/**
 * activity routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity, listActivity, listClientActivity } from '../activity-log.js';

// --- Activity Log ---
// Public: client views activity for their workspace
router.get('/api/public/activity/:workspaceId', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(listClientActivity(req.params.workspaceId, limit));
});

// Internal: list activity (optionally filtered by workspace)
router.get('/api/activity', (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(listActivity(wsId, limit));
});

// Internal: manually add an activity entry
router.post('/api/activity', (req, res) => {
  const { workspaceId, type, title, description } = req.body;
  if (!workspaceId || !type || !title) return res.status(400).json({ error: 'workspaceId, type, and title required' });
  const entry = addActivity(workspaceId, type, title, description);
  res.json(entry);
});

export default router;
