/**
 * workspace-home routes — aggregated endpoint for WorkspaceHome dashboard
 */
import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { getSearchOverview } from '../search-console.js';
import { getGA4Overview, getGA4PeriodComparison } from '../google-analytics.js';
import { getLatestRanks } from '../rank-tracking.js';
import { listRequests } from '../requests.js';
import { listContentRequests } from '../content-requests.js';
import { listActivity } from '../activity-log.js';
import { listAnnotations } from '../annotations.js';
import { listChurnSignals } from '../churn-signals.js';
import { listWorkOrders } from '../work-orders.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-home');
const router = Router();

/**
 * GET /api/workspace-home/:id
 *
 * Returns all data the WorkspaceHome dashboard needs in a single response,
 * eliminating 10+ parallel client-side fetches.
 */
router.get('/api/workspace-home/:id', async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const days = parseInt(req.query.days as string) || 28;

  // Fire all fetches in parallel — each wrapped so a single failure doesn't break the rest
  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    p.catch(err => { log.warn({ err }, 'workspace-home partial fetch failed'); return fallback; });

  const [
    ranks,
    requests,
    contentRequests,
    activity,
    annotations,
    churnSignals,
    workOrders,
    searchData,
    ga4Data,
    comparison,
  ] = await Promise.all([
    safe(Promise.resolve(getLatestRanks(req.params.id)), []),
    safe(Promise.resolve(listRequests(req.params.id)), []),
    safe(Promise.resolve(listContentRequests(req.params.id)), []),
    safe(Promise.resolve(listActivity(req.params.id)), []),
    safe(Promise.resolve(listAnnotations(req.params.id)), []),
    safe(Promise.resolve(listChurnSignals(req.params.id)), []),
    safe(Promise.resolve(listWorkOrders(req.params.id)), []),
    ws.gscPropertyUrl && ws.webflowSiteId
      ? safe(getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, days), null)
      : Promise.resolve(null),
    ws.ga4PropertyId
      ? safe(getGA4Overview(ws.ga4PropertyId, days), null)
      : Promise.resolve(null),
    ws.ga4PropertyId
      ? safe(getGA4PeriodComparison(ws.ga4PropertyId, days), null)
      : Promise.resolve(null),
  ]);

  res.json({
    ranks,
    requests,
    contentRequests,
    activity,
    annotations,
    churnSignals,
    workOrders,
    searchData,
    ga4Data,
    comparison,
  });
});

export default router;
