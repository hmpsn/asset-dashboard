/**
 * Routes for SEO Change Performance Tracker.
 * Records SEO changes and compares GSC before/after metrics.
 */

import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { getSeoChanges, getSeoChangeImpact, getSchemaImpactSummary } from '../seo-change-tracker.js';
import { createLogger } from '../logger.js';

const log = createLogger('seo-change-tracker');

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

function parseBoundedPositiveIntQuery(rawValue: unknown, fallback: number, max: number): number | null {
  if (rawValue == null) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, max);
}

// List recent SEO changes for a workspace
router.get('/api/seo-changes/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const limit = parseBoundedPositiveIntQuery(req.query.limit, 50, 200);
  if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
  const changes = getSeoChanges(req.params.workspaceId, limit);
  res.json({ changes });
});

// Get SEO change impact with GSC before/after comparison
router.get('/api/seo-change-impact/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property configured' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });

  try {
    const limit = parseBoundedPositiveIntQuery(req.query.limit, 20, 50);
    if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
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
router.get('/api/schema-impact/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property configured' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No site linked' });

  try {
    const limit = parseBoundedPositiveIntQuery(req.query.limit, 30, 50);
    if (limit == null) return res.status(400).json({ error: 'limit must be a positive integer' });
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
