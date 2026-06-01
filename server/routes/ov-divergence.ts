// server/routes/ov-divergence.ts
// Admin endpoint for reading OV divergence shadow-log rows per workspace.
// NOT under /api/public/ — admin-only, protected by the global APP_PASSWORD gate.
// Pattern follows server/routes/intelligence.ts (requireWorkspaceAccess on :workspaceId).

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { listOvDivergence } from '../ov-divergence.js';

const router = Router();

/**
 * GET /api/ov-divergence/:workspaceId
 *
 * Returns the most recent OV divergence rows for the workspace (default: 20, max: 100).
 * Admin-only — protected by the global APP_PASSWORD gate + requireWorkspaceAccess.
 *
 * Query params:
 *   limit (optional) — number of rows to return (1–100, default 20)
 */
router.get(
  '/api/ov-divergence/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      const { workspaceId } = req.params;
      const rawLimit = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

      const rows = listOvDivergence(workspaceId, limit);
      res.json({ workspaceId, rows, count: rows.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
