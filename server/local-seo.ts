import { createLogger } from './logger.js';
import { addActivity } from './activity-log.js';
import { fireBridge } from './bridge-infrastructure.js';
import { runLocalVisibilityShiftBridge } from './bridge-local-visibility-shift.js';
import { broadcastToWorkspace } from './broadcast.js';
import { listContentGaps } from './content-gaps.js';
import { createJob, updateJob, getJob, hasActiveJob, unregisterAbort } from './jobs.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { listPageKeywords } from './page-keywords.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { runRecommendationRegen } from './recommendation-regen-scheduler.js';
import { DEFAULT_SEO_DATA_PROVIDER, getProvider, isCapabilityDisabled, normalizeRuntimeSeoDataProvider, type SeoDataProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { waitForHeapHeadroom } from './seo-refresh-runner-runtime.js';
import { sleep } from './helpers.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import {
  LOCAL_SEO_MAX_RESULTS,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  scrubOwnedLocalResults,
} from './domains/local-seo/business-match.js';
import {
  applySourcePageCap,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
} from './domains/local-seo/keyword-intent.js';
import {
  buildLocalSeoKeywordCandidatesEvaluatedFromContext,
  buildLocalSeoKeywordCandidatesFromContext,
  countLocalSeoKeywordCandidatesFromContext,
  type CandidateIterationContext,
} from './domains/local-seo/candidate-pipeline.js';
import {
  LOCAL_SEO_DEFAULT_LANGUAGE_CODE,
  LOCAL_SEO_MAX_MARKETS,
  activeLocalSeoMarkets,
  applyLocalSeoConfigurationUpdate,
  buildSuggestedLocalSeoMarkets,
  disabledLocalSeoSettings,
  getEffectiveKeywordsPerRefresh,
  listLocalSeoMarkets,
  readLocalSeoSettings,
  setPrimaryLocalSeoMarket,
} from './domains/local-seo/configuration-service.js';
import {
  buildLocalSeoCaps,
  buildLocalSeoReportSummary,
  getLocalSeoCompetitorBrands,
  getLocalSeoServiceGaps,
} from './domains/local-seo/visibility-read-model.js';
import {
  countLocalVisibilitySnapshots,
  getLocalSeoVisibilityTrend,
  isUsableLocalVisibilitySnapshot,
  listLatestLocalVisibilitySnapshots,
  listLocalVisibilitySnapshotBackfillPage,
  runSnapshotRetentionPrune,
  snapshotFromProviderResult,
  storeLocalVisibilitySnapshot,
  updateLocalVisibilitySnapshotMatches,
  type LocalVisibilitySnapshotBackfillCursor,
  type LocalVisibilitySnapshotMatchUpdate,
} from './domains/local-seo/snapshot-store.js';
import {
  buildWorkspaceGeoRegex,
  buildWorkspaceServiceTermRegex,
} from './domains/local-seo/workspace-classifiers.js';
import type { LocalSeoKeywordCandidate } from './domains/local-seo/types.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_POSTURE,
  LOCAL_VISIBILITY_STATUS,
  type LocalSeoDevice,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalSeoMarket,
  type LocalSeoMarketUpdateRequest,
  type LocalSeoReadResponse,
  type LocalSeoRefreshRequest,
  type LocalSeoRefreshResult,
} from '../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS } from '../shared/types/rank-tracking.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('local-seo');

export {
  LOCAL_SEO_MAX_MARKETS,
  getEffectiveKeywordsPerRefresh,
  getLocalSeoPosture,
  getPrimaryMarketLocationCode,
  listLocalSeoMarkets,
  resolveWorkspaceLanguageCode,
  resolveWorkspaceLocationCode,
  resolveWorkspaceTargetGeo,
  type ResolvedWorkspaceTargetGeo,
} from './domains/local-seo/configuration-service.js';

export {
  RETENTION_PRUNE_BATCH_SIZE,
  RETENTION_RAW_DAYS,
  RETENTION_WEEKLY_MAX_DAYS,
  buildLocalSeoKeywordVisibilityByKey,
  buildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  countLocalVisibilitySnapshots,
  getLocalSeoVisibilityTrend,
  latestLocalSnapshotAt,
  listLatestLocalVisibilitySnapshots,
  runSnapshotRetentionPrune,
} from './domains/local-seo/snapshot-store.js';
export {
  getLocalSeoCompetitorBrands,
  getLocalSeoServiceGaps,
} from './domains/local-seo/visibility-read-model.js';

