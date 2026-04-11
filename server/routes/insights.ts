import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { resolveInsight, getUnresolvedInsights } from '../analytics-insights-store.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';

const log = createLogger('insights');

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
  validate(z.object({ status: z.enum(['in_progress', 'resolved']), note: z.string().max(500).optional() })),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    const { status, note } = req.body as { status: 'in_progress' | 'resolved'; note?: string };
    const updated = resolveInsight(req.params.insightId, workspaceId, status, note);
    if (!updated) return res.status(404).json({ error: 'Insight not found' });
    addActivity(workspaceId, 'insight_resolved', `Insight ${status}${note ? ': ' + note : ''}`);
    broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_RESOLVED, { insightId: req.params.insightId, status });
    // Record for outcome tracking — only on resolved, not in_progress; idempotent
    try {
      if (workspaceId && status === 'resolved' && !getActionBySource('insight', req.params.insightId)) {
        const insightData = updated.data as Record<string, unknown> | undefined;
        recordAction({ // recordAction-ok: workspaceId guarded by if condition at line 42
          workspaceId,
          actionType: 'insight_acted_on',
          sourceType: 'insight',
          sourceId: req.params.insightId,
          pageUrl: updated.pageId ?? null,
          targetKeyword: (insightData?.query as string) ?? (insightData?.keyword as string) ?? null,
          baselineSnapshot: {
            captured_at: new Date().toISOString(),
            position: insightData?.currentPosition as number | undefined,
            clicks: insightData?.clicks as number | undefined,
            impressions: insightData?.impressions as number | undefined,
            ctr: insightData?.ctr as number | undefined,
            page_health_score: insightData?.score as number | undefined,
          },
          attribution: 'platform_executed',
        });
      }
    } catch (err) {
      log.warn({ err, insightId: req.params.insightId }, 'Failed to record outcome action for insight');
    }
    res.json(updated);
  },
);

export default router;
