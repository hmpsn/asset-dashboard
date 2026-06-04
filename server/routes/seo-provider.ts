/**
 * Provider-neutral SEO routes.
 *
 * All live SEO reads resolve through the DataForSEO-primary provider registry.
 */
import { Router } from 'express';

const router = Router();

import { getConfiguredProvider, getBacklinksProvider, listProviders, isAnyProviderConfigured } from '../seo-data-provider.js';
import { listWorkspaces, getWorkspace, updateWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { getUploadRoot } from '../data-dir.js';
import { MAX_COMPETITORS } from '../constants.js';
import { cleanCompetitorDomains, filterDiscoveredCompetitors } from '../competitor-domain-filter.js';
import { requireWorkspaceAccess } from '../auth.js';
import { parseJsonFallback } from '../db/json-validation.js';
import fs from 'fs';
import path from 'path';
import { isProgrammingError } from '../errors.js';

const log = createLogger('seo-provider-routes');

function parseCsvQuery(rawValue: unknown): string[] {
  const rawParts = Array.isArray(rawValue) ? rawValue : [rawValue];
  return rawParts
    .flatMap(value => typeof value === 'string' ? value.split(',') : [])
    .map(value => value.trim())
    .filter(Boolean);
}

// --- Competitive Intelligence Hub ---
/**
 * Synchronous competitive intelligence read. Currently NOT exposed via MCP — the
 * MCP actions plan deferred this to roadmap because it's a sync endpoint, not a
 * background job. To expose via MCP, first promote to a real background job:
 * add COMPETITIVE_ANALYSIS to BACKGROUND_JOB_TYPES, write a runner that wraps
 * this fetch + caches the result, then add an MCP start_* tool wrapper.
 * TODO(mcp-actions): see docs/superpowers/specs/2026-05-25-mcp-actions-keyword-and-content-design.md
 */
router.get('/api/seo/competitive-intel/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const competitors = parseCsvQuery(req.query.competitors);
  if (competitors.length === 0) return res.status(400).json({ error: 'competitors query param required (comma-separated domains)' });
  if (competitors.length > MAX_COMPETITORS) {
    return res.status(400).json({ error: `competitors must include at most ${MAX_COMPETITORS} domains` });
  }

  const ws = listWorkspaces().find(w => w.id === workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const provider = getConfiguredProvider(ws.seoDataProvider);
  if (!provider) return res.status(503).json({ error: 'No SEO data provider configured' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!myDomain) return res.status(400).json({ error: 'Workspace has no live domain configured' });

  try {
    // Fetch domain overviews in parallel (my domain + configured competitor cap).
    // Backlinks are optional; if they are unavailable, omit backlink fields.
    const blProvider = getBacklinksProvider(ws.seoDataProvider);
    // Sanitize and validate competitor domains before sending to the provider.
    // Bare names without TLDs (e.g. "theaustindentist") pass the CSV parser but cause
    // DataForSEO error 40501 "Invalid Field: 'target'". Re-running cleanCompetitorDomains
    // here drops any entries that failed isProviderSafeDomain — including legacy stored
    // values saved before input validation was enforced.
    const cappedCompetitors = cleanCompetitorDomains(competitors, myDomain);
    const droppedCount = competitors.length - cappedCompetitors.length;
    if (droppedCount > 0) {
      log.warn({ dropped: competitors.filter(c => !cappedCompetitors.includes(c)), workspaceId }, 'competitive-intel: dropped invalid competitor domains');
    }
    const allDomains = [myDomain, ...cappedCompetitors];
    const [overviews, backlinks, keywordGaps] = await Promise.all([
      Promise.all(allDomains.map(d => provider.getDomainOverview(d, workspaceId).catch(() => null))),
      blProvider
        ? Promise.all(allDomains.map(d => blProvider.getBacklinksOverview(d, workspaceId).catch(() => null)))
        : Promise.resolve(allDomains.map(() => null)),
      provider.getKeywordGap(myDomain, cappedCompetitors, workspaceId, 30).catch(() => []),
    ]);

    // Get top keywords for each domain (parallel, limit 20 for speed)
    const topKeywords = await Promise.all(
      allDomains.map(d => provider.getDomainKeywords(d, workspaceId, 20).catch(() => []))
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
router.get('/api/seo/discover-competitors/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!myDomain) return res.status(400).json({ error: 'Workspace has no live domain configured' });

  const provider = getConfiguredProvider(ws.seoDataProvider);
  if (!provider) return res.status(400).json({ error: 'No SEO data provider configured' });

  try {
    const competitors = await provider.getCompetitors(myDomain, ws.id, 10);
    const filtered = filterDiscoveredCompetitors(competitors, myDomain);
    res.json({ competitors: filtered, domain: myDomain });
  } catch (err) {
    log.error({ err }, 'Competitor discovery failed');
    res.status(500).json({ error: 'Failed to discover competitors' });
  }
});

// --- Save competitor domains to workspace ---
router.post('/api/seo/competitors/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { domains, competitors } = req.body as { domains?: string[]; competitors?: string[] };
  const domainList = domains || competitors;
  if (!Array.isArray(domainList)) return res.status(400).json({ error: 'domains must be an array of domain strings' });

  const myDomain = (ws.liveDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const cleaned = cleanCompetitorDomains(domainList, myDomain).slice(0, MAX_COMPETITORS);

  updateWorkspace(ws.id, { competitorDomains: cleaned });
  res.json({ competitors: cleaned });
});

function clearSeoProviderCache(workspaceId: string): void {
  const workspaceRoot = path.join(getUploadRoot(), workspaceId);
  const cacheDirs = fs.existsSync(workspaceRoot)
    ? fs.readdirSync(workspaceRoot)
      .filter(name => name.startsWith('.') && name.endsWith('-cache'))
      .map(name => path.join(workspaceRoot, name))
    : [path.join(workspaceRoot, '.dataforseo-cache')];
  for (const cacheDir of cacheDirs) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err, cacheDir }, 'seo-provider/cache-clear: programming error');
    }
  }
}

router.get('/api/seo/status', (_req, res) => {
  res.json({ configured: isAnyProviderConfigured() });
});

router.get('/api/seo/providers/status', (_req, res) => {
  res.json({ providers: listProviders() });
});

router.post('/api/seo/estimate', (req, res) => {
  const { mode, competitorCount, keywordCount } = req.body as { mode?: string; competitorCount?: number; keywordCount?: number };
  const depthMultiplier = mode === 'full' ? 2 : 1;
  const estimatedCalls = Math.max(1, Math.ceil(((competitorCount ?? 0) + (keywordCount ?? 0)) / 100) * depthMultiplier);
  res.json({ provider: 'dataforseo', estimatedCalls });
});

router.delete('/api/seo/cache/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  clearSeoProviderCache(req.params.workspaceId);
  res.json({ ok: true });
});

