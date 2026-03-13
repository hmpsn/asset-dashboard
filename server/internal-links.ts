/**
 * Internal Linking Suggestions — analyzes page content and uses AI
 * to recommend where internal links should be added between pages.
 */

import {
  listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet,
  getSiteSubdomain,
} from './webflow.js';
import { getWorkspace } from './workspaces.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext, buildKnowledgeBase } from './seo-context.js';
import { createLogger } from './logger.js';

const log = createLogger('internal-links');

export interface PageContent {
  path: string;
  title: string;
  contentSnippet: string;
  existingInternalLinks: string[];
}

export interface LinkSuggestion {
  fromPage: string;
  fromTitle: string;
  toPage: string;
  toTitle: string;
  anchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface InternalLinkResult {
  suggestions: LinkSuggestion[];
  pageCount: number;
  existingLinkCount: number;
  analyzedAt: string;
}

async function fetchPageContent(url: string): Promise<{ content: string; internalLinks: string[] } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract body text — strip nav/header/footer so we only see page content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    const contentHtml = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');
    const content = contentHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract internal links from CONTENT ONLY (not nav/header/footer)
    // Nav links make every page appear to link to every other page,
    // hiding the real in-content linking gaps the AI should find.
    const linkRegex = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi;
    const internalLinks: string[] = [];
    let match;
    while ((match = linkRegex.exec(contentHtml)) !== null) {
      const href = match[1].trim();
      if (href.startsWith('/') || href.startsWith(url.split('/').slice(0, 3).join('/'))) {
        try {
          const parsed = new URL(href, url);
          internalLinks.push(parsed.pathname);
        } catch { /* skip */ }
      }
    }

    return { content: content.slice(0, 1200), internalLinks: [...new Set(internalLinks)] };
  } catch {
    return null;
  }
}

