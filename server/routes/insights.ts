import { Router } from 'express';
import { z } from '../middleware/validate.js';
import { validate } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
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

// PUT /api/insights/:insightId/resolve — mark insight in_progress or resolved
router.put(
  '/api/insights/:insightId/resolve',
  validate(z.object({ body: z.object({ workspaceId: z.string(), status: z.enum(['in_progress', 'resolved']), note: z.string().optional() }) })),
  (req, res) => {
    const { workspaceId, status, note } = req.body as { workspaceId: string; status: 'in_progress' | 'resolved'; note?: string };
    const updated = resolveInsight(req.params.insightId, workspaceId, status, note);
    if (!updated) return res.status(404).json({ error: 'Insight not found' });
    addActivity(workspaceId, `Insight ${status}: ${note ?? ''}`);
    broadcastToWorkspace(workspaceId, 'insight_resolved', { insightId: req.params.insightId, status });
    res.json(updated);
  },
);

export default router;
