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
import { applySuppressionsToAudit, getAuditTrafficForWorkspace, resolvePagePath } from '../helpers.js';
import { callOpenAI } from '../openai-helpers.js';
import { getLatestSnapshot } from '../reports.js';
import {
  getQueryPageData,
  getSearchDeviceBreakdown,
  getSearchCountryBreakdown,
  getSearchPeriodComparison,
} from '../search-console.js';
import { addTrackedKeyword, getTrackedKeywords } from '../rank-tracking.js';
import {
  trendDirection,
  hasSerpOpportunity,
} from '../semrush.js';
import { getConfiguredProvider } from '../seo-data-provider.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword } from '../seo-data-provider.js';
import { checkUsageLimit, incrementUsage } from '../usage-tracking.js';
import {
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import { getWorkspacePages } from '../workspace-data.js';
import { clearSeoContextCache } from '../seo-context.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache, formatPersonasForPrompt, formatKnowledgeBaseForPrompt } from '../workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { updateWorkspace, getWorkspace, getTokenForSite } from '../workspaces.js';
import { upsertAndCleanPageKeywords, listPageKeywords } from '../page-keywords.js';
import { validate, z } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { getInsights } from '../analytics-insights-store.js';
import type { KeywordClusterData, CompetitorGapData, ConversionAttributionData } from '../../shared/types/analytics.js';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';
import { queueLlmsTxtRegeneration } from '../llms-txt-generator.js';
import { buildStrategySignals } from '../insight-feedback.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from '../workspace-learnings.js';
import { isFeatureEnabled } from '../feature-flags.js';

const log = createLogger('keyword-strategy');

// ── Strategy Intelligence Block ──────────────────────────────────

interface StrategyIntelligenceInput {
  keywordClusters?: Array<{
    label: string;
    queries: string[];
    totalImpressions: number;
    avgPosition: number;
    pillarPage: string | null;
  }>;
  competitorGaps?: Array<{
    keyword: string;
    competitorDomain: string;
    competitorPosition: number;
    ourPosition: number | null;
    volume: number;
    difficulty: number;
  }>;
  performanceDeltas?: Array<{
    query: string;
    positionDelta: number;
    clicksDelta: number;
    currentPosition: number;
  }>;
  conversionPages?: Array<{
    pageUrl: string;
    conversions: number;
    conversionRate: number;
    sessions: number;
  }>;
}

/**
 * Build an intelligence block for the strategy generation prompt.
 * Injects keyword clusters, competitor gaps, performance deltas,
 * and conversion data to improve AI strategy output.
 */
export function buildStrategyIntelligenceBlock(opts: StrategyIntelligenceInput): string {
  const sections: string[] = [];

  // Keyword clusters
  if (opts.keywordClusters && opts.keywordClusters.length > 0) {
    const lines = opts.keywordClusters.slice(0, 10).map(c => {
      let pillar = '';
      if (c.pillarPage) {
        try { pillar = ` → pillar: ${new URL(c.pillarPage).pathname}`; } catch { pillar = ` → pillar: ${c.pillarPage}`; }
      }
      return `  "${c.label}" (${c.queries.length} queries, ${c.totalImpressions} imp, avg pos ${Math.round(c.avgPosition)})${pillar}`;
    });
    sections.push(`KEYWORD CLUSTERS (topic groups discovered from GSC queries — use these to inform site keyword themes and content gap topics):\n${lines.join('\n')}`);
  }

  // Competitor gaps
  if (opts.competitorGaps && opts.competitorGaps.length > 0) {
    const lines = opts.competitorGaps.slice(0, 15).map(g => {
      const ours = g.ourPosition != null ? `our pos ${Math.round(g.ourPosition)}` : 'not ranking';
      return `  "${g.keyword}" — ${g.competitorDomain} pos ${g.competitorPosition}, vol ${g.volume}, diff ${g.difficulty} (${ours})`;
    });
    sections.push(`COMPETITOR GAPS (high-priority keywords competitors rank for — prioritize these in contentGaps):\n${lines.join('\n')}`);
  }

  // Performance deltas
  if (opts.performanceDeltas && opts.performanceDeltas.length > 0) {
    const lines = opts.performanceDeltas.slice(0, 10).map(d => {
      const posDir = d.positionDelta > 0 ? `↓${d.positionDelta} pos` : `↑${Math.abs(d.positionDelta)} pos`;
      return `  "${d.query}": ${posDir}, ${d.clicksDelta > 0 ? '+' : ''}${d.clicksDelta} clicks (now pos ${Math.round(d.currentPosition)})`;
    });
    sections.push(`PERFORMANCE CHANGES (keywords with significant position/click changes — declining keywords need defensive strategy):\n${lines.join('\n')}`);
  }

  // Conversion data
  if (opts.conversionPages && opts.conversionPages.length > 0) {
    const lines = opts.conversionPages.slice(0, 10).map(c => {
      let path: string;
      try { path = new URL(c.pageUrl).pathname; } catch { path = c.pageUrl; }
      return `  ${path}: ${c.conversionRate.toFixed(1)}% CVR, ${c.conversions} conversions (${c.sessions} sessions)`;
    });
    sections.push(`CONVERSION DATA (pages driving business outcomes — protect and prioritize keywords for these "money pages"):\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';
  return `\nANALYTICS INTELLIGENCE (from computed intelligence layer — use to inform strategy decisions):\n\n${sections.join('\n\n')}\n`;
}

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

  const provider = getConfiguredProvider(ws.seoDataProvider);

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

  // Keepalive pings to prevent Render proxy from killing idle SSE connection
  // Declared before outer try so it can be cleared in both success and error paths
  let keepalive: ReturnType<typeof setInterval> | null = null;

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
      const published = await getWorkspacePages(ws.id, ws.webflowSiteId);
      for (const p of published) {
        const pagePath = resolvePagePath(p);
        wfMetaByPath.set(pagePath, {
          title: p.title || p.slug || '',
          seoTitle: p.seo?.title || '',
          seoDesc: p.seo?.description || '',
        });
      }
      log.info(`Webflow API: ${wfMetaByPath.size} pages with metadata`);
    } catch (err) {
      log.info({ err: err }, 'Webflow API metadata fetch failed, continuing without it');
    }

    // Sitemap = authoritative list of live pages
    // Filter out utility/thin/legal pages that don't need keyword strategy
    const SKIP_PATHS = new Set([
      '/404', '/search', '/password', '/offline', '/thank-you', '/thanks', '/confirmation',
      // Legal pages — no SEO value to optimize
      '/privacy', '/privacy-policy', '/terms', '/terms-of-service', '/terms-and-conditions',
      '/cookie-policy', '/cookies', '/disclaimer', '/legal', '/gdpr', '/ccpa',
      '/acceptable-use', '/acceptable-use-policy', '/dmca', '/refund-policy', '/returns-policy',
      // Utility pages
      '/login', '/signup', '/register', '/reset-password', '/forgot-password',
      '/unsubscribe', '/opt-out', '/maintenance', '/coming-soon', '/under-construction',
    ]);
    const SKIP_PREFIXES = ['/tag/', '/category/', '/author/', '/page/', '/legal/', '/policies/'];
    const SKIP_SUFFIXES = ['/rss', '/feed', '/rss.xml', '/feed.xml'];
    const SKIP_PATTERNS = [/\/404$/i, /\/search$/i, /\/password$/i, /\/privacy[-_]?policy/i, /\/terms[-_]?(of[-_]?service|and[-_]?conditions)?$/i, /\/cookie[-_]?policy/i, /\/legal$/i];

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
        log.info({ err: err }, 'Sitemap discovery failed');
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
    // The keyword pool paradigm: SEMRush provides the keyword universe, AI assigns them to pages
    let semrushContext = '';
    let semrushDomainData: DomainKeyword[] = [];
    let keywordGaps: KeywordGapEntry[] = [];
    const relatedKws: RelatedKeyword[] = [];
    const allQuestionKws: { seed: string; questions: { keyword: string; volume: number }[] }[] = [];
    // Competitor keyword data — used to enrich the keyword pool and give competitor proof to content gaps
    const competitorKeywordData: Array<{ keyword: string; volume: number; difficulty: number; domain: string; position: number }> = [];

    if (semrushMode !== 'none' && provider) {
      sendProgress('semrush', `Fetching keyword intelligence via ${provider.name}...`, 0.55);
      // Derive domain from baseUrl so provider always hits the live site (not webflow.io staging)
      const siteDomain = baseUrl ? new URL(baseUrl).hostname : '';

      if (siteDomain) {
        // Both quick and full: get domain organic keywords
        try {
          log.info(`Fetching domain organic keywords for ${siteDomain}...`);
          semrushDomainData = await provider.getDomainKeywords(siteDomain, ws.id, 200);
          log.info(`Got ${semrushDomainData.length} domain keywords`);

          if (semrushDomainData.length > 0) {
            semrushContext += `\n\nSEMRush Domain Organic Keywords (real search volume + difficulty data):\n`;
            semrushContext += semrushDomainData.slice(0, 100).map(k =>
              `- "${k.keyword}" → ${k.url} (pos: #${k.position}, vol: ${k.volume}/mo, KD: ${k.difficulty}%, CPC: $${k.cpc}, traffic: ${k.traffic})`
            ).join('\n');
          }
        } catch (err) {
          log.error({ err: err }, 'Domain organic error');
        }

        // Both quick and full: auto-discover competitors if none provided
        if (competitorDomains.length === 0) {
          try {
            sendProgress('semrush', 'Auto-discovering organic competitors...', 0.57);
            const discovered = await provider.getCompetitors(siteDomain, ws.id, 5);
            const autoCompetitors = discovered
              .filter(c => !c.domain.includes(siteDomain) && !siteDomain.includes(c.domain))
              .slice(0, 3)
              .map(c => c.domain);
            if (autoCompetitors.length > 0) {
              competitorDomains.push(...autoCompetitors);
              log.info(`Auto-discovered ${autoCompetitors.length} competitors: ${autoCompetitors.join(', ')}`);
              // Save discovered competitors to workspace for next time
              updateWorkspace(ws.id, { competitorDomains });
            }
          } catch (err) {
            log.error({ err: err }, 'Competitor auto-discovery error');
          }
        }

        // Both quick and full: fetch competitor keywords (their top terms become our keyword pool)
        if (competitorDomains.length > 0) {
          try {
            const compLimit = semrushMode === 'full' ? 100 : 50;
            sendProgress('semrush', `Fetching competitor keywords (${competitorDomains.length} competitors)...`, 0.58);
            for (const comp of competitorDomains.slice(0, 3)) {
              const cleanComp = comp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
              try {
                const compKws = await provider.getDomainKeywords(cleanComp, ws.id, compLimit);
                for (const ck of compKws) {
                  competitorKeywordData.push({
                    keyword: ck.keyword,
                    volume: ck.volume,
                    difficulty: ck.difficulty,
                    domain: cleanComp,
                    position: ck.position,
                  });
                }
                log.info(`Got ${compKws.length} keywords from competitor ${cleanComp}`);
              } catch (err) {
                log.warn({ err }, `Failed to fetch keywords for competitor ${cleanComp}`);
              }
            }

            if (competitorKeywordData.length > 0) {
              semrushContext += `\n\nCOMPETITOR KEYWORDS (what your competitors rank for — these are proven industry terms):\n`;
              // Deduplicate and sort by volume, show top 50
              const seen = new Set<string>();
              const deduped = competitorKeywordData
                .filter(k => { const lc = k.keyword.toLowerCase(); if (seen.has(lc)) return false; seen.add(lc); return true; })
                .sort((a, b) => b.volume - a.volume);
              semrushContext += deduped.slice(0, 50).map(k =>
                `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%) — ${k.domain} ranks #${k.position}`
              ).join('\n');
            }
          } catch (err) {
            log.error({ err: err }, 'Competitor keywords error');
          }
        }

        // Both quick and full: keyword gap analysis
        if (competitorDomains.length > 0) {
          try {
            sendProgress('semrush', `Running keyword gap analysis vs ${competitorDomains.length} competitors...`, 0.60);
            log.info(`Running keyword gap analysis vs ${competitorDomains.join(', ')}...`);
            keywordGaps = await provider.getKeywordGap(siteDomain, competitorDomains, ws.id, 50);
            log.info(`Found ${keywordGaps.length} keyword gaps`);

            if (keywordGaps.length > 0) {
              semrushContext += `\n\nCOMPETITOR KEYWORD GAPS (keywords competitors rank for but YOU don't — HIGHEST priority opportunities):\n`;
              semrushContext += keywordGaps.slice(0, 30).map(g =>
                `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
              ).join('\n');
            }
          } catch (err) {
            log.error({ err: err }, 'Keyword gap error');
          }
        }

        // Full mode only: related keywords for deeper topic expansion
        if (semrushMode === 'full') {
          try {
            sendProgress('semrush', 'Fetching related keyword ideas...', 0.65);
            const seedKeywords = semrushDomainData.filter(k => k.keyword?.trim()).slice(0, 5).map(k => k.keyword);
            for (const seed of seedKeywords) {
              const related = await provider.getRelatedKeywords(seed, ws.id, 10);
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
            log.error({ err: err }, 'Related keywords error');
          }

          // Full mode only: question keywords for FAQ/AEO targeting
          try {
            sendProgress('semrush', 'Fetching question-based keywords for FAQ/AEO...', 0.67);
            const qSeeds = semrushDomainData.filter(k => k.keyword?.trim() && k.volume > 100).slice(0, 5).map(k => k.keyword);
            for (const seed of qSeeds) {
              const questions = await provider.getQuestionKeywords(seed, ws.id, 10);
              if (questions.length > 0) {
                allQuestionKws.push({ seed, questions: questions.map(q => ({ keyword: q.keyword, volume: q.volume })) });
              }
            }
            const allQs = allQuestionKws.flatMap(q => q.questions);
            if (allQs.length > 0) {
              const uniqueQs = allQs.filter((q, i, arr) => arr.findIndex(x => x.keyword === q.keyword) === i)
                .sort((a, b) => b.volume - a.volume);
              semrushContext += `\n\nQUESTION KEYWORDS (real questions people search — use for FAQ sections, AEO, featured snippets):\n`;
              semrushContext += uniqueQs.slice(0, 20).map(q =>
                `- "${q.keyword}" (${q.volume}/mo)`
              ).join('\n');
              log.info(`Found ${uniqueQs.length} unique question keywords from ${qSeeds.length} seeds`);
            }
          } catch (err) {
            log.error({ err: err }, 'Question keywords error');
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

    // Start keepalive now that we're entering the long-running AI phase
    keepalive = wantsStream ? setInterval(() => {
      try { res.write(`: keepalive\n\n`); } catch { /* connection closed */ }
    }, 10_000) : null;

    // Keyword pool — declared outside try so enrichment code can access it after batching
    const keywordPool = new Map<string, { volume: number; difficulty: number; source: string }>();

    // Business context section — declared outside try so topic clustering can access it
    let businessSection = '';
    if (businessContext) {
      businessSection = `\nBUSINESS CONTEXT: ${businessContext}\n`;
    }
    const strategyIntel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
    const strategySeo = strategyIntel.seoContext;
    const kbBlock = formatKnowledgeBaseForPrompt(strategySeo?.knowledgeBase);
    const persBlock = formatPersonasForPrompt(strategySeo?.personas ?? []);
    if (kbBlock) {
      businessSection += kbBlock + '\n';
    }
    if (persBlock) {
      businessSection += persBlock + '\n';
    }

    // Inject client-declined keywords so AI avoids them
    const declinedKeywords = getDeclinedKeywords(ws.id);
    if (declinedKeywords.length > 0) {
      businessSection += `\nDECLINED KEYWORDS (the client has explicitly rejected these — do NOT suggest them or close variants as primaryKeyword, secondaryKeywords, or content gap targets):\n${declinedKeywords.map(k => `- "${k}"`).join('\n')}\n`;
      log.info(`Injecting ${declinedKeywords.length} declined keywords into AI prompt`);
    }

    // Inject client-requested keywords so AI prioritizes them
    const requestedKeywords = getRequestedKeywords(ws.id);
    if (requestedKeywords.length > 0) {
      businessSection += `\nCLIENT-REQUESTED KEYWORDS (the client has submitted these keyword ideas — give them HIGH PRIORITY in page assignments and content gap suggestions. If no existing page covers a requested keyword, it MUST appear as a content gap):\n${requestedKeywords.map(k => `- "${k}"`).join('\n')}\n`;
      log.info(`Injecting ${requestedKeywords.length} client-requested keywords into AI prompt`);
    }

    // Adaptive pipeline: inject workspace learnings for difficulty range guidance
    if (isFeatureEnabled('outcome-adaptive-pipeline')) {
      try {
        const learnings = getWorkspaceLearnings(ws.id);
        if (learnings) {
          const block = formatLearningsForPrompt(learnings, 'strategy');
          if (block) {
            businessSection += `\n\n${block}\n`;
            log.info({ workspaceId: ws.id }, 'Injected workspace learnings into strategy prompt');
          }
        }
      } catch (err) {
        log.warn({ err }, 'Failed to inject workspace learnings into strategy prompt');
      }
    }

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

    // Build per-page GSC context lookup
    const gscByPath = new Map<string, Array<{ query: string; position: number; clicks: number; impressions: number }>>();
    for (const r of gscData) {
      try {
        const p = new URL(r.page).pathname;
        if (!gscByPath.has(p)) gscByPath.set(p, []);
        gscByPath.get(p)!.push({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions });
      } catch { /* skip */ }
    }

    // Build SEMRush keyword reference for batch prompts — give the AI real search terms to pick from
    let semrushBatchRef = '';
    const semrushByPath = new Map<string, typeof semrushDomainData>();
    // Populate keyword pool from ALL available data sources
    if (semrushDomainData.length > 0) {
      // Group domain keywords by URL path for per-page matching
      for (const k of semrushDomainData) {
        try {
          const p = new URL(k.url).pathname;
          if (!semrushByPath.has(p)) semrushByPath.set(p, []);
          semrushByPath.get(p)!.push(k);
        } catch { /* skip */ }
        keywordPool.set(k.keyword.toLowerCase(), { volume: k.volume, difficulty: k.difficulty, source: 'semrush' });
      }
    }
    // Add GSC queries to the pool (these are proven search terms)
    for (const r of gscData) {
      const q = r.query.toLowerCase();
      if (!keywordPool.has(q) && q.length > 3 && q.split(' ').length >= 2) {
        keywordPool.set(q, { volume: r.impressions, difficulty: 0, source: 'gsc' });
      }
    }
    // Add competitor keywords to the pool — these are proven industry terms with real volume
    for (const ck of competitorKeywordData) {
      const kw = ck.keyword.toLowerCase();
      if (!keywordPool.has(kw) && ck.volume > 0) {
        keywordPool.set(kw, { volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` });
      }
    }
    // Add keyword gaps to the pool — highest priority since competitors rank and you don't
    for (const gap of keywordGaps) {
      const kw = gap.keyword.toLowerCase();
      if (!keywordPool.has(kw) && gap.volume > 0) {
        keywordPool.set(kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` });
      }
    }
    // Add related keywords to the pool
    for (const rk of relatedKws) {
      const kw = rk.keyword.toLowerCase();
      if (!keywordPool.has(kw) && rk.volume > 0) {
        keywordPool.set(kw, { volume: rk.volume, difficulty: rk.difficulty, source: 'related' });
      }
    }
    // Add client-tracked keywords to the pool — these are keywords the client explicitly wants to target
    const clientTracked = getTrackedKeywords(ws.id);
    let clientKeywordsAdded = 0;
    for (const tk of clientTracked) {
      const kw = tk.query.toLowerCase().trim();
      if (!keywordPool.has(kw) && kw.length > 1) {
        keywordPool.set(kw, { volume: 0, difficulty: 0, source: 'client' });
        clientKeywordsAdded++;
      }
    }
    // Add client-requested keywords to pool
    for (const kw of requestedKeywords) {
      if (!keywordPool.has(kw.toLowerCase())) {
        keywordPool.set(kw.toLowerCase(), { volume: 0, difficulty: 0, source: 'client' });
        clientKeywordsAdded++;
      }
    }
    log.info(`Keyword pool: ${keywordPool.size} unique terms (${semrushDomainData.length} domain + ${competitorKeywordData.length} competitor + ${keywordGaps.length} gaps + ${clientKeywordsAdded} client + GSC)`);
    if (keywordPool.size > 0) {
      // Sort by volume descending and include ALL keywords
      const poolList = [...keywordPool.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 200)
        .map(([kw, m]) => `"${kw}" (${m.volume}/mo${m.difficulty ? ` KD:${m.difficulty}%` : ''})`)
        .join(', ');
      // Call out client-requested keywords so AI gives them priority
      const clientKws = [...keywordPool.entries()].filter(([, m]) => m.source === 'client').map(([kw]) => `"${kw}"`);
      const clientNote = clientKws.length > 0
        ? `\n\nCLIENT-REQUESTED KEYWORDS — The client specifically wants to target these keywords. Give them PRIORITY when assigning to relevant pages, and ensure they appear in content gap suggestions if no existing page covers them:\n${clientKws.join(', ')}`
        : '';
      semrushBatchRef = `\n\nKEYWORD POOL — VERIFIED search terms with real volume. You MUST pick primaryKeyword from this list when a reasonable match exists for the page topic. Only invent a new keyword if NONE of these are relevant:\n${poolList}${clientNote}`;
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
        // Add per-page SEMRush keywords so the AI sees what this page actually ranks for
        const pageSem = semrushByPath.get(p.path);
        if (pageSem && pageSem.length > 0) {
          const topSem = pageSem.sort((a, b) => b.volume - a.volume).slice(0, 3);
          entry += `\n  SEMRush: ${topSem.map(s => `"${s.keyword}" vol:${s.volume} KD:${s.difficulty}% pos:#${s.position}`).join(', ')}`;
        }
        return entry;
      }).join('\n');

      const hasPool = keywordPool.size > 0;
      const batchPrompt = `You are an SEO keyword ASSIGNMENT engine. Your job is to match each page to the BEST keyword from a verified keyword pool — NOT to invent keywords.
${businessSection}${semrushBatchRef}
Pages to analyze:
${batchPages}

Return a JSON array with one entry per page:
[
  {
    "pagePath": "/exact-path",
    "pageTitle": "Page Title",
    "primaryKeyword": "keyword FROM THE POOL above",
    "secondaryKeywords": ["3-5 related terms, preferably also from the pool"],
    "searchIntent": "commercial|informational|transactional|navigational"
  }
]

Rules:
${hasPool ? `- MANDATORY: primaryKeyword MUST be selected from the KEYWORD POOL above. These are real, verified search terms with actual search volume. Do NOT invent keywords.
- If a page has GSC data, the highest-impression GSC query IS your primaryKeyword (it's already in the pool).
- If a page has SEMRush data, prefer those keywords (they're proven ranking terms).
- If multiple pages could target the same keyword, assign it to the MOST relevant page. Other pages can share keywords — that's better than inventing fake ones.
- ONLY if absolutely NO keyword in the pool is even remotely relevant to the page topic, you may suggest a SHORT generic industry term (2-4 words). Mark these with "(invented)" suffix so we can identify them.` : `- primaryKeyword must be a real search term people actually use on Google. Short, generic industry terms (2-4 words).
- If GSC data is available, PREFER the highest-impression GSC query.`}
- Blog posts, changelog entries, and update pages CAN share the same broader keyword — that's better than inventing a niche term nobody searches for.
- LOCATION TARGETING: If a page references a specific city/state/region, keywords MUST target THAT location.
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
        // Strip AI-hallucinated volume/difficulty — those must come from SEMRush enrichment only
        // Also strip "(invented)" suffix and pre-enrich keywords that are already in the pool
        if (Array.isArray(parsed)) {
          let fromPool = 0;
          let invented = 0;
          for (const pm of parsed) {
            delete pm.volume; delete pm.difficulty; delete pm.cpc;
            // Strip "(invented)" marker the AI may add
            if (pm.primaryKeyword) {
              pm.primaryKeyword = pm.primaryKeyword.replace(/\s*\(invented\)\s*$/i, '').trim();
            }
            // Pre-enrich from pool — if the keyword is in our pool, apply the data now
            const poolMatch = keywordPool.get(pm.primaryKeyword?.toLowerCase());
            if (poolMatch) {
              pm.volume = poolMatch.volume;
              pm.difficulty = poolMatch.difficulty;
              fromPool++;
            } else {
              invented++;
            }
          }
          log.info(`Batch ${batchIdx + 1}: ${fromPool} keywords from pool, ${invented} invented`);
        }
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        log.error({ detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} returned invalid JSON:`);
        return batch.map(p => ({
          pagePath: p.path,
          pageTitle: p.title,
          primaryKeyword: '',
          secondaryKeywords: [],
          searchIntent: 'informational',
          _parseError: true,
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
    // Filter out pages with parse errors and log warning
    const parseErrors = allPageMappings.filter((pm: { _parseError?: boolean }) => pm._parseError);
    if (parseErrors.length > 0) {
      log.warn(`${parseErrors.length} pages had JSON parse errors and were assigned empty keywords`);
      // Remove parse-error pages from the mappings
      const validMappings = allPageMappings.filter((pm: { _parseError?: boolean }) => !pm._parseError);
      allPageMappings.length = 0;
      allPageMappings.push(...validMappings);
    }
    log.info(`All batches complete: ${allPageMappings.length} total page mappings`);

    // --- Post-AI keyword validation via SEMRush bulk lookup ---
    // Optimization: check domain organic data + existing page_keywords before calling API
    if (provider && semrushMode !== 'none') {
      const domainKwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      const existingPkLookup = new Map(
        listPageKeywords(ws.id)
          .filter(pk => pk.volume && pk.volume > 0)
          .map(pk => [pk.primaryKeyword.toLowerCase(), pk])
      );

      // First pass: enrich from already-fetched data (no API calls)
      const needsApiLookup: string[] = [];
      let preEnriched = 0;
      for (const pm of allPageMappings) {
        const kwLower = pm.primaryKeyword?.toLowerCase();
        if (!kwLower) continue;
        // Check domain organic data (already fetched this run)
        const domainHit = domainKwLookup.get(kwLower);
        if (domainHit && domainHit.volume > 0) {
          (pm as Record<string, unknown>).validated = true;
          pm.volume = domainHit.volume;
          pm.difficulty = domainHit.difficulty;
          preEnriched++;
          continue;
        }
        // Check existing page_keywords from previous strategy runs
        const pkHit = existingPkLookup.get(kwLower);
        if (pkHit && pkHit.volume && pkHit.volume > 0) {
          (pm as Record<string, unknown>).validated = true;
          pm.volume = pkHit.volume;
          pm.difficulty = pkHit.difficulty ?? 0;
          preEnriched++;
          continue;
        }
        needsApiLookup.push(pm.primaryKeyword);
      }
      log.info(`Keyword validation: ${preEnriched} pre-enriched from existing data, ${needsApiLookup.length} need API lookup`);

      // Second pass: fetch remaining from provider API
      if (needsApiLookup.length > 0) {
        try {
          const uniqueNeeds = [...new Set(needsApiLookup.map(k => k.toLowerCase()))];
          const metrics = await provider.getKeywordMetrics(uniqueNeeds.slice(0, 100), ws.id);
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));

          let unvalidated = 0;
          for (const pm of allPageMappings) {
            if ((pm as Record<string, unknown>).validated != null) continue; // already handled
            const m = metricMap.get(pm.primaryKeyword.toLowerCase());
            if (m && m.volume > 0) {
              (pm as Record<string, unknown>).validated = true;
              pm.volume = m.volume;
              pm.difficulty = m.difficulty;
            } else {
              (pm as Record<string, unknown>).validated = false;
              unvalidated++;
            }
          }
          log.info(`API validation: ${needsApiLookup.length - unvalidated} validated, ${unvalidated} unvalidated`);
        } catch (err) {
          log.error({ err }, 'Post-AI keyword validation error');
        }
      }
    }

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

    // Fetch analytics intelligence from computed insights layer
    let intelligenceBlock = '';
    try {
      const insights = getInsights(ws.id);
      if (insights.length > 0) {
        const keywordClusters = insights
          .filter(i => i.insightType === 'keyword_cluster')
          .map(i => i.data as unknown as KeywordClusterData)
          .sort((a, b) => b.totalImpressions - a.totalImpressions);
        const competitorGaps = insights
          .filter(i => i.insightType === 'competitor_gap')
          .map(i => i.data as unknown as CompetitorGapData)
          .sort((a, b) => b.volume - a.volume);
        const conversionPages = insights
          .filter(i => i.insightType === 'conversion_attribution')
          .map(i => ({ pageUrl: i.pageId || '', ...(i.data as unknown as ConversionAttributionData) }))
          .sort((a, b) => b.conversionRate - a.conversionRate);
        intelligenceBlock = buildStrategyIntelligenceBlock({
          keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
          competitorGaps: competitorGaps.length > 0 ? competitorGaps : undefined,
          conversionPages: conversionPages.length > 0 ? conversionPages : undefined,
          performanceDeltas: undefined,
        });
      }
    } catch { /* non-critical — strategy works without intelligence data */ }

    const masterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}${ga4Context}${auditContext}
${semrushContext}${intelligenceBlock}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword (MUST be from SEMRush/GSC data when available)",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource",
      "competitorProof": "competitor.com ranks #3 (optional — cite if a competitor ranks for this keyword)"
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
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: Every targetKeyword MUST come from the SEMRush/GSC data above when available — do NOT invent keywords. ${hasSemrush ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''}${clientKeywordsAdded > 0 ? ` CLIENT-REQUESTED KEYWORDS get HIGH PRIORITY: if any client-requested keyword from the pool has no existing page covering it, it MUST appear as a content gap. The client specifically wants to rank for these terms.` : ''} Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority
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
${competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Competitor domains are used to identify topic areas and intent gaps — NOT to recommend branded searches that funnel users to a competitor. Specifically, do NOT include keywords containing: ${competitorDomains.map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')).join(', ')}. If a keyword gap came from competitor data but contains a competitor brand name, skip it and find the next best non-branded gap.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name. Use competitor data to find topic areas, not to recommend searches that drive users to a competitor.'}
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
      log.error({ detail: masterRaw.slice(0, 300) }, 'Master returned invalid JSON');
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

    } catch (batchErr) {
      if (keepalive) clearInterval(keepalive);
      throw batchErr;
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
          if (kwMatch) {
            pm.currentPosition = kwMatch.position;
          }
          // Don't set currentPosition from a non-matching query — it's misleading

          // Page-level aggregates are still correct:
          pm.impressions = matchingRows.reduce((s, r) => s + r.impressions, 0);
          pm.clicks = matchingRows.reduce((s, r) => s + r.clicks, 0);
          pm.gscKeywords = matchingRows
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 20)
            .map(r => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }));
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
          pm.metricsSource = METRICS_SOURCE.EXACT;
          // Capture SERP features for this page's primary keyword — stored per-page and
          // later aggregated into workspace-level SerpFeatures counts in assembleSeoContext()
          const serp = hasSerpOpportunity(match.serpFeatures);
          const features: string[] = [];
          if (serp.featuredSnippet) features.push('featured_snippet');
          if (serp.paa) features.push('people_also_ask');
          if (serp.video) features.push('video');
          if (serp.localPack) features.push('local_pack');
          if (features.length > 0) pm.serpFeatures = features;
        } else {
          // Try word-overlap match (requires >=80% word overlap and at least 2 words)
          const partial = semrushDomainData.find(k => {
            const kwWords = new Set(k.keyword.toLowerCase().split(/\s+/));
            const pmWords = pm.primaryKeyword.toLowerCase().split(/\s+/);
            const overlap = pmWords.filter(w => kwWords.has(w)).length;
            return overlap / pmWords.length >= 0.8 && pmWords.length >= 2;
          });
          if (partial) {
            pm.volume = partial.volume;
            pm.difficulty = partial.difficulty;
            pm.cpc = partial.cpc;
            pm.metricsSource = METRICS_SOURCE.PARTIAL_MATCH;
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
    // Only look up keywords NOT already in the pool (those are "invented" by the AI)
    // Cap at 30 to avoid burning credits on keywords that will mostly return NOTHING FOUND
    if (provider && semrushMode !== 'none') {
      const pagesNeedingVolume = strategy.pageMap
        .filter((pm: { volume?: number; primaryKeyword: string }) => !pm.volume && pm.primaryKeyword);
      // Filter to reasonable keywords only (≤5 words, not too specific)
      const lookupCandidates = pagesNeedingVolume
        .filter((pm: { primaryKeyword: string }) => pm.primaryKeyword.split(/\s+/).length <= 5)
        .map((pm: { primaryKeyword: string }) => pm.primaryKeyword);
      // Deduplicate
      const uniqueNeeds = [...new Set(lookupCandidates.map((k: string) => k.toLowerCase()))];
      log.info(`Enrichment: ${strategy.pageMap.length} pages total, ${pagesNeedingVolume.length} need volume, ${uniqueNeeds.length} unique keywords to look up (capped at 30)`);
      const needsVolume = uniqueNeeds.slice(0, 30);
      if (needsVolume.length > 0) {
        try {
          const metrics = await provider.getKeywordMetrics(needsVolume as string[], ws.id);
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));
          for (const pm of strategy.pageMap) {
            if (!pm.volume) {
              const m = metricMap.get(pm.primaryKeyword.toLowerCase());
              if (m) {
                pm.volume = m.volume;
                pm.difficulty = m.difficulty;
                pm.cpc = m.cpc;
                pm.metricsSource = METRICS_SOURCE.BULK_LOOKUP;
              }
            }
          }
        } catch (err) {
          log.error({ err: err }, 'Keyword overview enrichment error');
        }
      }
    }

    // Enrich contentGaps with SEMRush volume/difficulty + GSC impressions
    if (strategy.contentGaps && strategy.contentGaps.length > 0) {
      // SEMRush: look up volume/KD from existing domain data first, then bulk-fetch missing
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      const missingCgKws: string[] = [];
      for (const cg of strategy.contentGaps) {
        const m = kwLookup.get(cg.targetKeyword.toLowerCase());
        if (m) {
          cg.volume = m.volume;
          cg.difficulty = m.difficulty;
        } else {
          missingCgKws.push(cg.targetKeyword);
        }
      }
      if (missingCgKws.length > 0 && provider && semrushMode !== 'none') {
        try {
          const cgMetrics = await provider.getKeywordMetrics(missingCgKws.slice(0, 30), ws.id);
          const cgMap = new Map(cgMetrics.map(m => [m.keyword.toLowerCase(), m]));
          for (const cg of strategy.contentGaps) {
            if (!cg.volume) {
              const m = cgMap.get(cg.targetKeyword.toLowerCase());
              if (m) {
                cg.volume = m.volume;
                cg.difficulty = m.difficulty;
              }
            }
          }
        } catch (err) {
          log.error({ err }, 'Content gap keyword enrichment error');
        }
      }
      // GSC: check if the site already gets impressions for content gap keywords
      if (gscData.length > 0) {
        const gscByQuery = new Map<string, { impressions: number }>();
        for (const row of gscData) {
          const q = row.query.toLowerCase();
          const existing = gscByQuery.get(q);
          if (existing) {
            existing.impressions += row.impressions;
          } else {
            gscByQuery.set(q, { impressions: row.impressions });
          }
        }
        for (const cg of strategy.contentGaps) {
          const exact = gscByQuery.get(cg.targetKeyword.toLowerCase());
          if (exact) {
            cg.impressions = exact.impressions;
          } else {
            // Word-level match: sum impressions from queries where all target words appear
            const targetWords = cg.targetKeyword.toLowerCase().split(/\s+/);
            if (targetWords.length >= 2) {
              let totalImpr = 0;
              for (const [q, data] of gscByQuery) {
                const qWords = q.split(/\s+/);
                const allMatch = targetWords.every(tw => qWords.includes(tw));
                if (allMatch) totalImpr += data.impressions;
              }
              if (totalImpr > 0) cg.impressions = totalImpr;
            }
          }
        }
      }
    }

    // Enrich content gaps with trend direction + SERP features from domain data
    if (strategy.contentGaps?.length && semrushDomainData.length > 0) {
      const domainLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      for (const cg of strategy.contentGaps) {
        const match = domainLookup.get(cg.targetKeyword.toLowerCase());
        if (match) {
          cg.trendDirection = trendDirection(match.trend);
          const serp = hasSerpOpportunity(match.serpFeatures);
          const features: string[] = [];
          if (serp.featuredSnippet) features.push('featured_snippet');
          if (serp.paa) features.push('people_also_ask');
          if (serp.video) features.push('video');
          if (serp.localPack) features.push('local_pack');
          if (features.length > 0) cg.serpFeatures = features;
        }
        // Attach related question keywords to each gap
        if (allQuestionKws.length > 0) {
          const relatedQs = allQuestionKws.flatMap(q => q.questions)
            .filter(q => q.keyword.toLowerCase().includes(cg.targetKeyword.toLowerCase().split(' ')[0]))
            .slice(0, 3)
            .map(q => q.keyword);
          if (relatedQs.length > 0) cg.questionKeywords = relatedQs;
        }
      }
    }

    // ── SERP Feature Targeting Recommendations ───────────────────
    if (strategy.contentGaps?.length) {
      for (const cg of strategy.contentGaps) {
        if (!cg.serpFeatures?.length) continue;
        const recs: string[] = [];
        for (const feat of cg.serpFeatures) {
          switch (feat) {
            case 'featured_snippet':
              recs.push('Structure content with a clear definition or step-by-step list in the first 100 words to target the featured snippet');
              break;
            case 'people_also_ask':
              recs.push('Include FAQ sections with concise 2-3 sentence answers to target People Also Ask boxes');
              break;
            case 'video':
              recs.push('Embed a relevant video or create video content to compete for the video carousel');
              break;
            case 'local_pack':
              recs.push('Include location-specific content, NAP details, and LocalBusiness schema markup');
              break;
          }
        }
        if (recs.length > 0) cg.serpTargeting = recs;
      }
    }

    // ── Cannibalization Detection + Canonical Recommender ────────
    // Find keywords assigned to multiple pages, recommend canonical URLs and specific actions
    const cannibalization: Array<{
      keyword: string;
      pages: Array<{ path: string; position?: number; impressions?: number; clicks?: number; source: 'keyword_map' | 'gsc' }>;
      severity: 'high' | 'medium' | 'low';
      recommendation: string;
      canonicalPath?: string;
      canonicalUrl?: string;
      action: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
    }> = [];
    {
      const kwPages = new Map<string, Array<{ path: string; source: 'keyword_map' | 'gsc' }>>();
      for (const pm of strategy.pageMap) {
        const kw = pm.primaryKeyword.toLowerCase();
        if (!kwPages.has(kw)) kwPages.set(kw, []);
        kwPages.get(kw)!.push({ path: pm.pagePath, source: 'keyword_map' });
      }

      if (gscData.length > 0) {
        const gscByQuery = new Map<string, Array<{ page: string; position: number; impressions: number; clicks: number }>>();
        for (const r of gscData) {
          const q = r.query.toLowerCase();
          if (!gscByQuery.has(q)) gscByQuery.set(q, []);
          try {
            gscByQuery.get(q)!.push({ page: new URL(r.page).pathname, position: r.position, impressions: r.impressions, clicks: r.clicks });
          } catch { /* skip */ }
        }
        for (const [query, pages] of gscByQuery) {
          if (pages.length >= 2 && pages.some(p => p.impressions > 10)) {
            const existing = kwPages.get(query);
            if (existing) {
              for (const p of pages) {
                if (!existing.find(e => e.path === p.page)) {
                  existing.push({ path: p.page, source: 'gsc' });
                }
              }
            } else {
              kwPages.set(query, pages.map(p => ({ path: p.page, source: 'gsc' as const })));
            }
          }
        }

        for (const [kw, pages] of kwPages) {
          if (pages.length < 2) continue;
          const gscQueryData = gscByQuery.get(kw);
          const enrichedPages = pages.map(p => {
            const gscMatch = gscQueryData?.find(g => g.page === p.path);
            return {
              path: p.path,
              position: gscMatch?.position,
              impressions: gscMatch?.impressions,
              clicks: gscMatch?.clicks,
              source: p.source,
            };
          });
          const severity = pages.length >= 3 ? 'high' as const
            : enrichedPages.filter(p => p.position && p.position < 20).length >= 2 ? 'high' as const
            : 'medium' as const;

          // Rank pages by composite score: best position → most clicks → most impressions
          const scored = [...enrichedPages].sort((a, b) => {
            const posA = a.position ?? 100, posB = b.position ?? 100;
            if (posA !== posB) return posA - posB;
            const clickA = a.clicks ?? 0, clickB = b.clicks ?? 0;
            if (clickA !== clickB) return clickB - clickA;
            return (b.impressions ?? 0) - (a.impressions ?? 0);
          });
          const bestPage = scored[0];
          const otherPages = scored.slice(1);
          const canonicalPath = bestPage.path;
          const canonicalUrl = baseUrl ? `${baseUrl}${canonicalPath === '/' ? '' : canonicalPath}` : undefined;

          // Determine action type:
          // - Both pages have traffic + similar position → differentiate content
          // - Secondary page has no traffic → safe to redirect or noindex
          // - Secondary page has some traffic → canonical tag (preserves the page)
          const secondaryHasTraffic = otherPages.some(p => (p.clicks ?? 0) > 5);
          const positionsClose = otherPages.some(p =>
            p.position && bestPage.position && Math.abs(p.position - bestPage.position) < 10
          );
          let action: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
          let recommendation: string;

          if (positionsClose && secondaryHasTraffic) {
            action = 'differentiate';
            recommendation = `Both ${canonicalPath} and ${otherPages.map(p => p.path).join(', ')} rank competitively for "${kw}". Differentiate content: retarget ${otherPages.length === 1 ? otherPages[0].path : 'secondary pages'} to a more specific long-tail variant of this keyword.`;
          } else if (secondaryHasTraffic) {
            action = 'canonical_tag';
            recommendation = `Add <link rel="canonical" href="${canonicalUrl || canonicalPath}"> to ${otherPages.map(p => p.path).join(', ')}. This tells Google that ${canonicalPath} is the primary page for "${kw}" while preserving the secondary pages for users.`;
          } else if (otherPages.every(p => !p.clicks && (p.impressions ?? 0) < 50)) {
            action = 'redirect_301';
            recommendation = `301 redirect ${otherPages.map(p => p.path).join(', ')} → ${canonicalPath}. The secondary page(s) have no meaningful traffic and are diluting ranking authority for "${kw}".`;
          } else {
            action = 'canonical_tag';
            recommendation = `Set ${canonicalPath} as the canonical URL for "${kw}". Add <link rel="canonical" href="${canonicalUrl || canonicalPath}"> to ${otherPages.map(p => p.path).join(', ')}.`;
          }

          cannibalization.push({
            keyword: kw,
            pages: enrichedPages,
            severity,
            recommendation,
            canonicalPath,
            canonicalUrl,
            action,
          });
        }
      }
      if (cannibalization.length > 0) {
        cannibalization.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
        log.info(`Found ${cannibalization.length} cannibalization issues (${cannibalization.filter(c => c.severity === 'high').length} high, actions: ${cannibalization.map(c => c.action).join(', ')})`);
      }
    }

    // ── Topical Authority Clustering (AI-powered) ───────────────
    // Use AI to semantically group keywords into business-relevant topic areas,
    // then measure coverage against owned keywords
    const topicClusters: Array<{ topic: string; keywords: string[]; ownedCount: number; totalCount: number; coveragePercent: number; avgPosition?: number; topCompetitor?: string; topCompetitorCoverage?: number; gap: string[] }> = [];
    if (keywordPool.size >= 10) {
      try {
        sendProgress('enrichment', 'Building topical authority clusters...', 0.92);
        const ownedKws = new Set(semrushDomainData.map(k => k.keyword.toLowerCase()));

        // Top keywords by volume for AI clustering
        const poolForClustering = [...keywordPool.entries()]
          .sort((a, b) => b[1].volume - a[1].volume)
          .slice(0, 150)
          .map(([kw, m]) => `"${kw}" (${m.volume}/mo)`);

        const clusterPrompt = `You are a topical authority analyst. Group these keywords into 5-10 BUSINESS-RELEVANT topic clusters.
${businessSection}
KEYWORD POOL (${poolForClustering.length} keywords with search volume):
${poolForClustering.join(', ')}

Return JSON array:
[
  {
    "topic": "Short descriptive topic name (2-4 words, specific to THIS business)",
    "keywords": ["keyword1", "keyword2"]
  }
]

Rules:
- Each cluster must represent a distinct business capability, service area, product category, or content pillar that THIS business actually serves
- Topic names must be specific — NOT generic phrases like "how to", "what is", "best tools"
- Use the BUSINESS CONTEXT above to determine what matters to this business. If no context, infer from the keywords themselves
- Every keyword should appear in exactly ONE cluster. Skip keywords that don't fit any meaningful business topic
- Clusters should have 3-15 keywords each
- Order clusters by strategic importance to the business
- Return ONLY valid JSON array, no markdown`;

        const clusterRaw = await callStrategyAI([
          { role: 'system', content: 'You are a topical authority analyst. Return valid JSON only.' },
          { role: 'user', content: clusterPrompt },
        ], 2000, 'topic-clusters');

        const aiClusters = JSON.parse(clusterRaw);
        if (Array.isArray(aiClusters)) {
          for (const cluster of aiClusters) {
            if (!cluster.topic || !Array.isArray(cluster.keywords) || cluster.keywords.length < 3) continue;

            const normalizedKws = cluster.keywords
              .map((k: string) => k.toLowerCase().trim())
              .filter((k: string) => keywordPool.has(k));
            if (normalizedKws.length < 3) continue;

            const owned = normalizedKws.filter((k: string) => ownedKws.has(k));
            const gap = normalizedKws.filter((k: string) => !ownedKws.has(k));
            const coverage = Math.round((owned.length / normalizedKws.length) * 100);

            let avgPos: number | undefined;
            if (owned.length > 0) {
              const positions = owned.map((k: string) => semrushDomainData.find(d => d.keyword.toLowerCase() === k)?.position).filter(Boolean) as number[];
              if (positions.length > 0) avgPos = Math.round(positions.reduce((s, p) => s + p, 0) / positions.length);
            }

            let topComp: string | undefined;
            let topCompCov: number | undefined;
            if (competitorKeywordData.length > 0) {
              const compCoverage = new Map<string, number>();
              for (const ck of competitorKeywordData) {
                if (normalizedKws.includes(ck.keyword.toLowerCase())) {
                  compCoverage.set(ck.domain, (compCoverage.get(ck.domain) || 0) + 1);
                }
              }
              const best = [...compCoverage.entries()].sort((a, b) => b[1] - a[1])[0];
              if (best && best[1] > owned.length) {
                topComp = best[0];
                topCompCov = Math.round((best[1] / normalizedKws.length) * 100);
              }
            }

            topicClusters.push({
              topic: cluster.topic,
              keywords: normalizedKws,
              ownedCount: owned.length,
              totalCount: normalizedKws.length,
              coveragePercent: coverage,
              avgPosition: avgPos,
              topCompetitor: topComp,
              topCompetitorCoverage: topCompCov,
              gap,
            });
          }
        }
        if (topicClusters.length > 0) {
          topicClusters.sort((a, b) => a.coveragePercent - b.coveragePercent);
          log.info(`Built ${topicClusters.length} AI topic clusters (lowest coverage: ${topicClusters[0].topic} at ${topicClusters[0].coveragePercent}%)`);
        }
      } catch (err) {
        log.warn({ err }, 'AI topic clustering failed — skipping');
      }
    }

    // Enrich siteKeywords with volume/difficulty
    let siteKeywordMetrics: { keyword: string; volume: number; difficulty: number }[] = [];
    if (provider && semrushMode !== 'none' && strategy.siteKeywords?.length) {
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
          const extra = await provider.getKeywordMetrics(missing.slice(0, 15), ws.id);
          for (const m of extra) {
            found.push({ keyword: m.keyword, volume: m.volume, difficulty: m.difficulty });
          }
        } catch { /* non-critical */ }
      }
      siteKeywordMetrics = found;
    }

    // ── Impact-based filtering & sorting ──────────────────────────
    // Prefer content gaps with real search volume; if filtering would remove ALL, keep originals sorted by priority
    if (strategy.contentGaps?.length) {
      const prioWeight = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
      const withVolume = strategy.contentGaps
        .filter((cg: { volume?: number; impressions?: number }) =>
          cg.volume === undefined && cg.impressions === undefined ||
          (cg.volume && cg.volume > 0) || (cg.impressions && cg.impressions > 0)
        );
      if (withVolume.length > 0) {
        // Sort by volume descending, then priority
        strategy.contentGaps = withVolume.sort(
          (a: { volume?: number; priority: string }, b: { volume?: number; priority: string }) =>
            (b.volume || 0) - (a.volume || 0) || prioWeight(b.priority) - prioWeight(a.priority)
        );
      } else {
        // No volume data available — keep all but sort by priority
        strategy.contentGaps = strategy.contentGaps.sort(
          (a: { priority: string }, b: { priority: string }) =>
            prioWeight(b.priority) - prioWeight(a.priority)
        );
      }
      log.info(`Content gaps: ${withVolume.length} with volume data, ${strategy.contentGaps.length} total kept`);
    }

    // ── Quick Win ROI Scoring ──────────────────────────────────
    if (strategy.quickWins?.length) {
      // Compute ROI score: (volume × (1 - difficulty/100)) / max(currentPosition, 1)
      // Fall back to impact-based scoring if no volume data
      for (const qw of strategy.quickWins) {
        const pageData = strategy.pageMap?.find((p: { pagePath: string }) => p.pagePath === qw.pagePath);
        if (pageData?.volume && pageData?.currentPosition) {
          const difficulty = pageData.difficulty ?? 50;
          qw.roiScore = Math.round((pageData.volume * (1 - difficulty / 100)) / Math.max(pageData.currentPosition, 1));
        } else {
          // Fallback: estimate from impact level
          qw.roiScore = qw.estimatedImpact === 'high' ? 100 : qw.estimatedImpact === 'medium' ? 50 : 20;
        }
      }
      strategy.quickWins.sort((a: { roiScore?: number }, b: { roiScore?: number }) => (b.roiScore || 0) - (a.roiScore || 0));
    }

    // Sort pageMap by volume (highest impact first)
    if (strategy.pageMap?.length) {
      strategy.pageMap.sort((a: { volume?: number; impressions?: number }, b: { volume?: number; impressions?: number }) =>
        ((b.volume || 0) + (b.impressions || 0)) - ((a.volume || 0) + (a.impressions || 0))
      );
    }

    // Sort siteKeywordMetrics by volume
    if (siteKeywordMetrics.length > 0) {
      siteKeywordMetrics.sort((a, b) => b.volume - a.volume);
    }

    // 7. Save to workspace — pageMap goes to page_keywords table, rest to workspace blob
    sendProgress('complete', 'Strategy complete!', 1.0);
    const pageMap = strategy.pageMap || [];
    // Snapshot previous page map BEFORE replacing (needed for strategy diff)
    const prevPageMapForHistory = listPageKeywords(ws.id);
    // Save pageMap to dedicated table (upserts new entries + deletes stale ones, preserves PI data)
    upsertAndCleanPageKeywords(ws.id, pageMap);
    // Bridge #5: page keywords replaced — invalidate page caches
    debouncedPageAnalysisInvalidate(ws.id, () => {
      clearSeoContextCache(ws.id);
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
      invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
    });

    // Strategy-level data (no pageMap) goes to workspace JSON blob
    const { pageMap: _stripPageMap, ...strategyMeta } = strategy;
    const keywordStrategy = {
      ...strategyMeta,
      siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
      keywordGaps: keywordGaps.length > 0 ? keywordGaps.slice(0, 30) : undefined,
      topicClusters: topicClusters.length > 0 ? topicClusters : undefined,
      cannibalization: cannibalization.length > 0 ? cannibalization.slice(0, 20) : undefined,
      questionKeywords: allQuestionKws.length > 0 ? allQuestionKws : undefined,
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
    // Save previous strategy to history (keep last 5)
    if (ws.keywordStrategy?.generatedAt) {
      db.prepare(`INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)`).run(
        ws.id, JSON.stringify(ws.keywordStrategy), JSON.stringify(prevPageMapForHistory), ws.keywordStrategy.generatedAt
      );
      // Prune old entries, keep last 5
      db.prepare(`DELETE FROM strategy_history WHERE workspace_id = ? AND id NOT IN (SELECT id FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 5)`).run(ws.id, ws.id);
    }

    updateWorkspace(ws.id, { keywordStrategy });
    clearSeoContextCache(ws.id);
    invalidateIntelligenceCache(ws.id);
    // Bridge #3: strategy updated — debounced intelligence invalidation
    debouncedStrategyInvalidate(ws.id, () => {
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
    });
    incrementUsage(ws.id, 'strategy_generations');

    try {
      if (!getActionBySource('strategy', ws.id)) recordAction({ // recordAction-ok: ws.id is workspaceId
        workspaceId: ws.id,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        sourceId: ws.id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome action for strategy generation');
    }

    // Auto-seed rank tracking with strategy keywords (deduplicates internally)
    try {
      const seedKeywords = new Set<string>();
      for (const kw of keywordStrategy.siteKeywords || []) seedKeywords.add(kw.toLowerCase().trim());
      for (const pm of pageMap) {
        if (pm.primaryKeyword) seedKeywords.add(pm.primaryKeyword.toLowerCase().trim());
      }
      for (const kw of seedKeywords) addTrackedKeyword(ws.id, kw);
      log.info(`Auto-seeded ${seedKeywords.size} keywords into rank tracking for ${ws.name}`);
    } catch (seedErr) {
      log.warn({ err: seedErr }, 'Failed to auto-seed rank tracking keywords');
    }

    if (keepalive) clearInterval(keepalive);

    // Reassemble for response (frontend expects pageMap in the strategy object)
    const responseStrategy = { ...keywordStrategy, pageMap };
    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ done: true, strategy: responseStrategy })}\n\n`);
      res.end();
    } else {
      res.json(responseStrategy);
    }

    // Trigger background llms.txt regeneration after strategy update
    queueLlmsTxtRegeneration(ws.id, 'keyword_strategy_updated');
    return;
  } catch (err) {
    if (keepalive) clearInterval(keepalive);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    log.error({ detail: msg, stack }, 'Keyword strategy error');
    if (wantsStream) {
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch { /* already closed */ }
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// Get stored keyword strategy (reassembles pageMap from page_keywords table)
router.get('/api/webflow/keyword-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const strategy = ws.keywordStrategy;
  if (!strategy) return res.json(null);
  // Reassemble pageMap from dedicated table
  const pageMap = listPageKeywords(ws.id);
  res.json({ ...strategy, pageMap });
});

// Get strategy diff (compare current vs previous)
router.get('/api/webflow/keyword-strategy/:workspaceId/diff', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const current = ws.keywordStrategy;
  if (!current) return res.json(null);

  const prev = db.prepare('SELECT strategy_json, page_map_json, generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 1').get(ws.id) as { strategy_json: string; page_map_json: string; generated_at: string } | undefined;
  if (!prev) return res.json(null);

  const prevStrategy = parseJsonFallback(prev.strategy_json, {});
  const prevPageMap = parseJsonFallback(prev.page_map_json, []);
  const currentPageMap = listPageKeywords(ws.id);

  // Compute diffs
  const prevSiteKws = new Set(prevStrategy.siteKeywords || []);
  const currSiteKws = new Set(current.siteKeywords || []);
  const newKeywords = [...currSiteKws].filter(k => !prevSiteKws.has(k));
  const lostKeywords = [...prevSiteKws].filter(k => !currSiteKws.has(k));

  const prevGapKws = new Set((prevStrategy.contentGaps || []).map((g: { targetKeyword: string }) => g.targetKeyword));
  const currGapKws = new Set((current.contentGaps || []).map((g: { targetKeyword: string }) => g.targetKeyword));
  const newGaps = [...currGapKws].filter(k => !prevGapKws.has(k));
  const resolvedGaps = [...prevGapKws].filter(k => !currGapKws.has(k));

  // Page map changes
  const prevPageKws = new Map(prevPageMap.map((p: { pagePath: string; primaryKeyword: string }) => [p.pagePath, p.primaryKeyword]));
  const currPageKws = new Map(currentPageMap.map((p: { pagePath: string; primaryKeyword: string }) => [p.pagePath, p.primaryKeyword]));
  const keywordChanges: { pagePath: string; oldKeyword: string; newKeyword: string }[] = [];
  for (const [path, kw] of currPageKws) {
    const old = prevPageKws.get(path);
    if (old && old !== kw) keywordChanges.push({ pagePath: path, oldKeyword: old, newKeyword: kw });
  }

  res.json({
    previousGeneratedAt: prev.generated_at,
    currentGeneratedAt: current.generatedAt,
    newKeywords,
    lostKeywords,
    newGaps,
    resolvedGaps,
    keywordChanges,
    prevSiteKeywordCount: prevSiteKws.size,
    currSiteKeywordCount: currSiteKws.size,
  });
});

// Update keyword strategy (manual edits)
const patchStrategySchema = z.object({
  pageMap: z.array(z.object({
    pagePath: z.string(),
    pageTitle: z.string(),
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()),
    searchIntent: z.string().optional(),
  }).passthrough()).optional(),
  siteKeywords: z.array(z.string()).optional(),
  contentGaps: z.array(z.any()).optional(),
  quickWins: z.array(z.any()).optional(),
  opportunities: z.array(z.string()).optional(),
}).strict();

router.patch('/api/webflow/keyword-strategy/:workspaceId', validate(patchStrategySchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  // If pageMap is being updated, save to dedicated table
  if (req.body.pageMap) {
    upsertAndCleanPageKeywords(ws.id, req.body.pageMap);
    // Bridge #5: page keywords replaced — invalidate page caches
    debouncedPageAnalysisInvalidate(ws.id, () => {
      clearSeoContextCache(ws.id);
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
      invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
    });
  }
  // Save non-pageMap fields to workspace blob
  const { pageMap: _pm, ...rest } = req.body;
  const updated = { ...(ws.keywordStrategy || {}), ...rest, generatedAt: new Date().toISOString() };
  updateWorkspace(ws.id, { keywordStrategy: updated });
  clearSeoContextCache(ws.id);
  invalidateIntelligenceCache(ws.id);
  // Bridge #3: strategy updated — debounced intelligence invalidation
  debouncedStrategyInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
  });
  // Respond with reassembled strategy
  const responsePageMap = listPageKeywords(ws.id);
  res.json({ ...updated, pageMap: responsePageMap });
});

