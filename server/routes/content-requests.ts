/**
 * content-requests routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { generateBrief } from '../content-brief.js';
import { listMatrices } from '../content-matrices.js';
import {
  listContentRequests,
  getContentRequest,
  updateContentRequest,
  deleteContentRequest,
} from '../content-requests.js';
import { notifyClientBriefReady, notifyClientContentPublished, notifyTeamContentRequest } from '../email.js';
import { getGA4LandingPages } from '../google-analytics.js';
import { getQueryPageData, getAllGscPages, getPageTrend } from '../search-console.js';
import { isSemrushConfigured, getKeywordOverview, getRelatedKeywords } from '../semrush.js';
import {
  listPages,
  filterPublishedPages,
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import { getWorkspace, getTokenForSite, updatePageState } from '../workspaces.js';
import { resolvePagePath } from '../helpers.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('content-requests');

const updateContentRequestSchema = z.object({
  status: z.string().optional(),
  internalNote: z.string().max(5000).optional(),
  deliveryUrl: z.string().url().optional().or(z.literal('')),
  deliveryNotes: z.string().max(5000).optional(),
});

// --- Internal Content Request Management ---
router.get('/api/content-requests/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listContentRequests(req.params.workspaceId));
});

router.get('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

router.patch('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(updateContentRequestSchema), (req, res) => {
  const { status, internalNote, deliveryUrl, deliveryNotes } = req.body;
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, { status, internalNote, deliveryUrl, deliveryNotes });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  // Send email when brief is sent to client review
  if (status === 'client_review') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = origin ? `${origin}/dashboard/${req.params.workspaceId}?tab=content` : undefined;
      notifyClientBriefReady({ clientEmail: wsInfo.clientEmail, workspaceName: wsInfo.name, workspaceId: req.params.workspaceId, topic: updated.topic, targetKeyword: updated.targetKeyword, dashboardUrl: dashUrl });
    }
  }
  // When content is delivered and has a target page, update page state to live
  if (status === 'delivered' && updated.targetPageId) {
    updatePageState(req.params.workspaceId, updated.targetPageId, {
      status: 'live',
      source: 'content-delivery',
      contentRequestId: updated.id,
    });
  }
  // When content is marked as published and has a target page, update page state to live
  if (status === 'published' && updated.targetPageId) {
    updatePageState(req.params.workspaceId, updated.targetPageId, {
      status: 'live',
      source: 'content-delivery',
      contentRequestId: updated.id,
    });
  }
  // Notify client when content is published
  if (status === 'published') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = origin ? `${origin}/dashboard/${req.params.workspaceId}?tab=content` : undefined;
      notifyClientContentPublished({ clientEmail: wsInfo.clientEmail, workspaceName: wsInfo.name, workspaceId: req.params.workspaceId, topic: updated.topic, targetKeyword: updated.targetKeyword, dashboardUrl: dashUrl });
    }
  }
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: updated.id, status: updated.status });
  res.json(updated);
});

// Delete a content request
router.delete('/api/content-requests/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const deleted = deleteContentRequest(req.params.workspaceId, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Request not found' });
  broadcastToWorkspace(req.params.workspaceId, 'content-request:update', { id: req.params.id, deleted: true });
  res.json({ ok: true });
});

// --- Helper: fetch all published site pages for content brief internal linking ---
export async function getAllSitePages(ws: { webflowSiteId?: string; liveDomain?: string; keywordStrategy?: { pageMap?: { pagePath: string; primaryKeyword?: string }[] } }): Promise<string[]> {
  const pageMap = new Map<string, string>(); // path -> "path — title"

  // 1. Keyword strategy pages (always available, have keyword context)
  if (ws.keywordStrategy?.pageMap) {
    for (const p of ws.keywordStrategy.pageMap) {
      const path = p.pagePath.startsWith('/') ? p.pagePath : `/${p.pagePath}`;
      const label = p.primaryKeyword ? `${path} — targets: "${p.primaryKeyword}"` : path;
      pageMap.set(path.toLowerCase(), label);
    }
  }

  // 2. Webflow API pages (static pages with titles)
  if (ws.webflowSiteId) {
    try {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      const allPages = await listPages(ws.webflowSiteId, token);
      const published = filterPublishedPages(allPages);
      for (const p of published) {
        const pagePath = resolvePagePath(p);
        const key = pagePath.toLowerCase();
        if (!pageMap.has(key)) {
          const title = p.title || p.slug || 'Home';
          pageMap.set(key, `${pagePath} — "${title}"`);
        }
      }
    } catch { /* Webflow API unavailable */ }
  }

  // 3. Sitemap discovery (CMS pages: blog posts, case studies, etc.)
  if (ws.webflowSiteId) {
    try {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, token);
      const baseUrl = ws.liveDomain
        ? `https://${ws.liveDomain}`
        : subdomain ? `https://${subdomain}.webflow.io` : '';
      if (baseUrl) {
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        for (const url of sitemapUrls) {
          try {
            const parsed = new URL(url);
            const pagePath = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');
            const key = pagePath.toLowerCase();
            if (!pageMap.has(key)) {
              // Derive a readable title from the slug
              const slug = pagePath.split('/').pop() || '';
              const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              pageMap.set(key, `${pagePath} — "${title}"`);
            }
          } catch { /* skip malformed URL */ }
        }
      }
    } catch { /* sitemap unavailable */ }
  }

  return Array.from(pageMap.values());
}

