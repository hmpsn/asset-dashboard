/**
 * Webflow SEO legacy bulk rewrite suggestion route.
 *
 * @reads workspaces, seo_suggestions, page_keywords, analytics_insights, workspace_intelligence, search_console, webflow_api
 * @writes seo_suggestions
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess } from '../auth.js';
import { callCreativeAI } from '../content-posts-ai.js';
import {
  type SeoSuggestion,
  saveSuggestion,
} from '../seo-suggestions.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatPersonasForPrompt, formatForPrompt, formatKnowledgeBaseForPrompt } from '../workspace-intelligence.js';
import { getQueryPageData } from '../search-console.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  getBrandName,
} from '../workspaces.js';
import { createLogger } from '../logger.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { isProgrammingError } from '../errors.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { stripHtmlToText, stripCodeFences, tryResolvePagePath, matchGscUrlToPath, findPageMapEntryForPage } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { enforceSeoTextLimit as enforceLimit } from '../webflow-seo-rewrite-utils.js';

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

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
  const baseUrl = await resolveBaseUrl({ liveDomain: ws?.liveDomain, webflowSiteId: siteId }, token);

  const inlineBrandName = getBrandName(ws);
  const isBothMode = field === 'both';
  const maxLen = field === 'description' ? 160 : 60; // only used in single-field mode
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

  // Pre-assemble workspace-level seoContext once. pageProfile stays per-page
  // (page-specific optimization issues + recommendations require pagePath).
  const wsIntelRw = await buildWorkspaceIntelligence(resolvedWsId, { slices: ['seoContext'] });
  const wsRwSeo = wsIntelRw.seoContext;

  // Process in concurrent batches for performance
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(async (page) => {
      // Derive per-page keywords from the pre-built pageMap — no extra DB call for seoContext
      const rwPagePath = tryResolvePagePath(page);
      const rwSeo = wsRwSeo ? { ...wsRwSeo } : undefined;
      if (rwSeo && rwPagePath && rwSeo.strategy?.pageMap?.length) {
        // findPageMapEntryForPage handles legacy `/${slug}` entries for nested pages
        const kw = findPageMapEntryForPage(rwSeo.strategy.pageMap, page);
        if (kw) rwSeo.pageKeywords = kw;
      }
      const keywordBlock = formatKeywordsForPrompt(rwSeo);
      // Voice authority: effectiveBrandVoiceBlock already honors voice profile -> legacy fallback
      const bvBlock = rwSeo?.effectiveBrandVoiceBlock ?? '';
      const rwPersonasBlock = formatPersonasForPrompt(rwSeo?.personas ?? []);
      const rwKnowledgeBlock = formatKnowledgeBaseForPrompt(rwSeo?.knowledgeBase);
      // pageProfile is page-specific — assemble per page then merge with hoisted intel
      const pageProfileIntel = await buildWorkspaceIntelligence(resolvedWsId, { slices: ['pageProfile'], pagePath: rwPagePath });
      const rwIntel = { ...wsIntelRw, seoContext: rwSeo, pageProfile: pageProfileIntel.pageProfile };

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
      let gscBlock = '';
      let ctrFlag = '';
      if (allGscData.length > 0 && rwPagePath) {
        const pageQueries = allGscData
          .filter(r => matchGscUrlToPath(r.page, rwPagePath))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
        if (pageQueries.length > 0) {
          gscBlock = `\n\nREAL SEARCH QUERIES people use to find this page (from Google Search Console — use these exact phrases for relevance):\n${pageQueries.map(q => `- "${q.query}" (${q.impressions} impr, ${q.clicks} clicks, pos ${q.position.toFixed(1)}, CTR ${q.ctr}%)`).join('\n')}`;

          // CTR performance flag — highlight underperforming pages
          const totalImpr = pageQueries.reduce((sum, q) => sum + q.impressions, 0);
          const totalClicks = pageQueries.reduce((sum, q) => sum + q.clicks, 0);
          const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
          const avgPos = pageQueries.reduce((sum, q) => sum + q.position * q.impressions, 0) / (totalImpr || 1);
          if (totalImpr >= 50) {
            // Expected CTR benchmarks by position (approximate)
            const expectedCtr = avgPos <= 3 ? 8 : avgPos <= 5 ? 5 : avgPos <= 10 ? 2.5 : 1;
            if (avgCtr < expectedCtr * 0.7) {
              ctrFlag = `\n\n⚠️ CTR UNDERPERFORMANCE: This page gets ${totalImpr} impressions/month but only ${avgCtr.toFixed(1)}% CTR (expected ~${expectedCtr}% for position ${avgPos.toFixed(0)}). The current ${field} is failing to convert searchers into clicks — make it significantly more compelling.`;
            } else if (avgCtr >= expectedCtr * 1.3) {
              ctrFlag = `\n\n✅ CTR OUTPERFORMER: This page has ${avgCtr.toFixed(1)}% CTR (above average for position ${avgPos.toFixed(0)}). Preserve the elements that are working — focus on keyword optimization while keeping the compelling angle.`;
            }
          }
        }
      }

      // Sibling titles — so Claude can differentiate from other pages on the same site
      let siblingBlock = '';
      const siblings = siblingTitles[page.pageId];
      if (siblings && siblings.length > 0) {
        siblingBlock = `\n\nOTHER TITLES/DESCRIPTIONS ON THIS SITE (do NOT repeat similar phrasing — differentiate this page):\n${siblings.map(t => `- "${t}"`).join('\n')}`;
      }

      // Persisted page analysis (optimizationIssues + recommendations from keyword analysis)
      const rwPageAnalysis = formatForPrompt(rwIntel, { verbosity: 'detailed', sections: ['pageProfile'] }); // bip-ok: rwIntel used for raw field access above

      const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
      const brandNote = inlineBrandName ? `\nBrand name is "${inlineBrandName}" — use this exact name, never an abbreviated version.` : '';
      const locationRule = `\n- LOCATION RULE: If this page's primary keyword targets a specific city/region, ALWAYS use THAT location.`;
      const rwExtraContext = [rwPersonasBlock, rwKnowledgeBlock, gscBlock, ctrFlag, siblingBlock, rwPageAnalysis].filter(Boolean).join('');

      // ── "both" mode: paired title + description in one AI call ──
      if (isBothMode) {
        const oldTitle = page.currentSeoTitle || '';
        const oldDesc = page.currentDescription || '';

        const prompt = `Write 3 paired SEO title + meta description sets for a page titled "${page.title}". Current title: "${oldTitle}". Current description: "${oldDesc}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- TITLE: 50-60 characters (NEVER exceed 60). Front-load primary keyword.\n- DESCRIPTION: 150-160 characters (NEVER exceed 160). Expand on the title's promise.\n- Each pair must feel unified — title hooks attention, description closes the click.\n- If GSC queries are provided, incorporate the exact language searchers use\n- Each pair must take a genuinely different angle${locationRule}\n\nPair angles:\n1. Keyword-intent: Primary keyword + outcome. Description expands with proof.\n2. Differentiator: What makes this unique. Description reinforces with specifics.\n3. Searcher-match: Mirror GSC query phrasing. Description addresses their need.\n\nReturn ONLY a JSON array of 3 objects with "title" and "description" keys. No explanation.`;

        const aiText = await callCreativeAI({
          json: false,
          systemPrompt: buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.'),
          userPrompt: prompt,
          maxTokens: 800,
          feature: 'seo-bulk-rewrite-both',
          workspaceId: resolvedWsId,
        });

        let pairs: Array<{ title: string; description: string }>;
        const parsedPairs = parseJsonFallback<unknown>(stripCodeFences(aiText), undefined);
        pairs = Array.isArray(parsedPairs)
          ? parsedPairs.map((p: { title?: string; description?: string }) => ({
              title: enforceLimit(String(p.title || ''), 60),
              description: enforceLimit(String(p.description || ''), 160),
            }))
          : [];
        if (!pairs.length) return { savedSuggestions: [] as SeoSuggestion[], pageId: page.pageId, error: 'Empty AI response' };
        while (pairs.length < 3) pairs.push(pairs[0]);

        // Save two aligned rows: one for title, one for description
        const titleSugg = saveSuggestion({
          workspaceId: resolvedWsId, siteId, pageId: page.pageId,
          pageTitle: page.title, pageSlug: page.slug || '',
          field: 'title', currentValue: oldTitle,
          variations: pairs.map(p => p.title),
        });
        const descSugg = saveSuggestion({
          workspaceId: resolvedWsId, siteId, pageId: page.pageId,
          pageTitle: page.title, pageSlug: page.slug || '',
          field: 'description', currentValue: oldDesc,
          variations: pairs.map(p => p.description),
        });
        return { savedSuggestions: [titleSugg, descSugg], pageId: page.pageId, error: '' };
      }

      // ── Single-field mode ──
      const oldValue = field === 'title' ? (page.currentSeoTitle || '') : (page.currentDescription || '');

      const prompt = field === 'description'
        ? `Write 3 compelling, differentiated meta descriptions for a page titled "${page.title}". Current description: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 150-160 characters each (NEVER exceed 160)\n- Use specific details from the knowledge base — mention real services, outcomes, or differentiators\n- If GSC queries are provided, mirror the language real searchers use\n- Write to the target persona's pain points if personas are provided\n- Include primary keyword naturally\n- Each variation must take a genuinely different angle${locationRule}\n\nVariation angles:\n1. Pain-point: Address the specific problem the searcher has, then promise the solution\n2. Proof/specificity: Lead with a concrete result or differentiator from the business\n3. Direct-address: Speak directly to the target persona using "you/your" language\n\nReturn ONLY a JSON array of 3 strings. No explanation.`
        : `Write 3 optimized, differentiated SEO title tags for a page titled "${page.title}". Current SEO title: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 50-60 characters each (NEVER exceed 60)\n- Front-load the primary keyword\n- If GSC queries are provided, incorporate the exact language searchers use\n- Use specific language from the knowledge base, not generic filler\n- Each variation must take a genuinely different angle${locationRule}\n\nVariation angles:\n1. Keyword-intent: Primary keyword + the specific outcome this page delivers\n2. Differentiator: Lead with what makes this business unique (from knowledge base)\n3. Searcher-match: Mirror the exact phrasing from top GSC queries\n\nReturn ONLY a JSON array of 3 strings. No explanation.`;

      const aiText = await callCreativeAI({
        json: false,
        systemPrompt: buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.'),
        userPrompt: prompt,
        maxTokens: 400,
        feature: 'seo-bulk-rewrite',
        workspaceId: resolvedWsId,
      });

      // Parse 3 variations
      let variations: string[];
      const parsedVariations = parseJsonFallback<unknown>(stripCodeFences(aiText), undefined);
      if (parsedVariations === undefined) {
        const single = enforceLimit(aiText, maxLen);
        variations = single ? [single] : [];
      } else {
        variations = Array.isArray(parsedVariations)
          ? parsedVariations.map((v: string) => enforceLimit(String(v), maxLen)).filter(Boolean)
          : [enforceLimit(String(parsedVariations), maxLen)];
      }

      if (!variations.length) return { savedSuggestions: [] as SeoSuggestion[], pageId: page.pageId, error: 'Empty AI response' };

      // Pad to 3 if AI returned fewer
      while (variations.length < 3) variations.push(variations[0]);

      // Persist to SQLite
      const suggestion = saveSuggestion({
        workspaceId: resolvedWsId,
        siteId,
        pageId: page.pageId,
        pageTitle: page.title,
        pageSlug: page.slug || '',
        field: field as 'title' | 'description',
        currentValue: oldValue,
        variations,
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
