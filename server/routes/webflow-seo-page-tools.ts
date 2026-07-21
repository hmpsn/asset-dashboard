/**
 * Webflow SEO page utility routes.
 *
 * @reads workspaces, page_keywords, workspace_intelligence, webflow_api
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromBody, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { generateSeoPageCopySet } from '../domains/seo-health/seo-copy-generation.js';
import { normalizePageUrl } from '../utils/page-address.js';
import { stripHtmlToText } from '../utils/text.js';
import { createLogger } from '../logger.js';
import { getPageKeyword, listPageKeywords } from '../page-keywords.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { getSiteSubdomain } from '../webflow.js';
import { buildPageAssistContext } from '../intelligence/page-assist-context-builder.js';
import { getBrandName, getTokenForSite, getWorkspace, getWorkspaceBySiteId } from '../workspaces.js';

const router = Router();
const log = createLogger('webflow-seo-page-tools');

// --- Fetch page HTML body text (for keyword analysis) ---
router.get('/api/webflow/page-html/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  const { siteId } = req.params;
  const pagePath = typeof req.query.path === 'string' ? normalizePageUrl(req.query.path) : '';
  if (!pagePath) return res.status(400).json({ error: 'path query param required' });
  const token = getTokenForSite(siteId) || undefined;
  try {
    // Try live domain first (CMS collection pages often only accessible there)
    const ws = getWorkspaceBySiteId(siteId);
    const subdomain = await getSiteSubdomain(siteId, token);
    const urls: string[] = [];
    if (ws?.liveDomain) {
      const domain = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
      urls.push(`${domain.replace(/\/+$/, '')}${pagePath === '/' ? '' : pagePath}`);
    }
    if (subdomain) urls.push(`https://${subdomain}.webflow.io${pagePath === '/' ? '' : pagePath}`);
    if (urls.length === 0) return res.status(400).json({ error: 'Could not resolve site URL' });

    let html = '';
    for (const url of urls) {
      try {
        const htmlRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HmpsnStudioBot/1.0)' } });
        if (htmlRes.ok) { html = await htmlRes.text(); break; }
      } catch { /* try next URL */ }
    }
    if (!html) return res.status(404).json({ error: 'Failed to fetch page from live domain or webflow.io' });

    // Extract title and meta description from HTML (critical for CMS pages that lack Webflow API seo data)
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const seoTitle = titleMatch ? titleMatch[1].trim() : undefined;
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : undefined;

    // Extract body text: strip tags, scripts, styles
    const text = stripHtmlToText(html, { maxLength: 8000 });
    res.json({ text, seoTitle, metaDescription });
  } catch (e) {
    log.error({ err: e }, 'Page HTML fetch error');
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

// --- Per-Page SEO Copy Generator ---
router.post('/api/webflow/seo-copy', requireWorkspaceAccessFromBody(), async (req, res) => {
  const { pagePath, pageTitle, currentSeoTitle, currentDescription, currentH1, pageContent, workspaceId } = req.body;
  if (!pagePath || !workspaceId) return res.status(400).json({ error: 'pagePath and workspaceId required' });

  const pageAssist = await buildPageAssistContext(workspaceId, { pagePath });
  const pageMapEntries = pageAssist.seoContext?.strategy?.pageMap?.length
    ? pageAssist.seoContext.strategy.pageMap
    : listPageKeywords(workspaceId);
  const kwMapContext = pageAssist.seoContext?.strategy?.pageMap?.length
    ? pageAssist.blocks.pageMapBlock
    : pageMapEntries.length
      ? `\n\nKNOWN PAGE MAP:\n${pageMapEntries.map(p => `- ${p.pagePath}: ${p.pageTitle || p.primaryKeyword || 'Untitled page'}`).join('\n')}`
      : '';
  const verifiedInternalLinks = pageMapEntries.map(entry => ({
    path: normalizePageUrl(entry.pagePath),
    label: entry.pageTitle || entry.primaryKeyword || 'Untitled page',
  }));

  // If no page content was passed, try to fetch it from the live site
  let content = pageContent || '';
  if (!content) {
    const ws = getWorkspace(workspaceId);
    const baseUrl = await resolveBaseUrl(ws ?? {}, getTokenForSite(ws?.webflowSiteId ?? '') || undefined);
    if (baseUrl) {
      try {
        const url = `${baseUrl}${pagePath === '/' ? '' : pagePath}`;
        log.info(`Fetching page content from ${url}`);
        const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const html = await r.text();
          content = stripHtmlToText(html, { maxLength: 4000 });
        }
      } catch { /* non-critical - proceed without content */ }
    }
  }

  // Prefer the page-assist strategy authority, with the normalized table row as a fallback.
  const pageKw = pageAssist.seoContext?.pageKeywords ?? getPageKeyword(workspaceId, pagePath);

  // Resolve brand name
  const copyWs = getWorkspace(workspaceId);
  const copyBrandName = getBrandName(copyWs);
  try {
    const copy = await generateSeoPageCopySet({
      workspaceId,
      adapterHint: 'sync',
      currentPath: pagePath,
      evidence: {
        pageTitle: pageTitle || pageKw?.pageTitle || 'Untitled page',
        currentSeoTitle,
        currentDescription,
        currentH1,
        pageContent: content,
        contextBlocks: [
          pageAssist.blocks.keywordBlock,
          pageAssist.blocks.personasBlock,
          pageAssist.blocks.pageProfileBlock,
          kwMapContext,
          pageAssist.blocks.pageInsightsBlock,
        ].filter(Boolean),
      },
      authority: {
        primaryKeyword: pageKw?.primaryKeyword,
        secondaryKeywords: pageKw?.secondaryKeywords,
        searchIntent: pageKw?.searchIntent,
        brandName: copyBrandName || undefined,
        brandVoice: pageAssist.seoContext?.effectiveBrandVoiceBlock || undefined,
        approvedEvidence: pageAssist.blocks.knowledgeBlock ? [pageAssist.blocks.knowledgeBlock] : undefined,
      },
      verifiedInternalLinks,
    });
    if (!copy) {
      log.warn({ workspaceId, pagePath }, 'SEO copy returned malformed structured output');
      return res.status(500).json({ error: 'SEO copy generation failed' });
    }

    return res.json(copy);
  } catch (err) {
    log.error({ err: err }, 'SEO copy generator error');
    res.status(500).json({ error: 'SEO copy generation failed' });
  }
});

export default router;
