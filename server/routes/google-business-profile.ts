/**
 * Google Business Profile integration routes.
 *
 * @reads google_oauth_connections, google_business_accounts, google_business_locations, workspace_google_business_locations, google_business_reviews, google_business_review_sync_status, google_business_review_responses, client_locations
 * @writes google_oauth_connections, google_business_profile_oauth_states, google_business_accounts, google_business_locations, workspace_google_business_locations, google_business_reviews, google_business_review_sync_status, google_business_review_responses, google_business_review_response_events, google_business_review_reply_publish_attempts, client_deliverable, activities
 */
import { Router } from 'express';

import { addActivity } from '../activity-log.js';
import { requireWorkspaceAccess, requireWorkspaceAccessFromQuery } from '../auth.js';
import { broadcastToWorkspace } from '../broadcast.js';
import {
  createGbpAuthUrl,
  disconnectGbp,
  exchangeGbpOAuthCode,
  syncGbpAccountsAndLocations,
  syncWorkspaceGbpReviews,
} from '../google-business-profile-client.js';
import {
  getGbpConnectionSafe,
  getWorkspaceGbpMappingRead,
  listGbpAccounts,
  listGbpLocations,
  listGbpMappedWorkspaceIds,
  replaceWorkspaceGbpMappings,
} from '../google-business-profile-store.js';
import {
  consumeGbpOAuthState,
  createGbpOAuthState,
} from '../google-business-profile-oauth-state.js';
import { isFeatureEnabled } from '../feature-flags.js';
import {
  getWorkspaceGbpAuthenticatedReviews,
} from '../google-business-profile-reviews-store.js';
import { generateGbpReviewResponseDraft } from '../google-business-profile-review-response-ai.js';
import { startPublishForApprovedResponse } from '../google-business-profile-review-response-publish-job.js';
import {
  assertGbpReviewResponseSendable,
  GbpReviewResponseError,
  getGbpReviewContextForDraft,
  getGbpReviewResponse,
  listGbpReviewResponseWorkflow,
  markGbpReviewResponseSent,
  recordGbpReviewResponseDecision,
  updateGbpReviewResponseDraft,
  upsertGbpReviewResponseDraft,
} from '../google-business-profile-review-responses-store.js';
import {
  googleBusinessProfileProviderErrorMessage as googleProviderMessage,
  googleBusinessProfileProviderResponseStatus as googleProviderStatus,
} from '../google-business-profile-errors.js';
import { isGoogleProviderError } from '../google-provider-client.js';
import { createLogger } from '../logger.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
import { validate, z } from '../middleware/validate.js';
import { sendToClient } from '../domains/inbox/send-to-client.js';
import { WS_EVENTS } from '../ws-events.js';
import { type WorkspaceGbpMappingsUpdateRequest } from '../../shared/types/google-business-profile.js';

const router = Router();
const FLAG = 'gbp-auth-connection';
const log = createLogger('google-business-profile-routes');

const authUrlQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  returnTo: z.string().max(500).optional(),
}).strict();

const mappingBodySchema = z.object({
  mappings: z.array(z.object({
    clientLocationId: z.string().min(1),
    googleLocationId: z.string().min(1),
    isPrimary: z.boolean().optional(),
  }).strict()).max(100),
}).strict();

const reviewResponseDraftSchema = z.object({
  reviewResourceName: z.string().min(1).max(500),
}).strict();

const reviewResponseUpdateSchema = z.object({
  draftText: z.string().trim().min(20).max(1500),
}).strict();

const reviewResponseSendSchema = z.object({
  note: z.string().max(1000).optional(),
}).strict();

function featureEnabled(workspaceId?: string): boolean {
  return isFeatureEnabled(FLAG, workspaceId);
}

function responseFeatureEnabled(workspaceId: string): boolean {
  return featureEnabled(workspaceId)
    && isFeatureEnabled('gbp-auth-reviews', workspaceId)
    && isFeatureEnabled('gbp-review-responses', workspaceId);
}

