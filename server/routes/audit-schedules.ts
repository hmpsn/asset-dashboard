/**
 * audit-schedules routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import {
  getSchedule,
  listSchedules,
  upsertSchedule,
  deleteSchedule,
} from '../scheduled-audits.js';

// --- Scheduled Audits ---
router.get('/api/audit-schedules', (_req, res) => {
  res.json(listSchedules());
});

router.get('/api/audit-schedules/:workspaceId', (req, res) => {
  const schedule = getSchedule(req.params.workspaceId);
  if (!schedule) return res.status(404).json({ error: 'No schedule found' });
  res.json(schedule);
});

router.put('/api/audit-schedules/:workspaceId', (req, res) => {
  const { enabled, intervalDays, scoreDropThreshold } = req.body;
  const schedule = upsertSchedule(req.params.workspaceId, { enabled, intervalDays, scoreDropThreshold });
  res.json(schedule);
});

router.delete('/api/audit-schedules/:workspaceId', (req, res) => {
  deleteSchedule(req.params.workspaceId);
  res.json({ ok: true });
});

export default router;
