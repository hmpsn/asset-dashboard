/**
 * Diagnostic report routes — list and detail endpoints.
 * The job creation endpoint is in jobs.ts (POST /api/jobs with type 'deep-diagnostic').
 */

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { listDiagnosticReports, getDiagnosticReport, getReportForInsight } from '../diagnostic-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:diagnostics');
const router = Router();

// List diagnostic reports for a workspace
router.get('/api/workspaces/:workspaceId/diagnostics', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Feature not enabled' });
  const reports = listDiagnosticReports(req.params.workspaceId);
  res.json({ reports });
});

// Get a specific diagnostic report — literal segment ('by-insight') must be before the param route
router.get('/api/workspaces/:workspaceId/diagnostics/by-insight/:insightId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.json({ report: null });
  const report = getReportForInsight(req.params.workspaceId, req.params.insightId);
  res.json({ report });
});

router.get('/api/workspaces/:workspaceId/diagnostics/:reportId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  if (!isFeatureEnabled('deep-diagnostics')) return res.status(403).json({ error: 'Feature not enabled' });
  const report = getDiagnosticReport(req.params.reportId);
  if (!report || report.workspaceId !== req.params.workspaceId) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.json({ report });
});

void log; // referenced for consistency with other route modules

export default router;
