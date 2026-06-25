/**
 * Local SEO routes.
 *
 * @reads workspaces, local_seo_workspace_settings, local_seo_markets, local_visibility_snapshots, client_locations, rank_tracking_config, page_keywords, keyword_feedback
 * @writes local_seo_workspace_settings, local_seo_markets, local_visibility_snapshots, client_locations, jobs, activities, intelligence_cache
 */
import { Router } from 'express';

import { addActivity } from '../activity-log.js';
import { requireWorkspaceAccess } from '../auth.js';
import { broadcastToWorkspace } from '../broadcast.js';
import {
  createClientLocation,
  deleteClientLocation,
  getClientLocationById,
  getClientLocations,
  updateClientLocation,
} from '../client-locations.js';
import db from '../db/index.js';
import { createJob, hasActiveJob, registerAbort, updateJob } from '../jobs.js';
import { createLogger } from '../logger.js';
import {
  countLocalVisibilitySnapshots,
  createLocalSeoRefreshPlan,
  getLocalSeoReadModel,
  resolveLocalSeoProviderLocation,
  runLocalSeoRefreshJob,
  setPrimaryMarket,
  updateLocalSeoConfiguration,
} from '../local-seo.js';
import { enqueueLocationBackfill } from '../local-seo-location-backfill-queue.js';
import { runLocalGbpRefreshJob } from '../local-gbp.js';
import { getLatestBusinessListings, getLatestOwnedListing } from '../business-listings-store.js';
import { deriveGbpCompletenessScore } from '../listing-rating.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { assertCreditBudget, CreditBudgetError } from '../credit-budget-gate.js';
import { validate, z } from '../middleware/validate.js';
import { getWorkspace, computeEffectiveTier } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { KEYWORD_STRATEGY_MAX_PAGE_CAP } from '../keyword-strategy-generation.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
  LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_POSTURE,
} from '../../shared/types/local-seo.js';

const router = Router();
const log = createLogger('local-seo-routes');

const marketSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  stateOrRegion: z.string().max(120).optional(),
  country: z.string().min(1).max(120),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  providerLocationCode: z.number().int().positive().nullable().optional(),
  providerLocationName: z.string().max(200).nullable().optional(),
  status: z.enum([
    LOCAL_SEO_MARKET_STATUS.ACTIVE,
    LOCAL_SEO_MARKET_STATUS.INACTIVE,
    LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW,
  ]).optional(),
}).strict();

const updateSchema = z.object({
  posture: z.enum([
    LOCAL_SEO_POSTURE.LOCAL,
    LOCAL_SEO_POSTURE.NON_LOCAL,
    LOCAL_SEO_POSTURE.HYBRID,
    LOCAL_SEO_POSTURE.UNKNOWN,
  ]).optional(),
  // Allow a full replacement save at the v1 cap: up to 3 active rows plus
  // up to 3 existing rows being explicitly marked inactive in the same request.
  markets: z.array(marketSchema).max(6).optional(),
  // Per-workspace override for the local SEO refresh keyword budget.
  // `null` clears any existing override (revert to global default).
  // Integer in [min, max] sets a custom value. Omit to leave unchanged.
  keywordsPerRefresh: z
    .number()
    .int()
    .min(LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH)
    .max(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP)
    .nullable()
    .optional(),
}).strict();

const refreshSchema = z.object({
  marketIds: z.array(z.string().min(1)).max(3).optional(),
  // Use the hard ceiling here, not the workspace's effective budget — admin
  // can submit explicit keywords up to the platform-wide maximum; the refresh
  // plan clamps the final selection to the workspace's effective budget.
  keywords: z.array(z.string().min(1).max(200)).max(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP).optional(),
  device: z.enum([LOCAL_SEO_DEVICE.DESKTOP, LOCAL_SEO_DEVICE.MOBILE]).optional(),
  languageCode: z.string().min(2).max(8).optional(),
  // When true, a successful refresh (crawl that produced data) chains a
  // keyword-strategy regen server-side so it survives a closed tab. Threaded
  // through to runLocalSeoRefreshJob, which gates on result.refreshed > 0.
  thenRegenerateStrategy: z.boolean().optional(),
  strategyGeneration: z.object({
    businessContext: z.string().max(20_000).optional(),
    seoDataMode: z.enum(['none', 'quick', 'full']).optional(),
    seoDataProvider: z.string().min(1).max(80).optional(),
    competitorDomains: z.array(z.string().min(1).max(255)).max(50).optional(),
    maxPages: z.number().int().min(0).max(KEYWORD_STRATEGY_MAX_PAGE_CAP).optional(),
  }).strict().optional(),
}).strict();

