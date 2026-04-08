import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { getMeetingBrief } from '../meeting-brief-store.js';
import { generateMeetingBrief } from '../meeting-brief-generator.js';
import { createLogger } from '../logger.js';

const log = createLogger('meeting-brief-routes');
const router = Router();

// GET /api/workspaces/:workspaceId/meeting-brief — fetch stored brief (null if none)
router.get(
  '/api/workspaces/:workspaceId/meeting-brief',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      const brief = getMeetingBrief(req.params.workspaceId);
      res.json({ brief });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to fetch meeting brief');
      res.status(500).json({ error: msg });
    }
  },
);

// POST /api/workspaces/:workspaceId/meeting-brief/generate — generate new brief
// Literal segment 'generate' registered before any deeper param routes (route ordering rule)
router.post(
  '/api/workspaces/:workspaceId/meeting-brief/generate',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const brief = await generateMeetingBrief(workspaceId);
      res.json({ brief });
    } catch (err) {
      if (err instanceof Error && err.message === 'BRIEF_UNCHANGED') {
        const existing = getMeetingBrief(workspaceId);
        res.json({ brief: existing, unchanged: true });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, workspaceId }, 'Failed to generate meeting brief');
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
