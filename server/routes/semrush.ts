/**
 * semrush routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import {
  isSemrushConfigured, estimateCreditCost, clearSemrushCache,
  getDomainOverview, getDomainOrganicKeywords, getKeywordGap,
  getBacklinksOverview,
} from '../semrush.js';
import { listWorkspaces } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('semrush-routes');

// --- Competitive Intelligence Hub ---
router.get('/api/semrush/competitive-intel/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const competitors = (req.query.competitors as string || '').split(',').map(d => d.trim()).filter(Boolean);
  if (competitors.length === 0) return res.status(400).json({ error: 'competitors query param required (comma-separated domains)' });

  const ws = listWorkspaces().find(w => w.id === workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!myDomain) return res.status(400).json({ error: 'Workspace has no live domain configured' });

  try {
    // Fetch domain overviews in parallel (my domain + up to 3 competitors)
    const allDomains = [myDomain, ...competitors.slice(0, 3)];
    const [overviews, backlinks, keywordGaps] = await Promise.all([
      Promise.all(allDomains.map(d => getDomainOverview(d, workspaceId).catch(() => null))),
      Promise.all(allDomains.map(d => getBacklinksOverview(d, workspaceId).catch(() => null))),
      getKeywordGap(myDomain, competitors.slice(0, 3), workspaceId, 30).catch(() => []),
    ]);

    // Get top keywords for each domain (parallel, limit 20 for speed)
    const topKeywords = await Promise.all(
      allDomains.map(d => getDomainOrganicKeywords(d, workspaceId, 20).catch(() => []))
    );

    const domains = allDomains.map((domain, i) => ({
      domain,
      isOwn: i === 0,
      overview: overviews[i],
      backlinks: backlinks[i],
      topKeywords: topKeywords[i],
    }));

    res.json({ domains, keywordGaps, fetchedAt: new Date().toISOString() });
  } catch (err) {
    log.error({ err }, 'Competitive intelligence fetch failed');
    res.status(500).json({ error: 'Failed to fetch competitive data' });
  }
});

// --- SEMRush Utilities ---
router.get('/api/semrush/status', (_req, res) => {
  res.json({ configured: isSemrushConfigured() });
});

router.post('/api/semrush/estimate', (req, res) => {
  const { mode, competitorCount, keywordCount } = req.body;
  res.json({ credits: estimateCreditCost({ mode: mode || 'quick', competitorCount, keywordCount }) });
});

router.delete('/api/semrush/cache/:workspaceId', (req, res) => {
  clearSemrushCache(req.params.workspaceId);
  res.json({ ok: true });
});

export default router;