router.get('/api/seo/clear-cache/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  clearSeoProviderCache(req.params.workspaceId);
  res.json({ ok: true, message: 'SEO provider cache cleared. Go back and click Refresh on Competitive Intelligence.' });
});

// --- Diagnostic: verify domain resolution + cache without external provider calls ---
router.get('/api/seo/diagnose/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const rawDomain = ws.liveDomain || '';
  const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const competitors = (ws.competitorDomains || []).map(d =>
    d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  );

  // Check cache directory for existing entries
  const cacheDir = path.join(getUploadRoot(), ws.id, '.dataforseo-cache');
  let cacheFiles: string[] = [];
  try { cacheFiles = fs.readdirSync(cacheDir).sort(); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-provider/diagnose: programming error'); /* no cache dir */ }

  const domainOverviewKeys = cacheFiles.filter((f: string) => f.startsWith('domain_overview'));
  const backlinkKeys = cacheFiles.filter((f: string) => f.startsWith('backlinks_'));

  // Read contents of key cache files to see what data is stored
  const cachedData: Record<string, unknown> = {};
  const inspectKeys = [...domainOverviewKeys, ...backlinkKeys].slice(0, 10);
  for (const f of inspectKeys) {
    try {
      const raw = parseJsonFallback<{ cachedAt?: unknown; data?: unknown }>(
        fs.readFileSync(path.join(cacheDir, f), 'utf-8'),
        {},
      );
      cachedData[f] = { cachedAt: raw.cachedAt, data: raw.data };
    } catch (err) { cachedData[f] = 'unreadable'; }
  }

  res.json({
    configured: isAnyProviderConfigured(),
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
    note: 'This endpoint makes ZERO external SEO provider calls. No credits used.',
  });
});

export default router;
