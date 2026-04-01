/**
 * Suggested briefs API routes — CRUD for AI-generated content brief suggestions.
 */
import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  listSuggestedBriefs,
  getSuggestedBrief,
  updateSuggestedBrief,
  dismissSuggestedBrief,
  snoozeSuggestedBrief,
} from '../suggested-briefs-store.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';

const router = Router();

// List suggested briefs for workspace
router.get(
  '/api/suggested-briefs/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const includeAll = req.query.all === 'true';
    const briefs = listSuggestedBriefs(req.params.workspaceId, includeAll);
    res.json(briefs);
  },
);

// Get single suggested brief
router.get(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const brief = getSuggestedBrief(req.params.briefId, req.params.workspaceId);
    if (!brief) return res.status(404).json({ error: 'Suggested brief not found' });
    res.json(brief);
  },
);

const updateSchema = z.object({
  status: z.enum(['accepted', 'dismissed']),
});

// Update status (accept/dismiss)
router.patch(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateSchema),
  (req, res) => {
    const updated = updateSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.status);
    if (!updated) return res.status(404).json({ error: 'Suggested brief not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: updated.id, status: updated.status });
    res.json(updated);
  },
);

const snoozeSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Snooze
router.post(
  '/api/suggested-briefs/:workspaceId/:briefId/snooze',
  requireWorkspaceAccess('workspaceId'),
  validate(snoozeSchema),
  (req, res) => {
    const snoozed = snoozeSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.until);
    if (!snoozed) return res.status(404).json({ error: 'Suggested brief not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: snoozed.id, status: snoozed.status });
    res.json(snoozed);
  },
);

// Dismiss
router.post(
  '/api/suggested-briefs/:workspaceId/:briefId/dismiss',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const dismissed = dismissSuggestedBrief(req.params.briefId, req.params.workspaceId);
    if (!dismissed) return res.status(404).json({ error: 'Suggested brief not found' });
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: dismissed.id, status: dismissed.status });
    res.json(dismissed);
  },
);

export default router;
