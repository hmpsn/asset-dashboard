/**
 * national-serp — background job that reads the national advanced SERP rank +
 * AI-Overview citation for a workspace's tracked keywords and persists the result
 * as `serp_snapshots` rows (SEO Decision Engine P6 / national-serp-tracking).
 *
 * Structurally mirrors `runLocalSeoRefreshJob` (server/local-seo.ts): global
 * serialization is enforced at the ROUTE (concurrency = 1 across the platform);
 * this runner adds per-keyword cancellation checks, heap-aware backpressure before
 * each provider call, per-item `updateJob` progress, and a periodic broadcast.
 *
 * Tier + flag gating is enforced at the route. The tier guard here is defense in
 * depth — a non-Growth/Premium workspace finishes the job as a clean no-op.
 *
 * Budget gate (P5): `assertCreditBudget` is called per keyword on the network path.
 * Enforcement is OBSERVE-ONLY at launch (it logs the would-block and returns), but
 * the call is wired so flipping enforcement on later needs no change here. We wrap
 * it so that even when enforcement is later enabled, a thrown CreditBudgetError is
 * logged-and-skipped rather than fatal to the whole refresh.
 */
import { createLogger } from './logger.js';
import { updateJob, unregisterAbort } from './jobs.js';
import { getWorkspace, computeEffectiveTier } from './workspaces.js';
import { cleanDomain } from './domains/local-seo/business-match.js';
import { workspaceProviderGeo } from './seo-target-geo.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { storeSerpSnapshots } from './serp-snapshots-store.js';
import { assertCreditBudget, CreditBudgetError } from './credit-budget-gate.js';
import { broadcastToWorkspace } from './broadcast.js';
import { addActivity } from './activity-log.js';
import { WS_EVENTS } from './ws-events.js';
import { isRefreshJobCancelled, waitForHeapHeadroom } from './seo-refresh-runner-runtime.js';

const log = createLogger('national-serp');

/** Owner decision (P6): hard cap of 100 keywords per refresh. */
const NATIONAL_SERP_KEYWORD_CAP = 100;
/** Broadcast a mid-job cache-invalidation every N processed keywords. */
const NATIONAL_SERP_PROGRESS_BROADCAST_INTERVAL = 20;
/** Soft heap threshold (MB) above which we pause before the next provider call. */
const NATIONAL_SERP_HEAP_HEADROOM_THRESHOLD_MB = 320;
const NATIONAL_SERP_HEAP_HEADROOM_WAIT_MS = 250;
const NATIONAL_SERP_HEAP_HEADROOM_MAX_WAITS = 8;

/**
 * Heap-aware backpressure before allocating another advanced-SERP response. Mirrors
 * `waitForMemoryHeadroom` in local-seo.ts: if heap is above the threshold, sleep and
 * retry up to `maxWaits` times, then proceed anyway rather than stall indefinitely.
 */
async function waitForMemoryHeadroom(): Promise<void> {
  await waitForHeapHeadroom({
    thresholdMb: NATIONAL_SERP_HEAP_HEADROOM_THRESHOLD_MB,
    waitMs: NATIONAL_SERP_HEAP_HEADROOM_WAIT_MS,
    maxWaits: NATIONAL_SERP_HEAP_HEADROOM_MAX_WAITS,
    logger: log,
    logMessage: 'national-serp refresh: heap above threshold — pausing for GC headroom',
  });
}

export interface NationalSerpRefreshSummary {
  keywordsProcessed: number;
  aiOverviewsCited: number;
}

/** True while the job has been cancelled (route registers an AbortController). */
function isCancelled(jobId: string): boolean {
  return isRefreshJobCancelled(jobId);
}

