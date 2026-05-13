/**
 * Webflow SEO page utility routes.
 *
 * @reads workspaces, page_keywords, workspace_intelligence, webflow_api
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromBody, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { normalizePageUrl, stripCodeFences, stripHtmlToText } from '../helpers.js';
import { createLogger } from '../logger.js';
import { callAI } from '../ai.js';
import { getPageKeyword } from '../page-keywords.js';
import { resolveBaseUrl } from '../url-helpers.js';
import { getSiteSubdomain } from '../webflow.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatPageMapForPrompt,
} from '../workspace-intelligence.js';
import {
  getBrandName,
  getTokenForSite,
  getWorkspace,
  listWorkspaces,
} from '../workspaces.js';

const router = Router();
const log = createLogger('webflow-seo-page-tools');

interface SeoCopyResponse {
  seoTitle?: string;
  metaDescription?: string;
  h1?: string;
  introParagraph?: string;
  internalLinkSuggestions?: Array<{ targetPath: string; anchorText: string; context: string }>;
  changes?: string[];
}

// --- Fetch page HTML body text (for keyword analysis) ---
router.get('/api/webflow/page-html/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  const { siteId } = req.params;
  const pagePath = typeof req.query.path === 'string' ? normalizePageUrl(req.query.path) : '';
  if (!pagePath) return res.status(400).json({ error: 'path query param required' });
  const token = getTokenForSite(siteId) || undefined;
  try {
    // Try live domain first (CMS collection pages often only accessible there)
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
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

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build full context: keywords + brand voice + keyword map
  const copyIntel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'], pagePath });
  const copySeo = copyIntel.seoContext;
  const keywordBlock = formatKeywordsForPrompt(copySeo);
  // Voice authority: effectiveBrandVoiceBlock already honors voice profile to legacy fallback.
  const brandVoiceBlock = copySeo?.effectiveBrandVoiceBlock ?? '';
  const kwMapContext = formatPageMapForPrompt(copySeo);

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
- PRESERVE the existing brand voice and tone exactly - do NOT make it sound generic or corporate
- Every piece of copy must sound like it was written by the same person/team who wrote the existing content
- Incorporate keywords NATURALLY - never stuff or force them
- The intro paragraph should feel like a natural improvement, not a complete rewrite from scratch
- Internal link suggestions should reference real pages from the keyword map
- Changes array should explain your reasoning so the team can learn
${copyBrandName ? `- The brand name is "${copyBrandName}" - use this exact name if referencing the brand (never use a shortened/abbreviated version)` : ''}
Return ONLY valid JSON, no markdown fences.`;

  try {
    const aiResult = await callAI({
      model: 'gpt-5.4-mini',
      system: 'You are an expert SEO copywriter who preserves brand voice while optimizing for search. Return valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.6,
      feature: 'content-score',
      workspaceId,
    });

    const raw = aiResult.text || '{}';
    const cleaned = stripCodeFences(raw);

    const parsed = parseJsonFallback<SeoCopyResponse | null>(cleaned, null);
    if (!parsed) {
      log.debug('webflow-seo: expected JSON parse error - degrading gracefully');
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