export {
  cleanDomain,
  confidencePriority,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  isOwnedLocalResult,
  normalizePhone,
  normalizeProviderIdentity,
  scrubOwnedLocalResults,
} from './domains/local-seo/business-match.js';
export {
  applySourcePageCap,
  candidateSourceScore,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
  hasMarketModifier,
  localVariantKeywords,
  localVariantKeywordsByMarket,
  normalizeText,
  titleLooksLikeServiceKeyword,
  type LocalVariantKeyword,
} from './domains/local-seo/keyword-intent.js';
export {
  iterateLocalCandidateSignals,
  type CandidateIterationContext,
  type CandidateSourceSignal,
} from './domains/local-seo/candidate-pipeline.js';
export type { LocalSeoKeywordCandidate } from './domains/local-seo/types.js';

function notifyLocalSeoUpdated(workspaceId: string, payload: Record<string, unknown>): void {
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    ...payload,
  });
}
/**
 * Deprecated alias — kept temporarily for downstream readers that haven't
 * migrated to the new per-workspace budget. New code should read
 * `LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH` from `shared/types/local-seo.ts`
 * or call `getEffectiveKeywordsPerRefresh(workspaceId)` for the resolved value.
 */
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH = LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH;

const LOCAL_CANDIDATE_HARD_CAP = 1000;
// Fully sequential SERP calls. Iteration history: 5 (initial) → 3 (PR #909) → 1 (PR #910).
// Each concurrent slot holds a full DataForSEO serp/google/organic/live/advanced JSON
// response in memory during parsing (~20–30 MB). On memory-constrained hosts (Render
// starter ~512 MB) even 3 concurrent responses stacked with an active KCC build (~110 MB
// heap) and other request handlers exceeded the process memory limit and triggered an
// OOM SIGKILL with no error log. Going fully sequential cuts peak SERP-response memory
// to a single response (~25 MB). Combined with LOCAL_SEO_REFRESH_ITEM_YIELD_MS below
// and waitForMemoryHeadroom() before each batch, this gives V8 time to reclaim the
// previous response and lets concurrent KCC reads complete without competing for memory.
// Wall-clock is ~3× longer than before; that trade is explicitly acceptable.
const LOCAL_SEO_REFRESH_CONCURRENCY = 1;
// Production defaults for the inter-item yield and heap-headroom backpressure
// applied inside the refresh loop. Test-only override via
// `__setRefreshTimingsForTesting()` keeps unit tests fast without changing
// production behavior. Tuned for Render starter (~512 MB total): KCC alone
// uses ~110 MB heap, so 220 MB leaves room for one SERP response (~25 MB) plus
// baseline (~80 MB) without approaching the OOM cliff.
const DEFAULT_REFRESH_ITEM_YIELD_MS = 150;
const DEFAULT_HEAP_HEADROOM_THRESHOLD_MB = 220;
const DEFAULT_HEAP_HEADROOM_WAIT_MS = 2000;
const DEFAULT_HEAP_HEADROOM_MAX_WAITS = 3;

const refreshTimings = {
  itemYieldMs: DEFAULT_REFRESH_ITEM_YIELD_MS,
  heapHeadroomThresholdMb: DEFAULT_HEAP_HEADROOM_THRESHOLD_MB,
  heapHeadroomWaitMs: DEFAULT_HEAP_HEADROOM_WAIT_MS,
  heapHeadroomMaxWaits: DEFAULT_HEAP_HEADROOM_MAX_WAITS,
};

/**
 * Test-only hook: override refresh timing constants so unit tests run fast
 * without the 150 ms × N inter-item sleep and the 2 s heap-headroom pause.
 * Production code never calls this — the defaults above are the live values.
 */
export function __setRefreshTimingsForTesting(overrides: Partial<typeof refreshTimings>): void {
  Object.assign(refreshTimings, overrides);
}

/**
 * Test-only hook: restore production refresh timings. Call from `afterEach`
 * so a test that opted in to fast timings doesn't leak the override into
 * adjacent tests.
 */
export function __resetRefreshTimingsForTesting(): void {
  refreshTimings.itemYieldMs = DEFAULT_REFRESH_ITEM_YIELD_MS;
  refreshTimings.heapHeadroomThresholdMb = DEFAULT_HEAP_HEADROOM_THRESHOLD_MB;
  refreshTimings.heapHeadroomWaitMs = DEFAULT_HEAP_HEADROOM_WAIT_MS;
  refreshTimings.heapHeadroomMaxWaits = DEFAULT_HEAP_HEADROOM_MAX_WAITS;
}

/**
 * Heap-aware backpressure: before allocating another SERP response, ensure heap
 * headroom exists on memory-constrained hosts. If heap is above the threshold,
 * sleep and retry up to `maxWaits` times. After that, proceed anyway — we'd
 * rather risk one more allocation than stall the refresh indefinitely waiting
 * for memory that may never drain (e.g. a long-running KCC build).
 */
