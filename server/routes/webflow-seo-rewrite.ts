/**
 * Webflow SEO rewrite routes.
 *
 * @reads workspaces, snapshots, page_keywords, analytics_insights, workspace_intelligence, search_console, webflow_api
 * @writes none
 */
import { Router } from 'express';

import { callCreativeAI } from '../content-posts-ai.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { getLatestSnapshot } from '../reports.js';
import { getQueryPageData } from '../search-console.js';
import { getInsights } from '../analytics-insights-store.js';
import { isProgrammingError } from '../errors.js';
import {
  matchGscUrlToPath,
  normalizePageUrl,
  stripCodeFences,
  stripHtmlToText,
} from '../helpers.js';
import { createLogger } from '../logger.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { getBrandName, getTokenForSite, getWorkspace } from '../workspaces.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPageMapForPrompt,
  formatPersonasForPrompt,
} from '../workspace-intelligence.js';
import { enforceSeoTextLimit } from '../webflow-seo-rewrite-utils.js';

const router = Router();
const log = createLogger('webflow-seo');

// --- AI SEO Rewrite (returns 3 variations) ---
router.post('/api/webflow/seo-rewrite', async (req, res) => {
  const { pageTitle, currentSeoTitle, currentDescription, pageContent, siteContext, field, workspaceId, pagePath } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });
  const normalizedPagePath = typeof pagePath === 'string' && pagePath ? normalizePageUrl(pagePath) : undefined;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build full context: keyword strategy + brand voice + personas + knowledge base
  const rewriteIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext', 'pageProfile'], pagePath: normalizedPagePath });
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
  if (workspaceId && normalizedPagePath) {
    try {
      const ws = getWorkspace(workspaceId);
      if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
        const queryPageData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 28);
        const pageQueries = queryPageData
          .filter(r => matchGscUrlToPath(r.page, normalizedPagePath))
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
  let headingsBlock = '';
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

          resolvedPageContent = stripHtmlToText(html, { maxLength: 1500 });
        }
      }
    } catch { /* best-effort — fetch on external URL, continue without content */ } // url-fetch-ok
  }

  try {
    // Persisted page analysis (optimizationIssues + recommendations from keyword analysis)
    const pageAnalysisBlock = formatForPrompt(rewriteIntel, { verbosity: 'detailed', sections: ['pageProfile'] }); // bip-ok: rewriteIntel used for raw field access above

    // Intelligence context: cannibalization + page health + content decay
    let intelligenceBlock = '';
    if (workspaceId && normalizedPagePath) {
      try {
        const allInsights = getInsights(workspaceId);
        const pageInsights = allInsights.filter(i =>
          i.pageId && normalizePageUrl(i.pageId) === normalizedPagePath
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
      formatPageMapForPrompt(rewriteSeo),
      intelligenceBlock,
    ].filter(Boolean).join('');

    // "both" mode: generate paired title + description in one call
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
        json: false,
        systemPrompt: buildSystemPrompt(workspaceId || '', 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.'),
        userPrompt: prompt,
        maxTokens: 800,
        feature: 'seo-rewrite-both',
        workspaceId: workspaceId || '',
      });

      let pairs: Array<{ title: string; description: string }>;
      const parsedPairs = parseJsonFallback<Array<{ title?: string; description?: string }> | null>(stripCodeFences(aiText), null);
      pairs = Array.isArray(parsedPairs)
        ? parsedPairs.map((p: { title?: string; description?: string }) => ({
            title: enforceSeoTextLimit(String(p.title || ''), 60),
            description: enforceSeoTextLimit(String(p.description || ''), 160),
          }))
        : [];
      while (pairs.length < 3 && pairs.length > 0) pairs.push(pairs[0]);

      res.json({
        field: 'both',
        pairs,
        titleVariations: pairs.map(p => p.title),
        descriptionVariations: pairs.map(p => p.description),
      });
      return;
    }

    // Single-field mode (title or description)
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

    const aiText = await callCreativeAI({
      json: false,
      systemPrompt: buildSystemPrompt(workspaceId || '', 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.'),
      userPrompt: prompt,
      maxTokens: 400,
      feature: 'seo-rewrite',
      workspaceId: workspaceId || '',
    });

    // Parse the 3 variations
    const parsedVariations = parseJsonFallback<unknown>(stripCodeFences(aiText), undefined);
    let variations: string[];
    if (Array.isArray(parsedVariations)) {
      variations = parsedVariations.map(v => enforceSeoTextLimit(String(v), maxLen));
    } else if (parsedVariations !== undefined) {
      variations = [enforceSeoTextLimit(String(parsedVariations), maxLen)];
    } else {
      variations = [enforceSeoTextLimit(aiText, maxLen)];
    }

    // Always return at least the first as `text` for backward compatibility + all as `variations`
    res.json({ text: variations[0] || '', field, variations: variations.filter(Boolean) });
  } catch (err) {
    log.error({ err: err }, 'SEO rewrite error');
    res.status(500).json({ error: 'AI rewrite failed' });
  }
});

export default router;
