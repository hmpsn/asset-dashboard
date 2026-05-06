/**
 * Keyword strategy generation service.
 *
 * Shared by the direct keyword strategy route and background job worker.
 */
import { addTrackedKeyword } from './rank-tracking.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { incrementIfAllowed, decrementUsage } from './usage-tracking.js';
import { clearSeoContextCache } from './seo-context.js'; // seo-context-ok: strategy generation must invalidate legacy SEO context caches after writes.
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { updateWorkspace, getWorkspace, getTokenForSite } from './workspaces.js';
import { upsertAndCleanPageKeywords, upsertPageKeywordsBatch, listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import db from './db/index.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';
import { queueLlmsTxtRegeneration } from './llms-txt-generator.js';
import { recordAction, getActionBySource } from './outcome-tracking.js';
import { generateRecommendations } from './recommendations.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { fetchAndCacheKeywordStrategySeoData } from './keyword-strategy-seo-data.js';
import { discoverKeywordStrategyPages } from './keyword-strategy-pages.js';
import { fetchKeywordStrategySearchData } from './keyword-strategy-search-data.js';
import {
  KeywordStrategySynthesisError,
  synthesizeKeywordStrategy,
  type StrategyOutput,
} from './keyword-strategy-ai-synthesis.js';
import { enrichKeywordStrategy } from './keyword-strategy-enrichment.js';

// Re-exported for backward compatibility with existing callers.
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
