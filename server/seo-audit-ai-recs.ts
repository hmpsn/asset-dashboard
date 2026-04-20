// AI-powered meta tag recommendations for SEO audit engine.
// Extracted from seo-audit.ts for modularity.
// Note: mutates results[].issues[].suggestedFix in-place — no DB writes.

import { callOpenAI } from './openai-helpers.js';
import { buildWorkspaceIntelligence, formatForPrompt } from './workspace-intelligence.js';
import { listWorkspaces, getBrandName } from './workspaces.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { PageSeoResult } from './audit-page.js';

const log = createLogger('seo-audit-ai-recs');

export interface AiRecsOpts {
  results: PageSeoResult[];
  htmlCache: Map<string, string>;
  workspaceId?: string;
  siteId: string;
}

// Helper: extract readable body text from HTML for context
function extractBodyText(html: string): string {
  // Remove script/style/nav/footer/header blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  // Extract headings separately for emphasis
  const headings: string[] = [];
  const hRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = hRegex.exec(text)) !== null) {
    headings.push(hm[1].replace(/<[^>]+>/g, '').trim());
  }
  // Strip tags and normalize whitespace
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Return headings + body excerpt (capped at 2000 chars for token efficiency)
  const headingStr = headings.length > 0 ? `KEY HEADINGS: ${headings.slice(0, 8).join(' | ')}\n` : '';
  return headingStr + text.slice(0, 2000);
}

