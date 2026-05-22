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
import { isFeatureEnabled } from '../feature-flags.js';
import { createJob, hasActiveJob } from '../jobs.js';
import {
  countLocalVisibilitySnapshots,
  createLocalSeoRefreshPlan,
  getLocalSeoReadModel,
  resolveLocalSeoProviderLocation,
  runLocalSeoRefreshJob,
  updateLocalSeoConfiguration,
} from '../local-seo.js';
import { enqueueLocationBackfill } from '../local-seo-location-backfill-queue.js';
import { validate, z } from '../middleware/validate.js';
import { getWorkspace } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
  LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_POSTURE,
} from '../../shared/types/local-seo.js';

const router = Router();

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
  if (!isFeatureEnabled('local-seo-visibility')) {
    return { ok: false, status: 403, error: 'Local SEO visibility is not enabled for this environment' };
  }
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
  const payload = getLocalSeoReadModel(req.params.workspaceId, isFeatureEnabled('local-seo-visibility'), {
    includeSnapshots: req.query.includeSnapshots !== 'false',
  });
  if (!payload) return res.status(404).json({ error: 'Workspace not found' });
  res.json(payload);
});

router.put('/api/local-seo/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(updateSchema), (req, res, next) => {
  try {
    if (!isFeatureEnabled('local-seo-visibility')) {
      return res.status(403).json({ error: 'Local SEO visibility is not enabled for this environment' });
    }
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

router.get('/api/local-seo/:workspaceId/location-lookup', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    if (!isFeatureEnabled('local-seo-visibility')) {
      return res.status(403).json({ error: 'Local SEO visibility is not enabled for this environment' });
    }
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
  if (!isFeatureEnabled('local-seo-visibility')) {
    return res.status(403).json({ error: 'Local SEO visibility is not enabled for this environment' });
  }
  const active = hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, workspaceId);
  if (active) return res.status(409).json({ error: 'Local SEO refresh is already running for this workspace', jobId: active.id });
  const plan = createLocalSeoRefreshPlan(workspaceId, req.body);
  if (!plan) return res.status(404).json({ error: 'Workspace not found' });
  const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
    workspaceId,
    total: Math.max(1, plan.markets.length * plan.keywords.length),
    message: 'Preparing local SEO visibility refresh...',
  });
  res.json({ jobId: job.id, selectedKeywordCount: plan.keywords.length, selectedMarketCount: plan.markets.length });
  void runLocalSeoRefreshJob(job.id, workspaceId, req.body);
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
  const existing = getClientLocationById(locationId, workspaceId);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const confirmedRemaining = getClientLocations(workspaceId)
    .filter(location => location.status === 'confirmed' && location.id !== locationId)
    .length;
  const snapshotCount = countLocalVisibilitySnapshots(workspaceId);
  if (existing.status === 'confirmed' && confirmedRemaining === 0 && snapshotCount > 0) {
    return res.status(409).json({
      error: 'Cannot remove the only configured location while local visibility snapshots exist. Add another location first.',
    });
  }

  const deleted = deleteClientLocation(locationId, workspaceId);
  if (!deleted) return res.status(404).json({ error: 'Location not found' });
  recordLocationMutation(workspaceId, 'location_deleted', existing.name);
  const jobId = enqueueLocationBackfill(workspaceId);
  res.json({ deleted: true, jobId });
});

export default router;