const locationLookupQuerySchema = z.object({
  city: z.string().min(1).max(120),
  stateOrRegion: z.string().max(120).optional(),
  country: z.string().min(2).max(120),
}).strict();

const createLocationSchema = z.object({
  name: z.string().min(1).max(160),
  domain: z.string().max(240).optional().or(z.literal('')),
  phone: z.string().max(80).optional().or(z.literal('')),
  streetAddress: z.string().max(240).optional().or(z.literal('')),
  city: z.string().max(120).optional().or(z.literal('')),
  stateOrRegion: z.string().max(120).optional().or(z.literal('')),
  country: z.string().max(120).optional().or(z.literal('')),
  isPrimary: z.boolean().optional().default(false),
  status: z.enum(['needs_review', 'confirmed']).optional().default('needs_review'),
  gbpPlaceId: z.string().max(200).optional().or(z.literal('')),
}).strict();

const updateLocationSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  domain: z.string().max(240).optional().or(z.literal('')),
  phone: z.string().max(80).optional().or(z.literal('')),
  streetAddress: z.string().max(240).optional().or(z.literal('')),
  city: z.string().max(120).optional().or(z.literal('')),
  stateOrRegion: z.string().max(120).optional().or(z.literal('')),
  country: z.string().max(120).optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
  status: z.enum(['needs_review', 'confirmed']).optional(),
  gbpPlaceId: z.string().max(200).optional().or(z.literal('')),
}).strict();

function ensureLocalSeoLocationsAvailable(workspaceId: string): { ok: true } | { ok: false; status: number; error: string } {
  if (!getWorkspace(workspaceId)) {
    return { ok: false, status: 404, error: 'Workspace not found' };
  }
  return { ok: true };
}

function recordLocationMutation(
  workspaceId: string,
  action: 'location_created' | 'location_updated' | 'location_deleted',
  locationName: string,
): void {
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    action,
    locationName,
    updatedAt: new Date().toISOString(),
  });
  addActivity(
    workspaceId,
    'local_seo_updated',
    'Local SEO locations updated',
    `${locationName} ${action === 'location_deleted' ? 'removed' : action === 'location_created' ? 'added' : 'updated'}`,
    { source: 'local_seo', action, locationName },
  );
}

router.get('/api/local-seo/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const payload = getLocalSeoReadModel(req.params.workspaceId, true, {
    includeSnapshots: req.query.includeSnapshots !== 'false',
  });
  if (!payload) return res.status(404).json({ error: 'Workspace not found' });
  res.json(payload);
});

router.put('/api/local-seo/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(updateSchema), (req, res, next) => {
  try {
    const payload = updateLocalSeoConfiguration(req.params.workspaceId, req.body, true);
    if (!payload) return res.status(404).json({ error: 'Workspace not found' });
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Local SEO configuration failed';
    if (message.includes('At most') || message.includes('Active local SEO markets require')) return res.status(400).json({ error: message });
    if (message === 'Local SEO market not found') return res.status(404).json({ error: message });
    next(err);
  }
});

