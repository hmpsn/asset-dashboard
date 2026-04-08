import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { aiLimiter } from '../middleware.js';
import { getMeetingBrief } from '../meeting-brief-store.js';
import { generateMeetingBrief } from '../meeting-brief-generator.js';
import { addActivity } from '../activity-log.js';
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
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to fetch meeting brief');
      res.status(500).json({ error: 'Failed to fetch meeting brief' });
    }
  },
);

// POST /api/workspaces/:workspaceId/meeting-brief/generate — generate new brief
// Literal segment 'generate' registered before any deeper param routes (route ordering rule)
router.post(
  '/api/workspaces/:workspaceId/meeting-brief/generate',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const brief = await generateMeetingBrief(workspaceId);
      addActivity(workspaceId, 'meeting_brief_generated', 'Meeting brief generated');
      res.json({ brief });
    } catch (err) {
      if (err instanceof Error && err.message === 'BRIEF_UNCHANGED') {
        try {
          const existing = getMeetingBrief(workspaceId);
          res.json({ brief: existing, unchanged: true });
        } catch (readErr) {
          log.error({ readErr, workspaceId }, 'Failed to read cached brief after BRIEF_UNCHANGED');
          res.status(500).json({ error: 'Failed to generate meeting brief' });
        }
        return;
      }
      log.error({ err, workspaceId }, 'Failed to generate meeting brief');
      res.status(500).json({ error: 'Failed to generate meeting brief' });
    }
  },
);

export default router;
