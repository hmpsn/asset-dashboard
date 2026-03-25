/**
 * webflow-seo routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

import { callOpenAI } from '../openai-helpers.js';
import { callCreativeAI } from '../content-posts-ai.js';
import { getLatestSnapshot } from '../reports.js';
import { runSeoAudit } from '../seo-audit.js';
import { buildSeoContext, buildKeywordMapContext } from '../seo-context.js';
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
import { createLogger } from '../logger.js';

const log = createLogger('webflow-seo');

// --- SEO Audit ---
router.get('/api/webflow/seo-audit/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    if (!token) {
      log.error({ detail: req.params.siteId }, 'SEO audit: No token available for site');
      return res.status(500).json({ error: 'No Webflow API token configured. Please link a workspace to this site in Settings, or set WEBFLOW_API_TOKEN environment variable.' });
    }
    const result = await runSeoAudit(req.params.siteId, token, req.query.workspaceId as string | undefined);
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
  const { keywordBlock: keywordContext, brandVoiceBlock, personasBlock, knowledgeBlock } = buildSeoContext(workspaceId, pagePath);

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
        }
      }
    } catch { /* non-critical — continue without GSC data */ }
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
    } catch { /* non-critical */ }
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
    } catch { /* best-effort — continue without content */ }
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
    const maxLen = field === 'description' ? 160 : 60;

    // Assemble all context blocks
    const contextBlocks = [
      keywordContext,
      brandVoiceBlock,
      personasBlock,
      knowledgeBlock,
      gscBlock,
      auditBlock,
    ].filter(Boolean).join('');

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
      systemPrompt: 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.',
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
    } catch {
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
  const { pages, field, workspaceId } = req.body as { pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string; pageContent?: string }>; field: 'title' | 'description'; workspaceId?: string };
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
    } catch { /* best-effort */ }
  }

  const inlineBrandName = getBrandName(ws);

  const results = [];
  for (const page of pages) {
    try {
      const { keywordBlock, brandVoiceBlock: bvBlock, personasBlock: bulkPersonasBlock, knowledgeBlock: bulkKnowledgeBlock } = buildSeoContext(workspaceId || ws?.id, page.slug ? `/${page.slug}` : undefined);

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
        } catch { /* best-effort */ }
      }

      const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
      const brandNote = inlineBrandName ? `\nBrand name is "${inlineBrandName}" — use this exact name, never an abbreviated version.` : '';
      const locationRule = `\n- LOCATION RULE: If this page's primary keyword targets a specific city/region, ALWAYS use THAT location.`;
      const extraContext = [bulkPersonasBlock, bulkKnowledgeBlock].filter(Boolean).join('');
      const prompt = field === 'description'
        ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${contentSection}${keywordBlock}${bvBlock}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 160 characters\n- Use specific details from the knowledge base — mention real services, outcomes, or differentiators\n- Write to the target persona's pain points if personas are provided\n- Include primary keyword naturally${locationRule}\nReturn ONLY the text.`
        : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${contentSection}${keywordBlock}${bvBlock}${extraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 60 characters\n- Front-load the primary keyword\n- Use specific language from the knowledge base, not generic filler${locationRule}\nReturn ONLY the text.`;

      const aiResult = await callOpenAI({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 150,
        temperature: 0.7,
        feature: 'seo-bulk-fix',
        workspaceId: workspaceId || ws?.id,
      });

      let text = aiResult.text.replace(/^["']|["']$/g, '');
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
  const { pages, field, action, text: patternText } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; currentValue: string }>;
    field: 'title' | 'description';
    action: 'append' | 'prepend' | 'replace';
    text: string;
  };
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

// --- Bulk AI Rewrite (selected pages, concurrency-limited) ---
router.post('/api/webflow/seo-bulk-rewrite/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pages, field, workspaceId, dryRun } = req.body as {
    pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>;
    field: 'title' | 'description';
    workspaceId?: string;
    dryRun?: boolean; // preview only, don't push to Webflow
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
    } catch { /* best-effort */ }
  }

  const inlineBrandName = getBrandName(ws);
  const maxLen = field === 'description' ? 160 : 60;
  const CONCURRENCY = 3;

  const results: Array<{ pageId: string; oldValue: string; newValue: string; applied: boolean; error?: string }> = [];

  // Process in concurrent batches for performance
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(async (page) => {
      const { keywordBlock, brandVoiceBlock: bvBlock, personasBlock: rwPersonasBlock, knowledgeBlock: rwKnowledgeBlock } = buildSeoContext(workspaceId || ws?.id, page.slug ? `/${page.slug}` : undefined);

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
        } catch { /* best-effort */ }
      }

      const contentSection = contentExcerpt ? `\nPage content excerpt: ${contentExcerpt}` : '';
      const brandNote = inlineBrandName ? `\nBrand name is "${inlineBrandName}" — use this exact name, never an abbreviated version.` : '';
      const locationRule = `\n- LOCATION RULE: If this page's primary keyword targets a specific city/region, ALWAYS use THAT location.`;
      const rwExtraContext = [rwPersonasBlock, rwKnowledgeBlock].filter(Boolean).join('');

      const oldValue = field === 'title' ? (page.currentSeoTitle || '') : (page.currentDescription || '');
      const prompt = field === 'description'
        ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 160 characters\n- Use specific details from the knowledge base — mention real services, outcomes, or differentiators\n- Write to the target persona's pain points if personas are provided\n- Include primary keyword naturally${locationRule}\nReturn ONLY the text.`
        : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${oldValue}".${contentSection}${keywordBlock}${bvBlock}${rwExtraContext}${brandNote}\n\nRules:\n- HARD LIMIT: 60 characters\n- Front-load the primary keyword\n- Use specific language from the knowledge base, not generic filler${locationRule}\nReturn ONLY the text.`;

      const aiResult = await callOpenAI({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 200,
        temperature: 0.7,
        feature: 'seo-bulk-rewrite',
        workspaceId: workspaceId || ws?.id,
      });

      let text = aiResult.text.replace(/^["']|["']$/g, '');
      if (text.length > maxLen) {
        const truncated = text.slice(0, maxLen);
        const lastSpace = truncated.lastIndexOf(' ');
        text = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
      }

      if (!text) return { pageId: page.pageId, oldValue, newValue: '', applied: false, error: 'Empty AI response' };

      if (!dryRun) {
        const seoFields = field === 'description'
          ? { seo: { description: text } }
          : { seo: { title: text } };
        await updatePageSeo(page.pageId, seoFields, token);
        if (ws) {
          updatePageState(ws.id, page.pageId, { status: 'live', source: 'bulk-rewrite', fields: [field], updatedBy: 'admin' });
          recordSeoChange(ws.id, page.pageId, page.slug || '', page.title || '', [field], 'bulk-rewrite');
        }
      }

      return { pageId: page.pageId, oldValue, newValue: text, applied: !dryRun };
    }));

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ pageId: batch[results.length % batch.length]?.pageId || '', oldValue: '', newValue: '', applied: false, error: String(r.reason) });
      }
    }
  }

  log.info(`Bulk rewrite: ${results.filter(r => r.applied).length}/${pages.length} ${field}s ${dryRun ? 'previewed' : 'updated'}`);
  res.json({ results, field, dryRun: !!dryRun });
});

