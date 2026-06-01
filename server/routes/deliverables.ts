/**
 * deliverables — thin HTTP adapter for the unified send-to-client spine (Phase 0, dark).
 *
 * Lives under server/routes/ so pr-check rule #135 (public-route client-portal auth)
 * actually scans it (design §6, audit minor-2). Domain logic lives in
 * server/domains/inbox/send-to-client.ts; this file is the express layer only.
 *
 *   PATCH /api/public/deliverables/:workspaceId/:id/respond   (client)
 *     → requireAuthenticatedClientPortalAuth (DENIES passwordless — this mutates state;
 *       param is :workspaceId, NOT :ws, to avoid the silent-undefined auth bypass, M1).
 *   POST  /api/deliverables/:workspaceId/:id/remind            (admin)
 *     → requireWorkspaceAccess (HMAC-gated admin route; never requireAuth — auth conventions).
 *
 * A per-type guard resolver (requireClientCopyReviewAuth for copy, etc.) is added when
 * those types cut over in Phase 1d/1e; Phase 0 ships the single base guard.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { requireAuthenticatedClientPortalAuth, getClientActor } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import {
  respondToDeliverable,
  remindDeliverable,
  SendToClientError,
} from '../domains/inbox/send-to-client.js';
import { InvalidTransitionError } from '../state-machines.js';

const router = Router();
const log = createLogger('routes:deliverables');

const respondSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested', 'declined']),
    note: z.string().max(2000).optional(),
  })
  .strict();

// PATCH /api/public/deliverables/:workspaceId/:id/respond — client responds to a deliverable.
router.patch(
  '/api/public/deliverables/:workspaceId/:id/respond',
  requireAuthenticatedClientPortalAuth('workspaceId'),
  validate(respondSchema),
  async (req, res) => {
    const { workspaceId, id } = req.params;
    const actor = getClientActor(req, workspaceId);
    try {
      const updated = await respondToDeliverable(workspaceId, id, req.body);
      addActivity(
        workspaceId,
        'deliverable_responded',
        `Client ${updated.status} "${updated.title}"`,
        updated.clientResponseNote ?? undefined,
        { deliverableId: updated.id, type: updated.type, decision: req.body.decision },
        actor,
      );
      res.json(updated);
    } catch (err) {
      if (err instanceof SendToClientError) {
        return res.status(err.status).json({ error: err.message });
      }
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      log.error({ err, workspaceId, id }, 'Failed to respond to deliverable');
      res.status(500).json({ error: 'Failed to respond to deliverable' });
    }
  },
);

// POST /api/deliverables/:workspaceId/:id/remind — admin re-nudges the client.
router.post(
  '/api/deliverables/:workspaceId/:id/remind',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, id } = req.params;
    try {
      const deliverable = remindDeliverable(workspaceId, id);
      res.json(deliverable);
    } catch (err) {
      if (err instanceof SendToClientError) {
        return res.status(err.status).json({ error: err.message });
      }
      log.error({ err, workspaceId, id }, 'Failed to remind deliverable');
      res.status(500).json({ error: 'Failed to remind deliverable' });
    }
  },
);

export default router;
