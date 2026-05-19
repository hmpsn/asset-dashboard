/**
 * Keyword strategy generation service.
 *
 * Shared by the direct keyword strategy route and background job worker.
 */
import { DEFAULT_SEO_DATA_PROVIDER, getConfiguredProvider, type ProviderName } from './seo-data-provider.js';
import { incrementIfAllowed, decrementUsage } from './usage-tracking.js';
import { updateWorkspace, getWorkspace, getTokenForSite } from './workspaces.js';
import { createLogger } from './logger.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';
import { fetchAndCacheKeywordStrategySeoData } from './keyword-strategy-seo-data.js';
import { discoverKeywordStrategyPages } from './keyword-strategy-pages.js';
import { fetchKeywordStrategySearchData } from './keyword-strategy-search-data.js';
import {
  KeywordStrategySynthesisError,
  synthesizeKeywordStrategy,
  type StrategyOutput,
} from './keyword-strategy-ai-synthesis.js';
import { enrichKeywordStrategy } from './keyword-strategy-enrichment.js';
import { persistKeywordStrategy } from './keyword-strategy-persistence.js';
import { queueKeywordStrategyPostUpdateFollowOns, seedKeywordStrategyTrackedKeywords } from './keyword-strategy-follow-ons.js';

// Re-exported for backward compatibility with existing callers.
export { buildStrategyIntelligenceBlock, computeOpportunityScore, shouldFetchCompetitorData } from './keyword-strategy-helpers.js';

const log = createLogger('keyword-strategy');
export const KEYWORD_STRATEGY_MAX_PAGE_CAP = 2000;

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
  seoDataProvider?: ProviderName | string;
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

function normalizeSeoDataProvider(provider: string | undefined): ProviderName | undefined {
  return provider === 'dataforseo' || provider === 'semrush' ? provider : undefined;
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

  const providerPreference = normalizeSeoDataProvider(options.seoDataProvider)
    ?? ws.seoDataProvider
    ?? DEFAULT_SEO_DATA_PROVIDER;
  const provider = getConfiguredProvider(providerPreference);

  const businessContext = options.businessContext || ws.keywordStrategy?.businessContext || '';
  const strategyMode = options.mode === 'incremental' ? 'incremental' : 'full'; // 'full' | 'incremental'
  const seoDataMode = normalizeSeoDataMode(options.seoDataMode ?? options.semrushMode);
  const competitorDomains = options.competitorDomains ? [...options.competitorDomains] : [...(ws.competitorDomains || [])];
  const rawMaxPages = options.maxPages != null ? Number(options.maxPages) : 500;
  const maxPagesParam = rawMaxPages > 0 ? Math.min(rawMaxPages, KEYWORD_STRATEGY_MAX_PAGE_CAP) : 0; // 0 = no cap
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
      seoDataStatus,
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

    const {
      siteKeywordMetrics,
      topicClusters,
      cannibalization,
    } = await enrichKeywordStrategy({
      workspaceId: ws.id,
      baseUrl,
      strategy,
      keywordPool,
      businessSection,
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
      domainKeywords: semrushDomainData,
      questionKeywords: allQuestionKws,
      competitorKeywords: competitorKeywordData,
      provider,
      seoDataMode,
      sendProgress,
    });

    // 7. Save to workspace — pageMap goes to page_keywords table, rest to workspace blob
    sendProgress('complete', 'Strategy complete!', 1.0);
    const { keywordStrategy, pageMap } = persistKeywordStrategy({
      ws,
      strategy,
      strategyMode,
      pagesToAnalyze,
      siteKeywordMetrics,
      keywordGaps,
      competitorKeywordData,
      topicClusters,
      cannibalization,
      questionKeywords: allQuestionKws,
      businessContext,
      seoDataMode,
      seoDataStatus,
      searchData: {
        deviceBreakdown,
        countryBreakdown,
        periodComparison,
        organicLandingPages,
        organicOverview,
      },
    });

    seedKeywordStrategyTrackedKeywords({
      workspaceId: ws.id,
      workspaceName: ws.name,
      keywordStrategy,
      pageMap,
    });

    clearKeepalive();

    // Reassemble for response (frontend expects pageMap in the strategy object)
    const responseStrategy = { ...keywordStrategy, pageMap };
    responseSent = true;

    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id });
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
