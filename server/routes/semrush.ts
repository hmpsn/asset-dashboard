/**
 * semrush routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import {
  isSemrushConfigured, estimateCreditCost, clearSemrushCache,
  getDomainOverview, getDomainOrganicKeywords, getKeywordGap,
  getBacklinksOverview, getOrganicCompetitors,
} from '../semrush.js';
import { listProviders } from '../seo-data-provider.js';
import { listWorkspaces, getWorkspace, updateWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { getUploadRoot } from '../data-dir.js';
import fs from 'fs';
import path from 'path';

const log = createLogger('semrush-routes');

// --- Competitive Intelligence Hub ---
router.get('/api/semrush/competitive-intel/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const competitors = (req.query.competitors as string || '').split(',').map(d => d.trim()).filter(Boolean);
  if (competitors.length === 0) return res.status(400).json({ error: 'competitors query param required (comma-separated domains)' });

  const ws = listWorkspaces().find(w => w.id === workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
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

// --- Competitor Auto-Discovery ---
router.get('/api/semrush/discover-competitors/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!myDomain) return res.status(400).json({ error: 'Workspace has no live domain configured' });

  if (!isSemrushConfigured()) return res.status(400).json({ error: 'SEMRush API key not configured' });

  try {
    const competitors = await getOrganicCompetitors(myDomain, ws.id, 10);
    // Filter out the site's own domain and subdomains
    const filtered = competitors.filter(c =>
      !c.domain.includes(myDomain) && !myDomain.includes(c.domain)
    );
    res.json({ competitors: filtered, domain: myDomain });
  } catch (err) {
    log.error({ err }, 'Competitor discovery failed');
    res.status(500).json({ error: 'Failed to discover competitors' });
  }
});

// --- Save competitor domains to workspace ---
router.post('/api/semrush/competitors/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { domains, competitors } = req.body as { domains?: string[]; competitors?: string[] };
  const domainList = domains || competitors;
  if (!Array.isArray(domainList)) return res.status(400).json({ error: 'domains must be an array of domain strings' });

  // Clean and deduplicate
  const cleaned = [...new Set(
    domainList
      .map(d => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase())
      .filter(Boolean)
  )];

  updateWorkspace(ws.id, { competitorDomains: cleaned });
  res.json({ competitors: cleaned });
});

// --- SEMRush Utilities ---
router.get('/api/semrush/status', (_req, res) => {
  res.json({ configured: isSemrushConfigured() });
});

// Unified SEO data provider status
router.get('/api/seo-providers/status', (_req, res) => {
  res.json({ providers: listProviders() });
});

router.post('/api/semrush/estimate', (req, res) => {
  const { mode, competitorCount, keywordCount } = req.body;
  res.json({ credits: estimateCreditCost({ mode: mode || 'quick', competitorCount, keywordCount }) });
});

router.delete('/api/semrush/cache/:workspaceId', (req, res) => {
  clearSemrushCache(req.params.workspaceId);
  res.json({ ok: true });
});

// GET-based cache clear (browser-friendly — just visit this URL)
router.get('/api/semrush/clear-cache/:workspaceId', (req, res) => {
  clearSemrushCache(req.params.workspaceId);
  res.json({ ok: true, message: 'SEMRush cache cleared. Go back and click Refresh on Competitive Intelligence.' });
});

// --- Diagnostic: verify domain resolution + cache without calling SEMRush API ---
router.get('/api/semrush/diagnose/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const rawDomain = ws.liveDomain || '';
  const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const competitors = (ws.competitorDomains || []).map(d =>
    d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  );

  // Check cache directory for existing entries
  const cacheDir = path.join(getUploadRoot(), ws.id, '.semrush-cache');
  let cacheFiles: string[] = [];
  try { cacheFiles = fs.readdirSync(cacheDir).sort(); } catch { /* no cache dir */ }

  const domainOverviewKeys = cacheFiles.filter((f: string) => f.startsWith('domain_overview'));
  const backlinkKeys = cacheFiles.filter((f: string) => f.startsWith('backlinks_'));

  // Read contents of key cache files to see what data is stored
  const cachedData: Record<string, unknown> = {};
  const inspectKeys = [...domainOverviewKeys, ...backlinkKeys].slice(0, 10);
  for (const f of inspectKeys) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf-8'));
      cachedData[f] = { cachedAt: raw.cachedAt, data: raw.data };
    } catch { cachedData[f] = 'unreadable'; }
  }

  res.json({
    configured: isSemrushConfigured(),
    rawLiveDomain: rawDomain,
    resolvedDomain: cleanDomain,
    wwwStripped: rawDomain.includes('www.') && !cleanDomain.includes('www.'),
    competitors,
    cacheDir,
    cacheFileCount: cacheFiles.length,
    domainOverviewCacheKeys: domainOverviewKeys,
    backlinkCacheKeys: backlinkKeys,
    allCacheKeys: cacheFiles,
    cachedData,
    note: 'This endpoint makes ZERO SEMRush API calls. No credits used.',
  });
});

export default router;