router.put(
  '/api/local-seo/:workspaceId/markets/:marketId/set-primary',
  requireWorkspaceAccess('workspaceId'),
  (req, res, next) => {
    try {
      setPrimaryMarket(req.params.workspaceId, req.params.marketId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Local SEO market not found') return res.status(404).json({ error: message });
      if (message === 'Primary market requires an active market with a provider location code') return res.status(400).json({ error: message });
      next(err);
    }
  },
);

router.get('/api/local-seo/:workspaceId/location-lookup', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const parsed = locationLookupQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid local SEO location lookup request' });
    }
    const payload = await resolveLocalSeoProviderLocation(req.params.workspaceId, parsed.data);
    if (!payload) return res.status(404).json({ error: 'Workspace not found' });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/api/local-seo/:workspaceId/refresh', requireWorkspaceAccess('workspaceId'), validate(refreshSchema), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const active = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, workspaceId);
  if (active) return res.status(409).json({ error: 'Local SEO refresh is already running for this workspace', jobId: active.id });
  // Global cross-workspace coalescing — each refresh holds DataForSEO SERP responses
  // in memory; on memory-constrained hosts (Render starter ~512 MB) concurrent
  // refreshes from different workspaces stack and OOM-kill the Node process with no
  // error log. Serialize globally: only one local SEO refresh runs at a time across
  // the whole platform. Wall-clock cost is acceptable per product call ("OK if it
  // takes a while"). Returns 409 with the other workspace's jobId so the UI can
  // surface a "waiting for another refresh" state if desired.
  const globalActive = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH);
  if (globalActive) {
    return res.status(409).json({
      error: 'Another workspace is currently running a local SEO refresh — please wait for it to complete',
      jobId: globalActive.id,
      blockingWorkspaceId: globalActive.workspaceId,
    });
  }
  const plan = createLocalSeoRefreshPlan(workspaceId, req.body);
  if (!plan) return res.status(404).json({ error: 'Workspace not found' });
  const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
    workspaceId,
    total: Math.max(1, plan.markets.length * plan.keywords.length),
    message: 'Preparing local SEO visibility refresh...',
  });
  registerAbort(job.id);
  res.json({ jobId: job.id, selectedKeywordCount: plan.keywords.length, selectedMarketCount: plan.markets.length });
  // Use .catch() instead of void so any unexpected throw (e.g. from addActivity/broadcastToWorkspace
  // after the main loop) becomes a logged error + failed job rather than an unhandled rejection
  // that kills the Node.js process.
  runLocalSeoRefreshJob(job.id, workspaceId, req.body).catch(err => {
    log.error({ err, jobId: job.id, workspaceId }, 'local-seo refresh: unhandled error escaped job runner — marking failed');
    updateJob(job.id, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Local SEO refresh failed unexpectedly',
    });
  });
});

// Admin readout for the GBP + reviews data (SEO Decision Engine P7 / local-gbp). Aggregates
// ONLY — own rating/review-count + top competitors by review count + the derived GBP completeness
// score. Never returns per-review/author data (the store holds none; keep it that way — PII rule).
// When the flag is off, returns an empty payload (not 404) so the panel simply renders nothing.
// `requireWorkspaceAccess` only (HMAC admin auth is covered by the global app gate — no requireAuth).
router.get('/api/local-seo/:workspaceId/gbp-reviews', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;

  if (!isFeatureEnabled('local-gbp', workspaceId)) {
    return res.json({ owned: null, competitors: [], completenessScore: null });
  }

  const owned = getLatestOwnedListing(workspaceId) ?? null;
  const competitors = getLatestBusinessListings(workspaceId)
    .filter(listing => !listing.isOwned)
    .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
    .slice(0, 5);

  const completenessScore = owned
    ? deriveGbpCompletenessScore({
        claimed: owned.claimed,
        totalPhotos: owned.totalPhotos,
        attributeCount: owned.attributes.length,
        category: owned.category,
      })
    : null;

  res.json({ owned, competitors, completenessScore });
});

