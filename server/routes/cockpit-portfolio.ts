/**
 * cockpit-portfolio routes — cross-workspace Command Center read model
 *
 * @reads workspaces, requests, content_requests, activities, churn_signals, work_orders, content_matrices, rank_tracking, content_decay, audit_snapshots, admin_money_frames, content_posts
 * @writes none
 */
import { Router } from 'express';
import type { Request } from 'express';
import { buildCockpitPortfolio } from '../domains/cockpit-portfolio.js';
import { createLogger } from '../logger.js';
import { listWorkspaces } from '../workspaces.js';
import type { Workspace } from '../workspaces.js';

const log = createLogger('cockpit-portfolio-route');
const router = Router();

function listVisibleWorkspaces(req: Request): Workspace[] {
  const workspaces = listWorkspaces();
  if (!req.user || req.user.role === 'owner') return workspaces;
  const allowed = new Set(req.user.workspaceIds ?? []);
  return workspaces.filter(workspace => allowed.has(workspace.id));
}

router.get('/api/cockpit/portfolio', async (req, res) => {
  try {
    res.json(buildCockpitPortfolio(listVisibleWorkspaces(req)));
  } catch (err) {
    log.error({ err }, 'Failed to build cockpit portfolio');
    res.status(500).json({ error: 'Failed to build cockpit portfolio' });
  }
});

export default router;
