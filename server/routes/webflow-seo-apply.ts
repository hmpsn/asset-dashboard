/**
 * Webflow SEO live apply routes.
 *
 * @reads workspaces, page_keywords, workspace_intelligence, webflow_api
 * @writes page_edit_states, seo_changes, activities, webflow_api
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccess } from '../auth.js';
import { callCreativeAI } from '../content-posts-ai.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { stripHtmlToText, tryResolvePagePath, findPageMapEntryForPage } from '../helpers.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { updatePageSeo } from '../webflow.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPersonasForPrompt,
} from '../workspace-intelligence.js';
import {
  getBrandName,
  getTokenForSite,
  getWorkspace,
  listWorkspaces,
  updatePageState,
} from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';

const router = Router();

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
            recordSeoChange(ws.id, page.pageId, bulkPagePath || page.slug || '', page.title || '', [field], 'bulk-fix');
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
    const appliedPageIds = results.filter(r => r.applied).map(r => r.pageId);
    if (appliedPageIds.length > 0) {
      broadcastToWorkspace(bulkWsId, WS_EVENTS.PAGE_STATE_UPDATED, {
        pageIds: appliedPageIds,
        fields: [field],
        source: 'bulk-fix',
      });
    }
    addActivity(bulkWsId, 'seo_updated',
      `Bulk ${field} optimization: ${results.filter(r => r.applied).length} pages updated`,
      `AI-generated ${field}s applied to ${appliedPageIds.length}/${pages.length} pages`,
      { field, pagesUpdated: appliedPageIds.length, totalPages: pages.length }
    );
  }

  res.json({ results, field });
});

// --- Bulk Pattern Apply (instant text transforms, no AI) ---
router.post('/api/webflow/seo-pattern-apply/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { pages: rawPages, field, action, text: patternText, workspaceId } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; publishedPath?: string | null; currentValue: string }>;
    field: 'title' | 'description';
    action: 'append' | 'prepend' | 'replace';
    text: string;
    workspaceId?: string;
  };
  // Strip synthetic CMS IDs at the boundary — they are not real Webflow page IDs
  const pages = (rawPages || []).filter(p => !p.pageId.startsWith('cms-'));
  if (!pages?.length || !field || !action || !patternText) {
    return res.status(400).json({ error: 'pages, field, action, text required' });
  }

  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;
  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
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
        recordSeoChange(ws.id, page.pageId, tryResolvePagePath(page) || page.slug || '', page.title || '', [field], 'pattern-apply');
      }
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue, applied: true });
    } catch (err) {
      results.push({ pageId: page.pageId, oldValue: page.currentValue, newValue: '', applied: false, error: String(err) });
    }
  }

  if (ws) {
    const appliedPageIds = results.filter(r => r.applied).map(r => r.pageId);
    if (appliedPageIds.length > 0) {
      broadcastToWorkspace(ws.id, WS_EVENTS.PAGE_STATE_UPDATED, {
        pageIds: appliedPageIds,
        fields: [field],
        source: 'pattern-apply',
      });
      addActivity(ws.id, 'seo_updated',
        `Bulk ${field} pattern applied: ${appliedPageIds.length} pages updated`,
        `Pattern ${action} applied to ${appliedPageIds.length}/${pages.length} pages`,
        { field, action, pagesUpdated: appliedPageIds.length, totalPages: pages.length }
      );
    }
  }

  res.json({ results, field, action });
});

export default router;
