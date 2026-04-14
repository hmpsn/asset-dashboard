/**
 * webflow-seo routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

import { callOpenAI } from '../openai-helpers.js';
import { callCreativeAI } from '../content-posts-ai.js';
import {
  type SeoSuggestion,
  saveSuggestion, listSuggestions, selectVariation,
  getSelectedSuggestions, markApplied, dismissSuggestions, getSuggestionCounts,
} from '../seo-suggestions.js';
import { getLatestSnapshot } from '../reports.js';
import { runSeoAudit } from '../seo-audit.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatPersonasForPrompt, formatPageMapForPrompt, formatForPrompt, formatKnowledgeBaseForPrompt } from '../workspace-intelligence.js';
import { getQueryPageData } from '../search-console.js';
import { updatePageSeo, getSiteSubdomain } from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  updatePageState,
  getBrandName,
} from '../workspaces.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { addActivity } from '../activity-log.js';
import { getPageKeyword } from '../page-keywords.js';
import { createLogger } from '../logger.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { getInsights } from '../analytics-insights-store.js';
import { buildKeywordMapContext } from '../seo-context.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('webflow-seo');

// --- SEO Audit ---
router.get('/api/webflow/seo-audit/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
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
      for (const page of result.pages) {
        if (page.issues.length > 0) {
          updatePageState(auditWs.id, page.pageId, { status: 'issue-detected', source: 'audit', slug: page.slug, auditIssues: page.issues.map((i: { check: string }) => i.check), updatedBy: 'system' });
        }
      }
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'SEO audit error');
    res.status(500).json({ error: `SEO audit failed: ${msg}` });
  }
});

// --- AI SEO Rewrite (returns 3 variations) ---
router.post('/api/webflow/seo-rewrite', async (req, res) => {
  const { pageTitle, currentSeoTitle, currentDescription, pageContent, siteContext, field, workspaceId, pagePath } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build full context: keyword strategy + brand voice + personas + knowledge base
  const rewriteIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext', 'pageProfile'], pagePath: pagePath || undefined });
  const rewriteSeo = rewriteIntel.seoContext;
  const keywordContext = formatKeywordsForPrompt(rewriteSeo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = rewriteSeo?.effectiveBrandVoiceBlock ?? '';
  const personasBlock = formatPersonasForPrompt(rewriteSeo?.personas ?? []);
  const knowledgeBlock = formatKnowledgeBaseForPrompt(rewriteSeo?.knowledgeBase);

  // Resolve explicit brand name so the AI doesn't guess from the domain
  let brandName = '';
  if (workspaceId) {
    const wsForBrand = getWorkspace(workspaceId);
    brandName = getBrandName(wsForBrand);
  }

  // Fetch GSC search queries for this specific page (best-effort)
  let gscBlock = '';
  if (workspaceId && pagePath) {
    try {
      const ws = getWorkspace(workspaceId);
      if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
        const queryPageData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 28);
        // Match queries to this page by slug
        const slug = pagePath.replace(/^\//, '');
        const pageQueries = queryPageData
          .filter(r => r.page.includes(slug) || (slug === '' && r.page.endsWith('/')))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 15);
        if (pageQueries.length > 0) {
          gscBlock = `\n\nREAL SEARCH QUERIES people use to find this page (from Google Search Console — use these exact phrases for relevance):\n${pageQueries.map(q => `- "${q.query}" (${q.impressions} impr, ${q.clicks} clicks, pos ${q.position}, CTR ${q.ctr}%)`).join('\n')}`;

          // CTR performance flag
          const totalImpr = pageQueries.reduce((sum, q) => sum + q.impressions, 0);
          const totalClicks = pageQueries.reduce((sum, q) => sum + q.clicks, 0);
          const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
          const avgPos = pageQueries.reduce((sum, q) => sum + q.position * q.impressions, 0) / (totalImpr || 1);
          if (totalImpr >= 50) {
            const expectedCtr = avgPos <= 3 ? 8 : avgPos <= 5 ? 5 : avgPos <= 10 ? 2.5 : 1;
            if (avgCtr < expectedCtr * 0.7) {
              gscBlock += `\n\n⚠️ CTR UNDERPERFORMANCE: This page gets ${totalImpr} impressions/month but only ${avgCtr.toFixed(1)}% CTR (expected ~${expectedCtr}% for position ${avgPos.toFixed(0)}). The current ${field} is failing to convert searchers into clicks — make it significantly more compelling.`;
            } else if (avgCtr >= expectedCtr * 1.3) {
              gscBlock += `\n\n✅ CTR OUTPERFORMER: This page has ${avgCtr.toFixed(1)}% CTR (above average for position ${avgPos.toFixed(0)}). Preserve the elements that are working — focus on keyword optimization while keeping the compelling angle.`;
            }
          }
        }
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
          const pageSlug = pagePath ? pagePath.replace(/^\//, '') : '';
          const pageAudit = snapshot.audit.pages.find(p =>
            p.slug === pageSlug || p.url?.includes(pageSlug) || (pagePath && p.page === pagePath)
          );
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
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* non-critical */ }
  }

  // Fetch page content server-side if not provided — extract headings + body text
  let resolvedPageContent = pageContent || '';
  let headingsBlock = '';
  if (!resolvedPageContent && pagePath && workspaceId) {
    try {
      const ws = getWorkspace(workspaceId);
      let baseUrl = '';
      if (ws?.liveDomain) {
        baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
      } else if (ws?.webflowSiteId) {
        const sub = await getSiteSubdomain(ws.webflowSiteId, getTokenForSite(ws.webflowSiteId) || undefined);
        if (sub) baseUrl = `https://${sub}.webflow.io`;
      }
      if (baseUrl) {
        const slug = pagePath.replace(/^\//, '');
        log.info(`Fetching page content from ${baseUrl}/${slug}`);
        const htmlRes = await fetch(`${baseUrl}/${slug}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const body = bodyMatch ? bodyMatch[1] : html;

          // Extract heading structure for better understanding
          const headings: string[] = [];
          const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
          let match;
          while ((match = headingRegex.exec(body)) !== null && headings.length < 10) {
            const text = match[2].replace(/<[^>]+>/g, '').trim();
            if (text) headings.push(`H${match[1]}: ${text}`);
          }
          if (headings.length > 0) {
            headingsBlock = `\nPage heading structure:\n${headings.join('\n')}`;
          }

          resolvedPageContent = body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1500);
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* best-effort — continue without content */ }
  }

  // Enforce character limits helper - STRICT enforcement
  const enforceLimit = (text: string, maxLen: number): string => {
    const t = text.replace(/^["']|["']$/g, '').trim();
    if (t.length > maxLen) {
      const truncated = t.slice(0, maxLen);
      const lastSpace = truncated.lastIndexOf(' ');
      const lastPeriod = truncated.lastIndexOf('.');
      const lastExclamation = truncated.lastIndexOf('!');
      
      let cutPoint = maxLen;
      if (lastSpace > maxLen * 0.7) cutPoint = lastSpace;
      else if (lastPeriod > maxLen * 0.7) cutPoint = lastPeriod + 1;
      else if (lastExclamation > maxLen * 0.7) cutPoint = lastExclamation + 1;
      
      return t.slice(0, cutPoint);
    }
    return t;
  };

  try {
    // Persisted page analysis (optimizationIssues + recommendations from keyword analysis)
    const pageAnalysisBlock = formatForPrompt(rewriteIntel, { verbosity: 'detailed', sections: ['pageProfile'] }); // bip-ok: rewriteIntel used for raw field access above

    // Intelligence context: cannibalization + page health + content decay
    let intelligenceBlock = '';
    if (workspaceId && pagePath) {
      try {
        const allInsights = getInsights(workspaceId);
        // pageId is stored as a full URL (https://domain.com/path) or synthetic key.
        // pagePath is a path like /services/seo (already has leading slash).
        // Match if pageId ends with pagePath or equals it exactly.
        const pageInsights = allInsights.filter(i =>
          i.pageId != null && (
            i.pageId === pagePath ||
            i.pageId.endsWith(pagePath)
          )
        );

        const cannibalization = pageInsights
          .filter(i => i.insightType === 'cannibalization')
          .slice(0, 2)
          .map(i => `- Cannibalization: ${i.pageTitle ?? i.pageId ?? 'unknown page'}`);

        const decay = pageInsights
          .filter(i => i.insightType === 'content_decay')
          .slice(0, 1)
          .map(i => `- Content decay: ${i.pageTitle ?? i.pageId ?? 'unknown page'}`);

        const health = pageInsights
          .filter(i => i.insightType === 'page_health')
          .slice(0, 1)
          .map(i => `- Page health: ${i.pageTitle ?? i.pageId ?? 'unknown page'} (impact: ${i.impactScore ?? 'n/a'})`);

        const lines = [...cannibalization, ...decay, ...health];
        if (lines.length > 0) {
          intelligenceBlock = `\n\nPAGE INTELLIGENCE:\n${lines.join('\n')}`;
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* intelligence not available — skip */ }
    }

    // Assemble all context blocks
    const contextBlocks = [
      keywordContext,
      brandVoiceBlock,
      personasBlock,
      knowledgeBlock,
      gscBlock,
      auditBlock,
      pageAnalysisBlock,
      buildKeywordMapContext(workspaceId),
      intelligenceBlock,
    ].filter(Boolean).join('');

    // ── "both" mode: generate paired title + description in one call ──
    if (field === 'both') {
      const prompt = `You are an elite SEO copywriter. Write 3 paired SEO title + meta description sets for this page. Each pair must feel unified — the title and description should complement each other in tone, angle, and messaging.

PAGE CONTEXT:
- Page title: ${pageTitle}
- Current SEO title: ${currentSeoTitle || '(none)'}
- Current meta description: ${currentDescription || '(none)'}
- Site context: ${siteContext || 'N/A'}
${headingsBlock}
- Page content: ${resolvedPageContent || 'N/A'}
${contextBlocks}

CRAFT GUIDELINES:
- TITLE: 50-60 characters (NEVER exceed 60). Front-load primary keyword.
- DESCRIPTION: 150-160 characters (NEVER exceed 160). Expand on the title's promise with specific details.
- The title hooks attention; the description closes the click. They must tell a coherent story together.
- If GSC queries are provided, incorporate the exact language searchers use
- If audience personas are provided, write to their specific pain points and goals
${brandName ? `- Brand: "${brandName}" — use this exact name` : ''}
- LOCATION RULE: If the page keyword targets a specific city/region, use THAT location exactly
- Each pair must take a genuinely different angle

PAIR ANGLES:
1. Keyword-intent: Primary keyword + specific outcome. Description expands with proof/details.
2. Differentiator: What makes this business unique. Description reinforces with specifics.
3. Searcher-match: Mirror exact phrasing from GSC queries/personas. Description addresses their need directly.

Return ONLY a JSON array of 3 objects, each with "title" and "description" keys. No explanation.`;

      const aiText = await callCreativeAI({
        systemPrompt: buildSystemPrompt(workspaceId || '', 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.'),
        userPrompt: prompt,
        maxTokens: 800,
        feature: 'seo-rewrite-both',
        workspaceId: workspaceId || '',
      });

      let pairs: Array<{ title: string; description: string }>;
      try {
        const parsed = JSON.parse(aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
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
      while (pairs.length < 3 && pairs.length > 0) pairs.push(pairs[0]);

      res.json({
        field: 'both',
        pairs,
        titleVariations: pairs.map(p => p.title),
        descriptionVariations: pairs.map(p => p.description),
      });
      return;
    }

    // ── Single-field mode (title or description) ──
    const maxLen = field === 'description' ? 160 : 60;

    let prompt: string;
    if (field === 'description') {
      prompt = `You are an elite SEO copywriter who writes meta descriptions that dramatically outperform competitors in click-through rate. Write 3 compelling, differentiated meta descriptions for this page.

PAGE CONTEXT:
- Page title: ${pageTitle}
- Current meta description: ${currentDescription || '(none)'}
- Site context: ${siteContext || 'N/A'}
${headingsBlock}
- Page content: ${resolvedPageContent || 'N/A'}
${contextBlocks}

CRAFT GUIDELINES:
- HARD LIMIT: 150-160 characters (NEVER exceed 160)
- Write like a human expert, not a template — avoid generic phrases like "Learn more", "Find out", "Discover how"
- Use specific details from the page content and knowledge base — mention real services, outcomes, or differentiators
- If GSC queries are provided, mirror the language real searchers use
- If audience personas are provided, write to their specific pain points and goals
- Address the searcher's intent directly — what problem does this page solve?
- LOCATION RULE: If the page keyword targets a specific city/region, use THAT location exactly
${brandName ? `- Brand name: "${brandName}" — use this exact name when referencing the brand` : ''}
- Each variation must take a genuinely different angle, not just rephrase

VARIATION ANGLES:
1. Pain-point: Address the specific problem or need the searcher has, then promise the solution
2. Proof/specificity: Lead with a concrete number, result, or unique differentiator from the business
3. Direct-address: Speak directly to the target persona using "you/your" language with a clear value proposition

Return ONLY a JSON array of 3 strings. No explanation.`;
    } else {
      prompt = `You are an elite SEO copywriter who writes title tags that stand out in search results and earn clicks. Write 3 optimized, differentiated SEO title tags for this page.

PAGE CONTEXT:
- Page title: ${pageTitle}
- Current SEO title: ${currentSeoTitle || '(none)'}
- Current meta description: ${currentDescription || '(none)'}
- Site context: ${siteContext || 'N/A'}
${headingsBlock}
- Page content: ${resolvedPageContent || 'N/A'}
${contextBlocks}

CRAFT GUIDELINES:
- HARD LIMIT: 50-60 characters (NEVER exceed 60)
- Front-load the primary keyword from the strategy
- Use specific, concrete language — avoid vague words like "Best", "Top", "Quality", "Professional" unless justified by context
- If GSC queries are provided, incorporate the exact language searchers use
- If audience personas are provided, use terminology that resonates with them
${brandName ? `- Brand: "${brandName}" — append with pipe separator (|) only if space permits` : ''}
- LOCATION RULE: If the page keyword targets a specific city/region, use THAT location exactly
- Each variation must take a genuinely different angle

VARIATION ANGLES:
1. Keyword-intent: Primary keyword + the specific outcome or service this page delivers
2. Differentiator: Lead with what makes this business unique (from knowledge base/brand context)
3. Searcher-match: Mirror the exact phrasing from top GSC queries or persona language

Return ONLY a JSON array of 3 strings. No explanation.`;
    }

    // Claude primary (richer language), GPT fallback
    const aiText = await callCreativeAI({
      systemPrompt: buildSystemPrompt(workspaceId || '', 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.'),
      userPrompt: prompt,
      maxTokens: 400,
      feature: 'seo-rewrite',
      workspaceId: workspaceId || '',
    });

    // Parse the 3 variations
    let variations: string[];
    try {
      const parsed = JSON.parse(aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      variations = Array.isArray(parsed) ? parsed.map((v: string) => enforceLimit(String(v), maxLen)) : [enforceLimit(String(parsed), maxLen)];
    } catch (err) {
      log.debug({ err }, 'webflow-seo: expected error — degrading gracefully');
      // Fallback: single variation from raw text
      variations = [enforceLimit(aiText, maxLen)];
    }

    // Always return at least the first as `text` for backward compatibility + all as `variations`
    res.json({ text: variations[0] || '', field, variations: variations.filter(Boolean) });
  } catch (err) {
    log.error({ err: err }, 'SEO rewrite error');
    res.status(500).json({ error: 'AI rewrite failed' });
  }
});

// --- Bulk AI SEO Fix ---
router.post('/api/webflow/seo-bulk-fix/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pages: rawPages, field, workspaceId } = req.body as { pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string; pageContent?: string }>; field: 'title' | 'description'; workspaceId?: string };
  // Strip synthetic CMS IDs at the boundary — they are not real Webflow page IDs
  const pages = (rawPages || []).filter(p => !p.pageId.startsWith('cms-'));
  if (!pages?.length) return res.status(400).json({ error: 'pages required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;

  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Try to fetch page content for pages that don't have it (best-effort)
  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
  let baseUrl = '';
  if (ws?.liveDomain) {
    baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
  } else {
    try {
      const sub = await getSiteSubdomain(siteId, token);
      if (sub) baseUrl = `https://${sub}.webflow.io`;
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo/pages: programming error'); /* best-effort */ }
  }

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
      const bulkPagePath = page.slug ? `/${page.slug}` : undefined;
      const bulkFixSeo = wsBulkSeo ? { ...wsBulkSeo } : undefined;
      if (bulkFixSeo && bulkPagePath && bulkFixSeo.strategy?.pageMap?.length) {
        const kw = bulkFixSeo.strategy.pageMap.find(p => p.pagePath.toLowerCase() === bulkPagePath.toLowerCase());
        if (kw) bulkFixSeo.pageKeywords = kw;
      }
      const keywordBlock = formatKeywordsForPrompt(bulkFixSeo);
      // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
      const bvBlock = bulkFixSeo?.effectiveBrandVoiceBlock ?? '';
      const bulkPersonasBlock = formatPersonasForPrompt(bulkFixSeo?.personas ?? []);
      const bulkKnowledgeBlock = formatKnowledgeBaseForPrompt(bulkFixSeo?.knowledgeBase);

      // Fetch page content if not provided and we have a base URL
      let contentExcerpt = page.pageContent || '';
      if (!contentExcerpt && baseUrl && page.slug) {
        try {
          const htmlRes = await fetch(`${baseUrl}/${page.slug}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const body = bodyMatch ? bodyMatch[1] : html;
            contentExcerpt = body
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<nav[\s\S]*?<\/nav>/gi, '')
              .replace(/<footer[\s\S]*?<\/footer>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 800);
          }
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* best-effort */ }
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
        await updatePageSeo(page.pageId, seoFields, token);
        if (ws) {
          updatePageState(ws.id, page.pageId, { status: 'live', source: 'bulk-fix', fields: [field], updatedBy: 'admin' });
          recordSeoChange(ws.id, page.pageId, page.slug || '', page.title || '', [field], 'bulk-fix');
        }
        results.push({ pageId: page.pageId, text, applied: true });
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
router.post('/api/webflow/seo-pattern-apply/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
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
      await updatePageSeo(page.pageId, seoFields, token);

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
router.post('/api/webflow/seo-bulk-rewrite/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pages, field, workspaceId } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>;
    field: 'title' | 'description' | 'both';
    workspaceId?: string;
  };
  if (!pages?.length || !field) return res.status(400).json({ error: 'pages, field required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
  let baseUrl = '';
  if (ws?.liveDomain) {
    baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
  } else {
    try {
      const sub = await getSiteSubdomain(siteId, token);
      if (sub) baseUrl = `https://${sub}.webflow.io`;
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* best-effort */ }
  }

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

  // Enforce character limits helper
  const enforceLimit = (text: string, max: number): string => {
    const t = text.replace(/^["']|["']$/g, '').trim();
    if (t.length <= max) return t;
    const truncated = t.slice(0, max);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > max * 0.6 ? truncated.slice(0, lastSpace) : truncated;
  };

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
      const rwPagePath = page.slug ? `/${page.slug}` : undefined;
      const rwSeo = wsRwSeo ? { ...wsRwSeo } : undefined;
      if (rwSeo && rwPagePath && rwSeo.strategy?.pageMap?.length) {
        const kw = rwSeo.strategy.pageMap.find(p => p.pagePath.toLowerCase() === rwPagePath.toLowerCase());
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
      if (baseUrl && page.slug) {
        try {
          const htmlRes = await fetch(`${baseUrl}/${page.slug}`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const body = bodyMatch ? bodyMatch[1] : html;
            contentExcerpt = body
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<nav[\s\S]*?<\/nav>/gi, '')
              .replace(/<footer[\s\S]*?<\/footer>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 800);
          }
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* best-effort */ }
      }

      // Match GSC queries to this page by slug (top 15 by impressions)
      let gscBlock = '';
      let ctrFlag = '';
      if (allGscData.length > 0 && page.slug) {
        const pageQueries = allGscData
          .filter(r => r.page.includes(page.slug!) || (page.slug === '' && r.page.endsWith('/')))
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
          const parsed = JSON.parse(aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
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
        const parsed = JSON.parse(aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
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

// --- SEO Suggestions: List pending suggestions ---
router.get('/api/webflow/seo-suggestions/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const field = req.query.field as 'title' | 'description' | undefined;
  const suggestions = listSuggestions(workspaceId, field);
  const counts = getSuggestionCounts(workspaceId);
  res.json({ suggestions, counts });
});

// --- SEO Suggestions: Select a variation ---
router.patch('/api/webflow/seo-suggestions/:workspaceId/:suggestionId', async (req, res) => {
  const { workspaceId, suggestionId } = req.params;
  const { selectedIndex } = req.body as { selectedIndex: number };
  if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 2) {
    return res.status(400).json({ error: 'selectedIndex must be 0, 1, or 2' });
  }
  const ok = selectVariation(workspaceId, suggestionId, selectedIndex);
  if (!ok) return res.status(404).json({ error: 'Suggestion not found or already applied' });
  res.json({ ok: true });
});

// --- SEO Suggestions: Apply selected suggestions to Webflow ---
router.post('/api/webflow/seo-suggestions/:workspaceId/apply', async (req, res) => {
  const { workspaceId } = req.params;
  const { suggestionIds } = req.body as { suggestionIds?: string[] };

  // Get suggestions to apply — either specific IDs or all selected
  let toApply = getSelectedSuggestions(workspaceId);
  if (suggestionIds?.length) {
    const idSet = new Set(suggestionIds);
    toApply = toApply.filter(s => idSet.has(s.id));
  }

  if (!toApply.length) return res.status(400).json({ error: 'No suggestions with selected variations to apply' });

  const results: Array<{ pageId: string; field: string; text: string; applied: boolean; error?: string }> = [];

  for (const s of toApply) {
    try {
      const text = s.variations[s.selectedIndex!];
      if (!text) { results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: 'No text at selected index' }); continue; }

      const token = getTokenForSite(s.siteId) || undefined;
      const seoFields = s.field === 'description'
        ? { seo: { description: text } }
        : { seo: { title: text } };
      await updatePageSeo(s.pageId, seoFields, token);

      const ws = getWorkspace(workspaceId);
      if (ws) {
        updatePageState(ws.id, s.pageId, { status: 'live', source: 'bulk-rewrite', fields: [s.field], updatedBy: 'admin' });
        recordSeoChange(ws.id, s.pageId, s.pageSlug, s.pageTitle, [s.field], 'bulk-rewrite');
      }

      results.push({ pageId: s.pageId, field: s.field, text, applied: true });
    } catch (err) {
      results.push({ pageId: s.pageId, field: s.field, text: '', applied: false, error: String(err) });
    }
  }

  // Mark applied suggestions
  const appliedIds = results.filter(r => r.applied).map(r => toApply.find(s => s.pageId === r.pageId)?.id).filter(Boolean) as string[];
  if (appliedIds.length) markApplied(workspaceId, appliedIds);

  log.info(`Applied ${appliedIds.length}/${toApply.length} SEO suggestions for workspace ${workspaceId}`);
  res.json({ results, applied: appliedIds.length, total: toApply.length });
});

// --- SEO Suggestions: Dismiss suggestions ---
router.delete('/api/webflow/seo-suggestions/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const { suggestionIds } = req.body as { suggestionIds?: string[] } || {};
  const dismissed = dismissSuggestions(workspaceId, suggestionIds);
  res.json({ dismissed });
});

// --- Fetch page HTML body text (for keyword analysis) ---
router.get('/api/webflow/page-html/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { siteId } = req.params;
  const pagePath = req.query.path as string;
  if (!pagePath) return res.status(400).json({ error: 'path query param required' });
  const token = getTokenForSite(siteId) || undefined;
  try {
    // Try live domain first (CMS collection pages often only accessible there)
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    const subdomain = await getSiteSubdomain(siteId, token);
    const urls: string[] = [];
    if (ws?.liveDomain) {
      const domain = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
      urls.push(`${domain.replace(/\/+$/, '')}${pagePath}`);
    }
    if (subdomain) urls.push(`https://${subdomain}.webflow.io${pagePath}`);
    if (urls.length === 0) return res.status(400).json({ error: 'Could not resolve site URL' });

    let html = '';
    for (const url of urls) {
      try {
        const htmlRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HmpsnStudioBot/1.0)' } });
        if (htmlRes.ok) { html = await htmlRes.text(); break; }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* try next URL */ }
    }
    if (!html) return res.status(404).json({ error: 'Failed to fetch page from live domain or webflow.io' });

    // Extract title and meta description from HTML (critical for CMS pages that lack Webflow API seo data)
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const seoTitle = titleMatch ? titleMatch[1].trim() : undefined;
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : undefined;

    // Extract body text: strip tags, scripts, styles
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    res.json({ text, seoTitle, metaDescription });
  } catch (e) {
    log.error({ err: e }, 'Page HTML fetch error');
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

// --- Per-Page SEO Copy Generator ---
router.post('/api/webflow/seo-copy', async (req, res) => {
  const { pagePath, pageTitle, currentSeoTitle, currentDescription, currentH1, pageContent, workspaceId } = req.body;
  if (!pagePath || !workspaceId) return res.status(400).json({ error: 'pagePath and workspaceId required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build full context: keywords + brand voice + keyword map
  const copyIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'], pagePath });
  const copySeo = copyIntel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(copySeo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile → legacy fallback
  const brandVoiceBlock = copySeo?.effectiveBrandVoiceBlock ?? '';
  const kwMapContext = formatPageMapForPrompt(copySeo);

  // If no page content was passed, try to fetch it from the live site
  let content = pageContent || '';
  if (!content) {
    const ws = getWorkspace(workspaceId);
    let baseUrl = '';
    if (ws?.liveDomain) {
      baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
    } else if (ws?.webflowSiteId) {
      try {
        const sub = await getSiteSubdomain(ws.webflowSiteId, getTokenForSite(ws.webflowSiteId) || undefined);
        if (sub) baseUrl = `https://${sub}.webflow.io`;
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* best-effort */ }
    }
    if (baseUrl) {
      try {
        const url = `${baseUrl}${pagePath === '/' ? '' : pagePath}`;
        log.info(`Fetching page content from ${url}`);
        const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const html = await r.text();
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const body = bodyMatch ? bodyMatch[1] : html;
          content = body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-seo: programming error'); /* non-critical — proceed without content */ }
    }
  }

  // Find this page's keyword data
  const pageKw = getPageKeyword(workspaceId, pagePath);

  // Resolve brand name
  const copyWs = getWorkspace(workspaceId);
  const copyBrandName = getBrandName(copyWs);

  const prompt = `You are an expert SEO copywriter. Generate optimized SEO copy for this specific web page.

PAGE: ${pagePath}
Current title: ${pageTitle || '(none)'}
Current SEO title: ${currentSeoTitle || '(same as title)'}
Current meta description: ${currentDescription || '(none)'}
Current H1: ${currentH1 || '(none)'}
${pageKw ? `Primary keyword: "${pageKw.primaryKeyword}"
Secondary keywords: ${pageKw.secondaryKeywords?.join(', ') || 'none'}
Search intent: ${pageKw.searchIntent || 'unknown'}
${pageKw.currentPosition ? `Current Google position: #${pageKw.currentPosition.toFixed(0)}` : ''}
${pageKw.impressions ? `Monthly impressions: ${pageKw.impressions}` : ''}` : ''}
${content ? `\nPage content:\n${content.slice(0, 3000)}` : ''}${keywordBlock}${brandVoiceBlock}${kwMapContext}

Generate optimized copy in this exact JSON format:
{
  "seoTitle": "Optimized SEO title tag (50-60 chars, front-load primary keyword)",
  "metaDescription": "Compelling meta description (150-160 chars, include CTA, naturally incorporate keywords)",
  "h1": "Optimized H1 heading (clear, keyword-rich, matches search intent)",
  "introParagraph": "Rewritten opening paragraph (2-3 sentences, hook the reader, incorporate primary keyword naturally within first sentence, set clear expectations for the page content)",
  "internalLinkSuggestions": [
    { "targetPath": "/page-path", "anchorText": "suggested link text", "context": "Where/why to place this link" }
  ],
  "changes": [
    "Brief bullet explaining each change you made and why it will improve rankings"
  ]
}

CRITICAL RULES:
- PRESERVE the existing brand voice and tone exactly — do NOT make it sound generic or corporate
- Every piece of copy must sound like it was written by the same person/team who wrote the existing content
- Incorporate keywords NATURALLY — never stuff or force them
- The intro paragraph should feel like a natural improvement, not a complete rewrite from scratch
- Internal link suggestions should reference real pages from the keyword map
- Changes array should explain your reasoning so the team can learn
${copyBrandName ? `- The brand name is "${copyBrandName}" — use this exact name if referencing the brand (never use a shortened/abbreviated version)` : ''}
Return ONLY valid JSON, no markdown fences.`;

  try {
    const aiResult = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are an expert SEO copywriter who preserves brand voice while optimizing for search. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 1500,
      temperature: 0.6,
      feature: 'content-score',
      workspaceId,
    });

    const raw = aiResult.text || '{}';
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      log.debug({ err }, 'webflow-seo: expected error — degrading gracefully');
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: raw.slice(0, 500) });
    }

    // Enforce character limits
    if (parsed.seoTitle && parsed.seoTitle.length > 60) {
      const t = parsed.seoTitle.slice(0, 60);
      const ls = t.lastIndexOf(' ');
      parsed.seoTitle = ls > 36 ? t.slice(0, ls) : t;
    }
    if (parsed.metaDescription && parsed.metaDescription.length > 160) {
      const t = parsed.metaDescription.slice(0, 160);
      const ls = t.lastIndexOf(' ');
      parsed.metaDescription = ls > 96 ? t.slice(0, ls) : t;
    }

    res.json(parsed);
  } catch (err) {
    log.error({ err: err }, 'SEO copy generator error');
    res.status(500).json({ error: 'SEO copy generation failed' });
  }
});

export default router;
