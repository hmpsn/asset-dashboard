/**
 * Keyword strategy generation service.
 *
 * Shared by the direct keyword strategy route and background job worker.
 */
import { addTrackedKeyword } from './rank-tracking.js';
import {
  trendDirection,
  hasSerpOpportunity,
} from './seo-provider-signals.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { incrementIfAllowed, decrementUsage } from './usage-tracking.js';
import { clearSeoContextCache } from './seo-context.js'; // seo-context-ok: strategy generation must invalidate legacy SEO context caches after writes.
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { updateWorkspace, getWorkspace, getTokenForSite } from './workspaces.js';
import { upsertAndCleanPageKeywords, upsertPageKeywordsBatch, listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';
import { METRICS_SOURCE } from '../shared/types/keywords.js';
import { queueLlmsTxtRegeneration } from './llms-txt-generator.js';
import { recordAction, getActionBySource } from './outcome-tracking.js';
import { isProgrammingError } from './errors.js';
import { generateRecommendations } from './recommendations.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { matchesQuestionKeyword } from './strategy-filters.js';
import { addActivity } from './activity-log.js';
import { fetchAndCacheKeywordStrategySeoData } from './keyword-strategy-seo-data.js';
import { discoverKeywordStrategyPages } from './keyword-strategy-pages.js';
import { fetchKeywordStrategySearchData } from './keyword-strategy-search-data.js';
import {
  callKeywordStrategyAI,
  KeywordStrategySynthesisError,
  synthesizeKeywordStrategy,
  type StrategyContentGap,
  type StrategyOutput,
} from './keyword-strategy-ai-synthesis.js';
import { computeOpportunityScore } from './keyword-strategy-helpers.js';

export { buildStrategyIntelligenceBlock, computeOpportunityScore, shouldFetchCompetitorData } from './keyword-strategy-helpers.js';

const log = createLogger('keyword-strategy');

// Dedup guard: prevents concurrent background recommendation runs for the same workspace
// (e.g. rapid strategy re-generations). Final write wins via SQLite upsert; this just
// avoids wasted work and redundant broadcasts.
const recsInFlight = new Set<string>();

// Concurrent generation guard: prevents two simultaneous strategy generations for the same
// workspace from racing to the DB. The second request receives a 409 immediately.
const activeGenerations = new Set<string>();

export interface KeywordStrategyProgressEvent {
  step: string;
  detail: string;
  progress: number;
}

export interface GenerateKeywordStrategyOptions {
  workspaceId: string;
  businessContext?: string;
  mode?: 'full' | 'incremental';
  seoDataMode?: 'quick' | 'full' | 'none' | string;
  /** @deprecated use seoDataMode. Preserved for legacy route/job callers. */
  semrushMode?: 'quick' | 'full' | 'none' | string;
  competitorDomains?: string[];
  competitorDomainsProvided?: boolean;
  maxPages?: number;
  onProgress?: (event: KeywordStrategyProgressEvent) => void;
  startKeepalive?: () => () => void;
}

export interface GenerateKeywordStrategyResult {
  strategy: (KeywordStrategy & { pageMap?: PageKeywordMap[] }) | null;
  upToDate?: boolean;
  freshPageCount?: number;
}

export class KeywordStrategyGenerationError extends Error {
  statusCode: number;
  payload: { error: string; message?: string; raw?: string };

  constructor(statusCode: number, payload: { error: string; message?: string; raw?: string }) {
    super(payload.error);
    this.name = 'KeywordStrategyGenerationError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export function hasActiveKeywordStrategyGeneration(workspaceId: string): boolean {
  return activeGenerations.has(workspaceId);
}

function normalizeSeoDataMode(mode: string | undefined): 'quick' | 'full' | 'none' {
  return mode === 'quick' || mode === 'full' ? mode : 'none';
}

export async function generateKeywordStrategy(options: GenerateKeywordStrategyOptions): Promise<GenerateKeywordStrategyResult> {
  const ws = getWorkspace(options.workspaceId);
  if (!ws) throw new KeywordStrategyGenerationError(404, { error: 'Workspace not found' });
  if (!ws.webflowSiteId) throw new KeywordStrategyGenerationError(400, { error: 'No Webflow site linked' });

  // Concurrent generation guard: reject duplicate in-flight requests immediately.
  if (activeGenerations.has(ws.id)) {
    throw new KeywordStrategyGenerationError(409, { error: 'A keyword strategy is already being generated for this workspace' });
  }

  // Atomically reserve a usage slot before the async AI work begins (closes TOCTOU race).
  const tier = ws.tier || 'free';
  if (!incrementIfAllowed(ws.id, tier, 'strategy_generations')) {
    throw new KeywordStrategyGenerationError(429, {
      error: 'Strategy generation limit reached',
      message: `You've reached your monthly strategy generation limit. Upgrade for more.`,
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    decrementUsage(ws.id, 'strategy_generations'); // refund pre-reserved slot — misconfiguration is not a user error
    throw new KeywordStrategyGenerationError(500, { error: 'OPENAI_API_KEY not configured' });
  }

  const provider = getConfiguredProvider(ws.seoDataProvider);

  const businessContext = options.businessContext || ws.keywordStrategy?.businessContext || '';
  const strategyMode = options.mode === 'incremental' ? 'incremental' : 'full'; // 'full' | 'incremental'
  const seoDataMode = normalizeSeoDataMode(options.seoDataMode ?? options.semrushMode);
  const competitorDomains = options.competitorDomains ? [...options.competitorDomains] : [...(ws.competitorDomains || [])];
  const rawMaxPages = options.maxPages != null ? Number(options.maxPages) : 500;
  const maxPagesParam = rawMaxPages > 0 ? Math.min(rawMaxPages, 2000) : 0; // 0 = no cap, clamped at 2000
  const token = getTokenForSite(ws.webflowSiteId) || undefined;

  // Save competitor domains if provided
  if (options.competitorDomainsProvided) {
    updateWorkspace(ws.id, { competitorDomains });
  }

  const sendProgress = (step: string, detail: string, progress: number) => {
    log.info(`[${step}] ${detail} (${Math.round(progress * 100)}%)`);
    options.onProgress?.({ step, detail, progress });
  };

  // Keepalive pings to prevent Render proxy from killing idle SSE connection
  // Declared before outer try so it can be cleared in both success and error paths
  let stopKeepalive: (() => void) | null = null;
  const clearKeepalive = () => {
    if (stopKeepalive) {
      stopKeepalive();
      stopKeepalive = null;
    }
  };

  // Mark workspace in-progress AFTER all sync setup — any throw above (DB/parse errors)
  // will propagate without polluting activeGenerations. The finally block below
  // is the single cleanup point for all exit paths inside the try.
  activeGenerations.add(ws.id);
  let responseSent = false;

  try {
    const {
      baseUrl,
      pageInfo,
      preloadedPageKeywords,
    } = await discoverKeywordStrategyPages({
      ws: ws as typeof ws & { webflowSiteId: string },
      token,
      strategyMode,
      maxPagesParam,
      sendProgress,
    });

    const {
      gscData,
      deviceBreakdown,
      countryBreakdown,
      periodComparison,
      organicLandingPages,
      organicOverview,
      ga4Conversions,
      ga4EventsByPage,
    } = await fetchKeywordStrategySearchData({
      ws: ws as typeof ws & { webflowSiteId: string },
      sendProgress,
    });

    // 5. SEO provider data gathering (based on mode)
    // The keyword pool paradigm: provider data supplies the keyword universe, AI assigns terms to pages.
    const {
      seoContext: semrushContext,
      domainKeywords: semrushDomainData,
      keywordGaps,
      relatedKeywords: relatedKws,
      questionKeywords: allQuestionKws,
      competitorKeywords: competitorKeywordData,
    } = await fetchAndCacheKeywordStrategySeoData({
      ws,
      provider,
      baseUrl,
      strategyMode,
      seoDataMode,
      competitorDomains,
      sendProgress,
    });

    // 6. BATCHED AI STRATEGY — parallel page analysis + master synthesis
    //    Step 1: Split pages into batches, analyze each batch in parallel (per-page keyword mapping)
    //    Step 2: Master synthesis call merges all mappings + GSC + provider data into final strategy

    // Start keepalive now that we're entering the long-running AI phase
    stopKeepalive = options.startKeepalive?.() ?? null;

    const synthesis = await synthesizeKeywordStrategy({
      ws,
      businessContext,
      strategyMode,
      seoDataMode,
      competitorDomains,
      pageInfo,
      preloadedPageKeywords,
      searchData: {
        gscData,
        deviceBreakdown,
        countryBreakdown,
        periodComparison,
        organicLandingPages,
        organicOverview,
        ga4Conversions,
        ga4EventsByPage,
      },
      seoContext: semrushContext,
      domainKeywords: semrushDomainData,
      keywordGaps,
      relatedKeywords: relatedKws,
      competitorKeywords: competitorKeywordData,
      provider,
      sendProgress,
    });

    if (synthesis.upToDate) {
      clearKeepalive();
      activeGenerations.delete(ws.id);
      try {
        decrementUsage(ws.id, 'strategy_generations');
      } catch (err) {
        log.warn({ err, workspaceId: ws.id }, 'Failed to refund strategy generation usage after incremental no-op');
      }
      responseSent = true;
      return { strategy: synthesis.strategy as (KeywordStrategy & { pageMap?: PageKeywordMap[] }) | null, upToDate: true, freshPageCount: synthesis.freshPageCount };
    }

    const strategy = synthesis.strategy as StrategyOutput;
    const pagesToAnalyze = synthesis.pagesToAnalyze;
    const keywordPool = synthesis.keywordPool;
    const businessSection = synthesis.businessSection;

    if (!strategy?.pageMap) {
      const errMsg = 'Strategy generation produced no results';
      throw new KeywordStrategyGenerationError(500, { error: errMsg });
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

    // Enrich pageMap with SEO provider volume/difficulty data
    if (semrushDomainData.length > 0) {
      // Build lookup: keyword → metrics
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
      for (const pm of strategy.pageMap) {
        // Skip pages with no primary keyword (declined filter may have cleared it, or AI omitted it)
        if (!pm.primaryKeyword) continue;
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
          // Always write serpFeatures for exact matches (even empty) so COALESCE overwrites
          // stale features if provider data changed. Pages with no exact match are left
          // undefined → null → COALESCE keeps previous value (correct for unmatched pages).
          pm.serpFeatures = features;
        } else {
          // Try word-overlap match (requires >=80% word overlap and at least 2 words)
          const partial = semrushDomainData.find(k => {
            const kwWords = new Set(k.keyword.toLowerCase().split(/\s+/));
            const pmWords = pm.primaryKeyword.toLowerCase().split(/\s+/);
            const overlap = pmWords.filter((w: string) => kwWords.has(w)).length;
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

    // If we still have keywords without volume data and a provider is available, bulk-fetch them
    // Only look up keywords NOT already in the pool (those are "invented" by the AI)
    // Cap at 30 to avoid burning credits on keywords that will mostly return NOTHING FOUND
    if (provider && seoDataMode !== 'none') {
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
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok
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

    // Enrich contentGaps with SEO provider volume/difficulty + GSC impressions
    if (strategy.contentGaps && strategy.contentGaps.length > 0) {
      // Enrich content gaps with volume/KD from the keyword pool first (has data from
      // competitor gaps, competitor keywords, GSC, related keywords), then domain organic
      // data, then bulk API fetch as last resort. The keyword pool is the richest source
      // because it aggregates all data gathered during this strategy run.
      const domainKwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
      const missingCgKws: string[] = [];
      let poolEnriched = 0;
      for (const cg of strategy.contentGaps) {
        const kwLower = cg.targetKeyword.toLowerCase();
        // Priority 1: keyword pool (competitor gaps, competitor keywords, related keywords).
        // SKIP GSC-sourced entries — their "volume" is actually GSC impressions, not real
        // search volume. Using impressions would severely undervalue high-volume keywords
        // and set difficulty to 0 (hardcoded for GSC entries), misleading downstream sorts.
        const poolHit = keywordPool.get(kwLower);
        if (poolHit && poolHit.volume > 0 && poolHit.source !== 'gsc') {
          cg.volume = poolHit.volume;
          cg.difficulty = poolHit.difficulty;
          poolEnriched++;
          continue;
        }
        // Priority 2: domain organic data
        const domainHit = domainKwLookup.get(kwLower);
        if (domainHit) {
          cg.volume = domainHit.volume;
          cg.difficulty = domainHit.difficulty;
          continue;
        }
        missingCgKws.push(cg.targetKeyword);
      }
      log.info(`Content gap enrichment: ${poolEnriched} from keyword pool, ${strategy.contentGaps.length - poolEnriched - missingCgKws.length} from domain data, ${missingCgKws.length} need API lookup`);
      if (missingCgKws.length > 0 && provider && seoDataMode !== 'none') {
        try {
          const cgMetrics = await provider.getKeywordMetrics(missingCgKws.slice(0, 30), ws.id);
          const cgMap = new Map(cgMetrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok
          for (const cg of strategy.contentGaps) {
            if (cg.volume == null) {
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
                const allMatch = targetWords.every((tw: string) => qWords.includes(tw));
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
      const domainLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
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
            .filter(q => matchesQuestionKeyword(cg.targetKeyword, q.keyword))
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

    // Compute composite opportunity score — all enrichment (volume, KD, impressions, trend) is now done
    if (strategy.contentGaps?.length) {
      for (const cg of strategy.contentGaps) {
        cg.opportunityScore = computeOpportunityScore(cg);
      }
      // Sort descending so highest-value gaps surface first in the UI
      strategy.contentGaps.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
      log.info({ workspaceId: ws.id, count: strategy.contentGaps.length }, 'Computed content gap opportunity scores');
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
          } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* skip */ } // url-fetch-ok
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

        const clusterRaw = await callKeywordStrategyAI(ws.id, [
          { role: 'system', content: 'You are a topical authority analyst. Return valid JSON only.' },
          { role: 'user', content: clusterPrompt },
        ], 2000, 'topic-clusters');

        const aiClusters = parseJsonFallback<Array<{ topic?: string; keywords?: string[] }> | null>(clusterRaw, null);
        if (!Array.isArray(aiClusters)) throw new Error('AI topic clustering returned invalid JSON');
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
    if (provider && seoDataMode !== 'none' && strategy.siteKeywords?.length) {
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
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
          const extra = await provider.getKeywordMetrics(missing.slice(0, 30), ws.id);
          for (const m of extra) {
            found.push({ keyword: m.keyword, volume: m.volume, difficulty: m.difficulty });
          }
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* non-critical */ }
      }
      siteKeywordMetrics = found;
    }

    // ── Impact-based sorting (no filtering — keep all keywords including volume=0) ──
    // Previously dropped volume=0 keywords, but that silently removed AI-identified
    // opportunities after enrichment. Now we keep all and sort: positive-volume first,
    // then unenriched (no data yet), then confirmed-zero-volume at bottom.
    if (strategy.contentGaps?.length) {
      const prioWeight = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
      strategy.contentGaps = [...strategy.contentGaps].sort(
        (a: StrategyContentGap, b: StrategyContentGap) => {
          // Bucket values (higher = sorted first, descending):
          //   2 = Positive volume (>0) OR GSC-proven impressions — confirmed demand
          //   1 = Unenriched (null/undefined) — not yet checked, potential
          //   0 = Zero volume with no impressions — enriched but no proven demand
          const getBundle = (gap: StrategyContentGap) => {
            if (gap.volume == null) return { bucket: 1, vol: 0 };  // unenriched bucket 1 (null OR undefined)
            if (gap.volume > 0) return { bucket: 2, vol: gap.volume };   // positive volume bucket 2
            if ((gap.impressions ?? 0) > 0) return { bucket: 2, vol: gap.impressions! }; // GSC-proven demand even at volume=0
            return { bucket: 0, vol: 0 };                                 // confirmed zero demand bucket 0
          };
          const aBundle = getBundle(a);
          const bBundle = getBundle(b);

          // Sort by bucket desc, then by volume desc within bucket, then by priority desc
          return bBundle.bucket - aBundle.bucket ||
                 bBundle.vol - aBundle.vol ||
                 prioWeight(b.priority ?? '') - prioWeight(a.priority ?? '');
        }
      );
      log.info(`Content gaps: ${strategy.contentGaps.length} total (sorted, none dropped)`);
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
    // NOTE: for incremental mode we already called listPageKeywords() above (existingPageKeywords),
    // but we re-read here to get the freshest snapshot right before writing.
    const prevPageMapForHistory = listPageKeywords(ws.id);
    // Save pageMap to dedicated table.
    // Full mode: upsert + delete stale rows (clean replacement).
    // Incremental mode: only upsert analyzed pages (preserve existing rows for fresh pages).
    // Both modes stamp analysisGeneratedAt = now so incremental freshness checks work correctly
    // on the next run. Without this, analysis_generated_at stays NULL indefinitely and every
    // incremental run re-analyzes everything (COALESCE preserves NULL, not the current time).
    const now = new Date().toISOString();
    if (strategyMode === 'full') {
      const stampedMap = pageMap.map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      upsertAndCleanPageKeywords(ws.id, stampedMap);
    } else {
      // Only update the pages that were actually re-analyzed in this incremental run.
      // Pages with fresh analysis_generated_at are left untouched in the DB.
      const analyzedPaths = new Set(pagesToAnalyze.map(p => p.path));
      const analyzedMappings = pageMap
        .filter((pm) => analyzedPaths.has(pm.pagePath))
        .map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      upsertPageKeywordsBatch(ws.id, analyzedMappings);
    }
    // Bridge #5: page keywords replaced — invalidate page caches
    debouncedPageAnalysisInvalidate(ws.id, () => {
      clearSeoContextCache(ws.id);
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
      invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
    });

    // Strategy-level data (no pageMap) goes to workspace JSON blob
    const strategyMeta = { ...strategy };
    delete strategyMeta.pageMap;
    const keywordStrategy = {
      ...strategyMeta,
      siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
      keywordGaps: keywordGaps.length > 0 ? keywordGaps.slice(0, 30) : undefined,
      competitorKeywordData: competitorKeywordData.length > 0 ? competitorKeywordData.slice(0, 150) : undefined,
      topicClusters: topicClusters.length > 0 ? topicClusters : undefined,
      cannibalization: cannibalization.length > 0 ? cannibalization.slice(0, 20) : undefined,
      questionKeywords: allQuestionKws.length > 0 ? allQuestionKws : undefined,
      businessContext: businessContext || undefined,
      seoDataMode: seoDataMode as 'quick' | 'full' | 'none',
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
    // Save previous strategy to history (keep last 5).
    // Wrapped in db.transaction() so that the INSERT and the prune-DELETE
    // are atomic — without it, an INSERT that succeeds followed by a
    // DELETE that fails would leave the table over-quota and the next
    // generation would re-attempt the same prune on a stale snapshot,
    // potentially corrupting history ordering for the workspace.
    // Capture into a local so the closure inside db.transaction() preserves
    // the narrowed type from the if-guard above (TS can't propagate the
    // narrowing through the closure boundary on its own).
    const previousStrategy = ws.keywordStrategy;
    if (previousStrategy?.generatedAt) {
      const previousStrategyJson = JSON.stringify(previousStrategy);
      const previousGeneratedAt = previousStrategy.generatedAt;
      const saveStrategyHistory = db.transaction(() => {
        db.prepare(`INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)`).run(
          ws.id, previousStrategyJson, JSON.stringify(prevPageMapForHistory), previousGeneratedAt
        );
        // Prune old entries, keep last 5
        db.prepare(`DELETE FROM strategy_history WHERE workspace_id = ? AND id NOT IN (SELECT id FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 5)`).run(ws.id, ws.id);
      });
      saveStrategyHistory();
    }

    updateWorkspace(ws.id, { keywordStrategy: keywordStrategy as KeywordStrategy });
    addActivity(ws.id, 'strategy_generated', 'Keyword strategy generated', `${pageMap.length} pages mapped with keywords and search intent`);
    broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
      pageCount: pageMap.length,
      siteKeywords: keywordStrategy.siteKeywords?.length || 0,
    });
    clearSeoContextCache(ws.id);
    invalidateIntelligenceCache(ws.id);
    // Bridge #3: strategy updated — debounced intelligence invalidation
    debouncedStrategyInvalidate(ws.id, () => {
      invalidateIntelligenceCache(ws.id);
      invalidateSubCachePrefix(ws.id, 'slice:seoContext');
    });
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
      for (const kw of keywordStrategy.siteKeywords || []) {
        const normalized = kw.toLowerCase().trim();
        if (normalized) seedKeywords.add(normalized); // skip empty strings
      }
      for (const pm of pageMap) {
        if (pm.primaryKeyword) seedKeywords.add(pm.primaryKeyword.toLowerCase().trim());
      }
      for (const kw of seedKeywords) addTrackedKeyword(ws.id, kw);
      log.info(`Auto-seeded ${seedKeywords.size} keywords into rank tracking for ${ws.name}`);
    } catch (seedErr) {
      log.warn({ err: seedErr }, 'Failed to auto-seed rank tracking keywords');
    }

    clearKeepalive();

    // Reassemble for response (frontend expects pageMap in the strategy object)
    const responseStrategy = { ...keywordStrategy, pageMap };
    responseSent = true;

    // Trigger background llms.txt regeneration after strategy update
    queueLlmsTxtRegeneration(ws.id, 'keyword_strategy_updated');

    // Refresh recommendations so quick wins / content gaps / ranking opportunities
    // reflect the new strategy immediately, without waiting for the next manual audit.
    if (!recsInFlight.has(ws.id)) {
      recsInFlight.add(ws.id);
      generateRecommendations(ws.id)
        .catch(err => log.warn({ err, workspaceId: ws.id }, 'Failed to refresh recommendations after strategy update'))
        .finally(() => recsInFlight.delete(ws.id));
    }
    activeGenerations.delete(ws.id);
    return { strategy: responseStrategy as KeywordStrategy & { pageMap: PageKeywordMap[] } };
  } catch (err) {
    activeGenerations.delete(ws.id);
    clearKeepalive();
    if (!responseSent) decrementUsage(ws.id, 'strategy_generations'); // refund pre-reserved slot on failure
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    log.error({ detail: msg, stack }, 'Keyword strategy error');
    if (err instanceof KeywordStrategyGenerationError) throw err;
    if (err instanceof KeywordStrategySynthesisError) {
      const wrapped = new KeywordStrategyGenerationError(err.statusCode, err.payload);
      wrapped.stack = err.stack;
      throw wrapped;
    }
    throw new KeywordStrategyGenerationError(500, { error: msg });
  }
}
