import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listDeliverables, getDeliverable,
  generateDeliverable, refineDeliverable,
  approveDeliverable, exportDeliverables,
} from '../brand-identity.js';
import type { DeliverableType, DeliverableTier } from '../../shared/types/brand-engine.js';

const router = Router();

// List deliverables (all or by tier)
router.get('/api/brand-identity/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const tier = req.query.tier as DeliverableTier | undefined;
  res.json(listDeliverables(req.params.workspaceId, tier));
});

// Export approved deliverables as markdown — MUST be before /:id to avoid shadowing
router.get('/api/brand-identity/:workspaceId/export', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const tier = req.query.tier as DeliverableTier | undefined;
  const markdown = exportDeliverables(req.params.workspaceId, tier);
  res.type('text/markdown').send(markdown);
});

// Get single deliverable with version history
router.get('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = getDeliverable(req.params.workspaceId, req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// Generate a deliverable
router.post('/api/brand-identity/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { deliverableType } = req.body;
  if (!deliverableType) return res.status(400).json({ error: 'deliverableType required' });
  try {
    const result = await generateDeliverable(req.params.workspaceId, deliverableType as DeliverableType);
    addActivity(req.params.workspaceId, 'brand_deliverable_generated', `Generated ${deliverableType.replace(/_/g, ' ')} deliverable`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// Refine a deliverable with steering direction
router.post('/api/brand-identity/:workspaceId/:id/refine', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { direction } = req.body;
  if (!direction) return res.status(400).json({ error: 'direction required' });
  try {
    const result = await refineDeliverable(req.params.workspaceId, req.params.id, direction);
    if (!result) return res.status(404).json({ error: 'Not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

// Update status (approve / reset to draft)
router.patch('/api/brand-identity/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { status } = req.body;
  if (status === 'approved') {
    const result = approveDeliverable(req.params.workspaceId, req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    addActivity(req.params.workspaceId, 'brand_deliverable_approved', `Approved ${result.deliverableType.replace(/_/g, ' ')} deliverable`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRAND_IDENTITY_UPDATED, { deliverableId: req.params.id, status: 'approved' });
    return res.json(result);
  }
  return res.status(400).json({ error: 'Only status "approved" is supported via PATCH' });
});

export default router;
