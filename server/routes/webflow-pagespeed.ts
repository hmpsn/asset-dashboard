/**
 * webflow-pagespeed routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
const router = Router();

import { runSiteSpeed, runSinglePageSpeed } from '../pagespeed.js';
import { savePageSpeed, getPageSpeed, saveSinglePageSpeed } from '../performance-store.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-pagespeed');

function parseStrategy(value: unknown): 'mobile' | 'desktop' {
  return value === 'desktop' ? 'desktop' : 'mobile';
}

// --- PageSpeed / Core Web Vitals ---
router.get('/api/webflow/pagespeed/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const strategy = parseStrategy(req.query.strategy);
    const maxPages = parseInt(req.query.maxPages as string) || 5;
    const psWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const result = await runSiteSpeed(req.params.siteId, strategy, maxPages, psWs?.id);
    savePageSpeed(req.params.siteId, strategy, result);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'PageSpeed error');
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

// Load last saved PageSpeed snapshot
router.get('/api/webflow/pagespeed-snapshot/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const snapshot = getPageSpeed(req.params.siteId, parseStrategy(req.query.strategy));
  res.json(snapshot);
});

// Single-page PageSpeed test (resolves URL from siteId + slug)
router.post('/api/webflow/pagespeed-single/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  try {
    const { siteId } = req.params;
    const { pageSlug, strategy, pageTitle } = req.body;
    const token = getTokenForSite(siteId) || process.env.WEBFLOW_API_TOKEN || '';

    // Resolve subdomain to build full URL
    const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!siteRes.ok) return res.status(400).json({ error: 'Could not resolve site URL' });
    const siteData = await siteRes.json() as { shortName?: string };
    const subdomain = siteData.shortName;
    if (!subdomain) return res.status(400).json({ error: 'Site has no subdomain' });

    const url = pageSlug ? `https://${subdomain}.webflow.io/${pageSlug}` : `https://${subdomain}.webflow.io`;
    const result = await runSinglePageSpeed(url, strategy || 'mobile', pageTitle || '');
    if (!result) return res.status(502).json({ error: 'PageSpeed API returned no data. It may be rate-limited.' });
    saveSinglePageSpeed(siteId, `${pageSlug || 'home'}_${strategy || 'mobile'}`, result);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Single PageSpeed error');
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

export default router;
