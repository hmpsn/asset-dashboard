import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { buildIssueLenses } from '../strategy-issue-lenses.js';
import { createLogger } from '../logger.js';

const log = createLogger('strategy-issue-lenses-routes');
const router = Router();

// GET /api/workspaces/:workspaceId/issue-lenses — The Issue Phase 5 four-jobs lenses.
// ADMIN read-projection of the curated rec set (keyword targets + content work-orders). Read-only;
// no writes, no broadcasts. requireWorkspaceAccess (NOT requireAuth — admin HMAC auth path).
router.get(
  '/api/workspaces/:workspaceId/issue-lenses',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    // Express never matches the `:workspaceId` segment empty, so the param is always a non-empty
    // string here — no guard needed.
    const { workspaceId } = req.params;
    try {
      const lenses = buildIssueLenses(workspaceId);
      res.json(lenses);
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to build issue lenses');
      res.status(500).json({ error: 'Failed to build issue lenses' });
    }
  },
);

export default router;