export async function generateAiRecommendations(opts: AiRecsOpts): Promise<void> {
  const { results, htmlCache, workspaceId, siteId } = opts;

  // --- AI-Powered Recommendations ---
  // Generate keyword-optimized title/meta description suggestions using actual page content
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    // Resolve workspaceId from siteId if not provided
    const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
    const pagesNeedingFixes = results.filter(r =>
      r.issues.some(i => ['title', 'meta-description', 'og-tags'].includes(i.check))
    );
    log.info(`Generating AI recommendations for ${pagesNeedingFixes.length} pages (workspace: ${wsId || 'unknown'})...`);

    // Resolve brand name so AI uses correct name in suggestions
    const auditWs = wsId ? listWorkspaces().find(w => w.id === wsId) : undefined;
    const auditBrandName = getBrandName(auditWs);

    // Pre-assemble workspace-level slices once — learnings and seoContext base data are identical
    // for every page. pageKeywords (the only page-specific seoContext field) is a find() on the
    // pre-built pageMap, derived inline per page. pageProfile remains per-page (requires pagePath).
    // contentPipeline carries cannibalizationWarnings so the AI can recommend consolidation when
    // a page's primary keyword is also targeted by other pages.
    const wsIntel = await buildWorkspaceIntelligence(wsId ?? '', { slices: ['learnings', 'seoContext', 'contentPipeline'] as const });

    const aiBatch = 15;
    for (let i = 0; i < pagesNeedingFixes.length; i += aiBatch) {
      // Stagger batches to avoid hammering rate limits
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      const batch = pagesNeedingFixes.slice(i, i + aiBatch);
      await Promise.all(batch.map(async (pageResult) => {
        try {
          const titleIssue = pageResult.issues.find(i => i.check === 'title');
          const descIssue = pageResult.issues.find(i => i.check === 'meta-description');
          const ogTitleIssue = pageResult.issues.find(i => i.check === 'og-tags' && i.message.includes('title'));
          const ogDescIssue = pageResult.issues.find(i => i.check === 'og-tags' && i.message.includes('description'));

          if (!titleIssue && !descIssue && !ogTitleIssue && !ogDescIssue) return;

          const currentTitle = titleIssue?.value || pageResult.page || '';
          const currentDesc = descIssue?.value || '';

          // Get actual page content for on-brand suggestions
          const cachedHtml = htmlCache.get(pageResult.pageId);
          const pageContent = cachedHtml ? extractBodyText(cachedHtml) : '';

          // Build keyword strategy + brand voice + KB + personas context for this page
          const pagePath = pageResult.url ? (() => { try { return new URL(pageResult.url).pathname; } catch (err) { return undefined; } })() : undefined;
          // Derive per-page keywords from pre-built pageMap — no extra DB call for seoContext
          const seoCtx = wsIntel.seoContext ? { ...wsIntel.seoContext } : undefined;
          if (seoCtx && pagePath && seoCtx.strategy?.pageMap?.length) {
            const kw = seoCtx.strategy.pageMap.find(p => p.pagePath.toLowerCase() === pagePath.toLowerCase());
            if (kw) seoCtx.pageKeywords = kw;
          }
          const pageProfileIntel = await buildWorkspaceIntelligence(wsId ?? '', { slices: ['pageProfile'] as const, pagePath });
          const intel = { ...wsIntel, seoContext: seoCtx, pageProfile: pageProfileIntel.pageProfile };
          const fullContext = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext', 'learnings', 'pageProfile'] }); // bip-ok: slices is a superset

          // Build cannibalization context block if this page's primary keyword is flagged
          const pageKeyword = seoCtx?.pageKeywords?.primaryKeyword?.toLowerCase().trim();
          const cannibalizationWarnings = wsIntel.contentPipeline?.cannibalizationWarnings ?? [];
          const cannibalizationMatch = pageKeyword
            ? cannibalizationWarnings.find(w => w.keyword.toLowerCase().trim() === pageKeyword)
            : undefined;
          // Filter sibling pages: exclude this page's own path (pagePath is a pathname like /about,
          // matching the format stored in cannibalizationWarnings[].pages) and exclude matrix cell
          // UUIDs that carry no page identity.
          const siblingPages = cannibalizationMatch
            ? cannibalizationMatch.pages.filter(p =>
                p !== pagePath && !p.match(/^[0-9a-f-]{36}$/)
              )
            : [];
          const cannibalizationBlock = cannibalizationMatch && siblingPages.length > 0
            ? `\nKEYWORD CANNIBALIZATION WARNING:\nThe primary keyword "${cannibalizationMatch.keyword}" is also targeted by ${siblingPages.length} other page(s): ${siblingPages.join(', ')}. Severity: ${cannibalizationMatch.severity}.\nDo NOT suggest optimizing this page to rank harder for the same keyword as its siblings — that worsens cannibalization. Instead, recommend in the meta description that this page targets a differentiated angle or sub-topic, and recommend consolidation if appropriate.\n`
            : '';

          const prompt = `You are an expert SEO copywriter. Generate optimized meta tags for this webpage that match the brand voice and target the right keywords.

PAGE: ${pageResult.page}
URL: ${pageResult.url}
CURRENT TITLE: ${currentTitle || '(missing)'}
CURRENT META DESCRIPTION: ${currentDesc || '(missing)'}

${pageContent ? `PAGE CONTENT:\n${pageContent}\n` : ''}${fullContext}${cannibalizationBlock}
ISSUES TO FIX:
${titleIssue ? `- Title: ${titleIssue.message}` : ''}
${descIssue ? `- Meta Description: ${descIssue.message}` : ''}
${ogTitleIssue ? `- OG Title: ${ogTitleIssue.message}` : ''}

RULES:
- If keyword strategy is provided above, the title MUST include the primary keyword near the start
- If brand voice is provided above, match that exact tone and style
- Title: 30-60 chars, front-load the primary keyword, compelling for clicks
- Meta Description: 120-155 chars, include primary + secondary keywords naturally, include a call-to-action
- OG Title: Can match the SEO title or be slightly more conversational for social sharing
- Use natural language that sounds like it belongs on this specific website
- Pull specific terminology, services, or value props directly from the page content
${auditBrandName ? `- The brand name is "${auditBrandName}" — use this exact name if referencing the brand (never use a shortened/abbreviated version)` : ''}
Respond in this exact JSON format (only include fields that need fixing):
{"title":"...","metaDescription":"...","ogTitle":"..."}`;

          const aiResult = await callOpenAI({
            model: 'gpt-4.1-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            maxTokens: 400,
            feature: 'seo-audit-recs',
            workspaceId: wsId,
          });

          const content = aiResult.text;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return;

          const suggestions = parseJsonFallback<{ title?: string; metaDescription?: string; ogTitle?: string }>(jsonMatch[0], {});

          if (suggestions.title && titleIssue) {
            titleIssue.suggestedFix = suggestions.title;
          }
          if (suggestions.metaDescription && descIssue) {
            descIssue.suggestedFix = suggestions.metaDescription;
          }
          if (suggestions.ogTitle && ogTitleIssue) {
            ogTitleIssue.suggestedFix = suggestions.ogTitle;
          }
          // If OG desc is missing but we have a meta desc suggestion, use it
          if (ogDescIssue && suggestions.metaDescription) {
            ogDescIssue.suggestedFix = suggestions.metaDescription;
          }
        } catch (err) {
          log.error({ err: err }, `AI recommendation failed for ${pageResult.page}:`);
        }
      }));
    }
  }
}
