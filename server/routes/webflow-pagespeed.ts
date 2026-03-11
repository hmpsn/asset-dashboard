/**
 * webflow-pagespeed routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { runSiteSpeed, runSinglePageSpeed } from '../pagespeed.js';
import { savePageSpeed, getPageSpeed, saveSinglePageSpeed } from '../performance-store.js';
import { getTokenForSite } from '../workspaces.js';

// --- PageSpeed / Core Web Vitals ---
router.get('/api/webflow/pagespeed/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const strategy = (req.query.strategy as 'mobile' | 'desktop') || 'mobile';
    const maxPages = parseInt(req.query.maxPages as string) || 5;
    const result = await runSiteSpeed(req.params.siteId, strategy, maxPages, token);
    savePageSpeed(req.params.siteId, result);
    res.json(result);
  } catch (err) {
    console.error('PageSpeed error:', err);
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

// Load last saved PageSpeed snapshot
router.get('/api/webflow/pagespeed-snapshot/:siteId', (req, res) => {
  const snapshot = getPageSpeed(req.params.siteId);
  res.json(snapshot);
});

// Single-page PageSpeed test (resolves URL from siteId + slug)
router.post('/api/webflow/pagespeed-single/:siteId', async (req, res) => {
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
    console.error('Single PageSpeed error:', err);
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

export default router;
