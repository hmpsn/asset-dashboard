/**
 * webflow-seo routes — extracted from server/index.ts
 *
 * @reads workspaces, seo_suggestions, snapshots, page_keywords, analytics_insights, workspace_intelligence, search_console, webflow_api
 * @writes seo_suggestions, page_keywords, jobs, seo_changes, webflow_pages, activities
 */
import { Router } from 'express';

import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
const router = Router();

import { callCreativeAI } from '../content-posts-ai.js';
import {
  type SeoSuggestion,
  saveSuggestion,
} from '../seo-suggestions.js';
import { runSeoAudit } from '../seo-audit.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatPersonasForPrompt, formatForPrompt, formatKnowledgeBaseForPrompt } from '../workspace-intelligence.js';
import { getQueryPageData } from '../search-console.js';
import { updatePageSeo } from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  updatePageState,
  getBrandName,
} from '../workspaces.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { isProgrammingError } from '../errors.js';
import { stripHtmlToText, stripCodeFences, tryResolvePagePath, matchGscUrlToPath, findPageMapEntryForPage } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { createJob, hasActiveJob, registerAbort } from '../jobs.js';
import { validate, z } from '../middleware/validate.js';
import { seoBulkAcceptFixSchema, seoBulkAnalyzePageSchema, seoBulkRewritePageSchema } from '../schemas/seo-bulk-jobs.js';
import { handleOnDemandSeoAuditResult } from '../webflow-seo-audit-bridges.js';
import { runSeoBulkAcceptFixesJob } from '../webflow-seo-bulk-accept-fixes-job.js';
import { runSeoBulkAnalyzeJob } from '../webflow-seo-bulk-analyze-job.js';
import { runSeoBulkRewriteJob } from '../webflow-seo-bulk-rewrite-job.js';
import { enforceSeoTextLimit as enforceLimit } from '../webflow-seo-rewrite-utils.js';

const log = createLogger('webflow-seo');

// --- SEO Audit ---
router.get('/api/webflow/seo-audit/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    if (!token) {
      log.error({ detail: req.params.siteId }, 'SEO audit: No token available for site');
      return res.status(500).json({ error: 'No Webflow API token configured. Please link a workspace to this site in Settings, or set WEBFLOW_API_TOKEN environment variable.' });
    }
    const skipLinkCheck = req.query.skipLinkCheck === 'true';
    const result = await runSeoAudit(req.params.siteId, token, req.query.workspaceId as string | undefined, skipLinkCheck);
    // Auto-flag pages with issues for edit tracking
    const auditWsId = req.query.workspaceId as string | undefined;
    const auditWs = auditWsId ? getWorkspace(auditWsId) : listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (auditWs) {
      handleOnDemandSeoAuditResult(auditWs, result);
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'SEO audit error');
    res.status(500).json({ error: `SEO audit failed: ${msg}` });
  }
});