// Trigger a GBP + reviews refresh (SEO Decision Engine P7 / local-gbp). Manual-trigger
// for P7 (no cron in this unit). Gating order mirrors the P6 national-SERP refresh:
// feature flag → workspace → tier (Growth+) → observe-only budget gate → per-workspace +
// global job serialization. Fire-and-forget. `requireWorkspaceAccess` only (HMAC admin
// auth is covered by the global app gate — never add requireAuth here).
router.post('/api/local-seo/:workspaceId/refresh-gbp', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;

  // Flag gate — when off, the route does no work and returns a clean "not enabled" 404.
  if (!isFeatureEnabled('local-gbp', workspaceId)) {
    return res.status(404).json({ error: 'GBP + reviews tracking is not enabled' });
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Tier gate — Growth + Premium only (owner decision); Free is excluded.
  const tier = computeEffectiveTier(ws);
  if (tier !== 'growth' && tier !== 'premium') {
    return res.status(403).json({ error: 'GBP + reviews tracking requires a Growth or Premium plan' });
  }

  // P5 budget gate at route entry — observe-only at launch (logs the would-block, returns).
  // Wrapped so that if enforcement is later enabled, an over-budget workspace is logged and
  // the refresh still proceeds (enforcement posture for this route is observe-only by decision).
  try {
    assertCreditBudget(workspaceId, 'business_listings', tier);
  } catch (err) {
    if (err instanceof CreditBudgetError) {
      log.warn({ workspaceId, tier }, 'local-gbp refresh: credit budget would-block at route entry (proceeding — observe-only)');
    } else {
      throw err;
    }
  }

  // Per-workspace serialization.
  const active = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH, workspaceId);
  if (active) return res.status(409).json({ error: 'A GBP + reviews refresh is already running for this workspace', jobId: active.id });

  // Global cross-workspace coalescing — each refresh holds business-listings responses in
  // memory; on memory-constrained hosts concurrent refreshes from different workspaces stack
  // and OOM the process. Serialize globally: only one GBP refresh runs at a time platform-wide.
  const globalActive = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH);
  if (globalActive) {
    return res.status(409).json({
      error: 'Another workspace is currently running a GBP + reviews refresh — please wait for it to complete',
      jobId: globalActive.id,
      blockingWorkspaceId: globalActive.workspaceId,
    });
  }

  const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH, {
    workspaceId,
    message: 'Preparing GBP + reviews refresh...',
  });
  registerAbort(job.id);
  res.json({ jobId: job.id });
  // .catch() (not void) so any unexpected throw becomes a logged error + failed job rather than
  // an unhandled rejection that crashes the process.
  runLocalGbpRefreshJob(workspaceId, job.id).catch(err => {
    log.error({ err, jobId: job.id, workspaceId }, 'local-gbp refresh: unhandled error escaped job runner — marking failed');
    updateJob(job.id, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'GBP + reviews refresh failed unexpectedly',
    });
  });
});

router.get('/api/local-seo/:workspaceId/locations', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const available = ensureLocalSeoLocationsAvailable(req.params.workspaceId);
  if (!available.ok) return res.status(available.status).json({ error: available.error });
  res.json({ locations: getClientLocations(req.params.workspaceId) });
});

router.post('/api/local-seo/:workspaceId/locations', requireWorkspaceAccess('workspaceId'), validate(createLocationSchema), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const available = ensureLocalSeoLocationsAvailable(workspaceId);
  if (!available.ok) return res.status(available.status).json({ error: available.error });
  const location = createClientLocation(workspaceId, req.body);
  recordLocationMutation(workspaceId, 'location_created', location.name);
  const jobId = enqueueLocationBackfill(workspaceId);
  res.status(201).json({ location, jobId });
});

router.put('/api/local-seo/:workspaceId/locations/:locationId', requireWorkspaceAccess('workspaceId'), validate(updateLocationSchema), (req, res) => {
  const { workspaceId, locationId } = req.params;
  const available = ensureLocalSeoLocationsAvailable(workspaceId);
  if (!available.ok) return res.status(available.status).json({ error: available.error });
  const location = updateClientLocation(locationId, workspaceId, req.body);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  recordLocationMutation(workspaceId, 'location_updated', location.name);
  const jobId = enqueueLocationBackfill(workspaceId);
  res.json({ location, jobId });
});

router.delete('/api/local-seo/:workspaceId/locations/:locationId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, locationId } = req.params;
  const available = ensureLocalSeoLocationsAvailable(workspaceId);
  if (!available.ok) return res.status(available.status).json({ error: available.error });

  // Wrap the guard check + delete in a transaction to prevent two concurrent deletes
  // of the last two confirmed locations both passing the guard and leaving zero confirmed.
  type DeleteResult =
    | { ok: true; existingName: string }
    | { ok: false; status: number; error: string };

  const result = db.transaction((): DeleteResult => {
    const existing = getClientLocationById(locationId, workspaceId);
    if (!existing) return { ok: false, status: 404, error: 'Location not found' };

    const confirmedRemaining = getClientLocations(workspaceId)
      .filter(location => location.status === 'confirmed' && location.id !== locationId)
      .length;
    const snapshotCount = countLocalVisibilitySnapshots(workspaceId);
    if (existing.status === 'confirmed' && confirmedRemaining === 0 && snapshotCount > 0) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot remove the only configured location while local visibility snapshots exist. Add another location first.',
      };
    }

    deleteClientLocation(locationId, workspaceId);
    return { ok: true, existingName: existing.name };
  })();

  if (!result.ok) return res.status(result.status).json({ error: result.error });
  recordLocationMutation(workspaceId, 'location_deleted', result.existingName);
  const jobId = enqueueLocationBackfill(workspaceId);
  res.json({ deleted: true, jobId });
});

export default router;