async function waitForMemoryHeadroom(): Promise<void> {
  await waitForHeapHeadroom({
    thresholdMb: refreshTimings.heapHeadroomThresholdMb,
    waitMs: refreshTimings.heapHeadroomWaitMs,
    maxWaits: refreshTimings.heapHeadroomMaxWaits,
    logger: log,
    logMessage: 'local-seo refresh: heap above threshold — pausing for GC headroom',
  });
}

const LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL = 20;
const LOCAL_SEO_LOCATION_BACKFILL_PROGRESS_BROADCAST_INTERVAL = 100;

export function setPrimaryMarket(workspaceId: string, marketId: string): void {
  setPrimaryLocalSeoMarket(workspaceId, marketId);
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Primary market updated',
    'Set primary market for keyword volume geo-targeting',
    { source: 'local_seo' },
  );
  notifyLocalSeoUpdated(workspaceId, {
    action: 'primary_market_updated',
    updatedAt: new Date().toISOString(),
  });
}

export function getLocalSeoReadModel(
  workspaceId: string,
  featureEnabled: boolean,
  options: { includeSnapshots?: boolean } = {},
): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  if (!featureEnabled) {
    const settings = disabledLocalSeoSettings(workspace);
    return {
      featureEnabled: false,
      settings,
      markets: [],
      suggestedMarkets: [],
      latestSnapshots: [],
      report: buildLocalSeoReportSummary({
        featureEnabled: false,
        settings,
        markets: [],
        suggestedMarkets: [],
        latestSnapshots: [],
      }),
      competitorBrands: [],
      serviceGaps: [],
      visibilityTrend: [],
      caps: buildLocalSeoCaps(settings),
    };
  }
  const settings = readLocalSeoSettings(workspace);
  const markets = listLocalSeoMarkets(workspace.id);
  const suggestedMarkets = buildSuggestedLocalSeoMarkets(workspace);
  const latestSnapshots = listLatestLocalVisibilitySnapshots(workspace.id);
  const latestUsableSnapshots = latestSnapshots.filter(isUsableLocalVisibilitySnapshot);
  const responseSnapshots = options.includeSnapshots === false ? [] : latestSnapshots;
  return {
    featureEnabled,
    settings,
    markets,
    suggestedMarkets,
    latestSnapshots: responseSnapshots,
    report: buildLocalSeoReportSummary({
      featureEnabled,
      settings,
      markets,
      suggestedMarkets,
      latestSnapshots: latestUsableSnapshots,
    }),
    competitorBrands: getLocalSeoCompetitorBrands(workspaceId),
    serviceGaps: featureEnabled ? getLocalSeoServiceGaps(workspaceId) : [],
    visibilityTrend: getLocalSeoVisibilityTrend(workspace.id),
    caps: buildLocalSeoCaps(settings),
  };
}

export function updateLocalSeoConfiguration(workspaceId: string, request: LocalSeoMarketUpdateRequest, featureEnabled: boolean): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const { updatedAt, promotedPrimaryLabel } = applyLocalSeoConfigurationUpdate(workspace, request);
  const activityDetail = promotedPrimaryLabel
    ? `Updated local SEO posture or market setup — auto-promoted "${promotedPrimaryLabel}" to primary market`
    : 'Updated local SEO posture or market setup';
  addActivity(workspace.id, 'local_seo_updated', 'Local SEO configuration updated', activityDetail, { source: 'local_seo', ...(promotedPrimaryLabel ? { promotedPrimaryLabel } : {}) });
  notifyLocalSeoUpdated(workspace.id, { action: 'configuration_updated', updatedAt });
  return getLocalSeoReadModel(workspace.id, featureEnabled);
}

function buildCandidateContext(workspace: Workspace) {
  const contentGaps = listContentGaps(workspace.id);
  const pageMap = listPageKeywords(workspace.id);
  const declinedKeywords = getDeclinedKeywords(workspace.id);
  const requestedKeywords = getRequestedKeywords(workspace.id);
  const strategy = workspace.keywordStrategy;
  const businessTerms = [
    workspace.name,
    strategy?.businessContext,
    workspace.intelligenceProfile?.industry,
    ...(workspace.businessPriorities ?? []),
    ...(strategy?.siteKeywords ?? []),
    ...pageMap.flatMap(page => [page.pageTitle, page.primaryKeyword, ...(page.secondaryKeywords ?? [])]),
    ...contentGaps.flatMap(gap => [gap.topic, gap.targetKeyword]),
  ].filter((value): value is string => Boolean(value?.trim()));

  return {
    contentGaps,
    pageMap,
    declinedKeywords,
    requestedKeywords,
    evaluationContext: {
      workspaceId: workspace.id,
      pageMap,
      declinedKeywords,
      requestedKeywords,
      businessTerms,
      businessPhrases: [strategy?.businessContext ?? '', workspace.name].filter(Boolean),
      businessPriorities: workspace.businessPriorities ?? [],
      contentGapTopics: contentGaps.map(gap => `${gap.topic} ${gap.targetKeyword}`),
      strictBusinessFit: true,
    },
  };
}

