/**
 * webflow-pagespeed routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
const router = Router();

import { runSiteSpeed, runSinglePageSpeed } from '../pagespeed.js';
import { savePageSpeed, getPageSpeed, saveSinglePageSpeed } from '../performance-store.js';
import { listWorkspaces, getTokenForSite, getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { getWorkspacePages } from '../workspace-data.js';
import { normalizePageUrl, resolvePagePath } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';

const log = createLogger('webflow-pagespeed');

function parseStrategy(value: unknown): 'mobile' | 'desktop' {
  return value === 'desktop' ? 'desktop' : 'mobile';
}

// --- PageSpeed / Core Web Vitals ---
router.get('/api/webflow/pagespeed/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const strategy = parseStrategy(req.query.strategy);
    const rawMaxPages = req.query.maxPages;
    const requestedMaxPages = rawMaxPages == null ? 5 : Number(rawMaxPages);
    if (!Number.isInteger(requestedMaxPages) || requestedMaxPages <= 0) {
      return res.status(400).json({ error: 'maxPages must be a positive integer' });
    }
    const maxPages = requestedMaxPages;
    const psWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const result = await runSiteSpeed(req.params.siteId, strategy, maxPages, psWs?.id);
    savePageSpeed(req.params.siteId, strategy, result);
    if (psWs?.id) invalidateIntelligenceCache(psWs.id);
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

// Single-page PageSpeed test (resolves URL from workspace page metadata)
router.post('/api/webflow/pagespeed-single/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  try {
    const { siteId } = req.params;
    const { pageId, pageSlug, strategy, pageTitle, workspaceId } = req.body;
    const resolvedStrategy = parseStrategy(strategy);
    const resolvedWorkspaceId = typeof workspaceId === 'string' ? workspaceId : undefined;
    const ws = resolvedWorkspaceId ? getWorkspace(resolvedWorkspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
    const token = getTokenForSite(siteId) || process.env.WEBFLOW_API_TOKEN || '';

    const baseUrl = await resolveBaseUrl({ liveDomain: ws?.liveDomain, webflowSiteId: siteId }, token);
    if (!baseUrl) return res.status(400).json({ error: 'Could not resolve site URL' });

    const published = resolvedWorkspaceId ? await getWorkspacePages(resolvedWorkspaceId, siteId) : [];
    const matchedPage = typeof pageId === 'string' ? published.find(p => p.id === pageId) : undefined;
    const pagePath = matchedPage
      ? resolvePagePath(matchedPage)
      : (typeof pageSlug === 'string' && pageSlug ? normalizePageUrl(pageSlug) : '');

    const url = pagePath ? `${baseUrl.replace(/\/+$/, '')}${pagePath}` : baseUrl.replace(/\/+$/, '');
    const result = await runSinglePageSpeed(url, resolvedStrategy, matchedPage?.title || pageTitle || '');
    if (!result) return res.status(502).json({ error: 'PageSpeed API returned no data. It may be rate-limited.' });
    saveSinglePageSpeed(siteId, `${matchedPage?.id || pageSlug || 'home'}_${resolvedStrategy}`, result);
    if (resolvedWorkspaceId) invalidateIntelligenceCache(resolvedWorkspaceId);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Single PageSpeed error');
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

export default router;