// ── Keyword Feedback (approve/decline) ──────────────────────────

/** Get all declined keywords for a workspace (used by strategy generator to exclude) */
export function getDeclinedKeywords(workspaceId: string): string[] {
  const rows = db.prepare('SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?').all(workspaceId, 'declined') as { keyword: string }[];
  return rows.map(r => r.keyword);
}

/** Get all client-requested keywords for a workspace (used by strategy generator to prioritize) */
export function getRequestedKeywords(workspaceId: string): string[] {
  const rows = db.prepare('SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?').all(workspaceId, 'requested') as { keyword: string }[];
  return rows.map(r => r.keyword);
}

/** Get all keyword feedback for a workspace */
function getAllFeedback(workspaceId: string) {
  return db.prepare('SELECT * FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId);
}

// Admin: list all feedback for workspace
router.get('/api/webflow/keyword-feedback/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(getAllFeedback(ws.id));
});

// Admin or client: submit feedback on a keyword
const feedbackSchema = z.object({
  keyword: z.string().min(1),
  status: z.enum(['approved', 'declined', 'requested']),
  reason: z.string().optional(),
  source: z.enum(['content_gap', 'page_map', 'opportunity', 'topic_cluster', 'keyword_gap']).optional(),
  declinedBy: z.string().optional(),
});

