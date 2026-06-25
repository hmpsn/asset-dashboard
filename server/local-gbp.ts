/**
 * local-gbp — background job that reads Google Business Profile health + review
 * counts/ratings for a workspace's OWN listing and its local competitors, persisting
 * the result as `business_listing_snapshots` rows (SEO Decision Engine P7 / local-gbp).
 *
 * Structurally mirrors `runNationalSerpRefreshJob` (server/national-serp.ts): global +
 * per-workspace serialization is enforced at the ROUTE (concurrency = 1 platform-wide);
 * this runner adds per-item cancellation checks, heap-aware backpressure before each
 * provider call, per-item `updateJob` progress, incremental `flushSnapshots` (a mid-run
 * cancel keeps the paid work already done), and a periodic + final broadcast.
 *
 * Tier + flag gating is enforced at the route. The tier guard here is defense in depth —
 * a non-Growth/Premium workspace finishes the job as a clean no-op.
 *
 * Budget gate (P5): `assertCreditBudget` is called per PAID provider read. Enforcement is
 * OBSERVE-ONLY at launch (it logs the would-block and returns), but the call is wired so
 * flipping enforcement on later needs no change here. We wrap it so that even when
 * enforcement is later enabled, a thrown CreditBudgetError is logged-and-skipped rather
 * than fatal to the whole refresh.
 *
 * is_owned authority: a listing is marked owned by WHICH search produced it — the result of
 * a by-name (`title`) owner lookup is the OWNER; results of the category competitor search are
 * competitors (and any whose place_id matches an ownerPlaceId is force-excluded from that set).
 * We do NOT rely solely on the parser's `isOwned` flag, which is a best-effort domain/place-id
 * heuristic.
 */
import { createLogger } from './logger.js';
import { getJob, updateJob, unregisterAbort } from './jobs.js';
import { getWorkspace, computeEffectiveTier } from './workspaces.js';
import { cleanDomain, listLocalSeoMarkets, LOCAL_SEO_MAX_MARKETS } from './local-seo.js';
import { getClientLocations } from './client-locations.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import type { BusinessListingResult } from './seo-data-provider.js';
import {
  storeBusinessListingSnapshots,
  type StoreBusinessListingInput,
} from './business-listings-store.js';
import { assertCreditBudget, CreditBudgetError } from './credit-budget-gate.js';
import { broadcastToWorkspace } from './broadcast.js';
import { addActivity } from './activity-log.js';
import { WS_EVENTS } from './ws-events.js';
import { LOCAL_SEO_MARKET_STATUS } from '../shared/types/local-seo.js';
import type { LocalSeoMarket, ClientLocation } from '../shared/types/local-seo.js';

const log = createLogger('local-gbp');

/** DataForSEO location_coordinate radius (km) — matches the local-seo refresh default. */
const LOCAL_GBP_RADIUS_KM = 10;
/** Competitor listings to keep per (market × location) search (sorted by review count). */
const LOCAL_GBP_COMPETITOR_LIMIT = 20;
/** Broadcast a mid-job cache-invalidation every N processed (market × location) pairs. */
const LOCAL_GBP_PROGRESS_BROADCAST_INTERVAL = 3;
/** Soft heap threshold (MB) above which we pause before the next provider call. */
const LOCAL_GBP_HEAP_HEADROOM_THRESHOLD_MB = 320;
const LOCAL_GBP_HEAP_HEADROOM_WAIT_MS = 250;
const LOCAL_GBP_HEAP_HEADROOM_MAX_WAITS = 8;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Heap-aware backpressure before allocating another business-listings response. Mirrors
 * `waitForMemoryHeadroom` in national-serp.ts / local-seo.ts: if heap is above the
 * threshold, sleep and retry up to `maxWaits` times, then proceed anyway rather than
 * stall indefinitely.
 */
async function waitForMemoryHeadroom(): Promise<void> {
  for (let attempt = 0; attempt < LOCAL_GBP_HEAP_HEADROOM_MAX_WAITS; attempt++) {
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    if (heapMb < LOCAL_GBP_HEAP_HEADROOM_THRESHOLD_MB) return;
    log.warn(
      { heapMb: Math.round(heapMb), thresholdMb: LOCAL_GBP_HEAP_HEADROOM_THRESHOLD_MB, attempt: attempt + 1 },
      'local-gbp refresh: heap above threshold — pausing for GC headroom',
    );
    await sleep(LOCAL_GBP_HEAP_HEADROOM_WAIT_MS);
  }
}

export interface LocalGbpRefreshSummary {
  listingsProcessed: number;
  ownerFound: number;
}

/** True while the job has been cancelled (route registers an AbortController). */
function isCancelled(jobId: string): boolean {
  return getJob(jobId)?.status === 'cancelled';
}

/** Active markets with a usable coordinate, capped like the local-seo refresh (top 3). */
function activeMarketsWithCoords(workspaceId: string): LocalSeoMarket[] {
  return listLocalSeoMarkets(workspaceId)
    .filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)
    .filter(market => typeof market.latitude === 'number' && typeof market.longitude === 'number')
    .slice(0, LOCAL_SEO_MAX_MARKETS);
}

