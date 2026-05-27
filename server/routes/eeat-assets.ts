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
    const asset = createEeatAsset(workspaceId, req.body);
    addActivity(
      workspaceId,
      'eeat_asset_created',
      `E-E-A-T asset added: ${asset.title}`,
      `${asset.type}`,
      { assetId: asset.id, type: asset.type },
    );
    invalidateIntelligenceCache(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
      workspaceId,
      assetId: asset.id,
      action: 'created',
    });
    res.status(201).json(asset);
  },
);

router.patch(
  '/api/workspaces/:workspaceId/eeat-assets/:assetId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateEeatAssetSchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    const updated = updateEeatAsset(workspaceId, req.params.assetId, req.body);
    if (!updated) return res.status(404).json({ error: 'E-E-A-T asset not found' });
    addActivity(
      workspaceId,
      'eeat_asset_updated',
      `E-E-A-T asset updated: ${updated.title}`,
      `${updated.type}`,
      { assetId: updated.id, type: updated.type },
    );
    invalidateIntelligenceCache(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
      workspaceId,
      assetId: updated.id,
      action: 'updated',
    });
    res.json(updated);
  },
);

router.delete('/api/workspaces/:workspaceId/eeat-assets/:assetId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const workspaceId = req.params.workspaceId;
  const existing = getEeatAsset(workspaceId, req.params.assetId);
  if (!existing) return res.status(404).json({ error: 'E-E-A-T asset not found' });
  const deleted = deleteEeatAsset(workspaceId, req.params.assetId);
  if (!deleted) return res.status(500).json({ error: 'Failed to delete E-E-A-T asset' });
  addActivity(
    workspaceId,
    'eeat_asset_deleted',
    `E-E-A-T asset deleted: ${existing.title}`,
    `${existing.type}`,
    { assetId: existing.id, type: existing.type },
  );
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.EEAT_ASSETS_UPDATED, {
    workspaceId,
    assetId: existing.id,
    action: 'deleted',
  });
  res.json({ ok: true });
});

export default router;
