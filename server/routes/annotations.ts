/**
 * annotations routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
const router = Router();

import { listAnnotations, addAnnotation, deleteAnnotation } from '../annotations.js';

// --- Annotations ---
// Public: list annotations for a workspace
router.get('/api/public/annotations/:workspaceId', requireClientPortalAuth(), (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: list annotations
router.get('/api/annotations/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: add annotation
router.post('/api/annotations/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { date, label, description, color } = req.body;
  if (!date || !label) return res.status(400).json({ error: 'date and label required' });
  const annotation = addAnnotation(req.params.workspaceId, date, label, description, color);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
    id: annotation.id,
    action: 'created',
  });
  res.json(annotation);
});

// Internal: delete annotation
router.delete('/api/annotations/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  deleteAnnotation(req.params.workspaceId, req.params.id);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.ANNOTATION_BRIDGE_CREATED, {
    id: req.params.id,
    action: 'deleted',
  });
  res.json({ ok: true });
});

export default router;