/** Confirmed client locations (mirrors getEffectiveLocations' confirmed filter). */
function confirmedLocations(workspaceId: string): ClientLocation[] {
  return getClientLocations(workspaceId).filter(location => location.status === 'confirmed');
}

/** Map a parsed provider listing to a store row, forcing the authoritative is_owned + ids. */
function toStoreRow(
  listing: BusinessListingResult,
  opts: { isOwned: boolean; marketId: string; locationId?: string; category?: string },
): StoreBusinessListingInput {
  return {
    placeId: listing.placeId,
    isOwned: opts.isOwned,
    marketId: opts.marketId,
    locationId: opts.locationId ?? null,
    title: listing.title ?? null,
    domain: listing.domain ?? null,
    cid: listing.cid ?? null,
    category: listing.category ?? opts.category ?? null,
    rating: listing.rating ?? null,
    reviewCount: listing.reviewCount ?? null,
    ratingDistribution: listing.ratingDistribution ?? null,
    attributes: listing.attributes?.items ?? null,
    totalPhotos: listing.totalPhotos ?? null,
    claimed: listing.claimed ?? null,
  };
}

export async function runLocalGbpRefreshJob(workspaceId: string, jobId: string): Promise<void> {
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
        message: 'GBP + reviews tracking requires a Growth or Premium plan',
        result: { listingsProcessed: 0, ownerFound: 0 } satisfies LocalGbpRefreshSummary,
      });
      return;
    }

    // Provider must support the optional business-listings capability; feature-detect before use.
    const provider = getConfiguredProvider();
    if (!provider?.getBusinessListings) {
      const message = 'GBP + reviews tracking requires the DataForSEO provider (not configured)';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }
    // Capture the narrowed method reference so TS sees it as non-undefined in the async loop.
    const getBusinessListings = provider.getBusinessListings.bind(provider);

    const ownerDomain = cleanDomain(workspace.liveDomain) ?? '';
    const ownerName = workspace.name;
    // Single best category string from the intelligence profile; if absent, the job can still
    // title-search the owner (competitor category search is skipped when there is no category).
    const category = workspace.intelligenceProfile?.industry?.trim() || undefined;

    const markets = activeMarketsWithCoords(workspaceId);
    const locations = confirmedLocations(workspaceId);
    // Owner place ids — confirmed client_locations.gbp_place_id values used to force-exclude the
    // owner from the competitor set and (best-effort) hint the parser's isOwned matching.
    const ownerPlaceIds = locations
      .map(location => location.gbpPlaceId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const ownerPlaceIdSet = new Set(ownerPlaceIds);

    // Cross-product: each active market × confirmed location. When there are no confirmed
    // locations, run one pass per market with no location_id (owner found by name only).
    const locationAxis: (ClientLocation | undefined)[] = locations.length > 0 ? locations : [undefined];
    const pairs: { market: LocalSeoMarket; location: ClientLocation | undefined }[] = [];
    for (const market of markets) {
      for (const location of locationAxis) {
        pairs.push({ market, location });
      }
    }

    if (pairs.length === 0) {
      const message = 'No active markets with coordinates — add a market to track GBP + reviews';
      updateJob(jobId, { status: 'error', message, error: message });
      return;
    }

    const total = pairs.length;
    updateJob(jobId, { status: 'running', total, progress: 0, message: 'Refreshing GBP + reviews...' });

    // Dedupe across all pairs by place_id; owner wins over competitor. Buffer is flushed
    // incrementally (chunked upsert is idempotent on (workspace_id, place_id, snapshot_date)).
    const byPlaceId = new Map<string, StoreBusinessListingInput>();
    let processed = 0;
    let listingsPersisted = 0;
    let ownerFound = 0;
    let lastProgressBroadcastAt = 0;
    const today = new Date().toISOString().slice(0, 10);

    /** Add/merge a row, letting an owned listing override a previously-seen competitor row. */
    const addRow = (row: StoreBusinessListingInput): void => {
      const existing = byPlaceId.get(row.placeId);
      if (!existing) {
        byPlaceId.set(row.placeId, row);
        return;
      }
      // Owner wins: if this row is owned and the existing one is not, replace.
      if (row.isOwned && !existing.isOwned) byPlaceId.set(row.placeId, row);
    };

    /** Persist + clear the accumulated buffer. Called periodically and on cancellation so a
     *  mid-run cancel keeps the (paid) listing reads already completed. */
    const flushSnapshots = (): void => {
      if (byPlaceId.size === 0) return;
      const rows = [...byPlaceId.values()];
      storeBusinessListingSnapshots(workspaceId, today, rows);
      listingsPersisted += rows.length;
      byPlaceId.clear();
    };

    /** Observe-only budget check before a PAID provider read. Returns false → skip the call. */
    const budgetAllows = (): boolean => {
      try {
        assertCreditBudget(workspaceId, 'business_listings', tier);
        return true;
      } catch (err) {
        if (err instanceof CreditBudgetError) {
          log.warn({ workspaceId }, 'local-gbp refresh: credit budget would-block — skipping listings read');
          return false;
        }
        throw err;
      }
    };

    for (const { market, location } of pairs) {
      // Pre-check cancellation BEFORE spending provider credits — persist progress, then stop.
      if (isCancelled(jobId)) { flushSnapshots(); return; }

      // Prefer the location's market coordinate; both come from the market (locations carry no coords).
      const locationCoordinate = `${market.latitude},${market.longitude},${LOCAL_GBP_RADIUS_KM}`;
      const searchName = location?.name ?? ownerName;

      // 1) Competitor search (category-sorted by review count). Skipped when no category resolvable.
      if (category) {
        await waitForMemoryHeadroom();
        if (isCancelled(jobId)) { flushSnapshots(); return; }
        if (budgetAllows()) {
          try {
            const competitors = await getBusinessListings(
              { category, locationCoordinate, ownerDomain, ownerPlaceIds, limit: LOCAL_GBP_COMPETITOR_LIMIT },
              workspaceId,
            );
            if (isCancelled(jobId)) { flushSnapshots(); return; }
            for (const listing of competitors) {
              // Force-exclude the owner from the competitor set (authoritative is_owned by search).
              const matchesOwner = ownerPlaceIdSet.has(listing.placeId) || (listing.cid ? ownerPlaceIdSet.has(listing.cid) : false);
              if (matchesOwner) continue;
              addRow(toStoreRow(listing, { isOwned: false, marketId: market.id, category }));
            }
          } catch (err) {
            log.warn({ err, workspaceId, marketId: market.id }, 'local-gbp refresh: competitor search failed');
          }
        }
      }

      // 2) Owner search by name. The owner often has too few reviews to surface in the review-
      //    count-sorted competitor search (that IS the gap). getBusinessListings still sorts by
      //    votes_count, so result[0] is the most-reviewed NAME match — which can be a different
      //    same-name business. When we have an identity signal (gbp_place_id / live domain), trust
      //    the parser's verified `isOwned` (place_id/cid/domain match) to pick the RIGHT listing,
      //    and do NOT store a false owner if none of the candidates verify. Only fall back to the
      //    top name match when the workspace has no identity to verify against. (P7 scaled review.)
      await waitForMemoryHeadroom();
      if (isCancelled(jobId)) { flushSnapshots(); return; }
      if (budgetAllows()) {
        try {
          const ownerResults = await getBusinessListings(
            { title: searchName, locationCoordinate, ownerDomain, ownerPlaceIds, limit: 5 },
            workspaceId,
          );
          if (isCancelled(jobId)) { flushSnapshots(); return; }
          const hasIdentity = ownerPlaceIds.length > 0 || ownerDomain !== '';
          const verified = ownerResults.find(r => r.isOwned);
          const owner = verified ?? (hasIdentity ? undefined : ownerResults[0]);
          if (owner && owner.placeId) {
            addRow(toStoreRow(owner, { isOwned: true, marketId: market.id, locationId: location?.id, category }));
            ownerFound++;
          }
        } catch (err) {
          log.warn({ err, workspaceId, marketId: market.id }, 'local-gbp refresh: owner search failed');
        }
      }

      processed++;
      updateJob(jobId, { progress: processed, total, message: `Refreshed ${processed}/${total} markets` });

      // Mid-job: persist the buffer + broadcast every few pairs so consumers refresh incrementally
      // (and a later cancel keeps the work). Skip the final tick — the post-loop flush + completion
      // broadcast cover it.
      if (
        !isCancelled(jobId)
        && processed < total
        && processed - lastProgressBroadcastAt >= LOCAL_GBP_PROGRESS_BROADCAST_INTERVAL
      ) {
        lastProgressBroadcastAt = processed;
        flushSnapshots();
        broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED, {
          action: 'refresh_progress',
          processed,
          total,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Persist any remaining buffered snapshots (final partial batch).
    if (isCancelled(jobId)) { flushSnapshots(); return; }
    flushSnapshots();

    const summary: LocalGbpRefreshSummary = { listingsProcessed: listingsPersisted, ownerFound };

    addActivity(
      workspaceId,
      'local_seo_updated',
      'GBP + reviews refreshed',
      `${listingsPersisted} business listings captured for ${today}${ownerFound > 0 ? ` (owner found in ${ownerFound} market${ownerFound === 1 ? '' : 's'})` : ''}`,
      { source: 'local_gbp', listingsProcessed: listingsPersisted, ownerFound },
    );
    broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED, {
      action: 'refresh_completed',
      date: today,
      listingsProcessed: listingsPersisted,
      ownerFound,
      updatedAt: new Date().toISOString(),
    });

    updateJob(jobId, {
      status: 'done',
      progress: total,
      total,
      message: `GBP + reviews refreshed — ${listingsPersisted} listings across ${total} market${total === 1 ? '' : 's'}`,
      result: summary,
    });
  } finally {
    unregisterAbort(jobId);
  }
}