// Generate a brief for a content request
router.post('/api/content-requests/:workspaceId/:id/generate-brief', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  try {
    // Gather GSC context if available
    let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];
    if (ws.gscPropertyUrl && ws.webflowSiteId) {
      try {
        const gscData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90);
        relatedQueries = gscData
          .filter(r => { const q = r.query.toLowerCase(); return request.targetKeyword.toLowerCase().split(' ').some(w => w.length > 2 && q.includes(w)); })
          .slice(0, 20)
          .map(r => ({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions }));
      } catch { /* GSC unavailable */ }
    }

    // Gather SEMRush data if configured
    let semrushMetrics: import('../semrush.js').KeywordMetrics | undefined;
    let semrushRelated: import('../semrush.js').RelatedKeyword[] | undefined;
    if (isSemrushConfigured()) {
      try {
        const [metrics, related] = await Promise.all([
          getKeywordOverview([request.targetKeyword], req.params.workspaceId),
          getRelatedKeywords(request.targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) semrushMetrics = metrics[0];
        if (related.length > 0) semrushRelated = related;
      } catch (e) { log.error({ err: e }, 'SEMRush brief enrichment error'); }
    }

    // Gather GA4 landing page performance if connected
    let ga4PagePerformance: { landingPage: string; sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }[] | undefined;
    if (ws.ga4PropertyId) {
      try {
        const pages = await getGA4LandingPages(ws.ga4PropertyId, 28, 25);
        if (pages.length > 0) ga4PagePerformance = pages;
      } catch { /* GA4 unavailable */ }
    }

    // Fetch all published pages (Webflow API + sitemap CMS pages) for internal link suggestions
    const existingPages = await getAllSitePages(ws);
    const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
      relatedQueries,
      businessContext: ws.keywordStrategy?.businessContext || '',
      existingPages,
      semrushMetrics,
      semrushRelated,
      pageType: request.pageType || 'blog',
      ga4PagePerformance,
    });

    // Link brief to request and update status
    updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'brief_generated',
      briefId: brief.id,
    });

    addActivity(req.params.workspaceId, 'brief_generated', `Content brief generated for "${request.targetKeyword}"`, `Title: ${brief.suggestedTitle}`, { requestId: request.id, briefId: brief.id });
    res.json(brief);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// --- Content Performance Tracker (#31) ---
