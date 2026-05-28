/**
 * E-E-A-T assets routes.
 *
 * @reads eeat_assets
 * @writes eeat_assets, activities, intelligence_cache
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { addActivity } from '../activity-log.js';
import {
  createEeatAsset,
  deleteEeatAsset,
  getEeatAsset,
  listEeatAssets,
  updateEeatAsset,
} from '../eeat-assets.js';
import { validate } from '../middleware/validate.js';
import {
  createEeatAssetSchema,
  updateEeatAssetSchema,
} from '../schemas/eeat-assets.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';

const router = Router();

router.get('/api/workspaces/:workspaceId/eeat-assets', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listEeatAssets(req.params.workspaceId));
});

router.get('/api/workspaces/:workspaceId/eeat-assets/:assetId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const asset = getEeatAsset(req.params.workspaceId, req.params.assetId);
  if (!asset) return res.status(404).json({ error: 'E-E-A-T asset not found' });
  res.json(asset);
});

router.post(
  '/api/workspaces/:workspaceId/eeat-assets',
  requireWorkspaceAccess('workspaceId'),
  validate(createEeatAssetSchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const asset = runWorkspaceMutation({
        workspaceId,
        defaultErrorMessage: 'Failed to create E-E-A-T asset',
        mutate: () => createEeatAsset(workspaceId, req.body),
        onActivity: ({ workspaceId: wsId, result }) => {
          addActivity(
            wsId,
            'eeat_asset_created',
            `E-E-A-T asset added: ${result.title}`,
            `${result.type}`,
            { assetId: result.id, type: result.type },
          );
        },
        onBroadcast: ({ workspaceId: wsId, result }) => {
          invalidateIntelligenceCache(wsId);
          broadcastToWorkspace(wsId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
            workspaceId: wsId,
            assetId: result.id,
            action: 'created',
          });
        },
      });
      res.status(201).json(asset);
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Failed to create E-E-A-T asset' });
    }
  },
);

router.patch(
  '/api/workspaces/:workspaceId/eeat-assets/:assetId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateEeatAssetSchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      const updated = runWorkspaceMutation({
        workspaceId,
        defaultErrorMessage: 'Failed to update E-E-A-T asset',
        mutate: () => {
          const next = updateEeatAsset(workspaceId, req.params.assetId, req.body);
          if (!next) throw mutationError(404, 'E-E-A-T asset not found');
          return next;
        },
        onActivity: ({ workspaceId: wsId, result }) => {
          addActivity(
            wsId,
            'eeat_asset_updated',
            `E-E-A-T asset updated: ${result.title}`,
            `${result.type}`,
            { assetId: result.id, type: result.type },
          );
        },
        onBroadcast: ({ workspaceId: wsId, result }) => {
          invalidateIntelligenceCache(wsId);
          broadcastToWorkspace(wsId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
            workspaceId: wsId,
            assetId: result.id,
            action: 'updated',
          });
        },
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Failed to update E-E-A-T asset' });
    }
  },
);

router.delete('/api/workspaces/:workspaceId/eeat-assets/:assetId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    runWorkspaceMutation({
      workspaceId,
      defaultErrorMessage: 'Failed to delete E-E-A-T asset',
      readBeforeWrite: () => getEeatAsset(workspaceId, req.params.assetId),
      mutate: ({ existing }) => {
        if (!existing) throw mutationError(404, 'E-E-A-T asset not found');
        const deleted = deleteEeatAsset(workspaceId, req.params.assetId);
        if (!deleted) throw mutationError(500, 'Failed to delete E-E-A-T asset');
        return existing;
      },
      onActivity: ({ workspaceId: wsId, result }) => {
        addActivity(
          wsId,
          'eeat_asset_deleted',
          `E-E-A-T asset deleted: ${result.title}`,
          `${result.type}`,
          { assetId: result.id, type: result.type },
        );
      },
      onBroadcast: ({ workspaceId: wsId, result }) => {
        invalidateIntelligenceCache(wsId);
        broadcastToWorkspace(wsId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
          workspaceId: wsId,
          assetId: result.id,
          action: 'deleted',
        });
      },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to delete E-E-A-T asset' });
  }
});

export default router;
