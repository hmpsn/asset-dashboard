/**
 * Google Business Profile integration routes.
 *
 * @reads google_oauth_connections, google_business_accounts, google_business_locations, workspace_google_business_locations, client_locations
 * @writes google_oauth_connections, google_business_profile_oauth_states, google_business_accounts, google_business_locations, workspace_google_business_locations, activities
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
  googleBusinessProfileProviderErrorMessage,
  googleBusinessProfileProviderResponseStatus,
} from '../google-business-profile-errors.js';
import { isGoogleProviderError } from '../google-provider-client.js';
import { createLogger } from '../logger.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
import { validate, z } from '../middleware/validate.js';
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

function featureEnabled(): boolean {
  return isFeatureEnabled(FLAG);
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
      return res.status(googleBusinessProfileProviderResponseStatus(error)).json({
        error: googleBusinessProfileProviderErrorMessage(error),
        providerKind: error.kind,
        ...(typeof error.status === 'number' ? { providerStatus: error.status } : {}),
      });
    }
    next(error);
  }
});

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
