/**
 * content-briefs routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { renderBriefHTML } from '../brief-export-html.js';
import {
  listBriefs,
  getBrief,
  updateBrief,
  deleteBrief,
  generateBrief,
  regenerateBrief,
} from '../content-brief.js';
import { getSearchOverview } from '../search-console.js';
import { isSemrushConfigured, getKeywordOverview, getRelatedKeywords } from '../semrush.js';
import { getWorkspace } from '../workspaces.js';
import { getAllSitePages } from './content-requests.js';
import { createLogger } from '../logger.js';

const log = createLogger('content-briefs');

// --- Content Briefs ---
// List all briefs for a workspace
router.get('/api/content-briefs/:workspaceId', (req, res) => {
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`LIST ${req.params.workspaceId}: ${briefs.length} briefs found`);
  res.json(briefs);
});

// Get a specific brief
router.get('/api/content-briefs/:workspaceId/:briefId', (req, res) => {
  log.info(`GET ${req.params.workspaceId}/${req.params.briefId}`);
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) {
    log.info(`NOT FOUND: ${req.params.briefId} in workspace ${req.params.workspaceId}`);
    return res.status(404).json({ error: 'Brief not found' });
  }
  log.info(`FOUND: "${brief.targetKeyword}"`);
  res.json(brief);
});

// Update a content brief (inline editing)
router.patch('/api/content-briefs/:workspaceId/:briefId', (req, res) => {
  const updated = updateBrief(req.params.workspaceId, req.params.briefId, req.body);
  if (!updated) return res.status(404).json({ error: 'Brief not found' });
  res.json(updated);
});

// Generate a new content brief
router.post('/api/content-briefs/:workspaceId/generate', async (req, res) => {
  try {
    const { targetKeyword, businessContext, pageType, referenceUrls } = req.body;
    if (!targetKeyword) return res.status(400).json({ error: 'targetKeyword required' });

    const ws = getWorkspace(req.params.workspaceId);

    // No usage limit — briefs are paid add-ons purchased via Stripe
    let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];

    // Fetch GSC data if available
    if (ws?.gscPropertyUrl) {
      try {
        const overview = await getSearchOverview(ws.id, ws.gscPropertyUrl, 28);
        relatedQueries = overview.topQueries
          .filter(q => { const ql = q.query.toLowerCase(); return targetKeyword.toLowerCase().split(' ').some((w: string) => w.length > 2 && ql.includes(w)); })
          .slice(0, 20);
      } catch { /* GSC not available */ }
    }

    // Fetch all published pages (Webflow API + sitemap CMS pages) for internal link suggestions
    const existingPages = ws ? await getAllSitePages(ws) : [];

    // Gather SEMRush data if configured
    let semrushMetrics: import('../semrush.js').KeywordMetrics | undefined;
    let semrushRelated: import('../semrush.js').RelatedKeyword[] | undefined;
    if (isSemrushConfigured()) {
      try {
        const [metrics, related] = await Promise.all([
          getKeywordOverview([targetKeyword], req.params.workspaceId),
          getRelatedKeywords(targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) semrushMetrics = metrics[0];
        if (related.length > 0) semrushRelated = related;
      } catch (e) { log.error({ err: e }, 'SEMRush brief enrichment error'); }
    }

    // --- Parallel enrichment: reference URLs, SERP data, GA4 style examples ---
    const { scrapeUrls, scrapeSerpData } = await import('../web-scraper.js');

    // 1. Scrape reference URLs (user-provided competitor/inspiration pages)
    const refUrlList: string[] = Array.isArray(referenceUrls)
      ? referenceUrls.filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('http')).slice(0, 5)
      : [];

    // 2. Scrape Google SERP for target keyword (best-effort, may be blocked)
    // 3. If site has GA4 + liveDomain, scrape top-performing pages for style context
    const topPageUrls: string[] = [];
    let ga4Performance: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[] = [];
    if (ws?.ga4PropertyId) {
      try {
        const { getGA4LandingPages } = await import('../google-analytics.js');
        const pages = await getGA4LandingPages(ws.ga4PropertyId, 28, 25);
        ga4Performance = pages.slice(0, 10);
        // Pick top 2 pages with lowest bounce rate + highest engagement for style examples
        if (ws.liveDomain) {
          const sortedByQuality = [...pages]
            .filter(p => p.sessions > 10 && p.avgEngagementTime > 30)
            .sort((a, b) => (b.avgEngagementTime * b.sessions) - (a.avgEngagementTime * a.sessions));
          for (const p of sortedByQuality.slice(0, 2)) {
            const domain = ws.liveDomain.replace(/\/+$/, '');
            topPageUrls.push(`https://${domain}${p.landingPage}`);
          }
        }
      } catch { /* GA4 not available */ }
    }

    // Run all scraping in parallel
    const [scrapedRefs, serpData, stylePages] = await Promise.all([
      refUrlList.length > 0 ? scrapeUrls(refUrlList, 3) : Promise.resolve([]),
      scrapeSerpData(targetKeyword).catch(() => null),
      topPageUrls.length > 0 ? scrapeUrls(topPageUrls, 2) : Promise.resolve([]),
    ]);

    const validPageTypes = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'];
    const resolvedPageType = validPageTypes.includes(pageType) ? pageType : undefined;

    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: businessContext || ws?.keywordStrategy?.businessContext,
      existingPages,
      semrushMetrics,
      semrushRelated,
      pageType: resolvedPageType,
      referenceUrls: refUrlList.length > 0 ? refUrlList : undefined,
      scrapedReferences: scrapedRefs.length > 0 ? scrapedRefs : undefined,
      serpData: serpData ? { peopleAlsoAsk: serpData.peopleAlsoAsk, organicResults: serpData.organicResults } : undefined,
      ga4PagePerformance: ga4Performance.length > 0 ? ga4Performance : undefined,
      styleExamples: stylePages.length > 0 ? stylePages : undefined,
    });
    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brief' });
  }
});

// Regenerate a brief with user feedback
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate', async (req, res) => {
  try {
    const { feedback } = req.body;
    if (!feedback) return res.status(400).json({ error: 'feedback required' });
    const existing = getBrief(req.params.workspaceId, req.params.briefId);
    if (!existing) return res.status(404).json({ error: 'Brief not found' });
    const newBrief = await regenerateBrief(req.params.workspaceId, existing, feedback);
    log.info(`REGENERATED brief ${req.params.briefId} -> ${newBrief.id} for "${existing.targetKeyword}"`);
    res.json(newBrief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to regenerate brief' });
  }
});

// Export a brief as branded HTML
router.get('/api/content-briefs/:workspaceId/:briefId/export', (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const html = renderBriefHTML(brief);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Delete a brief
router.delete('/api/content-briefs/:workspaceId/:briefId', (req, res) => {
  deleteBrief(req.params.workspaceId, req.params.briefId);
  res.json({ ok: true });
});

export default router;