/**
 * Load the cheap data-fetch surface shared by both candidate builders.
 *
 * Returns null if the workspace cannot be found. Does not load markets-gated
 * behavior — callers decide whether an empty markets list short-circuits.
 */
export function loadCandidateIterationContext(
  workspaceId: string,
  explicitKeywords: string[] = [],
  options: { withEvaluationContext?: boolean } = {},
): CandidateIterationContext | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeLocalSeoMarkets(workspaceId);
  const built = buildCandidateContext(workspace);
  const declined = new Set(built.declinedKeywords.map(keywordComparisonKey));
  const trackedKeywords = getTrackedKeywords(workspaceId, { includeInactive: true });
  const inactiveTracked = new Set(
    trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  // Precompute per-workspace classifiers once — reused per keyword in the hot loop.
  const serviceTermRegex = buildWorkspaceServiceTermRegex(workspace);
  const geoTermRegex = buildWorkspaceGeoRegex(workspace, markets)
    ?? /\bnear me\b|\/location\//i;
  const settingsPosture = readLocalSeoSettings(workspace).posture;

  return {
    workspace,
    markets,
    declined,
    inactiveTracked,
    trackedKeywords,
    contentGaps: built.contentGaps,
    pageMap: built.pageMap,
    explicitKeywords,
    settingsPosture,
    evaluationContext: options.withEvaluationContext ? built.evaluationContext : undefined,
    classifiers: { geoTermRegex, serviceTermRegex },
  };
}

function warnLocalSeoCandidateHardCap(workspaceId: string): void {
  log.warn({ workspaceId, cap: LOCAL_CANDIDATE_HARD_CAP }, 'local SEO candidate hard cap reached; output truncated');
}

/**
 * Cheap default local SEO candidate builder.
 *
 * Storage/context loading stays in this facade; candidate enumeration, scoring,
 * dedupe, and hard-cap behavior live in the local SEO domain pipeline.
 */
export function buildLocalSeoKeywordCandidates(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords);
  if (!ctx) return [];
  return buildLocalSeoKeywordCandidatesFromContext(ctx, {
    hardCap: LOCAL_CANDIDATE_HARD_CAP,
    onHardCapReached: () => warnLocalSeoCandidateHardCap(workspaceId),
  });
}

/**
 * Slow opt-in local SEO candidate builder with eligibility-evaluator reasons.
 */
export function buildLocalSeoKeywordCandidatesEvaluated(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords, { withEvaluationContext: true });
  if (!ctx || !ctx.evaluationContext) return [];
  return buildLocalSeoKeywordCandidatesEvaluatedFromContext(ctx, {
    hardCap: LOCAL_CANDIDATE_HARD_CAP,
    onHardCapReached: () => warnLocalSeoCandidateHardCap(workspaceId),
  });
}

/**
 * Count-only local SEO candidate iteration — sub-100ms even on rich workspaces.
 */
export function countLocalSeoKeywordCandidates(workspaceId: string): number {
  const ctx = loadCandidateIterationContext(workspaceId, []);
  if (!ctx || ctx.markets.length === 0) return 0;
  return countLocalSeoKeywordCandidatesFromContext(ctx, { hardCap: LOCAL_CANDIDATE_HARD_CAP });
}

function selectExplicitLocalSeoKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const declined = new Set(getDeclinedKeywords(workspaceId).map(keywordComparisonKey));
  const inactiveTracked = new Set(
    getTrackedKeywords(workspaceId, { includeInactive: true })
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const keyword of explicitKeywords) {
    const display = cleanKeywordDisplay(keyword);
    const key = display ? keywordComparisonKey(display) : '';
    if (!display || !key || seen.has(key) || declined.has(key) || inactiveTracked.has(key)) continue;
    seen.add(key);
    selected.push(display);
    if (selected.length >= budget) break;
  }
  return selected;
}

