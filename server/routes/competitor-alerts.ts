import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { listCompetitorAlerts, type CompetitorAlert } from '../competitor-snapshot-store.js';
import { createLogger } from '../logger.js';
import type {
  CompetitorAlertView,
  CompetitorAlertsResponse,
} from '../../shared/types/competitor-alerts.js';

const log = createLogger('competitor-alerts-routes');
const router = Router();

function toView(alert: CompetitorAlert): CompetitorAlertView {
  return {
    id: alert.id,
    competitorDomain: alert.competitorDomain,
    alertType: alert.alertType,
    keyword: alert.keyword ?? null,
    previousPosition: alert.previousPosition ?? null,
    currentPosition: alert.currentPosition ?? null,
    positionChange: alert.positionChange ?? null,
    volume: alert.volume ?? null,
    severity: alert.severity,
    snapshotDate: alert.snapshotDate,
    createdAt: alert.createdAt,
  };
}

// GET /api/workspaces/:workspaceId/competitor-alerts — The Issue Phase 6 admin Competitors page.
// Read-only projection of the competitor_alerts table (written weekly by the competitor-monitoring
// cron), newest-first. No writes, no broadcasts. requireWorkspaceAccess (NOT requireAuth — admin
// HMAC auth path).
router.get(
  '/api/workspaces/:workspaceId/competitor-alerts',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    // Express never matches the `:workspaceId` segment empty, so the param is always a non-empty
    // string here — no guard needed.
    const { workspaceId } = req.params;
    try {
      const alerts = listCompetitorAlerts(workspaceId).map(toView);
      const response: CompetitorAlertsResponse = { workspaceId, alerts };
      res.json(response);
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to list competitor alerts');
      res.status(500).json({ error: 'Failed to list competitor alerts' });
    }
  },
);

export default router;
