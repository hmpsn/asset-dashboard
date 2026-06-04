/**
 * Keyword strategy generation service.
 *
 * Shared by the direct keyword strategy route and background job worker.
 */
import { DEFAULT_SEO_DATA_PROVIDER, getConfiguredProvider, normalizeRuntimeSeoDataProvider, type ProviderName } from './seo-data-provider.js';
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
import { resolveSiteKeywordMetrics } from './site-keyword-metrics.js';
import { sanitizeKeywordStrategyDerivedArtifacts, sanitizeKeywordStrategyKeywordGaps, sanitizeKeywordStrategyOutput } from './keyword-strategy-sanitizer.js';
import { queueKeywordStrategyPostUpdateFollowOns, seedKeywordStrategyTrackedKeywords, workspaceHasStrategyOwnedRankTracking } from './keyword-strategy-follow-ons.js';
import { listContentGaps } from './content-gaps.js';
import { listQuickWins } from './quick-wins.js';
import { listKeywordGaps } from './keyword-gaps.js';
import { listTopicClusters } from './topic-clusters.js';
import { listCannibalizationIssues } from './cannibalization-issues.js';
import { normalizePageUrl } from './helpers.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { isFeatureEnabled } from './feature-flags.js';
import { backfillContentGapsToFloor, STRATEGY_CONTENT_GAP_FLOOR } from './keyword-strategy-helpers.js';
import type { GenerationQuality } from '../shared/types/generation-quality.js';

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
  /**
   * Generation-quality telemetry (SEO Generation Quality P0). Additive + optional —
   * present on the full-generation path so eval fixtures can assert on it; absent on
   * the incremental no-op short-circuit. Does NOT change the existing output contract.
   */
  generationQuality?: GenerationQuality;
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
  return provider ? normalizeRuntimeSeoDataProvider(provider) : undefined;
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
    ?? normalizeSeoDataProvider(ws.seoDataProvider)
    ?? DEFAULT_SEO_DATA_PROVIDER;
  const provider = getConfiguredProvider(providerPreference);

  const businessContext = options.businessContext || ws.keywordStrategy?.businessContext || '';
  const strategyMode = options.mode === 'incremental' ? 'incremental' : 'full'; // 'full' | 'incremental'
  const requestedSeoDataMode = normalizeSeoDataMode(options.seoDataMode);
  // MCP-seed (G/P1 #8): the MCP/chat path passes a provider but no seoDataMode, so
  // it collapses to 'none' and discovery is starved. On the flag-ON path, treat
  // "provider present" as "build a real universe" — promote the collapsed 'none'
  // to 'quick' so seo-data fetches domain/competitor seeds and the assembler has a
  // populated pool. Flag-OFF is unchanged (byte-identical).
  const seoDataMode = (requestedSeoDataMode === 'none' && provider && isFeatureEnabled('seo-generation-quality', ws.id))
    ? 'quick'
    : requestedSeoDataMode;
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
    let {
      seoContext: semrushContext,
      domainKeywords: semrushDomainData,
      keywordGaps,
      discoveryKeywords,
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
      baseUrl,
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
      discoveryKeywords,
      relatedKeywords: relatedKws,
      competitorKeywords: competitorKeywordData,
      provider,
      sendProgress,
    });

    if (synthesis.upToDate) {
      const noOpStrategy = (synthesis.strategy ?? { pageMap: [] }) as StrategyOutput;
      const preservedContentGaps = listContentGaps(ws.id);
      const preservedQuickWins = listQuickWins(ws.id);
      const shouldCleanPageAssignments = workspaceHasStrategyOwnedRankTracking(ws.id);
      const noOpSanitizer = shouldCleanPageAssignments
        ? sanitizeKeywordStrategyOutput({
          workspaceId: ws.id,
          strategy: {
            ...noOpStrategy,
            contentGaps: preservedContentGaps,
            quickWins: preservedQuickWins,
          },
          keywordPool: synthesis.keywordPool,
          evaluationContext: synthesis.keywordEvaluationContext,
          stage: 'post-enrichment',
        })
        : {
          strategy: {
            ...noOpStrategy,
            contentGaps: preservedContentGaps,
            quickWins: preservedQuickWins,
          },
          removed: { pageMappings: [], siteKeywords: [], contentGaps: [], quickWins: [], secondaryKeywords: [] },
          repaired: [],
          updatedPagePaths: [],
        };
      const noOpRemovedPagePaths = noOpSanitizer.removed.pageMappings.map(page => page.pagePath);
      const noOpUpdatedPagePaths = noOpSanitizer.updatedPagePaths;
      const existingKeywordGaps = listKeywordGaps(ws.id);
      const sanitizedNoOpKeywordGaps = sanitizeKeywordStrategyKeywordGaps({
        keywordGaps: existingKeywordGaps,
        keywordPool: synthesis.keywordPool,
        evaluationContext: synthesis.keywordEvaluationContext,
      });
      const noOpChanged = noOpRemovedPagePaths.length > 0
        || noOpUpdatedPagePaths.length > 0
        || noOpSanitizer.removed.siteKeywords.length > 0
        || noOpSanitizer.removed.contentGaps.length > 0
        || noOpSanitizer.removed.quickWins.length > 0
        || noOpSanitizer.removed.secondaryKeywords.length > 0
        || noOpSanitizer.repaired.length > 0
        || sanitizedNoOpKeywordGaps.length !== existingKeywordGaps.length;
      if (noOpChanged) {
        const existingStrategy = ws.keywordStrategy;
        const { keywordStrategy, pageMap } = persistKeywordStrategy({
          ws,
          strategy: noOpSanitizer.strategy,
          strategyMode,
          pagesToAnalyze: [],
          extraPagePaths: noOpUpdatedPagePaths,
          removedPagePaths: noOpRemovedPagePaths,
          // Wave 3b-ii strip (table-as-truth): `existingStrategy` is `ws.keywordStrategy`,
          // a RAW blob read (workspaces.ts rowToWorkspace → parseJsonSafe of keyword_strategy).
          // The blob no longer carries siteKeywordMetrics, so reading it off `existingStrategy`
          // would carry forward an empty array and silently drop the metrics on every
          // incremental no-op re-persist. Source from the table — the sole store — instead,
          // so the closed loop survives.
          siteKeywordMetrics: resolveSiteKeywordMetrics(ws.id),
          keywordGaps: sanitizedNoOpKeywordGaps,
          competitorKeywordData: existingStrategy?.competitorKeywordData ?? competitorKeywordData,
          topicClusters: listTopicClusters(ws.id),
          cannibalization: listCannibalizationIssues(ws.id).map(issue => ({
            ...issue,
            action: issue.action ?? 'differentiate',
          })),
          questionKeywords: existingStrategy?.questionKeywords ?? allQuestionKws,
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
        const responseStrategy = { ...keywordStrategy, pageMap };
        seedKeywordStrategyTrackedKeywords({
          workspaceId: ws.id,
          workspaceName: ws.name,
          keywordStrategy,
          pageMap,
        });
        clearKeepalive();
        activeGenerations.delete(ws.id);
        responseSent = true;
        queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id });
        return { strategy: responseStrategy as KeywordStrategy & { pageMap: PageKeywordMap[] }, upToDate: false, freshPageCount: synthesis.freshPageCount };
      }
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

    let strategy = synthesis.strategy as StrategyOutput;
    const pagesToAnalyze = synthesis.pagesToAnalyze;
    const keywordPool = synthesis.keywordPool;
    const businessSection = synthesis.businessSection;
    const keywordEvaluationContext = synthesis.keywordEvaluationContext;
    // FAQ enrichment question keywords. On the flag-ON path the legacy
    // `seoDataMode === 'full'` question prefetch in keyword-strategy-seo-data.ts is
    // gated off (to avoid a double-fetch), so `allQuestionKws` is empty there; the
    // keyword-universe assembler instead surfaces the grouped questions (geo +
    // language threaded) via `synthesis.questionKeywords`. Use those when present so
    // enrichKeywordStrategy attaches FAQ questions to content gaps exactly as before.
    // On the flag-OFF path (and the M2 assembler-degradation fallback) the synthesis
    // value is undefined, so the legacy `allQuestionKws` flows unchanged — flag-OFF
    // stays byte-identical.
    const enrichmentQuestionKeywords = synthesis.questionKeywords ?? allQuestionKws;

    if (!strategy?.pageMap) {
      const errMsg = 'Strategy generation produced no results';
      throw new KeywordStrategyGenerationError(500, { error: errMsg });
    }

    const postSynthesisSanitizer = sanitizeKeywordStrategyOutput({
      workspaceId: ws.id,
      strategy,
      keywordPool,
      evaluationContext: keywordEvaluationContext,
      stage: 'post-synthesis',
    });
    strategy = postSynthesisSanitizer.strategy;
    const sanitizedRemovedPagePaths = new Set(postSynthesisSanitizer.removed.pageMappings.map(page => page.pagePath));
    const sanitizedUpdatedPagePaths = new Set(postSynthesisSanitizer.updatedPagePaths);
    if (!strategy.pageMap?.length) {
      throw new KeywordStrategyGenerationError(500, { error: 'Strategy generation produced no valid page keyword assignments' });
    }

    // SEO Generation Quality P2 (flag `seo-generation-quality`, per-workspace):
    // compute ONCE here and thread the boolean into enrichment (token-subset prune)
    // and the deterministic backfill floor below. Do NOT scatter isFeatureEnabled
    // into hot loops. Flag-OFF (false) keeps pruning/backfill byte-identical.
    const relaxConservatism = isFeatureEnabled('seo-generation-quality', ws.id);

    let {
      siteKeywordMetrics,
      topicClusters,
      cannibalization,
      prunedContentGaps,
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
      questionKeywords: enrichmentQuestionKeywords,
      competitorKeywords: competitorKeywordData,
      provider,
      seoDataMode,
      relaxConservatism,
      sendProgress,
    });

    const postEnrichmentSanitizer = sanitizeKeywordStrategyOutput({
      workspaceId: ws.id,
      strategy,
      keywordPool,
      evaluationContext: keywordEvaluationContext,
      stage: 'post-enrichment',
    });
    strategy = postEnrichmentSanitizer.strategy;
    for (const removed of postEnrichmentSanitizer.removed.pageMappings) {
      sanitizedRemovedPagePaths.add(removed.pagePath);
    }
    for (const updatedPagePath of postEnrichmentSanitizer.updatedPagePaths) {
      sanitizedUpdatedPagePaths.add(updatedPagePath);
    }
    if (!strategy.pageMap?.length) {
      throw new KeywordStrategyGenerationError(500, { error: 'Strategy generation produced no valid page keyword assignments after enrichment' });
    }
    const finalSiteKeywordSet = new Set((strategy.siteKeywords ?? []).map(keyword => keywordComparisonKey(keyword)));
    siteKeywordMetrics = siteKeywordMetrics.filter(metric => finalSiteKeywordSet.has(keywordComparisonKey(metric.keyword)));
    ({ topicClusters, cannibalization } = sanitizeKeywordStrategyDerivedArtifacts({
      topicClusters,
      cannibalization,
      pageMap: strategy.pageMap,
      keywordPool,
      evaluationContext: keywordEvaluationContext,
      domainKeywords: semrushDomainData,
      competitorKeywords: competitorKeywordData,
    }));
    keywordGaps = sanitizeKeywordStrategyKeywordGaps({
      keywordGaps,
      keywordPool,
      evaluationContext: keywordEvaluationContext,
    });

    // ── SEO Generation Quality P2(d): deterministic backfill floor ──
    // After pruning, if flag-ON and the kept content-gap count is below the soft
    // floor (6), re-admit the highest-scoring pruned candidates (ordered by score)
    // tagged `backfilled = true` until the floor is met. Deterministic — no AI; if
    // fewer than 6 real candidates exist, admit what is available (never fabricate).
    // Flag-OFF: skipped entirely → byte-identical (no backfill, no tags).
    // Count gaps the AI/enrichment produced (post-filter) BEFORE the backfill so the
    // telemetry's aiReturnedCount stays honest (backfilledCount is tracked separately).
    const aiReturnedContentGapCount = strategy.contentGaps?.length ?? 0;
    let backfilledCount = 0;
    let floorHit = false;
    if (relaxConservatism && (strategy.contentGaps?.length ?? 0) < STRATEGY_CONTENT_GAP_FLOOR && prunedContentGaps.length > 0) {
      const result = backfillContentGapsToFloor(
        strategy.contentGaps ?? [],
        prunedContentGaps,
        STRATEGY_CONTENT_GAP_FLOOR,
      );
      strategy.contentGaps = result.gaps;
      backfilledCount = result.backfilledCount;
      floorHit = result.floorHit;
      if (backfilledCount > 0) {
        log.info({ workspaceId: ws.id, backfilledCount, floor: STRATEGY_CONTENT_GAP_FLOOR, total: strategy.contentGaps.length }, 'Deterministic content-gap backfill floor applied');
      }
    }

    if (strategyMode === 'incremental') {
      const finalPagePaths = new Set((strategy.pageMap ?? []).map(page => normalizePageUrl(page.pagePath)));
      for (const page of pagesToAnalyze) {
        const pagePath = normalizePageUrl(page.path);
        if (!finalPagePaths.has(pagePath)) {
          sanitizedRemovedPagePaths.add(page.path);
        }
      }
    }

    // 7. Save to workspace — pageMap goes to page_keywords table, rest to workspace blob
    sendProgress('complete', 'Strategy complete!', 1.0);
    const { keywordStrategy, pageMap } = persistKeywordStrategy({
      ws,
      strategy,
      strategyMode,
      pagesToAnalyze,
      extraPagePaths: [...sanitizedUpdatedPagePaths],
      removedPagePaths: [...sanitizedRemovedPagePaths],
      siteKeywordMetrics,
      keywordGaps,
      competitorKeywordData,
      topicClusters,
      cannibalization,
      // Persist the same question keywords FAQ enrichment used: assembler-surfaced
      // (geo + language threaded) on flag-ON, legacy seo-data prefetch on flag-OFF.
      questionKeywords: enrichmentQuestionKeywords,
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

    // Generation-quality telemetry (SEO Generation Quality P0). Side-effect-free
    // w.r.t. output: poolSize + aiReturnedCount are knowable today; the remaining
    // fields are populated by P1–P2 (un-suppress + deterministic backfill floor).
    const generationQuality: GenerationQuality = {
      workspaceId: ws.id,
      // poolSize reflects the real universe on the flag-ON path (keywordPool is
      // populated from buildKeywordUniverse) and the legacy pool on flag-OFF.
      poolSize: keywordPool.size,
      aiReturnedCount: aiReturnedContentGapCount,
      // suppressedCount is wired from the assembler on the flag-ON path (branded +
      // declined hard-filter removals); 0 on the legacy path.
      suppressedCount: synthesis.suppressedCount ?? 0,
      // backfilledCount + floorHit reflect the P2 deterministic backfill floor.
      // Both stay 0/false on flag-OFF (the backfill block is skipped entirely).
      backfilledCount,
      floorHit,
    };
    log.info({ generationQuality }, 'keyword-strategy/generation-quality');

    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id });
    activeGenerations.delete(ws.id);
    return { strategy: responseStrategy as KeywordStrategy & { pageMap: PageKeywordMap[] }, generationQuality };
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
