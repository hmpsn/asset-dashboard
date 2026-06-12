/**
 * approvals routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import type * as EmailTemplates from '../email-templates.js';
import type * as Email from '../email.js';
const router = Router();

import { canSend, recordSend } from '../email-throttle.js';
import {
  listBatches,
  listBatchesPaged,
  getBatch,
} from '../approvals.js';
import { parsePaginationParams } from '../pagination.js';
import {
  createApprovalBatchForClient,
  deleteApprovalBatchForClient,
} from '../domains/inbox/approval-batch-admin-mutations.js';
import { applyApprovedBatchItems } from '../domains/inbox/approval-batch-apply.js';
import { respondToApprovalBatch, respondToApprovalBatchItem } from '../domains/inbox/approval-batch-response-lifecycle.js';
import { createLogger } from '../logger.js';
import { getClientActor, requireClientPortalAuth } from '../middleware.js';
import {
  getWorkspace,
  getClientPortalUrl,
} from '../workspaces.js';
import { validate, z } from '../middleware/validate.js';
import { toClientInboxApprovalBatch, toClientInboxApprovalBatches } from '../serializers/client-safe.js';

const log = createLogger('approvals');

const createBatchSchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  name: z.string().optional().default('SEO Changes'),
  note: z.string().max(2000).optional(),
  items: z.array(z.object({
    id: z.string().optional(),
    pageId: z.string(),
    pageSlug: z.string().optional(),
    publishedPath: z.string().nullable().optional(),
    pageTitle: z.string().optional(),
    field: z.string(),
    currentValue: z.string().optional(),
    proposedValue: z.string().optional(),
    collectionId: z.string().optional(),
  }).strict()).min(1, 'At least one item is required'),
}).strict();

const updateItemSchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']).optional(),
  clientValue: z.string().optional(),
  clientNote: z.string().max(2000).optional(),
}).strict();

// --- Approvals (admin, authenticated) ---
router.post('/api/approvals/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createBatchSchema), (req, res) => { // no-broadcast-ok: createApprovalBatchForClient owns approval update broadcasts
  const { siteId, name, note, items } = req.body;
  const batch = createApprovalBatchForClient({
    workspaceId: req.params.workspaceId,
    siteId,
    name: name || 'SEO Changes',
    note,
    items,
  });
  res.json(batch);
});

router.get('/api/approvals/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(toClientInboxApprovalBatches(listBatches(req.params.workspaceId)));
});

router.get('/api/approvals/:workspaceId/:batchId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(toClientInboxApprovalBatch(batch));
});

router.delete('/api/approvals/:workspaceId/:batchId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, batchId } = req.params;
  const result = deleteApprovalBatchForClient(workspaceId, batchId);
  if (!result) return res.status(404).json({ error: 'Batch not found' });
  res.json({ ok: true });
});

// --- Send Reminder (admin, authenticated) ---
router.post('/api/approvals/:workspaceId/:batchId/remind', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId, batchId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!ws.clientEmail) return res.status(400).json({ error: 'No client email configured for this workspace' });

  const pendingItems = batch.items.filter(i => i.status === 'pending');
  if (pendingItems.length === 0) return res.status(400).json({ error: 'No pending items in this batch' });

  const staleDays = Math.max(1, Math.floor((Date.now() - new Date(batch.createdAt).getTime()) / 86400000));
  const dashUrl = getClientPortalUrl(ws);

  // Throttle check
  const throttle = canSend(ws.clientEmail, 'action');
  if (!throttle.allowed) {
    return res.status(429).json({ error: `Email throttled: ${throttle.reason}. Try again tomorrow.` });
  }

  try {
    const { renderApprovalReminder }: typeof EmailTemplates = await import('../email-templates.js'); // dynamic-import-ok
    const { isEmailConfigured, sendEmail }: typeof Email = await import('../email.js'); // dynamic-import-ok
    if (!isEmailConfigured()) return res.status(400).json({ error: 'Email not configured' });
    const { subject, html } = renderApprovalReminder({ workspaceName: ws.name, batchName: batch.name, pendingCount: pendingItems.length, staleDays, dashboardUrl: dashUrl });
    await sendEmail(ws.clientEmail, subject, html);
    recordSend(ws.clientEmail, 'action', 'approval_reminder', workspaceId, 1);
    log.info({ workspaceId, batchId, clientEmail: ws.clientEmail }, 'Manual approval reminder sent');
    res.json({ ok: true, sentTo: ws.clientEmail });
  } catch (err) {
    log.error({ err }, 'Failed to send reminder');
    res.status(500).json({ error: 'Failed to send reminder email' });
  }
});

// --- Public Approvals (client dashboard, no auth required) ---
router.get('/api/public/approvals/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const pagination = parsePaginationParams(req.query);
  if (!pagination) {
    return res.json(toClientInboxApprovalBatches(listBatches(req.params.workspaceId)));
  }
  const paged = listBatchesPaged(req.params.workspaceId, pagination.limit, pagination.offset);
  return res.json({
    items: toClientInboxApprovalBatches(paged.items),
    pageInfo: { total: paged.total, limit: paged.limit, offset: paged.offset, hasMore: paged.hasMore },
  });
});

router.get('/api/public/approvals/:workspaceId/:batchId', requireClientPortalAuth(), (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(toClientInboxApprovalBatch(batch));
});

const bulkApproveSchema = z.object({
  clientNote: z.string().max(2000).optional(),
}).strict();

// Bulk-approve all pending items in a batch (client submits trust-first approval)
// MUST precede the /:itemId route so 'approve' is not captured as a param.
// Delegates to the shared respondToApprovalBatch service (R2) so this route and the
// unified-inbox respond propagation drive the SAME source write (no divergence).
router.patch('/api/public/approvals/:workspaceId/:batchId/approve', requireClientPortalAuth(), validate(bulkApproveSchema), (req, res, next) => {
  const { workspaceId, batchId } = req.params;
  const { clientNote } = req.body as { clientNote?: string };

  const batch = getBatch(workspaceId, batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const pendingItems = batch.items.filter(i => i.status === 'pending');
  if (pendingItems.length === 0) {
    return res.status(400).json({ error: 'No pending items to approve' });
  }

  let result: ReturnType<typeof respondToApprovalBatch>;
  try {
    // Delegates to the shared respondToApprovalBatch service (R2) so this route and the
    // unified-inbox respond path drive identical source writes. The service wraps its
    // per-item updateItem writes in a db.transaction() (atomic batch decision) and fires
    // the team email + broadcast + activity AFTER, outside the transaction.
    result = respondToApprovalBatch(workspaceId, batchId, 'approved', {
      note: clientNote ?? null,
      actor: getClientActor(req, workspaceId),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!result) return res.status(404).json({ error: 'Batch not found' });

  res.json(result.batch);
});

router.patch('/api/public/approvals/:workspaceId/:batchId/:itemId', requireClientPortalAuth(), validate(updateItemSchema), (req, res, next) => {
  // Only include fields that were actually sent — passing undefined would overwrite existing values
  const update: Partial<Pick<import('../../shared/types/approvals').ApprovalItem, 'status' | 'clientValue' | 'clientNote'>> = {};
  if (req.body.status !== undefined) update.status = req.body.status;
  if (req.body.clientValue !== undefined) update.clientValue = req.body.clientValue;
  if (req.body.clientNote !== undefined) update.clientNote = req.body.clientNote;

  let result;
  try {
    result = respondToApprovalBatchItem({
      workspaceId: req.params.workspaceId,
      batchId: req.params.batchId,
      itemId: req.params.itemId,
      update,
      actor: getClientActor(req, req.params.workspaceId),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!result) return res.status(404).json({ error: 'Item not found' });

  // NOTE: recommendation resolution happens on the APPLY path (the /apply endpoint below),
  // NOT on approve. Approving only changes item status — the change isn't live on the page yet.
  // Resolving here would mark the rec 'completed', and the regen merge preserves 'completed'
  // even when the issue is still detected, so a later failed apply would permanently hide a
  // still-valid recommendation.
  res.json(result.batch);
});

// Apply approved items to Webflow
router.post('/api/public/approvals/:workspaceId/:batchId/apply', requireClientPortalAuth(), async (req, res) => {
  const result = await applyApprovedBatchItems(req.params.workspaceId, req.params.batchId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ results: result.results, applied: result.applied, failed: result.failed });
});

export default router;
