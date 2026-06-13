/**
 * deliverables — thin HTTP adapter for the canonical send-to-client spine.
 *
 * Lives under server/routes/ so pr-check rule #135 (public-route client-portal auth)
 * actually scans it (design §6, audit minor-2). Domain logic lives in
 * server/domains/inbox/send-to-client.ts; this file is the express layer only.
 *
 *   PATCH /api/public/deliverables/:workspaceId/:id/respond   (client)
 *     → requireAuthenticatedClientPortalAuth (DENIES passwordless — this mutates state;
 *       param is :workspaceId, NOT :ws, to avoid the silent-undefined auth bypass, M1).
 *   POST  /api/public/deliverables/:workspaceId/:id/apply     (client)
 *     → canonical apply URL; delegates to the proven approval-batch apply service.
 *   POST  /api/deliverables/:workspaceId/:id/remind            (admin)
 *     → requireWorkspaceAccess (HMAC-gated admin route; never requireAuth — auth conventions).
 *
 * A per-type guard resolver (requireClientCopyReviewAuth for copy, etc.) is added where a
 * type needs stricter client access than the base guard.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import {
  requireAuthenticatedClientPortalAuth,
  requireClientPortalAuth,
  getClientActor,
} from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import {
  respondToDeliverable,
  remindDeliverable,
  SendToClientError,
} from '../domains/inbox/send-to-client.js';
import { applyApprovedBatchItems } from '../domains/inbox/approval-batch-apply.js';
import { SchemaPlanFeedbackConflictError } from '../domains/schema/schema-plan-feedback.js';
import { listClientFacingDeliverables } from '../domains/inbox/unified-inbox-read.js';
import { listAdminDeliverables } from '../domains/inbox/admin-inbox-read.js';
import { getDeliverable } from '../client-deliverables.js';
import { InvalidTransitionError } from '../state-machines.js';
import {
  DELIVERABLE_KINDS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
} from '../../shared/types/client-deliverable.js';
import { DELIVERABLE_STATUS_AXES } from '../../shared/types/admin-deliverable-view.js';

const router = Router();
const log = createLogger('routes:deliverables');

const respondSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested', 'declined']),
    note: z.string().max(2000).optional(),
    // R3 per-item subset (APPROVAL-FAMILY ONLY): the items the client flagged in the detail modal,
    // each carrying the ClientDeliverableItem.id plus the typed flag note. On `approved`, the source
    // write approves the unflagged items and holds the flagged ones ("implement N of M"), persisting
    // the typed note onto each held item. Optional + bounded; ignored on reject decisions and by the
    // client_action family. The deliverable mirror status is still `approved`.
    flaggedItems: z
      .array(z.object({ itemId: z.string(), note: z.string().max(2000).optional() }))
      .max(500)
      .optional(),
    // Item 2 — EDIT-before-approve (APPROVAL-FAMILY ONLY): the per-item edited proposed values the
    // client typed in the inline editor (seoTitle / seoDescription only). Each carries the
    // ClientDeliverableItem.id + the edited value. Persisted as the legacy approval item's
    // `clientValue`, which the Webflow apply path already prefers (`item.clientValue || proposedValue`,
    // approvals.ts). Orthogonal to flaggedItems — a client can edit AND approve the same item.
    // Bounded; ignored on reject decisions and by the client_action family (no typed items).
    editedItems: z
      .array(z.object({ itemId: z.string(), value: z.string().max(5000) }))
      .max(500)
      .optional(),
  })
  .strict();

// Response shape for GET /api/public/deliverables/:workspaceId. A defensive Zod schema asserts
// the assembled list matches the ClientDeliverable contract (drift guard — the assembly mixes
// physical rows + projected adapters, so a drifted projection would surface as a parse failure).
const deliverableItemResponseSchema = z
  .object({
    id: z.string(),
    deliverableId: z.string(),
    status: z.string(),
    targetRef: z.string().nullable(),
    collectionId: z.string().nullable(),
    field: z.string().nullable(),
    currentValue: z.string().nullable(),
    proposedValue: z.string().nullable(),
    clientValue: z.string().nullable(),
    clientNote: z.string().nullable(),
    applyable: z.boolean(),
    itemPayload: z.record(z.unknown()).nullable(),
    sortOrder: z.number(),
    createdAt: z.string(),
  })
  .passthrough();

const deliverableResponseSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    externalRef: z.string().nullable(),
    type: z.enum(DELIVERABLE_TYPES),
    kind: z.enum(DELIVERABLE_KINDS),
    status: z.enum(DELIVERABLE_STATUSES),
    title: z.string(),
    summary: z.string().nullable(),
    payload: z.record(z.unknown()),
    note: z.string().nullable(),
    clientResponseNote: z.string().nullable(),
    parentDeliverableId: z.string().nullable(),
    sentAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    appliedAt: z.string().nullable(),
    generatedAt: z.string().nullable(),
    source: z.string().nullable(),
    sourceRef: z.string().nullable(),
    commentCount: z.number().int().nonnegative().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    items: z.array(deliverableItemResponseSchema).optional(),
  })
  .passthrough();

const deliverablesListResponseSchema = z.object({
  deliverables: z.array(deliverableResponseSchema),
});

// Admin "Client Deliverables" pane response (PR-2b). The same deliverable contract plus the
// operator status axis + derived staleness (annotated in admin-inbox-read.ts). A defensive Zod
// schema asserts the assembled+annotated list before it's served (drift guard — same rationale as
// the client read: the assembly mixes physical rows + projected adapters).
const adminDeliverableViewSchema = deliverableResponseSchema.extend({
  statusAxis: z.enum(DELIVERABLE_STATUS_AXES),
  ageDays: z.number().nullable(),
  stale: z.boolean(),
});

const adminDeliverablesListResponseSchema = z.object({
  deliverables: z.array(adminDeliverableViewSchema),
});

// GET /api/public/deliverables/:workspaceId — the unified client-facing deliverable list (PR-2a).
// Standard public-portal client auth (matches the sibling projected reads like the copy /entries
// endpoint). Returns physical client_deliverable rows + projected copy/content_request, filtered
// to client-facing statuses. The physical table is empty until the Phase-1 send-path cutover, so
// in production this returns only the projected entries — expected and correct.
router.get(
  '/api/public/deliverables/:workspaceId',
  requireClientPortalAuth('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) {
      return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
    }
    try {
      const deliverables = listClientFacingDeliverables(workspaceId);
      const parsed = deliverablesListResponseSchema.safeParse({ deliverables });
      if (!parsed.success) {
        // A drifted projection/row would land here — fail loud rather than serving a malformed
        // client-facing list (the unified inbox renders Approve/Decline against these rows).
        log.error({ workspaceId, issues: parsed.error.issues }, 'unified deliverable list failed response validation');
        return res.status(500).json({ error: 'Failed to assemble deliverables' });
      }
      res.json(parsed.data);
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to list client-facing deliverables');
      res.status(500).json({ error: 'Failed to list deliverables' });
    }
  },
);

// GET /api/deliverables/:workspaceId — the admin "Client Deliverables" pane.
// Admin-only (requireWorkspaceAccess — HMAC-gated, NOT requireAuth per auth conventions). Returns
// EVERY deliverable in the workspace (all statuses, physical + projected) annotated with the
// operator status axis + a derived `stale` flag (design §6). The read is exercised here with
// seeded rows regardless of how the UI arrives at the pane.
router.get(
  '/api/deliverables/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    try {
      const deliverables = listAdminDeliverables(workspaceId);
      const parsed = adminDeliverablesListResponseSchema.safeParse({ deliverables });
      if (!parsed.success) {
        // A drifted projection/row/annotation would land here — fail loud rather than serving a
        // malformed operator list.
        log.error(
          { workspaceId, issues: parsed.error.issues },
          'admin deliverable list failed response validation',
        );
        return res.status(500).json({ error: 'Failed to assemble deliverables' });
      }
      res.json(parsed.data);
    } catch (err) {
      log.error({ err, workspaceId }, 'Failed to list admin deliverables');
      res.status(500).json({ error: 'Failed to list deliverables' });
    }
  },
);

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
      if (err instanceof SchemaPlanFeedbackConflictError) {
        return res.status(err.status).json({ error: err.message, jobId: err.jobId });
      }
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      log.error({ err, workspaceId, id }, 'Failed to respond to deliverable');
      res.status(500).json({ error: 'Failed to respond to deliverable' });
    }
  },
);

// POST /api/public/deliverables/:workspaceId/:id/apply — canonical client apply URL.
// The deliverable is the client-facing object; the legacy approval batch id is resolved server-side
// and delegated to applyApprovedBatchItems so Webflow writes, page-state updates, activity,
// outcome tracking, recommendation resolution, and broadcasts stay in the existing domain service.
router.post(
  '/api/public/deliverables/:workspaceId/:id/apply',
  requireClientPortalAuth('workspaceId'),
  async (req, res) => {
    const { workspaceId, id } = req.params;
    const deliverable = getDeliverable(id);
    if (!deliverable || deliverable.workspaceId !== workspaceId) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const legacyBatchId = deliverable.payload.legacyBatchId;
    if (typeof legacyBatchId !== 'string' || !legacyBatchId) {
      return res.status(400).json({ error: 'Deliverable is missing its approval batch reference' });
    }

    const result = await applyApprovedBatchItems(workspaceId, legacyBatchId);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ results: result.results, applied: result.applied, failed: result.failed });
  },
);

// POST /api/deliverables/:workspaceId/:id/remind — admin re-nudges the client.
router.post(
  '/api/deliverables/:workspaceId/:id/remind',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    const { workspaceId, id } = req.params;
    try {
      const deliverable = await remindDeliverable(workspaceId, id);
      // Data-Flow Rule #4: the sibling respond handler logs activity; a remind is an
      // operator-initiated client-facing nudge, so it must too (NOT client-visible).
      addActivity(
        workspaceId,
        'deliverable_reminded',
        `Reminded client about "${deliverable.title}"`,
        undefined,
        { deliverableId: deliverable.id, type: deliverable.type, status: deliverable.status },
      );
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
