/**
 * backlinks routes — lightweight backlink profile overview via SEMRush
 */
import { Router } from 'express';
import { getBacklinksOverview, getTopReferringDomains, isSemrushConfigured } from '../semrush.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('backlinks');
const router = Router();

router.get('/api/backlinks/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  if (!isSemrushConfigured()) {
    return res.status(503).json({ error: 'SEMRush is not configured. Set SEMRUSH_API_KEY to enable backlink data.' });
  }

  // Derive domain from liveDomain or webflowSiteName
  const domain = ws.liveDomain || ws.webflowSiteName;
  if (!domain) {
    return res.status(400).json({ error: 'No domain configured for this workspace. Set a live domain in workspace settings.' });
  }

  try {
    const [overview, referringDomains] = await Promise.all([
      getBacklinksOverview(domain, workspaceId),
      getTopReferringDomains(domain, workspaceId, 15),
    ]);

    log.info(`Backlink profile for ${domain}: ${overview?.totalBacklinks ?? 0} backlinks, ${overview?.referringDomains ?? 0} referring domains`);

    res.json({
      domain,
      overview,
      referringDomains,
    });
  } catch (err) {
    log.error({ err }, `Failed to fetch backlink profile for ${domain}`);
    res.status(500).json({ error: 'Failed to fetch backlink data' });
  }
});

export default router;