export async function analyzeInternalLinks(
  siteId: string,
  workspaceId?: string,
  tokenOverride?: string,
): Promise<InternalLinkResult> {
  const token = tokenOverride || process.env.WEBFLOW_API_TOKEN || '';
  const openaiKey = process.env.OPENAI_API_KEY;

  // Resolve base URL
  const ws = workspaceId ? getWorkspace(workspaceId) : null;
  const subdomain = await getSiteSubdomain(siteId, token);
  const baseUrl = ws?.liveDomain
    ? `https://${ws.liveDomain}`
    : subdomain ? `https://${subdomain}.webflow.io` : '';

  if (!baseUrl) {
    return { suggestions: [], pageCount: 0, existingLinkCount: 0, analyzedAt: new Date().toISOString() };
  }

  // Gather all pages
  const allPages = await listPages(siteId, tokenOverride);
  const published = filterPublishedPages(allPages);

  const pageUrls: Array<{ url: string; path: string; title: string }> = published.map(p => {
    // Use publishedPath for full URL (handles nested pages like /about/team)
    const pagePath = p.publishedPath || (p.slug ? `/${p.slug}` : '');
    return {
      url: pagePath ? `${baseUrl}${pagePath}` : baseUrl,
      path: pagePath || '/',
      title: p.title || p.slug || 'Home',
    };
  });

  // Also discover CMS pages (limit to 30 for performance)
  const staticPaths = buildStaticPathSet(published);
  try {
    const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 30);
    for (const cms of cmsUrls) {
      pageUrls.push({ url: cms.url, path: cms.path, title: cms.pageName });
    }
  } catch { /* skip */ }

  log.info(`Internal links: fetching content for ${pageUrls.length} pages`);

  // Fetch content for all pages
  const pages: PageContent[] = [];
  const batchSize = 5;
  for (let i = 0; i < pageUrls.length; i += batchSize) {
    const chunk = pageUrls.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(p => fetchPageContent(p.url)));
    for (let j = 0; j < chunk.length; j++) {
      const result = results[j];
      if (result) {
        pages.push({
          path: chunk[j].path,
          title: chunk[j].title,
          contentSnippet: result.content,
          existingInternalLinks: result.internalLinks,
        });
      }
    }
  }

  const existingLinkCount = pages.reduce((sum, p) => sum + p.existingInternalLinks.length, 0);
  log.info(`Internal links: ${pages.length} pages loaded, ${existingLinkCount} existing internal links`);

  if (!openaiKey || pages.length < 2) {
    return { suggestions: [], pageCount: pages.length, existingLinkCount, analyzedAt: new Date().toISOString() };
  }

  // Enrich with brand voice for better anchor text quality
  const wsObj = workspaceId ? getWorkspace(workspaceId) : null;
  const { brandVoiceBlock } = buildSeoContext(workspaceId);
  const brandCtx = brandVoiceBlock || (wsObj?.brandVoice ? `\nBrand voice: ${wsObj.brandVoice}` : '');

  // Build the page summary for AI analysis
  const pageSummaries = pages.map(p => {
    const links = p.existingInternalLinks.length > 0
      ? `Links to: ${p.existingInternalLinks.slice(0, 10).join(', ')}`
      : 'No internal links';
    return `PATH: ${p.path}\nTITLE: ${p.title}\nCONTENT: ${p.contentSnippet.slice(0, 600)}\n${links}`;
  }).join('\n\n---\n\n');

  // Get keyword strategy for extra context
  let kwContext = '';
  if (ws?.keywordStrategy?.pageMap) {
    const kwMap = ws.keywordStrategy.pageMap.map(
      (pm: { pagePath: string; primaryKeyword: string }) => `${pm.pagePath}: "${pm.primaryKeyword}"`
    ).join('\n');
    kwContext = `\n\nKeyword targets per page:\n${kwMap}`;
  }

  // Add business knowledge for better link priority and anchor text
  const knowledgeBlock = workspaceId ? buildKnowledgeBase(workspaceId) : '';

  const prompt = `You are an expert SEO strategist analyzing internal linking opportunities for a website. 

Here are all the pages on the site with their content and existing internal links:

${pageSummaries}
${kwContext}${knowledgeBlock}

Analyze the content relationships between pages and suggest internal links that are MISSING. For each suggestion:
1. Identify WHERE a link should be added (source page)
2. Identify WHAT page it should link to (destination page)
3. Suggest natural anchor text
4. Explain WHY this link makes sense (topical relevance, user journey, SEO value)
5. Rate priority: "high" (strongly related content, no existing link), "medium" (related, would help), "low" (loosely related)

Rules:
- Only suggest links between pages that DON'T already link to each other
- Prioritize links that connect semantically related content
- Suggest anchor text that would be natural in the source page's content
- Focus on high-value linking: service pages linking to related services, location pages cross-linking, blog posts linking to service pages
- Include bidirectional suggestions where appropriate (if A should link to B, B might also link to A)
- Aim for 10-20 high-quality suggestions, not exhaustive lists
- Every page should ideally have at least 2-3 internal links
- Anchor text should sound natural and match the site's tone${brandCtx ? ` (${brandCtx.replace(/\n/g, ' ').trim()})` : ''}

Return ONLY a JSON array:
[
  {
    "fromPage": "/source-path",
    "fromTitle": "Source Page Title",
    "toPage": "/destination-path",
    "toTitle": "Destination Page Title",
    "anchorText": "suggested anchor text",
    "reason": "brief explanation",
    "priority": "high"
  }
]

Return ONLY valid JSON array, no markdown fences, no explanation.`;

  try {
    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'You are an SEO expert. Return only valid JSON arrays, no markdown, no explanation.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 4000,
      temperature: 0.3,
      feature: 'internal-links',
      workspaceId: workspaceId || undefined,
    });

    let raw = aiResult.text || '[]';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let suggestions: LinkSuggestion[];
    try {
      suggestions = JSON.parse(raw);
    } catch {
      log.error('Internal links: AI returned invalid JSON');
      suggestions = [];
    }

    // Validate and clean suggestions
    suggestions = suggestions.filter(s =>
      s.fromPage && s.toPage && s.anchorText && s.reason &&
      s.fromPage !== s.toPage &&
      ['high', 'medium', 'low'].includes(s.priority)
    );

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    log.info(`Internal links: generated ${suggestions.length} suggestions`);

    return {
      suggestions,
      pageCount: pages.length,
      existingLinkCount,
      analyzedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.error({ err: err }, 'Internal links analysis error');
    return { suggestions: [], pageCount: pages.length, existingLinkCount, analyzedAt: new Date().toISOString() };
  }
}
