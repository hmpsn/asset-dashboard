/**
 * churn-signals routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { listChurnSignals, dismissSignal, getSignal } from '../churn-signals.js';

// --- Churn Prevention Signals (admin) ---
router.get('/api/churn-signals', (_req, res) => {
  res.json(listChurnSignals());
});

router.get('/api/churn-signals/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listChurnSignals(req.params.workspaceId));
});

router.post('/api/churn-signals/:signalId/dismiss', (req, res) => {
  const signal = getSignal(req.params.signalId);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  const ok = dismissSignal(signal.workspaceId, req.params.signalId);
  if (!ok) return res.status(404).json({ error: 'Signal not found' });
  res.json({ dismissed: true });
});

export default router;
