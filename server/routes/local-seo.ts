/**
 * Local SEO routes.
 *
 * @reads workspaces, local_seo_workspace_settings, local_seo_markets, local_visibility_snapshots, rank_tracking_config, page_keywords, keyword_feedback
 * @writes local_seo_workspace_settings, local_seo_markets, local_visibility_snapshots, jobs, activities, intelligence_cache
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { createJob, hasActiveJob } from '../jobs.js';
import {
  createLocalSeoRefreshPlan,
  getLocalSeoReadModel,
  runLocalSeoRefreshJob,
  updateLocalSeoConfiguration,
} from '../local-seo.js';
import { validate, z } from '../middleware/validate.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_STATUS,
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
}).strict();

const refreshSchema = z.object({
  marketIds: z.array(z.string().min(1)).max(3).optional(),
  keywords: z.array(z.string().min(1).max(200)).max(25).optional(),
  device: z.enum([LOCAL_SEO_DEVICE.DESKTOP, LOCAL_SEO_DEVICE.MOBILE]).optional(),
  languageCode: z.string().min(2).max(8).optional(),
}).strict();

router.get('/api/local-seo/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const payload = getLocalSeoReadModel(req.params.workspaceId, isFeatureEnabled('local-seo-visibility'));
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

export default router;
