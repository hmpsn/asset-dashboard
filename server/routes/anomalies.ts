/**
 * anomalies routes — extracted from server/index.ts
 */
import { Router } from 'express';
import {
  listAnomalies,
  dismissAnomaly,
  acknowledgeAnomaly,
  runAnomalyDetection,
} from '../anomaly-detection.js';
import { requireWorkspaceAccess } from '../auth.js';

const router = Router();

// --- Anomaly Detection ---
router.get('/api/anomalies', (_req, res) => {
  res.json(listAnomalies());
});

router.get('/api/anomalies/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const includeDismissed = req.query.includeDismissed === 'true';
  res.json(listAnomalies(req.params.workspaceId, includeDismissed));
});

router.get('/api/public/anomalies/:workspaceId', (req, res) => {
  res.json(listAnomalies(req.params.workspaceId));
});

router.post('/api/anomalies/:anomalyId/dismiss', (req, res) => {
  const ok = dismissAnomaly(req.params.anomalyId);
  if (!ok) return res.status(404).json({ error: 'Anomaly not found' });
  res.json({ dismissed: true });
});

router.post('/api/anomalies/:anomalyId/acknowledge', (req, res) => {
  const ok = acknowledgeAnomaly(req.params.anomalyId);
  if (!ok) return res.status(404).json({ error: 'Anomaly not found' });
  res.json({ acknowledged: true });
});

router.post('/api/anomalies/scan', async (_req, res) => {
  try {
    const result = await runAnomalyDetection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scan failed' });
  }
});

export default router;