// --- Bulk AI SEO Fix ---
router.post('/api/webflow/seo-bulk-fix/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { pages: rawPages, field, workspaceId } = req.body as { pages: Array<{ pageId: string; title: string; slug?: string; publishedPath?: string | null; currentSeoTitle?: string; currentDescription?: string; pageContent?: string }>; field: 'title' | 'description'; workspaceId?: string };
  // Strip synthetic CMS IDs at the boundary — they are not real Webflow page IDs
  const pages = (rawPages || []).filter(p => !p.pageId.startsWith('cms-'));
  if (!pages?.length) return res.status(400).json({ error: 'pages required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;

  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Try to fetch page content for pages that don't have it (best-effort)
  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
  const baseUrl = await resolveBaseUrl({ liveDomain: ws?.liveDomain, webflowSiteId: siteId }, token);

  const inlineBrandName = getBrandName(ws);

  // Pre-assemble workspace-level seoContext once — brandVoice, personas, knowledgeBase,
  // rank tracking, and strategy are identical for every page. pageKeywords (the only
  // page-specific field) is a simple find() on the pre-built pageMap, done inline per page.
  const resolvedWsIdBulk = workspaceId || ws?.id || '';
  const wsIntelBulk = await buildWorkspaceIntelligence(resolvedWsIdBulk, { slices: ['seoContext'] });
  const wsBulkSeo = wsIntelBulk.seoContext;

  const results = [];
  for (const page of pages) {
    try {
      // Derive per-page keywords from the pre-built pageMap — no extra DB call
      const bulkPagePath = tryResolvePagePath(page);
      const bulkFixSeo = wsBulkSeo ? { ...wsBulkSeo } : undefined;
      if (bulkFixSeo && bulkPagePath && bulkFixSeo.strategy?.pageMap?.length) {
        // findPageMapEntryForPage handles legacy `/${slug}` entries for nested pages
        const kw = findPageMapEntryForPage(bulkFixSeo.strategy.pageMap, page);
        if (kw) bulkFixSeo.pageKeywords = kw;
      }
      const keywordBlock = formatKeywordsForPrompt(bulkFixSeo);
      // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
      const bvBlock = bulkFixSeo?.effectiveBrandVoiceBlock ?? '';
      const bulkPersonasBlock = formatPersonasForPrompt(bulkFixSeo?.personas ?? []);
      const bulkKnowledgeBlock = formatKnowledgeBaseForPrompt(bulkFixSeo?.knowledgeBase);

      // Fetch page content if not provided and we have a base URL
      let contentExcerpt = page.pageContent || '';
      if (!contentExcerpt && baseUrl && bulkPagePath) {
        try {
          const htmlRes = await fetch(`${baseUrl}${bulkPagePath}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            contentExcerpt = stripHtmlToText(html, { maxLength: 800 });
          }
        } catch { /* best-effort — fetch on external URL */ } // url-fetch-ok
      }

      const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
      const brandNote = inlineBrandName ? `\nBrand name is "${inlineBrandName}" — use this exact name, never an abbreviated version.` : '';
      const locationRule = `\n- LOCATION RULE: If this page's primary keyword targets a specific city/region, ALWAYS use THAT location.`;
      const extraContext = [bulkPersonasBlock, bulkKnowledgeBlock].filter(Boolean).join('');
      const prompt = field === 'description'
        ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${contentSection}${keywordBlock}${bvBlock}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 160 characters\n- Use specific details from the knowledge base — mention real services, outcomes, or differentiators\n- Write to the target persona's pain points if personas are provided\n- Include primary keyword naturally${locationRule}\nReturn ONLY the text.`
        : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${contentSection}${keywordBlock}${bvBlock}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 60 characters\n- Front-load the primary keyword\n- Use specific language from the knowledge base, not generic filler${locationRule}\nReturn ONLY the text.`;

      const aiText = await callCreativeAI({
        systemPrompt: buildSystemPrompt(resolvedWsIdBulk, 'You are an elite SEO copywriter. Return ONLY the requested text — no quotes, no explanation, no markdown.'),
        userPrompt: prompt,
        maxTokens: 150,
        feature: 'seo-bulk-fix',
        workspaceId: resolvedWsIdBulk,
      });

      let text = aiText.replace(/^["']|["']$/g, '');
      const maxLen = field === 'description' ? 160 : 60;
      if (text.length > maxLen) {
        const truncated = text.slice(0, maxLen);
        const lastSpace = truncated.lastIndexOf(' ');
        text = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
      }

      if (text) {
        const seoFields = field === 'description'
          ? { seo: { description: text } }
          : { seo: { title: text } };
        const seoResult = await updatePageSeo(page.pageId, seoFields, token);
        if (!seoResult.success) {
          results.push({ pageId: page.pageId, text: '', applied: false, error: seoResult.error });
        } else {
          if (ws) {
            updatePageState(ws.id, page.pageId, { status: 'live', source: 'bulk-fix', fields: [field], updatedBy: 'admin' });
            recordSeoChange(ws.id, page.pageId, page.slug || '', page.title || '', [field], 'bulk-fix');
          }
          results.push({ pageId: page.pageId, text, applied: true });
        }
      } else {
        results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
      }
    } catch (err) {
      results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
    }
  }

  // Log activity for bulk SEO fix
  const bulkWsId = workspaceId || ws?.id;
  if (bulkWsId) {
    addActivity(bulkWsId, 'seo_updated',
      `Bulk ${field} optimization: ${results.filter(r => r.applied).length} pages updated`,
      `AI-generated ${field}s applied to ${results.filter(r => r.applied).length}/${pages.length} pages`,
      { field, pagesUpdated: results.filter(r => r.applied).length, totalPages: pages.length }
    );
  }

  res.json({ results, field });
});

// --- Bulk Pattern Apply (instant text transforms, no AI) ---
router.post('/api/webflow/seo-pattern-apply/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { pages: rawPages, field, action, text: patternText } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; currentValue: string }>;
    field: 'title' | 'description';
    action: 'append' | 'prepend' | 'replace';
    text: string;
  };
  // Strip synthetic CMS IDs at the boundary — they are not real Webflow page IDs
  const pages = (rawPages || []).filter(p => !p.pageId.startsWith('cms-'));
  if (!pages?.length || !field || !action || !patternText) {
    return res.status(400).json({ error: 'pages, field, action, text required' });
  }

  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;
  const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
  const maxLen = field === 'description' ? 160 : 60;

  const results: Array<{ pageId: string; oldValue: string; newValue: string; applied: boolean; error?: string }> = [];

  for (const page of pages) {
    try {
      let newValue: string;
      if (action === 'append') {
        newValue = `${page.currentValue} ${patternText}`.trim();
      } else if (action === 'prepend') {
        newValue = `${patternText} ${page.currentValue}`.trim();
      } else {
        newValue = patternText;
      }

      // Truncate if over limit
      if (newValue.length > maxLen) {
        const truncated = newValue.slice(0, maxLen);
        const lastSpace = truncated.lastIndexOf(' ');
        newValue = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
      }

      const seoFields = field === 'description'
        ? { seo: { description: newValue } }
        : { seo: { title: newValue } };
      const seoResult = await updatePageSeo(page.pageId, seoFields, token);
      if (!seoResult.success) {
        results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue: '', applied: false, error: seoResult.error });
        continue;
      }

      if (ws) {
        updatePageState(ws.id, page.pageId, { status: 'live', source: 'pattern-apply', fields: [field], updatedBy: 'admin' });
        recordSeoChange(ws.id, page.pageId, page.slug || '', page.title || '', [field], 'pattern-apply');
      }
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue, applied: true });
    } catch (err) {
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue: '', applied: false, error: String(err) });
    }
  }

  res.json({ results, field, action });
});

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
      // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
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
          systemPrompt: buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.'),
          userPrompt: prompt,
          maxTokens: 800,
          feature: 'seo-bulk-rewrite-both',
          workspaceId: resolvedWsId,
        });

        let pairs: Array<{ title: string; description: string }>;
        try {
          const parsed = JSON.parse(stripCodeFences(aiText));
          pairs = Array.isArray(parsed)
            ? parsed.map((p: { title?: string; description?: string }) => ({
                title: enforceLimit(String(p.title || ''), 60),
                description: enforceLimit(String(p.description || ''), 160),
              }))
            : [];
        } catch (err) {
          log.debug({ err }, 'webflow-seo: expected error — degrading gracefully');
          pairs = [];
        }
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
        systemPrompt: buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.'),
        userPrompt: prompt,
        maxTokens: 400,
        feature: 'seo-bulk-rewrite',
        workspaceId: resolvedWsId,
      });

      // Parse 3 variations
      let variations: string[];
      try {
        const parsed = JSON.parse(stripCodeFences(aiText));
        variations = Array.isArray(parsed)
          ? parsed.map((v: string) => enforceLimit(String(v), maxLen)).filter(Boolean)
          : [enforceLimit(String(parsed), maxLen)];
      } catch (err) {
        log.debug({ err }, 'webflow-seo: expected error — degrading gracefully');
        const single = enforceLimit(aiText, maxLen);
        variations = single ? [single] : [];
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

// ═══════════════════════════════════════════════════════════════════
// Bulk background job endpoints — run server-side with WS progress
// ═══════════════════════════════════════════════════════════════════

const bulkAnalyzeSchema = z.object({
  pages: z.array(seoBulkAnalyzePageSchema).min(1).max(500),
});

router.post('/api/seo/:workspaceId/bulk-analyze', requireWorkspaceAccess('workspaceId'), validate(bulkAnalyzeSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { pages } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const existing = hasActiveJob('seo-bulk-analyze', workspaceId);
  if (existing) return res.status(409).json({ error: 'A bulk analyze job is already running', jobId: existing.id });

  const job = createJob('seo-bulk-analyze', {
    message: `Analyzing ${pages.length} pages...`,
    total: pages.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkAnalyzeJob({
    jobId: job.id,
    workspaceId,
    pages,
    workspace: ws,
    signal: ac.signal,
  });
});

// ── Bulk AI Rewrite (background job) ──

const bulkRewriteSchema = z.object({
  siteId: z.string().min(1),
  pages: z.array(seoBulkRewritePageSchema).min(1).max(500),
  field: z.enum(['title', 'description', 'both']),
});

router.post('/api/seo/:workspaceId/bulk-rewrite', requireWorkspaceAccess('workspaceId'), validate(bulkRewriteSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { siteId, pages, field } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.webflowSiteId && siteId !== ws.webflowSiteId) return res.status(400).json({ error: 'siteId does not belong to this workspace' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const existingJob = hasActiveJob('seo-bulk-rewrite', workspaceId);
  if (existingJob) return res.status(409).json({ error: 'A bulk rewrite job is already running', jobId: existingJob.id });

  const job = createJob('seo-bulk-rewrite', {
    message: `Generating ${field} variations for ${pages.length} pages...`,
    total: pages.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkRewriteJob({
    jobId: job.id,
    workspaceId,
    siteId,
    pages,
    field,
    workspace: ws,
    signal: ac.signal,
  });
});

// ── Bulk Accept Fixes (background job — SeoAudit accept-all) ──

const bulkAcceptFixesSchema = z.object({
  siteId: z.string().min(1),
  fixes: z.array(seoBulkAcceptFixSchema).min(1).max(500),
});

router.post('/api/seo/:workspaceId/bulk-accept-fixes', requireWorkspaceAccess('workspaceId'), validate(bulkAcceptFixesSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { siteId, fixes } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.webflowSiteId && siteId !== ws.webflowSiteId) return res.status(400).json({ error: 'siteId does not belong to this workspace' });

  const existingJob = hasActiveJob('seo-bulk-accept-fixes', workspaceId);
  if (existingJob) return res.status(409).json({ error: 'A bulk accept job is already running', jobId: existingJob.id });

  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(500).json({ error: 'No Webflow API token configured' });

  const job = createJob('seo-bulk-accept-fixes', {
    message: `Applying ${fixes.length} fixes...`,
    total: fixes.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkAcceptFixesJob({
    jobId: job.id,
    workspaceId,
    fixes,
    token,
    signal: ac.signal,
  });
});

export default router;
