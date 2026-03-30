/**
 * content-briefs routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { renderBriefHTML } from '../brief-export-html.js';
import {
  listBriefs,
  getBrief,
  updateBrief,
  deleteBrief,
  generateBrief,
  regenerateBrief,
  regenerateOutline,
} from '../content-brief.js';
import { createContentRequest, updateContentRequest } from '../content-requests.js';
import { notifyClientBriefReady } from '../email.js';
import { getSearchOverview } from '../search-console.js';
import { getConfiguredProvider } from '../seo-data-provider.js';
import type { KeywordMetrics, RelatedKeyword } from '../seo-data-provider.js';
import { getWorkspace } from '../workspaces.js';
import { getAllSitePages } from './content-requests.js';
import { createLogger } from '../logger.js';
import { buildPipelineSignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';
import { recordAction } from '../outcome-tracking.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from '../workspace-learnings.js';
import { isFeatureEnabled } from '../feature-flags.js';

const log = createLogger('content-briefs');

// --- Content Briefs ---
// List all briefs for a workspace
router.get('/api/content-briefs/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`LIST ${req.params.workspaceId}: ${briefs.length} briefs found`);
  res.json(briefs);
});

// AI Suggested Briefs — must be registered BEFORE /:briefId to avoid param shadowing
router.get('/api/content-briefs/:workspaceId/suggested', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const insights = getInsights(req.params.workspaceId);
    const signals = buildPipelineSignals(insights);
    res.json({ signals });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to build pipeline signals');
    res.json({ signals: [] });
  }
});

// Get a specific brief
router.get('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), (req, res) => {
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
router.patch('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const updated = updateBrief(req.params.workspaceId, req.params.briefId, req.body);
  if (!updated) return res.status(404).json({ error: 'Brief not found' });
  res.json(updated);
});

// Generate a new content brief
router.post('/api/content-briefs/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
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

    // Gather SEO keyword data if a provider is configured
    let semrushMetrics: KeywordMetrics | undefined;
    let semrushRelated: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) semrushMetrics = metrics[0];
        if (related.length > 0) semrushRelated = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
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

    // Adaptive pipeline: inject workspace learnings into the brief prompt
    let adaptedBusinessContext = businessContext || ws?.keywordStrategy?.businessContext;
    if (isFeatureEnabled('outcome-adaptive-pipeline')) {
      try {
        const learnings = getWorkspaceLearnings(req.params.workspaceId);
        if (learnings) {
          const block = formatLearningsForPrompt(learnings, 'content');
          if (block) {
            adaptedBusinessContext = adaptedBusinessContext
              ? `${adaptedBusinessContext}\n\n${block}`
              : block;
          }
        }
      } catch (err) {
        log.warn({ err }, 'Failed to inject workspace learnings into brief prompt');
      }
    }

    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
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

    // Record for outcome tracking
    try {
      recordAction({
        workspaceId: req.params.workspaceId,
        actionType: 'brief_created',
        sourceType: 'brief',
        sourceId: brief.id,
        pageUrl: null,
        targetKeyword: targetKeyword,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
        },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err, keyword: targetKeyword }, 'Failed to record outcome action for brief creation');
    }

    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brief' });
  }
});

// Regenerate a brief with user feedback
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
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

// Regenerate outline only (preserves all other brief fields)
router.post('/api/content-briefs/:workspaceId/:briefId/regenerate-outline', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { feedback } = req.body || {};
    const result = await regenerateOutline(req.params.workspaceId, req.params.briefId, feedback);
    if (!result) return res.status(404).json({ error: 'Brief not found' });
    log.info(`REGENERATED OUTLINE for brief ${req.params.briefId} in workspace ${req.params.workspaceId}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to regenerate outline' });
  }
});

// Export a brief as branded HTML
router.get('/api/content-briefs/:workspaceId/:briefId/export', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const html = renderBriefHTML(brief);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Send a standalone brief to client for review
// Creates a content request linked to this brief and sets status to client_review
router.post('/api/content-briefs/:workspaceId/:briefId/send-to-client', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  const ws = getWorkspace(req.params.workspaceId);

  // Create a content request linked to this brief
  const request = createContentRequest(req.params.workspaceId, {
    topic: brief.suggestedTitle,
    targetKeyword: brief.targetKeyword,
    intent: brief.intent || 'informational',
    priority: 'medium',
    rationale: brief.executiveSummary || `Content brief for "${brief.targetKeyword}"`,
    source: 'strategy',
    serviceType: 'brief_only',
    pageType: (brief.pageType as 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource') || 'blog',
    initialStatus: 'requested',
  });

  // Link the brief and set to client_review
  updateContentRequest(req.params.workspaceId, request.id, {
    briefId: brief.id,
    status: 'client_review',
  });

  // Send email notification
  if (ws?.clientEmail) {
    const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
    const dashUrl = origin ? `${origin}/dashboard/${req.params.workspaceId}?tab=content` : undefined;
    notifyClientBriefReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId: req.params.workspaceId,
      topic: brief.suggestedTitle,
      targetKeyword: brief.targetKeyword,
      dashboardUrl: dashUrl,
    });
  }

  log.info(`Brief ${brief.id} sent to client via request ${request.id}`);
  res.json({ ok: true, requestId: request.id });
});

// Delete a brief
router.delete('/api/content-briefs/:workspaceId/:briefId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  deleteBrief(req.params.workspaceId, req.params.briefId);
  res.json({ ok: true });
});

// Validate a keyword via SEMRush before locking it for brief generation
router.post('/api/content-briefs/:workspaceId/validate-keyword', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const kwWs = getWorkspace(req.params.workspaceId);
  const kwProvider = getConfiguredProvider(kwWs?.seoDataProvider);
  if (!kwProvider) {
    // No SEO provider — return a stub validation so the flow isn't blocked
    return res.json({
      keyword,
      valid: true,
      source: 'manual' as const,
      metrics: null,
      message: 'No SEO data provider configured — keyword accepted without validation',
    });
  }

  try {
    const metrics = await kwProvider.getKeywordMetrics([keyword], req.params.workspaceId);
    const kw = metrics[0];

    if (!kw) {
      return res.json({
        keyword,
        valid: true,
        source: 'semrush' as const,
        metrics: null,
        message: 'No SEMRush data found — keyword accepted without metrics',
      });
    }

    // Flag low-volume or very high difficulty keywords as warnings (not blocking)
    const warnings: string[] = [];
    if (kw.volume < 10) warnings.push(`Very low search volume (${kw.volume}/mo)`);
    if (kw.difficulty > 85) warnings.push(`Very high keyword difficulty (${kw.difficulty}/100)`);

    res.json({
      keyword,
      valid: true,
      source: 'semrush' as const,
      metrics: {
        volume: kw.volume,
        difficulty: kw.difficulty,
        cpc: kw.cpc,
        validatedAt: new Date().toISOString(),
      },
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    log.error({ err, keyword, workspaceId: req.params.workspaceId }, 'Keyword validation failed');
    // Don't block workflow on SEMRush failure
    res.json({
      keyword,
      valid: true,
      source: 'manual' as const,
      metrics: null,
      message: 'SEMRush lookup failed — keyword accepted without validation',
    });
  }
});

// Bulk validate keywords (for matrix pre-assignment)
router.post('/api/content-briefs/:workspaceId/validate-keywords', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords) || !keywords.length) {
    return res.status(400).json({ error: 'keywords array is required' });
  }

  const bulkWs = getWorkspace(req.params.workspaceId);
  const bulkProvider = getConfiguredProvider(bulkWs?.seoDataProvider);
  if (!bulkProvider) {
    return res.json({
      results: keywords.map((kw: string) => ({
        keyword: kw,
        valid: true,
        source: 'manual' as const,
        metrics: null,
      })),
      message: 'No SEO data provider configured — all keywords accepted without validation',
    });
  }

  try {
    const metrics = await bulkProvider.getKeywordMetrics(keywords.slice(0, 50), req.params.workspaceId);
    const metricsMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));

    const results = keywords.slice(0, 50).map((kw: string) => {
      const m = metricsMap.get(kw.toLowerCase());
      if (!m) {
        return { keyword: kw, valid: true, source: 'semrush' as const, metrics: null };
      }
      const warnings: string[] = [];
      if (m.volume < 10) warnings.push(`Very low volume (${m.volume}/mo)`);
      if (m.difficulty > 85) warnings.push(`Very high KD (${m.difficulty}/100)`);
      return {
        keyword: kw,
        valid: true,
        source: 'semrush' as const,
        metrics: {
          volume: m.volume,
          difficulty: m.difficulty,
          cpc: m.cpc,
          validatedAt: new Date().toISOString(),
        },
        warnings: warnings.length ? warnings : undefined,
      };
    });

    res.json({ results });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Bulk keyword validation failed');
    res.json({
      results: keywords.map((kw: string) => ({
        keyword: kw,
        valid: true,
        source: 'manual' as const,
        metrics: null,
      })),
      message: 'SEMRush lookup failed — all keywords accepted without validation',
    });
  }
});

export default router;