export function selectLocalIntentKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  if (explicitKeywords.length > 0) {
    const selected = selectExplicitLocalSeoKeywords(workspaceId, explicitKeywords);
    // Apply intent filter even for explicit keywords — informational/comparison
    // queries cannot produce local pack results regardless of how they were chosen.
    return selected.filter(kw => {
      const intent = classifyLocalKeywordIntent(kw);
      return intent !== 'informational' && intent !== 'comparison';
    });
  }
  // Use the Evaluated variant here. Unlike the KCC/intelligence-slice/MCP read
  // paths (where the evaluator's `reasons` field is unused and the cheap
  // default is the right contract), `selectLocalIntentKeywords` feeds a real
  // DataForSEO call — every chosen keyword costs provider credits and adds a
  // row to local visibility snapshot history. The evaluator's noise-pattern /
  // authority-mismatch / business-fit suppression and `scoreDelta` are exactly
  // the signal-to-noise judgement we want spending that budget. The OOM
  // concern that drove the cheap default elsewhere does not apply: this
  // function runs once per scheduled refresh inside `runLocalSeoRefreshJob`
  // (a background job), not per request, and it caps the candidate set with
  // LOCAL_CANDIDATE_HARD_CAP before the evaluator even runs.
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const candidates = buildLocalSeoKeywordCandidatesEvaluated(workspaceId, explicitKeywords);
  // Filter out intents that can never produce local pack results (no credits spent on them)
  const filteredCandidates = candidates.filter(c => c.intent !== 'informational' && c.intent !== 'comparison');
  // Apply per-page cap to prevent any single source page from monopolizing the budget
  const capped = applySourcePageCap(filteredCandidates, budget);
  return capped.slice(0, budget).map(c => c.keyword);
}

export function createLocalSeoRefreshPlan(workspaceId: string, request: LocalSeoRefreshRequest = {}): { markets: LocalSeoMarket[]; keywords: string[]; device: LocalSeoDevice; languageCode: string } | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeLocalSeoMarkets(workspaceId, request.marketIds).slice(0, LOCAL_SEO_MAX_MARKETS);
  const keywords = selectLocalIntentKeywords(workspaceId, request.keywords ?? []).slice(0, getEffectiveKeywordsPerRefresh(workspaceId));
  return {
    markets,
    keywords,
    device: request.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: request.languageCode || LOCAL_SEO_DEFAULT_LANGUAGE_CODE,
  };
}

function resolveLocalVisibilityProvider(workspace: Workspace): SeoDataProvider | null {
  const providerName = normalizeRuntimeSeoDataProvider(workspace.seoDataProvider ?? DEFAULT_SEO_DATA_PROVIDER);
  if (isCapabilityDisabled(providerName, 'local_visibility')) return null;
  const provider = getProvider(providerName);
  if (!provider?.isConfigured()) return null;
  return provider.getLocalVisibility ? provider : null;
}

function resolveLocalLocationProvider(workspace: Workspace): SeoDataProvider | null {
  const providerName = normalizeRuntimeSeoDataProvider(workspace.seoDataProvider ?? DEFAULT_SEO_DATA_PROVIDER);
  if (isCapabilityDisabled(providerName, 'local_visibility')) return null;
  const provider = getProvider(providerName);
  if (!provider?.isConfigured()) return null;
  return provider.resolveLocalSeoLocation ? provider : null;
}

export async function resolveLocalSeoProviderLocation(
  workspaceId: string,
  request: LocalSeoLocationLookupRequest,
): Promise<LocalSeoLocationLookupResponse | null> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const provider = resolveLocalLocationProvider(workspace);
  if (!provider?.resolveLocalSeoLocation) {
    return {
      query: request,
      status: 'provider_unavailable',
      candidates: [],
      degradedReason: 'No configured local location provider is available.',
    };
  }
  return provider.resolveLocalSeoLocation(request, workspaceId);
}

