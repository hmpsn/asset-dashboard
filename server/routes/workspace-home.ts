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
import { listMatrices } from '../content-matrices.js';
import { listTemplates } from '../content-templates.js';
import { loadDecayAnalysis } from '../content-decay.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-home');
import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

/**
 * GET /api/workspace-home/:id
 *
 * Returns all data the WorkspaceHome dashboard needs in a single response,
 * eliminating 10+ parallel client-side fetches.
 */
router.get('/api/workspace-home/:id', requireWorkspaceAccess(), async (req, res) => {
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
    matrices,
    templates,
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
    safe(Promise.resolve(listMatrices(req.params.id)), []),
    safe(Promise.resolve(listTemplates(req.params.id)), []),
  ]);

  // Content decay — synchronous SQLite read, wrapped for safety
  let contentDecay = null;
  try { contentDecay = loadDecayAnalysis(req.params.id)?.summary ?? null; } catch (err) { log.warn({ err }, 'workspace-home partial fetch failed'); }

  // Weekly accomplishments — aggregate activity from last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentActivity = (activity as Array<{ type: string; createdAt: string }>)
    .filter(a => new Date(a.createdAt) >= sevenDaysAgo);
  const weeklySummary = {
    seoUpdates: recentActivity.filter(a => a.type === 'seo_updated' || a.type === 'approval_applied').length,
    auditsRun: recentActivity.filter(a => a.type === 'audit_completed').length,
    contentGenerated: recentActivity.filter(a => a.type === 'brief_generated' || a.type === 'post_generated').length,
    contentPublished: recentActivity.filter(a => a.type === 'content_published').length,
    requestsResolved: recentActivity.filter(a => a.type === 'request_resolved').length,
  };
  const weeklyTotal = Object.values(weeklySummary).reduce((s, n) => s + n, 0);

  // Derive content pipeline summary
  const allCells = (matrices as Array<{ cells?: Array<{ status: string }> }>).flatMap(m => m.cells || []);
  const contentPipeline = {
    templateCount: (templates as unknown[]).length,
    matrixCount: (matrices as unknown[]).length,
    totalCells: allCells.length,
    publishedCells: allCells.filter(c => c.status === 'published').length,
    reviewCells: allCells.filter(c => c.status === 'review' || c.status === 'flagged').length,
    approvedCells: allCells.filter(c => c.status === 'approved').length,
    inProgressCells: allCells.filter(c => c.status === 'brief_generated' || c.status === 'in_progress').length,
  };

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
    contentPipeline,
    contentDecay,
    weeklySummary: weeklyTotal > 0 ? weeklySummary : null,
  });
});

export default router;