// --- Fetch page HTML body text (for keyword analysis) ---
router.get('/api/webflow/page-html/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { siteId } = req.params;
  const pagePath = req.query.path as string;
  if (!pagePath) return res.status(400).json({ error: 'path query param required' });
  const token = getTokenForSite(siteId) || undefined;
  try {
    const subdomain = await getSiteSubdomain(siteId, token);
    if (!subdomain) return res.status(400).json({ error: 'Could not resolve site subdomain' });
    const url = `https://${subdomain}.webflow.io${pagePath}`;
    const htmlRes = await fetch(url, { redirect: 'follow' });
    if (!htmlRes.ok) return res.status(htmlRes.status).json({ error: `Failed to fetch page: ${htmlRes.status}` });
    const html = await htmlRes.text();
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
    res.json({ text });
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
  const { keywordBlock, brandVoiceBlock, strategy } = buildSeoContext(workspaceId, pagePath);
  const kwMapContext = buildKeywordMapContext(workspaceId);

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
      } catch { /* best-effort */ }
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
      } catch { /* non-critical — proceed without content */ }
    }
  }

  // Find this page's keyword data
  const pageKw = strategy?.pageMap?.find(
    p => p.pagePath === pagePath || pagePath.includes(p.pagePath) || p.pagePath.includes(pagePath)
  );

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
    } catch {
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
