/**
 * Webflow SEO legacy bulk rewrite suggestion route.
 *
 * @reads workspaces, seo_suggestions, page_keywords, analytics_insights, workspace_intelligence, search_console, webflow_api
 * @writes seo_suggestions
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess } from '../auth.js';
import { generateSeoMetadataVariations } from '../domains/seo-health/seo-copy-generation.js';
import {
  type SeoSuggestion,
  saveSuggestion,
  saveSuggestionPair,
} from '../seo-suggestions.js';
import { buildPageAssistContext } from '../intelligence/page-assist-context-builder.js';
import { getQueryPageData } from '../search-console.js';
import { getBrandName, getTokenForSite, getWorkspace, getWorkspaceBySiteId } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { stripHtmlToText } from '../utils/text.js';
import { tryResolvePagePath, matchGscUrlToPath, findPageMapEntryForPage } from '../utils/page-address.js';
import { resolveBaseUrl } from '../url-helpers.js';

const router = Router();
const log = createLogger('webflow-seo-bulk-rewrite');

// --- Bulk AI Rewrite (generates 3 variations per page, persists to SQLite) ---
router.post('/api/webflow/seo-bulk-rewrite/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { pages, field, workspaceId } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; publishedPath?: string | null; currentSeoTitle?: string; currentDescription?: string }>;
    field: 'title' | 'description' | 'both';
    workspaceId?: string;
  };
  if (!pages?.length || !field) return res.status(400).json({ error: 'pages, field required' });

  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;

  const ws = workspaceId ? getWorkspace(workspaceId) : getWorkspaceBySiteId(siteId);
  const baseUrl = await resolveBaseUrl({ liveDomain: ws?.liveDomain, webflowSiteId: siteId }, token);

  const inlineBrandName = getBrandName(ws);
  const isBothMode = field === 'both';
  const CONCURRENCY = 3;
  const resolvedWsId = workspaceId || ws?.id || '';

  // Fetch ALL GSC query data once, then match per page by slug (no N+1 API calls)
  let allGscData: Array<{ query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }> = [];
  if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
    try {
      allGscData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 28);
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* non-critical */ }
  }

  // Build sibling title map so each page knows what other pages in this batch use
  // Prevents generating duplicate/similar titles across the site
  const siblingTitles: Record<string, string[]> = {};
  for (const p of pages) {
    // For 'both' mode, include both title and description as sibling context
    const siblingValues = isBothMode
      ? [p.currentSeoTitle || p.title || '', p.currentDescription || ''].filter(Boolean)
      : [field === 'title' ? (p.currentSeoTitle || p.title || '') : (p.currentDescription || '')].filter(Boolean);
    for (const val of siblingValues) {
      for (const other of pages) {
        if (other.pageId === p.pageId) continue;
        if (!siblingTitles[other.pageId]) siblingTitles[other.pageId] = [];
        if (siblingTitles[other.pageId].length < 8) {
          siblingTitles[other.pageId].push(val);
        }
      }
    }
  }

  const suggestions: SeoSuggestion[] = [];
  const errors: Array<{ pageId: string; error: string }> = [];
  const basePageAssist = await buildPageAssistContext(resolvedWsId, { includePageMap: false });
  const baseSeoContext = basePageAssist.seoContext;

  // Process in concurrent batches for performance
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(async (page) => {
      const rwPagePath = tryResolvePagePath(page);
      const pageKeywords = baseSeoContext && rwPagePath && baseSeoContext.strategy?.pageMap?.length
        ? findPageMapEntryForPage(baseSeoContext.strategy.pageMap, page)
        : undefined;
      const pageAssist = await buildPageAssistContext(resolvedWsId, {
        pagePath: rwPagePath,
        includePageMap: false,
        baseSeoContext,
        pageKeywords,
      });

      // Fetch page content for context (best-effort)
      let contentExcerpt = '';
      if (baseUrl && rwPagePath) {
        try {
          const htmlRes = await fetch(`${baseUrl}${rwPagePath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            contentExcerpt = stripHtmlToText(html, { maxLength: 800 });
          }
        } catch { /* best-effort — fetch on external URL */ } // url-fetch-ok
      }

      // Match GSC queries to this page by slug (top 15 by impressions)
      let pageQueries: typeof allGscData = [];
      if (allGscData.length > 0 && rwPagePath) {
        pageQueries = allGscData
          .filter(r => matchGscUrlToPath(r.page, rwPagePath))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
      }

      const siblings = siblingTitles[page.pageId];

      const contextBlocks = [
        pageAssist.blocks.keywordBlock,
        pageAssist.blocks.personasBlock,
        pageAssist.blocks.pageProfileBlock,
      ].filter(Boolean);
      const authorityKeywords = pageKeywords ?? pageAssist.seoContext?.pageKeywords;
      const generationInput = {
        workspaceId: resolvedWsId,
        field,
        adapterHint: 'bulk' as const,
        evidence: {
          pageTitle: page.title,
          currentSeoTitle: page.currentSeoTitle,
          currentDescription: page.currentDescription,
          pageContent: contentExcerpt,
          searchPerformance: pageQueries,
          siblingMetadata: siblings,
          contextBlocks,
        },
        authority: {
          primaryKeyword: authorityKeywords?.primaryKeyword,
          secondaryKeywords: authorityKeywords?.secondaryKeywords,
          searchIntent: authorityKeywords?.searchIntent,
          brandName: inlineBrandName || undefined,
          // Voice authority must reach the canonical service only through this field.
          brandVoice: pageAssist.seoContext?.effectiveBrandVoiceBlock || undefined,
          approvedEvidence: pageAssist.blocks.knowledgeBlock ? [pageAssist.blocks.knowledgeBlock] : undefined,
        },
      };

      // ── "both" mode: paired title + description in one AI call ──
      if (isBothMode) {
        const oldTitle = page.currentSeoTitle || '';
        const oldDesc = page.currentDescription || '';
        const generated = await generateSeoMetadataVariations(generationInput);
        if (!generated || !('pairs' in generated)) return { savedSuggestions: [] as SeoSuggestion[], pageId: page.pageId, error: 'Empty AI response' };

        // The aligned rows are one logical result and must never persist partially.
        const [titleSugg, descSugg] = saveSuggestionPair({
          workspaceId: resolvedWsId, siteId, pageId: page.pageId,
          pageTitle: page.title, pageSlug: rwPagePath || page.slug || '',
          title: {
            currentValue: oldTitle,
            variations: generated.pairs.map(pair => pair.title),
          },
          description: {
            currentValue: oldDesc,
            variations: generated.pairs.map(pair => pair.description),
          },
        });
        return { savedSuggestions: [titleSugg, descSugg], pageId: page.pageId, error: '' };
      }

      // ── Single-field mode ──
      const oldValue = field === 'title' ? (page.currentSeoTitle || '') : (page.currentDescription || '');
      const generated = await generateSeoMetadataVariations(generationInput);
      if (!generated || !('variations' in generated)) return { savedSuggestions: [] as SeoSuggestion[], pageId: page.pageId, error: 'Empty AI response' };

      // Persist to SQLite
      const suggestion = saveSuggestion({
        workspaceId: resolvedWsId,
        siteId,
        pageId: page.pageId,
        pageTitle: page.title,
        pageSlug: rwPagePath || page.slug || '',
        field: field as 'title' | 'description',
        currentValue: oldValue,
        variations: generated.variations,
      });

      return { savedSuggestions: [suggestion], pageId: page.pageId, error: '' };
    }));

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        if (r.value.savedSuggestions.length > 0) suggestions.push(...r.value.savedSuggestions);
        else if (r.value.error) errors.push({ pageId: r.value.pageId, error: r.value.error });
      } else {
        errors.push({ pageId: batch[j]?.pageId || '', error: String(r.reason) });
      }
    }
  }

  log.info(`Bulk rewrite: ${suggestions.length}/${pages.length} ${field} suggestions generated (${errors.length} errors)`);
  res.json({ suggestions, errors, field, generated: suggestions.length, total: pages.length });
});

export default router;
