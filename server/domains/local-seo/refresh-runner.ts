import { addActivity } from '../../activity-log.js';
import { fireBridge } from '../../bridge-infrastructure.js';
import { runLocalVisibilityShiftBridge } from '../../bridge-local-visibility-shift.js';
import { sleep } from '../../utils/async.js';
import { createJob, getJob, hasActiveJob, unregisterAbort, updateJob } from '../../jobs.js';
import { createLogger } from '../../logger.js';
import { runRecommendationRegen } from '../../recommendation-regen-scheduler.js';
import {
  DEFAULT_SEO_DATA_PROVIDER,
  getProvider,
  isCapabilityDisabled,
  normalizeRuntimeSeoDataProvider,
  type SeoDataProvider,
} from '../../seo-data-provider.js';
import { waitForHeapHeadroom } from '../../seo-refresh-runner-runtime.js';
import { getWorkspace } from '../../workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_POSTURE,
  LOCAL_VISIBILITY_STATUS,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalSeoRefreshRequest,
  type LocalSeoRefreshResult,
} from '../../../shared/types/local-seo.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { LOCAL_SEO_MAX_RESULTS, evaluateLocalBusinessMatch, getEffectiveLocations, scrubOwnedLocalResults } from './business-match.js';
import { createLocalSeoRefreshPlan } from './candidate-service.js';
import { readLocalSeoSettings } from './configuration-service.js';
import { notifyLocalSeoUpdated } from './events.js';
import {
  countLocalVisibilitySnapshots,
  listLatestLocalVisibilitySnapshots,
  listLocalVisibilitySnapshotBackfillPage,
  runSnapshotRetentionPrune,
  snapshotFromProviderResult,
  storeLocalVisibilitySnapshot,
  updateLocalVisibilitySnapshotMatches,
  type LocalVisibilitySnapshotBackfillCursor,
  type LocalVisibilitySnapshotMatchUpdate,
} from './snapshot-store.js';

const log = createLogger('local-seo/refresh-runner');

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
              const { generateKeywordStrategy } = await import('../../keyword-strategy-generation.js'); // dynamic-import-ok - breaks the keyword-strategy-generation.ts ↔ local-seo.ts cycle
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
