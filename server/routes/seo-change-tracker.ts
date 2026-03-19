/**
 * Routes for SEO Change Performance Tracker.
 * Records SEO changes and compares GSC before/after metrics.
 */

import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { getSeoChanges, getSeoChangeImpact, getSchemaImpactSummary } from '../seo-change-tracker.js';
import { createLogger } from '../logger.js';

const log = createLogger('seo-change-tracker');

const router = Router();

// List recent SEO changes for a workspace
router.get('/api/seo-changes/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const changes = getSeoChanges(req.params.workspaceId, limit);
  res.json({ changes });
});

// Get SEO change impact with GSC before/after comparison
router.get('/api/seo-change-impact/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property configured' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const source = req.query.source as string | undefined;
    const impact = await getSeoChangeImpact(
      req.params.workspaceId,
      ws.gscPropertyUrl,
      ws.webflowSiteId,
      limit,
      source || undefined,
    );
    res.json({ impact });
  } catch (err) {
    log.error({ err: err }, 'Error');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch impact data' });
  }
});

// Schema-specific impact summary with aggregate stats
router.get('/api/schema-impact/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property configured' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
    const summary = await getSchemaImpactSummary(
      req.params.workspaceId,
      ws.gscPropertyUrl,
      ws.webflowSiteId,
      limit,
    );
    res.json(summary);
  } catch (err) {
    log.error({ err }, 'Schema impact error');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch schema impact data' });
  }
});

export default router;
