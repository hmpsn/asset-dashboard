/**
 * annotations routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { listAnnotations, addAnnotation, deleteAnnotation } from '../annotations.js';

// --- Annotations ---
// Public: list annotations for a workspace
router.get('/api/public/annotations/:workspaceId', (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: list annotations
router.get('/api/annotations/:workspaceId', (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: add annotation
router.post('/api/annotations/:workspaceId', (req, res) => {
  const { date, label, description, color } = req.body;
  if (!date || !label) return res.status(400).json({ error: 'date and label required' });
  res.json(addAnnotation(req.params.workspaceId, date, label, description, color));
});

// Internal: delete annotation
router.delete('/api/annotations/:workspaceId/:id', (req, res) => {
  deleteAnnotation(req.params.workspaceId, req.params.id);
  res.json({ ok: true });
});

export default router;