// Shared handler for both admin and public routes
export async function handleContentPerformance(workspaceId: string): Promise<{
  items: Array<{
    requestId: string;
    topic: string;
    targetKeyword: string;
    targetPageSlug?: string;
    pageType?: string;
    status: string;
    publishedAt?: string;
    daysSincePublish: number;
    gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
    ga4: { sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number } | null;
    source?: 'request' | 'matrix';
  }>;
}> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const requests = listContentRequests(workspaceId);
  const published = requests.filter(r => r.status === 'delivered' || r.status === 'published');

  // Batch-fetch GSC page data (one API call)
  const gscPages: Map<string, { clicks: number; impressions: number; ctr: number; position: number }> = new Map();
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const pages = await getAllGscPages(ws.webflowSiteId, ws.gscPropertyUrl, 90);
      for (const p of pages) {
        // Store by path (strip domain)
        try {
          const url = new URL(p.page);
          gscPages.set(url.pathname, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
        } catch {
          gscPages.set(p.page, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
        }
      }
    } catch { /* GSC unavailable */ }
  }

  // Batch-fetch GA4 landing pages (one API call)
  const ga4Pages: Map<string, { sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }> = new Map();
  if (ws.ga4PropertyId) {
    try {
      const pages = await getGA4LandingPages(ws.ga4PropertyId, 90, 100);
      for (const p of pages) {
        ga4Pages.set(p.landingPage, { sessions: p.sessions, users: p.users, bounceRate: p.bounceRate, avgEngagementTime: p.avgEngagementTime, conversions: p.conversions });
      }
    } catch { /* GA4 unavailable */ }
  }

  const now = Date.now();
  const seenKeywords = new Set<string>();
  const items: Array<{
    requestId: string; topic: string; targetKeyword: string; targetPageSlug?: string;
    pageType?: string; status: string; publishedAt?: string; daysSincePublish: number;
    gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
    ga4: { sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number } | null;
    source?: 'request' | 'matrix';
  }> = published.map(r => {
    const slug = r.targetPageSlug;
    const path = slug ? (slug.startsWith('/') ? slug : `/${slug}`) : undefined;
    if (r.targetKeyword) seenKeywords.add(r.targetKeyword.toLowerCase());

    // Match GSC data by slug path
    const gsc = path ? (gscPages.get(path) || null) : null;
    // Match GA4 data by slug path
    const ga4 = path ? (ga4Pages.get(path) || null) : null;

    // Calculate days since publish (use updatedAt as proxy for publish date)
    const publishDate = r.updatedAt || r.requestedAt;
    const daysSincePublish = Math.floor((now - new Date(publishDate).getTime()) / (1000 * 60 * 60 * 24));

    return {
      requestId: r.id,
      topic: r.topic,
      targetKeyword: r.targetKeyword,
      targetPageSlug: r.targetPageSlug,
      pageType: r.pageType,
      status: r.status,
      publishedAt: publishDate,
      daysSincePublish,
      gsc,
      ga4,
      source: 'request' as const,
    };
  });

  // Include published matrix cells not already covered by content requests
  try {
    const matrices = listMatrices(workspaceId);
    for (const matrix of matrices) {
      for (const cell of (matrix.cells || [])) {
        if (cell.status !== 'published' || !cell.targetKeyword) continue;
        if (seenKeywords.has(cell.targetKeyword.toLowerCase())) continue;
        seenKeywords.add(cell.targetKeyword.toLowerCase());

        const slug = cell.plannedUrl;
        const path = slug ? (slug.startsWith('/') ? slug : `/${slug}`) : undefined;
        const gsc = path ? (gscPages.get(path) || null) : null;
        const ga4 = path ? (ga4Pages.get(path) || null) : null;

        items.push({
          requestId: cell.id,
          topic: cell.variableValues ? Object.values(cell.variableValues).join(' × ') : cell.targetKeyword,
          targetKeyword: cell.targetKeyword,
          targetPageSlug: slug,
          pageType: undefined,
          status: 'published',
          publishedAt: matrix.updatedAt,
          daysSincePublish: Math.floor((now - new Date(matrix.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
          gsc,
          ga4,
          source: 'matrix' as const,
        });
      }
    }
  } catch { /* matrices not available — skip */ }

  // Sort by GSC clicks descending, then by days since publish
  items.sort((a, b) => (b.gsc?.clicks || 0) - (a.gsc?.clicks || 0) || a.daysSincePublish - b.daysSincePublish);

  return { items };
}

router.get('/api/content-performance/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const data = await handleContentPerformance(req.params.workspaceId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(err instanceof Error && msg === 'Workspace not found' ? 404 : 500).json({ error: msg });
  }
});

// Per-post GSC trend (daily clicks/impressions since publish)
router.get('/api/content-performance/:workspaceId/:requestId/trend', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const request = getContentRequest(req.params.workspaceId, req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.targetPageSlug || !ws.gscPropertyUrl || !ws.webflowSiteId) {
      return res.json({ trend: [] });
    }

    // Build full URL for the page
    let siteBase = ws.gscPropertyUrl.replace(/\/$/, '');
    if (siteBase.startsWith('sc-domain:')) {
      siteBase = `https://${siteBase.replace('sc-domain:', '')}`;
    }
    const slug = request.targetPageSlug.startsWith('/') ? request.targetPageSlug : `/${request.targetPageSlug}`;
    const pageUrl = `${siteBase}${slug}`;

    // Use publish date as start, or default to 90 days
    const publishDate = request.updatedAt || request.requestedAt;
    const startDate = publishDate.split('T')[0];
    const endDate = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]; // 3-day GSC delay

    const trend = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, pageUrl, 90, { startDate, endDate });
    res.json({ trend });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