router.post('/api/webflow/keyword-feedback/:workspaceId', validate(feedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { keyword, status, reason, source, declinedBy } = req.body;
  const kw = keyword.toLowerCase().trim();

  db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `).run(ws.id, kw, status, reason || null, source || 'content_gap', declinedBy || null);

  if (status === 'approved') addTrackedKeyword(ws.id, kw);

  log.info(`Keyword feedback: "${kw}" → ${status} for workspace ${ws.id}${reason ? ` (reason: ${reason})` : ''}`);
  res.json({ keyword: kw, status, reason: reason || null });
});

// Bulk feedback (approve/decline multiple keywords at once)
const bulkFeedbackSchema = z.object({
  keywords: z.array(z.object({
    keyword: z.string().min(1),
    status: z.enum(['approved', 'declined', 'requested']),
    reason: z.string().optional(),
    source: z.string().optional(),
  })).min(1).max(100),
  declinedBy: z.string().optional(),
});

router.post('/api/webflow/keyword-feedback/:workspaceId/bulk', validate(bulkFeedbackSchema), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const stmt = db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `);

  const insert = db.transaction((items: typeof req.body.keywords) => {
    for (const item of items) {
      stmt.run(ws.id, item.keyword.toLowerCase().trim(), item.status, item.reason || null, item.source || 'content_gap', req.body.declinedBy || null);
    }
  });
  insert(req.body.keywords);

  for (const item of req.body.keywords) {
    if (item.status === 'approved') addTrackedKeyword(ws.id, item.keyword.toLowerCase().trim());
  }

  log.info(`Bulk keyword feedback: ${req.body.keywords.length} keywords for workspace ${ws.id}`);
  res.json({ updated: req.body.keywords.length });
});

// Delete feedback (un-decline a keyword)
router.delete('/api/webflow/keyword-feedback/:workspaceId/:keyword', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const kw = decodeURIComponent(req.params.keyword).toLowerCase().trim();
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').run(ws.id, kw);
  res.json({ deleted: kw });
});

// --- Intelligence Signals ---
// GET /api/webflow/keyword-strategy/:workspaceId/signals

router.get('/api/webflow/keyword-strategy/:workspaceId/signals', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  try {
    const insights = getInsights(ws.id);
    const signals = buildStrategySignals(insights);
    res.json({ signals });
  } catch (err) {
    log.error({ err, workspaceId: ws.id }, 'Failed to build strategy signals');
    res.json({ signals: [] });
  }
});

export default router;