export async function runLocalSeoRefreshJob(jobId: string, workspaceId: string, request: LocalSeoRefreshRequest = {}): Promise<void> {
  try {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
      return;
    }
    const locations = getEffectiveLocations(workspace);
    const plan = createLocalSeoRefreshPlan(workspaceId, request);
    if (!plan || plan.markets.length === 0 || plan.keywords.length === 0) {
      updateJob(jobId, {
        status: 'done',
        progress: 100,
        total: 100,
        message: 'No local markets or local-intent keywords ready for refresh',
        result: { workspaceId, refreshed: 0, skipped: 0, failed: 0, markets: [], keywords: [] } satisfies LocalSeoRefreshResult,
      });
      return;
    }

    const provider = resolveLocalVisibilityProvider(workspace);
    if (!provider?.getLocalVisibility) {
      updateJob(jobId, { status: 'error', message: 'No configured local visibility provider', error: 'No configured local visibility provider' });
      return;
    }
    // Capture the narrowed method reference so TypeScript can see it's non-undefined
    // inside async closures where control-flow narrowing doesn't persist.
    const getLocalVisibility = provider.getLocalVisibility.bind(provider);

    // W5.3: snapshot the PREVIOUS latest-per-(market, keyword, device, language) state
    // BEFORE the crawl writes new rows, so the shift bridge can diff transitions after
    // the refresh. Captured here (not after) because storing a snapshot mutates the series.
    const previousLatestSnapshots = listLatestLocalVisibilitySnapshots(workspaceId);

    const total = plan.markets.length * plan.keywords.length;
    let processed = 0;
    let refreshed = 0;
    let failed = 0;
    let lastProgressBroadcastAt = 0;
    updateJob(jobId, { status: 'running', total, progress: 0, message: 'Refreshing local visibility...' });

  // Flatten (market × keyword) into a single work-item array, then process
  // with bounded concurrency to cut wall-clock time 3–5× vs. fully sequential.
    const workItems = plan.markets.flatMap(market =>
      plan.keywords.map(keyword => ({ market, keyword }))
    );

    for (let i = 0; i < workItems.length; i += LOCAL_SEO_REFRESH_CONCURRENCY) {
    if (getJob(jobId)?.status === 'cancelled') return;
    // Layer 4: heap-aware backpressure. If heap is above the soft threshold,
    // pause briefly so GC + concurrent KCC reads can drain before we allocate
    // another big SERP response. See LOCAL_SEO_HEAP_HEADROOM_THRESHOLD_MB.
    await waitForMemoryHeadroom();
    const chunk = workItems.slice(i, i + LOCAL_SEO_REFRESH_CONCURRENCY);
    await Promise.allSettled(chunk.map(async ({ market, keyword }) => {
      // Bail before spending provider credits if the job was cancelled.
      if (getJob(jobId)?.status === 'cancelled') return;
      try {
        const providerResult = await getLocalVisibility({
          keyword,
          market,
          device: plan.device,
          languageCode: plan.languageCode,
          maxResults: LOCAL_SEO_MAX_RESULTS,
        }, workspaceId);
        if (getJob(jobId)?.status === 'cancelled') return;
        const snapshot = snapshotFromProviderResult(workspaceId, locations, market, providerResult, plan.device, plan.languageCode);
        storeLocalVisibilitySnapshot(snapshot, providerResult.results);
        if (providerResult.status === LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED) failed++;
        else refreshed++;
      } catch (err) {
        failed++;
        log.warn({ err, workspaceId, keyword, marketId: market.id }, 'local visibility refresh item failed');
      } finally {
        if (getJob(jobId)?.status === 'cancelled') return;
        processed++;
        updateJob(jobId, {
          progress: processed,
          total,
          message: `Refreshed ${processed}/${total} local visibility checks`,
        });
      }
    }));

    // Mid-job invalidation broadcast — fires every
    // LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL snapshots so the KCC and
    // local-seo React Query caches refresh incrementally instead of looking
    // frozen until completion. Skip when we're about to fire the final
    // `refresh_completed` broadcast (processed === total) to avoid a redundant
    // double-invalidation back-to-back.
    if (
      getJob(jobId)?.status !== 'cancelled'
      && processed < total
      && processed - lastProgressBroadcastAt >= LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL
    ) {
      lastProgressBroadcastAt = processed;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'refresh_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }

    // Layer 2: inter-item yield. Sleep briefly so V8 has time to GC the SERP
    // response from this chunk before the next iteration allocates a fresh one.
    // Skip when this was the last chunk — no more allocations coming.
    if (processed < total && refreshTimings.itemYieldMs > 0) await sleep(refreshTimings.itemYieldMs);
  }

    const result: LocalSeoRefreshResult = {
      workspaceId,
      refreshed,
      skipped: total - refreshed - failed,
      failed,
      markets: plan.markets.map(market => market.id),
      keywords: plan.keywords,
    };
    if (getJob(jobId)?.status === 'cancelled') return;

    if (refreshed === 0 && failed > 0) {
      const message = `Local visibility refresh failed — 0/${total} checks refreshed`;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'refresh_failed',
        refreshed,
        failed,
        updatedAt: new Date().toISOString(),
      });
      updateJob(jobId, {
        status: 'error',
        progress: processed,
        total,
        message,
        error: 'All local visibility checks failed',
        result,
      });
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Local SEO visibility refresh failed',
        `${failed} local visibility checks failed; no usable local evidence was refreshed`,
        { source: 'local_seo', refreshed, failed },
      );
      return;
    }

    notifyLocalSeoUpdated(workspaceId, { action: 'refresh_completed', refreshed, failed, updatedAt: new Date().toISOString() });
    addActivity(workspaceId, 'local_seo_updated', 'Local SEO visibility refreshed', `${refreshed} local visibility checks refreshed`, { source: 'local_seo', refreshed, failed });

    // W5.3: mint local_visibility_shift insights from snapshot transitions. Read the NEW
    // latest state (after the crawl wrote rows, before the retention prune — the prune
    // never removes the immortal latest row, so ordering vs. prune is immaterial) and diff
    // it against the pre-crawl state. fireBridge is fire-and-forget with its own timeout +
    // error isolation and auto-broadcasts INSIGHT_BRIDGE_UPDATED when modified > 0 — no
    // manual broadcast here (Bridge rule #3). A bridge failure never fails the refresh.
    const newLatestSnapshots = listLatestLocalVisibilitySnapshots(workspaceId);
    fireBridge('bridge-local-visibility-shift', workspaceId, () =>
      runLocalVisibilityShiftBridge(workspaceId, previousLatestSnapshots, newLatestSnapshots),
    );

    // Bug 3 / D4: retention prune after successful refresh. Wrapped in try/catch
    // so a prune failure never fails the already-successful refresh job.
    try {
      runSnapshotRetentionPrune(workspaceId);
    } catch (err) {
      log.warn({ err, workspaceId }, 'Snapshot retention prune after local SEO refresh failed (non-fatal)');
    }

  // Fresh local visibility snapshots are the spine of the local recs (B1/B2/B3). After a refresh
  // completes, regenerate recommendations so the new evidence surfaces immediately — mirroring the
  // post-scheduled-audit regen in scheduled-audits.ts. This remains posture-gated so non-local
  // workspaces avoid unnecessary local-aware recommendation churn. `generateRecommendations`
  // broadcasts + invalidates internally (Bridge rule #3 — NO manual broadcast here). Wrapped in
  // its own try/catch so a regen failure never fails the refresh job. Dynamic import avoids a
  // static recommendations.ts ↔ local-seo.ts import cycle (recommendations.ts imports the local
  // readers statically).
    const localSeoPosture = readLocalSeoSettings(workspace).posture;
    const useLocalGenQual = localSeoPosture === LOCAL_SEO_POSTURE.LOCAL
      || localSeoPosture === LOCAL_SEO_POSTURE.HYBRID;
    if (useLocalGenQual) {
      try {
        await runRecommendationRegen(workspaceId, 'local_seo_refresh');
        log.info({ workspaceId }, 'Auto-regenerated recommendations after local SEO refresh');
      } catch (err) {
        log.warn({ err, workspaceId }, 'Recommendation regen after local SEO refresh failed (non-fatal)');
      }
    }

    // Optional chained keyword-strategy regen. When the admin requested
    // `thenRegenerateStrategy` AND the crawl actually produced data
    // (result.refreshed > 0 — the only success signal on the result shape), kick
    // off a strategy regen server-side so it survives a closed tab. A hard-fail
    // crawl (refreshed === 0) is NOT a usable refresh, so we abort rather than
    // regenerate a strategy on stale/empty evidence.
    //
    // The regen is its own tracked KEYWORD_STRATEGY job and runs DETACHED (not
    // awaited) — mirroring the POST /api/jobs dispatcher (server/routes/jobs.ts)
    // — so the slow, AI-heavy strategy phase never blocks this local-refresh job
    // from reaching 'done'. A strategy failure (e.g. KeywordStrategyGenerationError,
    // or a missing tier/OPENAI_API_KEY/webflowSiteId precondition) marks only the
    // strategy job 'error'; the local refresh job is already successful and stays
    // 'done'. `generateKeywordStrategy` owns its own STRATEGY_UPDATED broadcast
    // (Data-flow rule #4 — NO manual broadcast here). Dynamic import breaks the
    // keyword-strategy-generation.ts ↔ local-seo.ts cycle, exactly like the
    // recommendations regen above.
    const proceed = result.refreshed > 0;
    if (request.thenRegenerateStrategy === true && proceed) {
      try {
        const activeStrategyJob = hasActiveJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, workspaceId);
        if (activeStrategyJob) {
          log.info({ workspaceId, activeJobId: activeStrategyJob.id }, 'Skipped chained keyword strategy regeneration because a strategy job is already active');
        } else {
          const strategyJob = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
            workspaceId,
            message: 'Regenerating keyword strategy after local refresh...',
          });
          // Detached: do NOT await — the local-refresh job must not block on the
          // slow strategy generation. Failures are isolated to the strategy job.
          void (async () => {
            try {
              updateJob(strategyJob.id, { status: 'running', message: 'Generating keyword strategy...' });
              const { generateKeywordStrategy } = await import('./keyword-strategy-generation.js'); // dynamic-import-ok - breaks the keyword-strategy-generation.ts ↔ local-seo.ts cycle
              // mode 'full' (not incremental): fresh local snapshots can shift the whole
              // keyword universe, not just the pages that changed.
              const strategyGeneration = request.strategyGeneration;
              const competitorDomainsProvided = Array.isArray(strategyGeneration?.competitorDomains);
              const generationResult = await generateKeywordStrategy({
                ...strategyGeneration,
                workspaceId,
                mode: 'full',
                competitorDomainsProvided,
              });
              updateJob(strategyJob.id, {
                status: 'done',
                progress: 100,
                total: 100,
                message: generationResult.upToDate ? 'Strategy already up to date' : 'Keyword strategy regenerated after local refresh',
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.warn({ err, workspaceId, strategyJobId: strategyJob.id }, 'Keyword-strategy regen after local SEO refresh failed (non-fatal to refresh job)');
              updateJob(strategyJob.id, { status: 'error', error: message, message: 'Keyword strategy regeneration failed' });
            }
          })();
        }
      } catch (err) {
        // Guards the synchronous createJob/dynamic-import setup — a failure here
        // must never fail the already-successful local-refresh job.
        log.warn({ err, workspaceId }, 'Failed to kick off keyword-strategy regen after local SEO refresh (non-fatal)');
      }
    }

    updateJob(jobId, { status: 'done', progress: total, total, message: `Local visibility refreshed — ${refreshed}/${total} checks`, result });
  } finally {
    unregisterAbort(jobId);
  }
}

