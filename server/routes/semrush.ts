/**
 * semrush routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { isSemrushConfigured, estimateCreditCost, clearSemrushCache } from '../semrush.js';

// --- SEMRush Utilities ---
router.get('/api/semrush/status', (_req, res) => {
  res.json({ configured: isSemrushConfigured() });
});

router.post('/api/semrush/estimate', (req, res) => {
  const { mode, competitorCount, keywordCount } = req.body;
  res.json({ credits: estimateCreditCost({ mode: mode || 'quick', competitorCount, keywordCount }) });
});

router.delete('/api/semrush/cache/:workspaceId', (req, res) => {
  clearSemrushCache(req.params.workspaceId);
  res.json({ ok: true });
});

export default router;
