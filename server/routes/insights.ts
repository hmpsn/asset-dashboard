import { Router } from 'express';
import { z } from '../middleware/validate.js';
import { validate } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { resolveInsight, getUnresolvedInsights } from '../analytics-insights-store.js';

const router = Router();

// GET /api/insights/:workspaceId/queue — admin action queue (unresolved insights)
// Literal 'queue' registered before any deeper param routes
router.get('/api/insights/:workspaceId/queue', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const items = getUnresolvedInsights(req.params.workspaceId);
    res.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// PUT /api/insights/:workspaceId/:insightId/resolve — mark insight in_progress or resolved
// workspaceId in path enables requireWorkspaceAccess authorization middleware
router.put(
  '/api/insights/:workspaceId/:insightId/resolve',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({ status: z.enum(['in_progress', 'resolved']), note: z.string().optional() })),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    const { status, note } = req.body as { status: 'in_progress' | 'resolved'; note?: string };
    const updated = resolveInsight(req.params.insightId, workspaceId, status, note);
    if (!updated) return res.status(404).json({ error: 'Insight not found' });
    addActivity(workspaceId, 'insight_resolved', `Insight ${status}${note ? ': ' + note : ''}`);
    broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_RESOLVED, { insightId: req.params.insightId, status });
    res.json(updated);
  },
);

export default router;
