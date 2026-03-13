/**
 * keyword-strategy routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import {
  getGA4Conversions,
  getGA4EventsByPage,
  getGA4LandingPages,
  getGA4OrganicOverview,
} from '../google-analytics.js';
import { applySuppressionsToAudit, getAuditTrafficForWorkspace } from '../helpers.js';
import { callOpenAI } from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import {
  getQueryPageData,
  getSearchDeviceBreakdown,
  getSearchCountryBreakdown,
  getSearchPeriodComparison,
} from '../search-console.js';
import {
  isSemrushConfigured,
  getKeywordOverview,
  getDomainOrganicKeywords,
  getKeywordGap,
  getRelatedKeywords,
} from '../semrush.js';
import { checkUsageLimit, incrementUsage } from '../usage-tracking.js';
import {
  listPages,
  filterPublishedPages,
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import { buildKnowledgeBase } from '../seo-context.js';
import { updateWorkspace, getWorkspace, getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('keyword-strategy');

// --- Keyword Strategy Generation (SSE progress) ---
router.post('/api/webflow/keyword-strategy/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  // Usage limit check
  const tier = ws.tier || 'free';
  const strategyUsage = checkUsageLimit(ws.id, tier, 'strategy_generations');
  if (!strategyUsage.allowed) {
    return res.status(429).json({
      error: 'Strategy generation limit reached',
      message: `You've used all ${strategyUsage.limit} strategy generations this month. Upgrade for more.`,
      used: strategyUsage.used, limit: strategyUsage.limit,
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const businessContext = (req.body?.businessContext as string) || ws.keywordStrategy?.businessContext || '';
  const semrushMode = (req.body?.semrushMode as string) || 'none'; // 'quick', 'full', 'none'
  const competitorDomains = (req.body?.competitorDomains as string[]) || ws.competitorDomains || [];
  const rawMaxPages = req.body?.maxPages != null ? Number(req.body.maxPages) : 500;
  const maxPagesParam = rawMaxPages > 0 ? Math.min(rawMaxPages, 2000) : 0; // 0 = no cap, clamped at 2000
  const token = getTokenForSite(ws.webflowSiteId) || undefined;

  // Save competitor domains if provided
  if (req.body?.competitorDomains) {
    updateWorkspace(ws.id, { competitorDomains });
  }

  // Check if client wants SSE streaming
  const wantsStream = req.headers.accept === 'text/event-stream';
  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
  }
  const sendProgress = (step: string, detail: string, progress: number) => {
    log.info(`[${step}] ${detail} (${Math.round(progress * 100)}%)`);
    if (wantsStream) {
      try { res.write(`data: ${JSON.stringify({ step, detail, progress })}\n\n`); } catch { /* connection dropped */ }
    }
  };

  try {
    // 1. Resolve site base URL — auto-resolve liveDomain if missing
    sendProgress('discovery', 'Resolving site URL...', 0.02);
    let liveDomain = ws.liveDomain || '';
    if (!liveDomain && token) {
      try {
        const domRes = await fetch(`https://api.webflow.com/v2/sites/${ws.webflowSiteId}/custom_domains`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (domRes.ok) {
          const domData = await domRes.json() as { customDomains?: { url?: string }[] };
          const domains = domData.customDomains || [];
          if (domains.length > 0 && domains[0].url) {
            const d = domains[0].url;
            liveDomain = d.startsWith('http') ? d : `https://${d}`;
            // Persist so we don't re-resolve every time
            updateWorkspace(ws.id, { liveDomain });
            log.info(`Auto-resolved liveDomain: ${liveDomain}`);
          }
        }
      } catch { /* best-effort */ }
    }
    const subdomain = await getSiteSubdomain(ws.webflowSiteId, token);
    const baseUrl = liveDomain
      ? (liveDomain.startsWith('http') ? liveDomain : `https://${liveDomain}`)
      : subdomain ? `https://${subdomain}.webflow.io` : '';
    log.info(`Using baseUrl: ${baseUrl}`);

    // 2. Discover pages: sitemap is the SOURCE OF TRUTH for live pages.
    //    Webflow API is only used for metadata enrichment (SEO title, meta desc).
    sendProgress('discovery', 'Crawling sitemap for live pages...', 0.05);

    // Build Webflow API metadata lookup (for enrichment only, not page discovery)
    const wfMetaByPath = new Map<string, { title: string; seoTitle: string; seoDesc: string }>();
    try {
      const allPages = await listPages(ws.webflowSiteId, token);
      const published = filterPublishedPages(allPages);
      for (const p of published) {
        const pagePath = p.publishedPath || `/${p.slug || ''}`;
        wfMetaByPath.set(pagePath, {
          title: p.title || p.slug || '',
          seoTitle: p.seo?.title || '',
          seoDesc: p.seo?.description || '',
        });
      }
      log.info(`Webflow API: ${wfMetaByPath.size} pages with metadata`);
    } catch (err) {
      log.info('Webflow API metadata fetch failed, continuing without it:', err);
    }

    // Sitemap = authoritative list of live pages
    // Filter out utility/thin/legal pages that don't need keyword strategy
    const SKIP_PATHS = new Set(['/404', '/search', '/password', '/offline', '/thank-you', '/thanks', '/confirmation']);
    const SKIP_PREFIXES = ['/tag/', '/category/', '/author/', '/page/'];
    const SKIP_SUFFIXES = ['/rss', '/feed', '/rss.xml', '/feed.xml'];
    const SKIP_PATTERNS = [/\/404$/i, /\/search$/i, /\/password$/i];

    const allPaths = new Set<string>();
    if (baseUrl) {
      try {
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        log.info(`Sitemap discovered ${sitemapUrls.length} URLs from ${baseUrl}`);
        let skippedUtility = 0;
        for (const url of sitemapUrls) {
          try {
            const rawPath = new URL(url).pathname || '/';
            // Normalize: strip trailing slash (except root)
            const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');

            // Skip utility pages
            if (SKIP_PATHS.has(path.toLowerCase())) { skippedUtility++; continue; }
            if (SKIP_PREFIXES.some(p => path.toLowerCase().startsWith(p))) { skippedUtility++; continue; }
            if (SKIP_SUFFIXES.some(s => path.toLowerCase().endsWith(s))) { skippedUtility++; continue; }
            if (SKIP_PATTERNS.some(r => r.test(path))) { skippedUtility++; continue; }

            allPaths.add(path);
          } catch { /* skip invalid URLs */ }
        }
        if (skippedUtility > 0) log.info(`Skipped ${skippedUtility} utility/index pages`);
      } catch (err) {
        log.info('Sitemap discovery failed:', err);
      }
    }
    // Fallback: if sitemap found nothing, use Webflow API pages
    if (allPaths.size === 0 && wfMetaByPath.size > 0) {
      log.info('Sitemap empty — falling back to Webflow API pages');
      for (const path of wfMetaByPath.keys()) allPaths.add(path);
    }
    sendProgress('discovery', `Found ${allPaths.size} live pages`, 0.12);
    log.info(`Total live pages: ${allPaths.size}`);

    // --- Page cap: prevent OOM on large sites ---
    // maxPagesParam: 0 = no cap, otherwise cap at user-chosen limit (200/500/1000)
    // Even with "All", streaming HTML reads + snippet limits keep memory bounded.
    let pathArray = Array.from(allPaths);
    let cappedFromTotal = 0;
    if (maxPagesParam > 0 && pathArray.length > maxPagesParam) {
      cappedFromTotal = pathArray.length;
      // Prioritize: homepage → short paths (key pages) → pages with WF metadata → rest
      const scorePath = (p: string): number => {
        if (p === '/') return 0;                            // homepage always first
        const depth = p.split('/').filter(Boolean).length;
        const hasWfMeta = wfMetaByPath.has(p) ? 0 : 100;   // prefer pages with metadata
        return depth * 10 + hasWfMeta;
      };
      pathArray.sort((a, b) => scorePath(a) - scorePath(b));
      pathArray = pathArray.slice(0, maxPagesParam);
      log.info(`Capped from ${cappedFromTotal} → ${maxPagesParam} pages (prioritized by depth + metadata)`);
      sendProgress('discovery', `Large site — prioritized top ${maxPagesParam} of ${cappedFromTotal} pages`, 0.13);
    }

    // Content snippet size: reduce for large sites to control memory
    const SNIPPET_LIMIT = cappedFromTotal > 0 ? 800 : 1200;
    const HTML_READ_LIMIT = 100_000; // 100KB max per page — enough for snippet extraction

    // 3. Fetch actual page content for prioritized pages (parallel, batched)
    sendProgress('content', `Fetching content from ${pathArray.length} pages...`, 0.15);
    const pageInfo: Array<{ path: string; title: string; seoTitle: string; seoDesc: string; contentSnippet: string }> = [];
    const contentBatch = 6;
    for (let i = 0; i < pathArray.length; i += contentBatch) {
      const chunk = pathArray.slice(i, i + contentBatch);
      const fetched = Math.min(i + contentBatch, pathArray.length);
      sendProgress('content', `Fetching page content... ${fetched}/${pathArray.length}`, 0.15 + (fetched / pathArray.length) * 0.30);
      const contents = await Promise.all(chunk.map(async (pagePath): Promise<{ path: string; title: string; seoTitle: string; seoDesc: string; contentSnippet: string } | null> => {
        const wfMeta = wfMetaByPath.get(pagePath);
        let contentSnippet = '';
        let htmlTitle = '';
        let htmlMetaDesc = '';
        const url = baseUrl ? `${baseUrl}${pagePath === '/' ? '' : pagePath}` : '';
        if (url) {
          try {
            const htmlRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
            if (!htmlRes.ok) {
              // Non-200 = page doesn't exist on live site (e.g. non-live CMS collection)
              if (!wfMeta) return null; // Skip sitemap-only pages that 404
            } else {
              // Read limited body to prevent OOM on huge pages
              let html = '';
              if (htmlRes.body) {
                const reader = htmlRes.body.getReader();
                const decoder = new TextDecoder();
                let bytesRead = 0;
                while (bytesRead < HTML_READ_LIMIT) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  html += decoder.decode(value, { stream: true });
                  bytesRead += value.byteLength;
                }
                reader.cancel().catch(() => {});
              } else {
                html = (await htmlRes.text()).slice(0, HTML_READ_LIMIT);
              }
              // Extract title and meta description from HTML for pages without Webflow metadata
              if (!wfMeta) {
                const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                if (titleMatch) htmlTitle = titleMatch[1].trim();
                const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                  || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
                if (descMatch) htmlMetaDesc = descMatch[1].trim();
              }
              const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              const body = bodyMatch ? bodyMatch[1] : html;
              contentSnippet = body
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                .replace(/<header[\s\S]*?<\/header>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, SNIPPET_LIMIT);
            }
          } catch {
            if (!wfMeta) return null; // Skip unreachable sitemap-only pages
          }
        }
        const pathName = pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Home';
        return {
          path: pagePath,
          title: wfMeta?.title || htmlTitle || pathName,
          seoTitle: wfMeta?.seoTitle || htmlTitle || '',
          seoDesc: wfMeta?.seoDesc || htmlMetaDesc || '',
          contentSnippet,
        };
      }));
      pageInfo.push(...contents.filter((c): c is NonNullable<typeof c> => c !== null));
    }
    const skipped = pathArray.length - pageInfo.length;
    if (skipped > 0) log.info(`Filtered out ${skipped} non-live pages (404/unreachable)`);

    // Post-fetch: filter out pages with very thin content (utility/legal pages with < 50 chars)
    const beforeThinFilter = pageInfo.length;
    const thinPages = pageInfo.filter(p => p.contentSnippet.length < 50 && p.path !== '/');
    if (thinPages.length > 0) {
      log.info(`Thin content pages (< 50 chars): ${thinPages.map(p => p.path).join(', ')}`);
      // Remove thin pages from the array
      for (const thin of thinPages) {
        const idx = pageInfo.indexOf(thin);
        if (idx >= 0) pageInfo.splice(idx, 1);
      }
      log.info(`Removed ${thinPages.length} thin content pages`);
    }

    const capNote = cappedFromTotal > 0 ? ` of ${cappedFromTotal} total` : '';
    sendProgress('content', `Fetched ${pageInfo.length} live pages${capNote} (${skipped} non-live, ${beforeThinFilter - pageInfo.length} thin filtered)`, 0.46);

    // 4. Try to gather GSC data if connected
    sendProgress('search_data', 'Fetching Google Search Console data...', 0.48);
    let gscData: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> = [];
    let deviceBreakdown: Awaited<ReturnType<typeof getSearchDeviceBreakdown>> = [];
    let countryBreakdown: Awaited<ReturnType<typeof getSearchCountryBreakdown>> = [];
    let periodComparison: Awaited<ReturnType<typeof getSearchPeriodComparison>> | null = null;
    if (ws.gscPropertyUrl) {
      try {
        // Parallel: query+page data, device, country, and period comparison
        const [qpData, devices, countries, comparison] = await Promise.all([
          getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90),
          getSearchDeviceBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, 28).catch(() => []),
          getSearchCountryBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, 28, 10).catch(() => []),
          getSearchPeriodComparison(ws.webflowSiteId, ws.gscPropertyUrl, 28).catch(() => null),
        ]);
        gscData = qpData;
        deviceBreakdown = devices;
        countryBreakdown = countries;
        periodComparison = comparison;
        sendProgress('search_data', `Got ${gscData.length} query rows, ${devices.length} devices, ${countries.length} countries from GSC`, 0.50);
      } catch {
        sendProgress('search_data', 'GSC unavailable — continuing without it', 0.50);
        log.info('Keyword strategy: GSC data unavailable, proceeding without it');
      }
    } else {
      sendProgress('search_data', 'No GSC connected — skipping', 0.50);
    }

    // 4b. Try to gather GA4 organic data + conversions if connected
    let organicLandingPages: Awaited<ReturnType<typeof getGA4LandingPages>> = [];
    let organicOverview: Awaited<ReturnType<typeof getGA4OrganicOverview>> | null = null;
    let ga4Conversions: Awaited<ReturnType<typeof getGA4Conversions>> = [];
    let ga4EventsByPage: Awaited<ReturnType<typeof getGA4EventsByPage>> = [];
    if (ws.ga4PropertyId) {
      try {
        sendProgress('search_data', 'Fetching GA4 organic + conversion data...', 0.51);
        const [landing, organic, conversions, eventPages] = await Promise.all([
          getGA4LandingPages(ws.ga4PropertyId, 28, 25, true).catch(() => []),
          getGA4OrganicOverview(ws.ga4PropertyId, 28).catch(() => null),
          getGA4Conversions(ws.ga4PropertyId, 28).catch(() => []),
          getGA4EventsByPage(ws.ga4PropertyId, 28, { limit: 50 }).catch(() => []),
        ]);
        organicLandingPages = landing;
        organicOverview = organic;
        ga4Conversions = conversions;
        ga4EventsByPage = eventPages;
        sendProgress('search_data', `Got ${landing.length} organic landing pages, ${conversions.length} conversion events from GA4`, 0.52);
      } catch {
        sendProgress('search_data', 'GA4 organic data unavailable — continuing without it', 0.52);
      }
    }

    // 5. SEMRush data gathering (based on mode)
    let semrushContext = '';
    let semrushDomainData: Awaited<ReturnType<typeof getDomainOrganicKeywords>> = [];
    let keywordGaps: Awaited<ReturnType<typeof getKeywordGap>> = [];
    const relatedKws: Awaited<ReturnType<typeof getRelatedKeywords>> = [];

    if (semrushMode !== 'none' && isSemrushConfigured()) {
      sendProgress('semrush', 'Fetching SEMRush keyword intelligence...', 0.55);
      // Derive domain from baseUrl so SEMRush always hits the live site (not webflow.io staging)
      const siteDomain = baseUrl ? new URL(baseUrl).hostname : '';

      if (siteDomain) {
        // Both quick and full: get domain organic keywords
        try {
          log.info(`Fetching domain organic keywords for ${siteDomain}...`);
          semrushDomainData = await getDomainOrganicKeywords(siteDomain, ws.id, semrushMode === 'full' ? 200 : 100);
          log.info(`Got ${semrushDomainData.length} domain keywords`);

          if (semrushDomainData.length > 0) {
            semrushContext += `\n\nSEMRush Domain Organic Keywords (real search volume + difficulty data):\n`;
            semrushContext += semrushDomainData.slice(0, 100).map(k =>
              `- "${k.keyword}" → ${k.url} (pos: #${k.position}, vol: ${k.volume}/mo, KD: ${k.difficulty}%, CPC: $${k.cpc}, traffic: ${k.traffic})`
            ).join('\n');
          }
        } catch (err) {
          log.error('Domain organic error:', err);
        }

        // Full mode: competitor gap analysis + related keywords
        if (semrushMode === 'full' && competitorDomains.length > 0) {
          try {
            sendProgress('semrush', `Running competitor gap analysis vs ${competitorDomains.length} competitors...`, 0.60);
            log.info(`Running keyword gap analysis vs ${competitorDomains.join(', ')}...`);
            keywordGaps = await getKeywordGap(siteDomain, competitorDomains, ws.id, 50);
            log.info(`Found ${keywordGaps.length} keyword gaps`);

            if (keywordGaps.length > 0) {
              semrushContext += `\n\nCOMPETITOR KEYWORD GAPS (keywords competitors rank for but YOU don't — high-priority opportunities):\n`;
              semrushContext += keywordGaps.slice(0, 30).map(g =>
                `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
              ).join('\n');
            }
          } catch (err) {
            log.error('Keyword gap error:', err);
          }

          // Get related keywords for top 5 seed terms
          try {
            sendProgress('semrush', 'Fetching related keyword ideas...', 0.65);
            const seedKeywords = semrushDomainData.slice(0, 5).map(k => k.keyword);
            for (const seed of seedKeywords) {
              const related = await getRelatedKeywords(seed, ws.id, 10);
              relatedKws.push(...related);
            }
            if (relatedKws.length > 0) {
              const unique = relatedKws.filter((k, i, arr) => arr.findIndex(x => x.keyword === k.keyword) === i);
              semrushContext += `\n\nSEMRush Related Keywords (expansion ideas with real volume):\n`;
              semrushContext += unique.slice(0, 30).map(k =>
                `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%)`
              ).join('\n');
            }
          } catch (err) {
            log.error('Related keywords error:', err);
          }
        }
      }
    }

    // 6. BATCHED AI STRATEGY — parallel page analysis + master synthesis
    //    Step 1: Split pages into batches, analyze each batch in parallel (per-page keyword mapping)
    //    Step 2: Master synthesis call merges all mappings + GSC + SEMRush into final strategy

    // Helper: call OpenAI for strategy using shared utility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const callStrategyAI = async (messages: Array<{ role: string; content: string }>, maxTokens: number, _label?: string): Promise<string> => {
      const result = await callOpenAI({
        model: 'gpt-4.1-mini',
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        maxTokens,
        temperature: 0.3,
        feature: 'keyword-strategy',
        workspaceId: ws.id,
        maxRetries: 3,
        timeoutMs: 90_000,
      });
      return result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    };

    // Keepalive pings to prevent Render proxy from killing idle SSE connection
    const keepalive = wantsStream ? setInterval(() => {
      try { res.write(`: keepalive\n\n`); } catch { /* connection closed */ }
    }, 10_000) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let strategy: any;
    try {
    // --- STEP 1: Parallel page analysis batches ---
    const BATCH_SIZE = 20;
    const batches: typeof pageInfo[] = [];
    for (let i = 0; i < pageInfo.length; i += BATCH_SIZE) {
      batches.push(pageInfo.slice(i, i + BATCH_SIZE));
    }
    log.info(`Splitting ${pageInfo.length} pages into ${batches.length} batches of ~${BATCH_SIZE}`);
    sendProgress('ai', `Analyzing pages in ${batches.length} parallel batches...`, 0.55);

    let businessSection = '';
    if (businessContext) {
      businessSection = `\nBUSINESS CONTEXT: ${businessContext}\n`;
    }
    // Add knowledge base for deeper business understanding (services, expertise, differentiators)
    const knowledgeBlock = buildKnowledgeBase(ws.id);
    if (knowledgeBlock) {
      businessSection += knowledgeBlock + '\n';
    }

    // Build per-page GSC context lookup
    const gscByPath = new Map<string, Array<{ query: string; position: number; clicks: number; impressions: number }>>();
    for (const r of gscData) {
      try {
        const p = new URL(r.page).pathname;
        if (!gscByPath.has(p)) gscByPath.set(p, []);
        gscByPath.get(p)!.push({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions });
      } catch { /* skip */ }
    }

    const runBatch = async (batch: typeof pageInfo, batchIdx: number) => {
      const batchPages = batch.map(p => {
        let entry = `- ${p.path}: "${p.title}"`;
        if (p.seoTitle) entry += ` | SEO: "${p.seoTitle}"`;
        if (p.seoDesc) entry += ` | Desc: "${p.seoDesc.slice(0, 150)}"`;
        if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 400)}`;
        const pageGsc = gscByPath.get(p.path);
        if (pageGsc && pageGsc.length > 0) {
          const topGsc = pageGsc.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
          entry += `\n  GSC: ${topGsc.map(g => `"${g.query}" pos:${g.position.toFixed(1)} clicks:${g.clicks} imp:${g.impressions}`).join(', ')}`;
        }
        return entry;
      }).join('\n');

      const batchPrompt = `You are an expert SEO strategist. Analyze these ${batch.length} web pages and assign optimal keyword targets for each.
${businessSection}
Pages to analyze:
${batchPages}

Return a JSON array with one entry per page:
[
  {
    "pagePath": "/exact-path",
    "pageTitle": "Page Title",
    "primaryKeyword": "specific, high-intent keyword (unique per page, no cannibalization)",
    "secondaryKeywords": ["4-6 supporting keywords: long-tail, question-based, location variants"],
    "searchIntent": "commercial|informational|transactional|navigational"
  }
]

Rules:
- Each primaryKeyword must be UNIQUE across all pages — no keyword cannibalization
- Keywords should be specific and high-intent, NOT generic
- LOCATION TARGETING: If a page's URL, title, or content references a specific city/state/region (e.g. /houston, /san-antonio, "Houston Office"), that page's keywords MUST target THAT location — NOT the business headquarters or any other location. Each location page gets its own city. Do NOT default all pages to the same city.
- For non-location pages (e.g. /about, /services), use the broadest relevant geographic scope from the business context (nationwide, statewide, or primary city as appropriate)
- If GSC data is available, leverage it: high impressions + poor position = opportunity
- Cover ALL ${batch.length} pages — do not skip any
- Return ONLY valid JSON array, no markdown, no explanation`;

      log.info(`Batch ${batchIdx + 1}/${batches.length}: ${batch.length} pages, ${batchPrompt.length} chars`);
      const raw = await callStrategyAI([
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: batchPrompt },
      ], 3000, `batch-${batchIdx + 1}`);

      try {
        const parsed = JSON.parse(raw);
        log.info(`Batch ${batchIdx + 1} returned ${Array.isArray(parsed) ? parsed.length : 0} page mappings`);
        sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${Array.isArray(parsed) ? parsed.length : 0} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        log.error(`Batch ${batchIdx + 1} returned invalid JSON:`, raw.slice(0, 200));
        return batch.map(p => ({
          pagePath: p.path,
          pageTitle: p.title,
          primaryKeyword: p.title.toLowerCase(),
          secondaryKeywords: [],
          searchIntent: 'informational',
        }));
      }
    };

    // Run batches with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    const allPageMappings: Array<{ pagePath: string; pageTitle: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent: string }> = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const chunk = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((batch, ci) => runBatch(batch, i + ci)));
      allPageMappings.push(...results.flat());
    }
    log.info(`All batches complete: ${allPageMappings.length} total page mappings`);

    // --- STEP 2: Master synthesis — site-level strategy only ---
    // The batch results ARE the pageMap. Master only generates siteKeywords, contentGaps, quickWins, opportunities.
    // This keeps output small (~2K tokens) and fast.
    sendProgress('ai', 'Synthesizing site-level strategy...', 0.78);

    // Detect keyword conflicts from batch results (batches don't know about each other)
    const kwCount = new Map<string, string[]>();
    for (const pm of allPageMappings) {
      const kw = pm.primaryKeyword.toLowerCase();
      if (!kwCount.has(kw)) kwCount.set(kw, []);
      kwCount.get(kw)!.push(pm.pagePath);
    }
    const conflicts = [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
    if (conflicts.length > 0) {
      log.info(`Found ${conflicts.length} keyword conflicts to resolve`);
    }

    // Compact summary: just keywords per page (no secondary details — keep prompt small)
    const kwSummary = allPageMappings.map(pm => `${pm.pagePath}: "${pm.primaryKeyword}"`).join('\n');

    // GSC: top queries + enriched signals
    let gscSummary = '';
    if (gscData.length > 0) {
      const topGsc = [...gscData].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
      gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
        topGsc.map(r => `- "${r.query}" → ${new URL(r.page).pathname} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`).join('\n');
    }

    // Device breakdown context
    if (deviceBreakdown.length > 0) {
      gscSummary += `\n\nDEVICE BREAKDOWN (last 28 days):\n` +
        deviceBreakdown.map(d => `- ${d.device}: ${d.clicks} clicks, ${d.impressions} imp, CTR ${d.ctr}%, avg pos ${d.position}`).join('\n');
      // Flag if mobile dominates but has worse position
      const mobile = deviceBreakdown.find(d => d.device === 'MOBILE');
      const desktop = deviceBreakdown.find(d => d.device === 'DESKTOP');
      if (mobile && desktop && mobile.impressions > desktop.impressions && mobile.position > desktop.position + 2) {
        gscSummary += `\n⚠️ MOBILE GAP: Mobile has ${mobile.impressions} imp vs desktop ${desktop.impressions} but avg position is ${mobile.position.toFixed(1)} vs ${desktop.position.toFixed(1)} — mobile optimization is critical.`;
      }
    }

    // Period comparison context
    if (periodComparison) {
      const { change, changePercent } = periodComparison;
      gscSummary += `\n\nPERIOD COMPARISON (last 28 days vs previous 28 days):\n` +
        `- Clicks: ${change.clicks >= 0 ? '+' : ''}${change.clicks} (${changePercent.clicks >= 0 ? '+' : ''}${changePercent.clicks}%)\n` +
        `- Impressions: ${change.impressions >= 0 ? '+' : ''}${change.impressions} (${changePercent.impressions >= 0 ? '+' : ''}${changePercent.impressions}%)\n` +
        `- Avg Position: ${change.position >= 0 ? '+' : ''}${change.position} (${change.position > 0 ? 'declining ⚠️' : change.position < 0 ? 'improving ✓' : 'stable'})`;
    }

    // Country breakdown
    if (countryBreakdown.length > 0) {
      gscSummary += `\n\nTOP COUNTRIES by clicks:\n` +
        countryBreakdown.slice(0, 5).map(c => `- ${c.country}: ${c.clicks} clicks, ${c.impressions} imp, pos ${c.position}`).join('\n');
    }

    // GA4 organic landing pages — find pages getting traffic that aren't in the keyword map
    let ga4Context = '';
    if (organicLandingPages.length > 0) {
      const mappedPaths = new Set(allPageMappings.map(pm => pm.pagePath));
      const unmappedLanding = organicLandingPages.filter(lp => !mappedPaths.has(lp.landingPage));
      if (unmappedLanding.length > 0) {
        ga4Context += `\n\nGA4 ORGANIC LANDING PAGES not in keyword map (getting traffic but no keyword strategy):\n` +
          unmappedLanding.slice(0, 10).map(lp => `- ${lp.landingPage}: ${lp.sessions} organic sessions, ${lp.users} users, bounce ${lp.bounceRate}%`).join('\n');
      }
      // High-bounce organic landing pages = content quality signal
      const highBounce = organicLandingPages.filter(lp => lp.bounceRate > 70 && lp.sessions > 5);
      if (highBounce.length > 0) {
        ga4Context += `\n\nHIGH-BOUNCE ORGANIC PAGES (>70% bounce, may need content improvement):\n` +
          highBounce.slice(0, 5).map(lp => `- ${lp.landingPage}: bounce ${lp.bounceRate}%, ${lp.sessions} sessions`).join('\n');
      }
    }
    if (organicOverview) {
      ga4Context += `\n\nORGANIC SEARCH OVERVIEW (GA4, last 28 days):\n` +
        `- ${organicOverview.organicUsers} organic users (${organicOverview.shareOfTotalUsers}% of all traffic)\n` +
        `- Engagement rate: ${organicOverview.engagementRate}%\n` +
        `- Avg engagement time: ${organicOverview.avgEngagementTime.toFixed(0)}s`;
    }

    // GA4 conversions — which events fire and on which pages
    if (ga4Conversions.length > 0) {
      ga4Context += `\n\nCONVERSION EVENTS (GA4, last 28 days — these are the site's money actions):\n` +
        ga4Conversions.slice(0, 10).map(c => `- "${c.eventName}": ${c.conversions} events, ${c.users} users (${c.rate}% conversion rate)`).join('\n');
    }
    if (ga4EventsByPage.length > 0) {
      // Group events by page to find "money pages"
      const pageEvents = new Map<string, { events: number; topEvent: string }>();
      for (const ep of ga4EventsByPage) {
        const existing = pageEvents.get(ep.pagePath);
        if (!existing || ep.eventCount > existing.events) {
          pageEvents.set(ep.pagePath, { events: ep.eventCount, topEvent: ep.eventName });
        }
      }
      const topConvertingPages = [...pageEvents.entries()]
        .sort((a, b) => b[1].events - a[1].events)
        .slice(0, 8);
      if (topConvertingPages.length > 0) {
        ga4Context += `\n\nTOP CONVERTING PAGES (pages that drive the most events — protect these keywords):\n` +
          topConvertingPages.map(([p, d]) => `- ${p}: ${d.events} events (top: "${d.topEvent}")`).join('\n');
      }
    }

    // Audit data — pages with SEO errors + traffic = high-priority quick wins
    let auditContext = '';
    if (ws.webflowSiteId) {
      try {
        const trafficMap = await getAuditTrafficForWorkspace(ws);
        const latestAudit = getLatestSnapshot(ws.webflowSiteId);
        if (latestAudit && Object.keys(trafficMap).length > 0) {
          // Apply suppressions so strategy chat excludes suppressed issues
          const filteredAudit = applySuppressionsToAudit(latestAudit.audit, ws.auditSuppressions || []);
          const pagesWithIssues = filteredAudit.pages
            .filter(p => p.issues.length > 0)
            .map(p => {
              const slug = p.slug.startsWith('/') ? p.slug : `/${p.slug}`;
              const traffic = trafficMap[slug] || trafficMap[p.slug];
              return { slug, issues: p.issues.length, score: p.score, traffic };
            })
            .filter(p => p.traffic && (p.traffic.clicks > 0 || p.traffic.pageviews > 0))
            .sort((a, b) => ((b.traffic?.clicks || 0) + (b.traffic?.pageviews || 0)) - ((a.traffic?.clicks || 0) + (a.traffic?.pageviews || 0)))
            .slice(0, 8);
          if (pagesWithIssues.length > 0) {
            auditContext = `\n\nSEO AUDIT: HIGH-TRAFFIC PAGES WITH ERRORS (fix these for immediate impact):\n` +
              pagesWithIssues.map(p => `- ${p.slug}: ${p.issues} issues, score ${p.score}/100 | ${p.traffic!.clicks} clicks, ${p.traffic!.pageviews} pageviews`).join('\n');
            if (filteredAudit.siteScore != null) {
              auditContext += `\nOverall site health score: ${filteredAudit.siteScore}/100`;
            }
          }
        }
      } catch { /* non-critical */ }
    }

    const hasSemrush = semrushContext.length > 0;
    const conflictNote = conflicts.length > 0
      ? `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n${conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n')}\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
      : '';

    const masterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}${ga4Context}${auditContext}
${semrushContext}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${conflicts.length > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority${hasSemrush ? '. Prioritize competitor gap keywords.' : ''}
- suggestedPageType: Choose the best page type for each content gap. Use "blog" for informational articles, "landing" for conversion pages, "service" for service descriptions, "location" for local SEO, "product" for product pages, "pillar" for topic hubs, "resource" for guides/downloads.
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
- If DEVICE BREAKDOWN shows mobile ranking gaps, include a mobile-optimization quick win.
- If PERIOD COMPARISON shows declining metrics, flag defensive content gaps to recover traffic.
- If GA4 shows high-bounce organic pages, include content-improvement quick wins for those pages.
- If GA4 shows organic landing pages NOT in the keyword map, suggest adding them to the strategy.
- If CONVERSION EVENTS data is available, prioritize keywords for pages that drive conversions. Protect "money pages" — never deprioritize their keywords.
- If TOP CONVERTING PAGES data is available, mention specific conversion events in quickWin rationales (e.g., "this page drives 15 form_submissions — fixing its meta description could increase CTR").
- If SEO AUDIT data shows high-traffic pages with errors, include them as quickWins with specific fix actions.
- If COUNTRY data shows a dominant market, consider location-specific content gaps.
${hasSemrush ? '- Use SEMRush data to inform priorities. KD < 40% = quick wins.' : ''}
- Return ONLY valid JSON, no markdown`;

    log.info(`Master prompt: ${masterPrompt.length} chars (~${Math.ceil(masterPrompt.length / 4)} tokens)`);

    const masterRaw = await callStrategyAI([
      { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
      { role: 'user', content: masterPrompt },
    ], 3000, 'master');

    let masterData;
    try {
      masterData = JSON.parse(masterRaw);
    } catch {
      log.error('Master returned invalid JSON:', masterRaw.slice(0, 300));
      const errMsg = 'AI returned invalid JSON in master synthesis';
      if (wantsStream) { try { res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`); res.end(); } catch { /* closed */ } return; }
      return res.status(500).json({ error: errMsg, raw: masterRaw.slice(0, 500) });
    }

    // Apply keyword conflict fixes from master
    if (masterData.keywordFixes?.length) {
      const fixMap = new Map(masterData.keywordFixes.map((f: { pagePath: string; newPrimaryKeyword: string }) => [f.pagePath, f.newPrimaryKeyword]));
      for (const pm of allPageMappings) {
        const fix = fixMap.get(pm.pagePath);
        if (fix) pm.primaryKeyword = fix as string;
      }
      log.info(`Applied ${masterData.keywordFixes.length} keyword conflict fixes`);
    }

    // Assemble final strategy: batch pageMap + master site-level data
    strategy = {
      siteKeywords: masterData.siteKeywords || [],
      pageMap: allPageMappings,
      opportunities: masterData.opportunities || [],
      contentGaps: masterData.contentGaps || [],
      quickWins: masterData.quickWins || [],
    };
    log.info(`Final strategy: ${strategy.pageMap.length} pages, ${strategy.siteKeywords.length} site keywords, ${strategy.contentGaps.length} content gaps, ${strategy.quickWins.length} quick wins`);

    } finally {
      if (keepalive) clearInterval(keepalive);
    }

    if (!strategy?.pageMap) {
      const errMsg = 'Strategy generation produced no results';
      if (wantsStream) { try { res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`); res.end(); } catch { /* closed */ } return; }
      return res.status(500).json({ error: errMsg });
    }

    // Enrich pageMap with GSC metrics if available
    sendProgress('enrichment', 'Enriching strategy with ranking data...', 0.90);
    if (gscData.length > 0) {
      for (const pm of strategy.pageMap) {
        const matchingRows = gscData.filter(r => {
          try { return new URL(r.page).pathname === pm.pagePath; } catch { return false; }
        });
        if (matchingRows.length > 0) {
          const kwMatch = matchingRows.find(r => r.query.toLowerCase().includes(pm.primaryKeyword.toLowerCase()));
          const best = kwMatch || matchingRows.sort((a, b) => b.impressions - a.impressions)[0];
          pm.currentPosition = best.position;
          pm.impressions = matchingRows.reduce((s, r) => s + r.impressions, 0);
          pm.clicks = matchingRows.reduce((s, r) => s + r.clicks, 0);
        }
      }
    }

    // Enrich pageMap with SEMRush volume/difficulty data
    if (semrushDomainData.length > 0) {
      // Build lookup: keyword → metrics
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      for (const pm of strategy.pageMap) {
        const match = kwLookup.get(pm.primaryKeyword.toLowerCase());
        if (match) {
          pm.volume = match.volume;
          pm.difficulty = match.difficulty;
          pm.cpc = match.cpc;
        } else {
          // Try partial match
          const partial = semrushDomainData.find(k =>
            k.keyword.toLowerCase().includes(pm.primaryKeyword.toLowerCase()) ||
            pm.primaryKeyword.toLowerCase().includes(k.keyword.toLowerCase())
          );
          if (partial) {
            pm.volume = partial.volume;
            pm.difficulty = partial.difficulty;
            pm.cpc = partial.cpc;
          }
        }
        // Enrich secondary keywords
        if (pm.secondaryKeywords?.length) {
          pm.secondaryMetrics = pm.secondaryKeywords
            .map((sk: string) => {
              const m = kwLookup.get(sk.toLowerCase());
              return m ? { keyword: sk, volume: m.volume, difficulty: m.difficulty } : null;
            })
            .filter(Boolean) as { keyword: string; volume: number; difficulty: number }[];
        }
      }
    }

    // If we still have keywords without volume data and SEMRush is available, bulk-fetch them
    if (isSemrushConfigured() && semrushMode !== 'none') {
      const needsVolume = strategy.pageMap
        .filter((pm: { volume?: number; primaryKeyword: string }) => !pm.volume)
        .map((pm: { primaryKeyword: string }) => pm.primaryKeyword);
      if (needsVolume.length > 0) {
        try {
          const metrics = await getKeywordOverview(needsVolume.slice(0, 30), ws.id);
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));
          for (const pm of strategy.pageMap) {
            if (!pm.volume) {
              const m = metricMap.get(pm.primaryKeyword.toLowerCase());
              if (m) {
                pm.volume = m.volume;
                pm.difficulty = m.difficulty;
                pm.cpc = m.cpc;
              }
            }
          }
        } catch (err) {
          log.error('Keyword overview enrichment error:', err);
        }
      }
    }

    // Enrich siteKeywords with volume/difficulty
    let siteKeywordMetrics: { keyword: string; volume: number; difficulty: number }[] = [];
    if (isSemrushConfigured() && semrushMode !== 'none' && strategy.siteKeywords?.length) {
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      const found: typeof siteKeywordMetrics = [];
      const missing: string[] = [];
      for (const kw of strategy.siteKeywords) {
        const m = kwLookup.get(kw.toLowerCase());
        if (m) {
          found.push({ keyword: kw, volume: m.volume, difficulty: m.difficulty });
        } else {
          missing.push(kw);
        }
      }
      if (missing.length > 0) {
        try {
          const extra = await getKeywordOverview(missing.slice(0, 15), ws.id);
          for (const m of extra) {
            found.push({ keyword: m.keyword, volume: m.volume, difficulty: m.difficulty });
          }
        } catch { /* non-critical */ }
      }
      siteKeywordMetrics = found;
    }

    // 7. Save to workspace
    sendProgress('complete', 'Strategy complete!', 1.0);
    const keywordStrategy = {
      ...strategy,
      siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
      keywordGaps: keywordGaps.length > 0 ? keywordGaps.slice(0, 30) : undefined,
      businessContext: businessContext || undefined,
      semrushMode: semrushMode as 'quick' | 'full' | 'none',
      // Enriched search signals
      searchSignals: {
        deviceBreakdown: deviceBreakdown.length > 0 ? deviceBreakdown : undefined,
        periodComparison: periodComparison || undefined,
        topCountries: countryBreakdown.length > 0 ? countryBreakdown.slice(0, 5) : undefined,
        organicOverview: organicOverview || undefined,
        organicLandingPages: organicLandingPages.length > 0 ? organicLandingPages.slice(0, 15) : undefined,
      },
      generatedAt: new Date().toISOString(),
    };
    updateWorkspace(ws.id, { keywordStrategy });
    incrementUsage(ws.id, 'strategy_generations');

    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ done: true, strategy: keywordStrategy })}\n\n`);
      return res.end();
    }
    res.json(keywordStrategy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    log.error('Keyword strategy error:', msg, stack);
    if (wantsStream) {
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch { /* already closed */ }
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// Get stored keyword strategy
router.get('/api/webflow/keyword-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(ws.keywordStrategy || null);
});

// Update keyword strategy (manual edits)
router.patch('/api/webflow/keyword-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const updated = { ...(ws.keywordStrategy || {}), ...req.body, generatedAt: new Date().toISOString() };
  updateWorkspace(ws.id, { keywordStrategy: updated });
  res.json(updated);
});

export default router;