export async function runLocationBackfillJob(jobId: string, workspaceId: string): Promise<void> {
  if (getJob(jobId)?.status === 'cancelled') return;

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
    return;
  }

  const locations = getEffectiveLocations(workspace);
  const total = countLocalVisibilitySnapshots(workspaceId);

  if (total === 0) {
    updateJob(jobId, {
      status: 'done',
      progress: 100,
      total: 0,
      message: 'No snapshots to recalculate',
      result: { workspaceId, updated: 0 },
    });
    return;
  }

  updateJob(jobId, {
    status: 'running',
    progress: 0,
    total,
    message: `Recalculating match data for ${total} snapshots...`,
  });

  // Bug 2 fix: keyset-paginated read so we never materialise all rows into memory.
  // Cursor tracks (captured_at, id) for stable, deterministic pagination over
  // ORDER BY captured_at DESC, id ASC.
  const pageSize = 100;
  let processed = 0;
  let lastProgressBroadcastAt = 0;
  let cursor: LocalVisibilitySnapshotBackfillCursor | null = null;

  while (true) {
    if (getJob(jobId)?.status === 'cancelled') return;

    const batch = listLocalVisibilitySnapshotBackfillPage(workspaceId, pageSize, cursor);

    if (batch.length === 0) break;

    cursor = batch[batch.length - 1].cursor;

    const updates: LocalVisibilitySnapshotMatchUpdate[] = batch.map(({ snapshot, rawResults }) => {
      const match = evaluateLocalBusinessMatch(locations, rawResults);
      const isSuccess = snapshot.status === LOCAL_VISIBILITY_STATUS.SUCCESS;
      return {
        workspaceId,
        snapshotId: snapshot.id,
        businessFound: isSuccess && match.found,
        businessMatchConfidence: isSuccess ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
        businessMatchReason: isSuccess ? (match.reason ?? null) : (snapshot.degradedReason ?? null),
        localRank: isSuccess ? (match.rank ?? null) : null,
        matchedLocationId: isSuccess ? (match.matchedLocationId ?? null) : null,
        matchedLocationName: isSuccess ? (match.matchedLocationName ?? null) : null,
        topCompetitors: scrubOwnedLocalResults(rawResults, locations),
        rawResults,
      };
    });
    updateLocalVisibilitySnapshotMatches(updates);

    processed += batch.length;
    updateJob(jobId, {
      status: 'running',
      progress: processed,
      total,
      message: `Recalculating match data... (${processed}/${total})`,
    });

    if (
      getJob(jobId)?.status !== 'cancelled'
      && processed < total
      && processed - lastProgressBroadcastAt >= LOCAL_SEO_LOCATION_BACKFILL_PROGRESS_BROADCAST_INTERVAL
    ) {
      lastProgressBroadcastAt = processed;
      notifyLocalSeoUpdated(workspaceId, {
        action: 'backfill_progress',
        processed,
        total,
        updatedAt: new Date().toISOString(),
      });
    }

    if (batch.length < pageSize) break; // last page
  }

  if (getJob(jobId)?.status === 'cancelled') return;

  // Bug 3 / D4: retention prune at backfill completion — backfill is the other
  // natural hook point (alongside refresh). Wrapped in try/catch so a prune
  // failure never fails the already-completed backfill job.
  try {
    runSnapshotRetentionPrune(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'Snapshot retention prune after backfill failed (non-fatal)');
  }

  notifyLocalSeoUpdated(workspaceId, {
    action: 'backfill_completed',
    updated: processed,
    updatedAt: new Date().toISOString(),
  });
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Local match history recalculated',
    `${processed} snapshots updated with multi-location match data`,
    { source: 'local_seo', updated: processed },
  );

  updateJob(jobId, {
    status: 'done',
    progress: processed,
    total,
    message: `Match history updated for ${processed} snapshots`,
    result: { workspaceId, updated: processed },
  });
}