function broadcastGbpReviewResponseChange(workspaceId: string, action: string, responseId?: string): void {
  broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_REVIEW_RESPONSES_UPDATED, {
    workspaceId,
    action,
    ...(responseId ? { responseId } : {}),
    updatedAt: new Date().toISOString(),
  });
}

function handleReviewResponseError(error: unknown, res: import('express').Response): boolean {
  if (error instanceof GbpReviewResponseError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

function safeReturnTo(returnTo?: string, workspaceId?: string): string {
  if (returnTo && workspaceId && returnTo.startsWith(`/ws/${workspaceId}/`)) return returnTo;
  if (returnTo && !workspaceId && returnTo.startsWith('/ws/')) return returnTo;
  return workspaceId ? `/ws/${workspaceId}/workspace-settings?tab=connections` : '/';
}

function withStatusParam(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}gbp=connected`;
}

function broadcastGbpConnectionChange(action: string, workspaceId?: string): void {
  const workspaceIds = new Set(listGbpMappedWorkspaceIds());
  if (workspaceId) workspaceIds.add(workspaceId);
  const updatedAt = new Date().toISOString();
  for (const id of workspaceIds) {
    broadcastToWorkspace(id, WS_EVENTS.GBP_CONNECTION_UPDATED, {
      workspaceId: id,
      action,
      updatedAt,
    });
  }
}

router.get('/api/google-business-profile/status', requireAdminAuth, (_req, res) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
  res.json(getGbpConnectionSafe());
});

router.get(
  '/api/google-business-profile/auth-url',
  requireAdminAuth,
  requireWorkspaceAccessFromQuery('workspaceId'),
  (req, res) => {
    const queryResult = authUrlQuerySchema.safeParse(req.query);
    if (!queryResult.success) return res.status(400).json({ error: queryResult.error.issues[0]?.message ?? 'Invalid query' });
    const workspaceId = req.query.workspaceId as string | undefined;
    if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
    const state = createGbpOAuthState({
      workspaceId,
      returnTo: safeReturnTo(req.query.returnTo as string | undefined, workspaceId),
    });
    res.json({ url: createGbpAuthUrl(state) });
  },
);

router.get('/api/google-business-profile/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state) {
    return res.status(400).send('Missing Google Business Profile OAuth callback parameters.');
  }

  try {
    const payload = consumeGbpOAuthState(state);
    if (!featureEnabled()) {
      throw new Error('Google Business Profile connection is not enabled');
    }
    await exchangeGbpOAuthCode(code);
    try {
      await syncGbpAccountsAndLocations();
    } catch (err) {
      log.warn({ err }, 'Google Business Profile post-auth discovery sync failed');
    }
    broadcastGbpConnectionChange('connected', payload.workspaceId);
    return res.redirect(withStatusParam(safeReturnTo(payload.returnTo, payload.workspaceId)));
  } catch (error) {
    return res.status(400).send(error instanceof Error ? error.message : 'Google Business Profile OAuth failed.');
  }
});

router.post('/api/google-business-profile/sync', requireAdminAuth, requireWorkspaceAccessFromQuery('workspaceId'), async (req, res, next) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
  try {
    const payload = await syncGbpAccountsAndLocations();
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    broadcastGbpConnectionChange('discovery_synced', workspaceId);
    res.json(payload);
  } catch (error) {
    if (isGoogleProviderError(error)) {
      log.error({ err: error }, 'Google Business Profile discovery sync failed');
      return res.status(googleProviderStatus(error)).json({
        error: googleProviderMessage(error),
        providerKind: error.kind,
        ...(typeof error.status === 'number' ? { providerStatus: error.status } : {}),
      });
    }
    next(error);
  }
});

router.get(
  '/api/google-business-profile/workspaces/:workspaceId/reviews',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!featureEnabled(workspaceId)) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
    if (!isFeatureEnabled('gbp-auth-reviews', req.params.workspaceId)) {
      return res.status(404).json({ error: 'Authenticated Google Business Profile reviews are not enabled' });
    }
    res.json(getWorkspaceGbpAuthenticatedReviews(workspaceId));
  },
);

router.post(
  '/api/google-business-profile/workspaces/:workspaceId/reviews/sync',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  async (req, res, next) => {
    const { workspaceId } = req.params;
    if (!featureEnabled(workspaceId)) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
    if (!isFeatureEnabled('gbp-auth-reviews', workspaceId)) {
      return res.status(404).json({ error: 'Authenticated Google Business Profile reviews are not enabled' });
    }
    try {
      const payload = await syncWorkspaceGbpReviews(workspaceId);
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile reviews synced',
        `${payload.reviewCount} authenticated GBP review${payload.reviewCount === 1 ? '' : 's'} synced across ${payload.locationCount} mapped location${payload.locationCount === 1 ? '' : 's'}`,
        { source: 'google_business_profile', reviewCount: payload.reviewCount, locationCount: payload.locationCount },
      );
      broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_REVIEWS_UPDATED, {
        workspaceId,
        action: 'reviews_synced',
        updatedAt: payload.syncedAt,
      });
      res.json(payload);
    } catch (error) {
      const updatedAt = new Date().toISOString();
      const safeErrorMessage = isGoogleProviderError(error)
        ? googleProviderMessage(error)
        : 'Authenticated GBP review sync could not complete';
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile review sync failed',
        'Authenticated GBP review sync could not complete. Check Google API access and connection health.',
        { source: 'google_business_profile', error: safeErrorMessage },
      );
      broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_REVIEWS_UPDATED, {
        workspaceId,
        action: 'reviews_sync_failed',
        updatedAt,
      });
      if (isGoogleProviderError(error)) {
        log.error({ err: error }, 'Google Business Profile review sync failed');
        return res.status(googleProviderStatus(error)).json({
          error: googleProviderMessage(error),
          providerKind: error.kind,
          ...(typeof error.status === 'number' ? { providerStatus: error.status } : {}),
        });
      }
      next(error);
    }
  },
);

router.get(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    res.json(listGbpReviewResponseWorkflow(workspaceId));
  },
);

router.post(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses/draft',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  validate(reviewResponseDraftSchema),
  async (req, res, next) => {
    const { workspaceId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    const body = req.body as { reviewResourceName: string };
    try {
      const review = getGbpReviewContextForDraft(workspaceId, body.reviewResourceName);
      const draftText = await generateGbpReviewResponseDraft({ workspaceId, review });
      const response = upsertGbpReviewResponseDraft({
        workspaceId,
        reviewResourceName: body.reviewResourceName,
        draftText,
        actor: { type: 'admin' },
      });
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile review reply drafted',
        'A draft response was generated for an unanswered Google Business Profile review.',
        { source: 'google_business_profile', responseId: response.id },
      );
      broadcastGbpReviewResponseChange(workspaceId, 'drafted', response.id);
      res.json(response);
    } catch (error) {
      if (handleReviewResponseError(error, res)) return;
      next(error);
    }
  },
);

router.patch(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses/:responseId',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  validate(reviewResponseUpdateSchema),
  (req, res, next) => {
    const { workspaceId, responseId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    const body = req.body as { draftText: string };
    try {
      const response = updateGbpReviewResponseDraft({
        workspaceId,
        responseId,
        draftText: body.draftText,
        actor: { type: 'admin' },
      });
      broadcastGbpReviewResponseChange(workspaceId, 'draft_edited', response.id);
      res.json(response);
    } catch (error) {
      if (handleReviewResponseError(error, res)) return;
      next(error);
    }
  },
);

router.post(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses/:responseId/send-to-client',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  validate(reviewResponseSendSchema),
  async (req, res, next) => {
    const { workspaceId, responseId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    const body = req.body as { note?: string };
    try {
      const current = assertGbpReviewResponseSendable(workspaceId, responseId);
      const deliverable = await sendToClient(
        workspaceId,
        'gbp_review_response',
        { response: current },
        { note: body.note ?? null, source: 'google_business_profile' },
      );
      const response = markGbpReviewResponseSent({
        workspaceId,
        responseId,
        deliverableId: deliverable.id,
        actor: { type: 'admin' },
        note: body.note,
      });
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile review reply sent',
        'A Google Business Profile review response was sent to the client for approval.',
        { source: 'google_business_profile', responseId, deliverableId: deliverable.id },
      );
      broadcastGbpReviewResponseChange(workspaceId, 'sent_to_client', responseId);
      res.json({ response, deliverable });
    } catch (error) {
      if (handleReviewResponseError(error, res)) return;
      next(error);
    }
  },
);

router.post(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses/:responseId/approve-and-publish',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  (req, res, next) => {
    const { workspaceId, responseId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    try {
      const response = recordGbpReviewResponseDecision({
        workspaceId,
        responseId,
        status: 'approved',
        actor: { type: 'admin' },
      });
      const { jobId } = startPublishForApprovedResponse(workspaceId, responseId);
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile review reply approved',
        'An admin approved a Google Business Profile review response for publishing.',
        { source: 'google_business_profile', responseId, jobId },
      );
      broadcastGbpReviewResponseChange(workspaceId, 'admin_approved', responseId);
      res.json({ response, jobId });
    } catch (error) {
      if (handleReviewResponseError(error, res)) return;
      next(error);
    }
  },
);

router.post(
  '/api/google-business-profile/workspaces/:workspaceId/review-responses/:responseId/retry-publish',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  (req, res, next) => {
    const { workspaceId, responseId } = req.params;
    if (!responseFeatureEnabled(workspaceId)) {
      return res.status(404).json({ error: 'Google Business Profile review responses are not enabled' });
    }
    try {
      const response = getGbpReviewResponse(workspaceId, responseId);
      if (!response) return res.status(404).json({ error: 'Review response not found' });
      const { jobId } = startPublishForApprovedResponse(workspaceId, responseId);
      broadcastGbpReviewResponseChange(workspaceId, 'publish_retried', responseId);
      res.json({ response, jobId });
    } catch (error) {
      if (handleReviewResponseError(error, res)) return;
      next(error);
    }
  },
);

router.post('/api/google-business-profile/disconnect', requireAdminAuth, requireWorkspaceAccessFromQuery('workspaceId'), async (req, res, next) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    await disconnectGbp();
    broadcastGbpConnectionChange('disconnected', workspaceId);
    res.json(getGbpConnectionSafe());
  } catch (error) {
    next(error);
  }
});

router.get('/api/google-business-profile/accounts', requireAdminAuth, (_req, res) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
  res.json(listGbpAccounts());
});

router.get('/api/google-business-profile/locations', requireAdminAuth, (_req, res) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
  res.json(listGbpLocations());
});

router.get(
  '/api/google-business-profile/workspaces/:workspaceId/mappings',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
    res.json(getWorkspaceGbpMappingRead(req.params.workspaceId));
  },
);

router.put(
  '/api/google-business-profile/workspaces/:workspaceId/mappings',
  requireAdminAuth,
  requireWorkspaceAccess('workspaceId'),
  validate(mappingBodySchema),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!featureEnabled()) return res.status(404).json({ error: 'Google Business Profile connection is not enabled' });
    const body = req.body as WorkspaceGbpMappingsUpdateRequest;
    try {
      const payload = replaceWorkspaceGbpMappings(workspaceId, body.mappings);
      const updatedAt = new Date().toISOString();
      addActivity(
        workspaceId,
        'local_seo_updated',
        'Google Business Profile locations mapped',
        `${payload.mappings.length} GBP location${payload.mappings.length === 1 ? '' : 's'} mapped to workspace locations`,
        { source: 'google_business_profile', mappedLocationCount: payload.mappings.length },
      );
      broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_CONNECTION_UPDATED, {
        workspaceId,
        action: 'mappings_updated',
        updatedAt,
      });
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update GBP mappings' });
    }
  },
);

export default router;