export async function runNationalSerpRefreshJob(workspaceId: string, jobId: string): Promise<void> {
  try {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
      return;
    }

    // Defense in depth — the route already gates to Growth/Premium. Free finishes as a no-op.
    const tier = computeEffectiveTier(workspace);
    if (tier !== 'growth' && tier !== 'premium') {
      updateJob(jobId, {
        status: 'done',
        progress: 100,
        total: 100,
        message: 'National SERP tracking requires a Growth or Premium plan',
        result: { keywordsProcessed: 0, aiOverviewsCited: 0 } satisfies NationalSerpRefreshSummary,
      });
      return;
    }

    const ownerDomain = cleanDomain(workspace.liveDomain);
    if (!ownerDomain) {
      const message = 'No live domain configured — connect a domain to track national SERP ranks';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }

    // Provider must support the optional national-SERP capability; feature-detect before use.
    const provider = getConfiguredProvider();
    if (!provider?.getNationalSerp) {
      const message = 'National SERP tracking requires the DataForSEO provider (not configured)';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }
    // Capture the narrowed method reference so TS sees it as non-undefined in the async loop.
    const getNationalSerp = provider.getNationalSerp.bind(provider);

    // Target-geo (P4): admin target-geo → local primary market → US/'en'. Flag-gated inside
    // the helper; returns {} when geo-targeting is off, so the provider falls back to US/'en'.
    const { locationCode, languageCode } = workspaceProviderGeo(workspaceId);

    // Cap at the first 100 tracked keywords (owner decision).
    const trackedKeywords = getTrackedKeywords(workspaceId)
      .map(keyword => keyword.query)
      .filter((query): query is string => typeof query === 'string' && query.trim().length > 0)
      .slice(0, NATIONAL_SERP_KEYWORD_CAP);

    if (trackedKeywords.length === 0) {
      const message = 'No tracked keywords to refresh';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }

    const total = trackedKeywords.length;
    updateJob(jobId, { status: 'running', total, progress: 0, message: 'Refreshing national SERP ranks...' });

    const snapshots: Parameters<typeof storeSerpSnapshots>[2] = [];
    let processed = 0;
    let aiOverviewsCited = 0;
    let keywordsPersisted = 0;
    let lastProgressBroadcastAt = 0;
    const today = new Date().toISOString().slice(0, 10);

    // Persist + clear the accumulated buffer. Called periodically and on cancellation so a
    // mid-run cancel keeps the (paid) SERP reads already completed — mirrors runLocalSeoRefreshJob,
    // which persists incrementally, rather than discarding the whole batch. The upsert is
    // idempotent on (workspace_id, date, query), so flushing in chunks is safe.
    const flushSnapshots = (): void => {
      if (snapshots.length === 0) return;
      storeSerpSnapshots(workspaceId, today, snapshots);
      keywordsPersisted += snapshots.length;
      snapshots.length = 0;
    };

    for (const keyword of trackedKeywords) {
      // Pre-check cancellation BEFORE spending provider credits — persist progress, then stop.
      if (isCancelled(jobId)) { flushSnapshots(); return; }
      await waitForMemoryHeadroom();

      // P5 budget gate — call before each PAID provider read. Observe-only at launch
      // (logs the would-block, returns). Wrapped so a thrown CreditBudgetError (only
      // possible once enforcement is enabled) is logged-and-skipped, never fatal.
      try {
        assertCreditBudget(workspaceId, 'national_serp', tier);
      } catch (err) {
        if (err instanceof CreditBudgetError) {
          log.warn({ workspaceId, keyword }, 'national-serp refresh: credit budget would-block — skipping keyword');
          processed++;
          updateJob(jobId, { progress: processed, total, message: `Refreshed ${processed}/${total} national SERP ranks` });
          continue;
        }
        throw err;
      }

      try {
        const result = await getNationalSerp({ keyword, ownerDomain, locationCode, languageCode }, workspaceId);
        if (isCancelled(jobId)) { flushSnapshots(); return; }
        if (result.aiOverviewCited === true) aiOverviewsCited++;
        snapshots.push({
          query: keyword,
          observedAt: new Date().toISOString(),
          position: result.position,
          matchedUrl: result.matchedUrl,
          features: result.features,
          aiOverviewCited: result.aiOverviewCited,
          aiOverviewPresent: result.aiOverviewPresent,
        });
      } catch (err) {
        log.warn({ err, workspaceId, keyword }, 'national-serp refresh item failed');
      } finally {
        if (!isCancelled(jobId)) {
          processed++;
          updateJob(jobId, { progress: processed, total, message: `Refreshed ${processed}/${total} national SERP ranks` });
        }
      }

      // Mid-job: persist the batch so far + broadcast every ~20 keywords so consumers refresh
      // incrementally (and a later cancel keeps the work). Skip the final tick (processed ===
      // total) — the post-loop flush + completion broadcast cover it.
      if (
        !isCancelled(jobId)
        && processed < total
        && processed - lastProgressBroadcastAt >= NATIONAL_SERP_PROGRESS_BROADCAST_INTERVAL
      ) {
        lastProgressBroadcastAt = processed;
        flushSnapshots();
        broadcastToWorkspace(workspaceId, WS_EVENTS.SERP_SNAPSHOTS_REFRESHED, {
          action: 'refresh_progress',
          processed,
          total,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Persist any remaining buffered snapshots (final partial batch).
    flushSnapshots();
    if (isCancelled(jobId)) return; // data already persisted above; leave the cancelled status.

    const summary: NationalSerpRefreshSummary = { keywordsProcessed: keywordsPersisted, aiOverviewsCited };

    addActivity(
      workspaceId,
      'rank_snapshot',
      'National SERP ranks refreshed',
      `${keywordsPersisted} national SERP positions captured for ${today}`,
      { source: 'national_serp', keywordsProcessed: keywordsPersisted, aiOverviewsCited },
    );
    broadcastToWorkspace(workspaceId, WS_EVENTS.SERP_SNAPSHOTS_REFRESHED, {
      action: 'refresh_completed',
      date: today,
      keywordsProcessed: keywordsPersisted,
      aiOverviewsCited,
      updatedAt: new Date().toISOString(),
    });

    updateJob(jobId, {
      status: 'done',
      progress: total,
      total,
      message: `National SERP ranks refreshed — ${keywordsPersisted}/${total} keywords`,
      result: summary,
    });
  } finally {
    unregisterAbort(jobId);
  }
}
