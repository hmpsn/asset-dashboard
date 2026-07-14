import { Router } from 'express';

import { getClientBrandSummary } from '../domains/brand/client-summary.js';
import { requireAuthenticatedClientPortalAuth } from '../middleware.js';

const router = Router();

router.get(
  '/api/public/brand-summary/:workspaceId',
  requireAuthenticatedClientPortalAuth('workspaceId'),
  (req, res) => {
    const summary = getClientBrandSummary(req.params.workspaceId);
    if (!summary) return res.status(404).json({ error: 'Workspace not found' });
    return res.json(summary);
  },
);

export default router;
