/**
 * Webflow SEO rewrite routes.
 *
 * @reads workspaces, snapshots, page_keywords, analytics_insights, workspace_intelligence, search_console, webflow_api
 * @writes none
 */
import { Router } from 'express';
import { requireWorkspaceAccessFromBody } from '../auth.js';

import {
  generateSeoMetadataVariations,
  isCreativeSeoProviderConfigured,
} from '../domains/seo-health/seo-copy-generation.js';
import { getLatestSnapshot } from '../reports.js';
import { getQueryPageData } from '../search-console.js';
import { isProgrammingError } from '../errors.js';
import { matchGscUrlToPath, normalizePageUrl } from '../utils/page-address.js';
import { stripHtmlToText } from '../utils/text.js';
import { createLogger } from '../logger.js';
import { getPageKeyword } from '../page-keywords.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { getBrandName, getTokenForSite, getWorkspace } from '../workspaces.js';
import { buildPageAssistContext } from '../intelligence/page-assist-context-builder.js';

const router = Router();
const log = createLogger('webflow-seo');

// --- AI SEO Rewrite (returns 3 variations) ---
router.post('/api/webflow/seo-rewrite', requireWorkspaceAccessFromBody(), async (req, res) => {
  const { pageTitle, currentSeoTitle, currentDescription, pageContent, siteContext, field, workspaceId, pagePath } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });
  if (!isCreativeSeoProviderConfigured()) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  const normalizedPagePath = typeof pagePath === 'string' && pagePath ? normalizePageUrl(pagePath) : undefined;
  const metadataField = field === 'both' || field === 'description' ? field : 'title';

  const pageAssist = await buildPageAssistContext(workspaceId, {
    pagePath: normalizedPagePath,
    includeInsights: true,
  });

  // Resolve explicit brand name so the AI doesn't guess from the domain
  let brandName = '';
  if (workspaceId) {
    const wsForBrand = getWorkspace(workspaceId);
    brandName = getBrandName(wsForBrand);
  }

  // Fetch GSC search queries for this specific page (best-effort)
  let searchPerformance: Awaited<ReturnType<typeof getQueryPageData>> = [];
  if (workspaceId && normalizedPagePath) {
    try {
      const ws = getWorkspace(workspaceId);
      if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
        const queryPageData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 28);
        searchPerformance = queryPageData
          .filter(r => matchGscUrlToPath(r.page, normalizedPagePath))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* non-critical — continue without GSC data */ }
  }

  // Build audit context for this page (if available)
  let auditBlock = '';
  if (workspaceId) {
    try {
      const ws = getWorkspace(workspaceId);
      if (ws?.webflowSiteId) {
        const snapshot = getLatestSnapshot(ws.webflowSiteId);
        if (snapshot) {
          const pageSlug = normalizedPagePath ? normalizedPagePath.replace(/^\//, '') : '';
          const matchesAuditPage = (p: { slug?: string; url?: string; page?: string }) => {
            if (p.slug === pageSlug) return true;
            if (p.url && normalizedPagePath) {
              try { return normalizePageUrl(p.url) === normalizedPagePath; } catch { /* malformed URL — expected */ } // catch-ok
            }
            return normalizedPagePath ? p.page === normalizedPagePath : false;
          };
          const pageAudit = snapshot.audit.pages.find(matchesAuditPage);
          if (pageAudit && pageAudit.issues.length > 0) {
            const relevant = pageAudit.issues
              .filter(i => ['title', 'meta-description', 'content-length', 'h1', 'duplicate-title', 'duplicate-description'].includes(i.check))
              .slice(0, 5);
            if (relevant.length > 0) {
              auditBlock = `\n\nAUDIT FINDINGS FOR THIS PAGE (address these in your rewrite):\n${relevant.map(i => `- [${i.severity}] ${i.message}${i.recommendation ? ' → ' + i.recommendation : ''}`).join('\n')}`;
            }
          }
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* non-critical */ } // url-fetch-ok
  }

  // Fetch page content server-side if not provided — extract headings + body text
  let resolvedPageContent = pageContent || '';
  const headings: string[] = [];
  if (!resolvedPageContent && normalizedPagePath && workspaceId) {
    try {
      const ws = getWorkspace(workspaceId);
      const baseUrl = await resolveBaseUrl(ws ?? {}, getTokenForSite(ws?.webflowSiteId ?? '') || undefined);
      if (baseUrl) {
        const url = `${baseUrl.replace(/\/+$/, '')}${normalizedPagePath === '/' ? '' : normalizedPagePath}`;
        log.info(`Fetching page content from ${url}`);
        const htmlRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const body = bodyMatch ? bodyMatch[1] : html;

          // Extract heading structure for better understanding
          const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
          let match;
          while ((match = headingRegex.exec(body)) !== null && headings.length < 10) {
            const text = match[2].replace(/<[^>]+>/g, '').trim();
            if (text) headings.push(`H${match[1]}: ${text}`);
          }
          resolvedPageContent = stripHtmlToText(html, { maxLength: 1500 });
        }
      }
    } catch { /* best-effort — fetch on external URL, continue without content */ } // url-fetch-ok
  }

  try {
    const pageKeyword = normalizedPagePath && workspaceId
      ? pageAssist.seoContext?.pageKeywords ?? getPageKeyword(workspaceId, normalizedPagePath)
      : pageAssist.seoContext?.pageKeywords;
    const contextBlocks = [
      pageAssist.blocks.keywordBlock,
      pageAssist.blocks.personasBlock,
      auditBlock,
      pageAssist.blocks.pageProfileBlock,
      pageAssist.blocks.pageMapBlock,
      pageAssist.blocks.pageInsightsBlock,
      siteContext ? `SITE CONTEXT:\n${siteContext}` : '',
    ].filter(Boolean);
    const output = await generateSeoMetadataVariations({
      workspaceId: workspaceId || '',
      field: metadataField,
      adapterHint: 'sync',
      evidence: {
        pageTitle,
        currentSeoTitle,
        currentDescription,
        pageContent: resolvedPageContent,
        headings,
        searchPerformance,
        contextBlocks,
      },
      authority: {
        primaryKeyword: pageKeyword?.primaryKeyword,
        secondaryKeywords: pageKeyword?.secondaryKeywords,
        searchIntent: pageKeyword?.searchIntent,
        brandName: brandName || undefined,
        brandVoice: pageAssist.seoContext?.effectiveBrandVoiceBlock || undefined,
        approvedEvidence: pageAssist.blocks.knowledgeBlock ? [pageAssist.blocks.knowledgeBlock] : undefined,
      },
    });
    if (!output) {
      log.warn({ workspaceId, field: metadataField }, 'SEO rewrite returned malformed structured output');
      return res.status(500).json({ error: 'AI rewrite failed' });
    }

    if (metadataField === 'both') {
      if (!('pairs' in output)) return res.status(500).json({ error: 'AI rewrite failed' });
      return res.json({
        field: 'both',
        pairs: output.pairs,
        titleVariations: output.pairs.map(pair => pair.title),
        descriptionVariations: output.pairs.map(pair => pair.description),
      });
    }

    if (!('variations' in output)) return res.status(500).json({ error: 'AI rewrite failed' });
    return res.json({ text: output.variations[0], field, variations: output.variations });
  } catch (err) {
    log.error({ err: err }, 'SEO rewrite error');
    res.status(500).json({ error: 'AI rewrite failed' });
  }
});

export default router;
