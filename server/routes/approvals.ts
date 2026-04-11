/**
 * approvals routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import type * as EmailTemplates from '../email-templates.js';
import type * as Email from '../email.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { canSend, recordSend } from '../email-throttle.js';
import {
  createBatch,
  listBatches,
  getBatch,
  updateItem,
  markBatchApplied,
  deleteBatch,
} from '../approvals.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { notifyApprovalReady } from '../email.js';
import { getClientActor, requireClientPortalAuth } from '../middleware.js';
import {
  updateCollectionItem,
  publishCollectionItems,
  updatePageSeo,
  publishSchemaToPage,
} from '../webflow.js';
import {
  getWorkspace,
  getTokenForSite,
  getClientPortalUrl,
  updatePageState,
  getPageState,
  clearPageState,
} from '../workspaces.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('approvals');

/** Derive the correct page-level edit state from all items targeting that page in a batch. */
function derivePageStatus(batch: import('../../shared/types/approvals').ApprovalBatch, pageId: string): 'in-review' | 'approved' | 'rejected' {
  const pageItems = batch.items.filter(i => i.pageId === pageId);
  const statuses = pageItems.map(i => i.status);
  // Guard: .every() on empty returns true vacuously — default to in-review
  if (statuses.length === 0) return 'in-review';
  if (statuses.every(s => s === 'approved' || s === 'applied')) return 'approved';
  if (statuses.every(s => s === 'rejected')) return 'rejected';
  // Mix of pending/approved/rejected → still in review
  return 'in-review';
}

const createBatchSchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  name: z.string().optional().default('SEO Changes'),
  items: z.array(z.object({
    id: z.string().optional(),
    pageId: z.string(),
    pageSlug: z.string().optional(),
    pageTitle: z.string().optional(),
    field: z.string(),
    currentValue: z.string().optional(),
    proposedValue: z.string().optional(),
    collectionId: z.string().optional(),
  })).min(1, 'At least one item is required'),
});

const updateItemSchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']).optional(),
  clientValue: z.string().optional(),
  clientNote: z.string().max(2000).optional(),
});

// --- Approvals (admin, authenticated) ---
router.post('/api/approvals/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createBatchSchema), (req, res) => {
  const { siteId, name, items } = req.body;
  const batch = createBatch(req.params.workspaceId, siteId, name || 'SEO Changes', items);
  // Track all pages in this batch as in-review
  for (const item of items) {
    if (item.pageId) updatePageState(req.params.workspaceId, item.pageId, { status: 'in-review', fields: [item.field], approvalBatchId: batch.id, updatedBy: 'admin' });
  }
  // Notify client that items are ready for review
  const ws = getWorkspace(req.params.workspaceId);
  if (ws?.clientEmail) {
    const dashUrl = getClientPortalUrl(ws);
    notifyApprovalReady({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: req.params.workspaceId, batchName: batch.name, itemCount: items.length, dashboardUrl: dashUrl });
  }
  broadcastToWorkspace(req.params.workspaceId, 'approval:update', { batchId: batch.id, action: 'created' });
  res.json(batch);
});

router.get('/api/approvals/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listBatches(req.params.workspaceId));
});

router.get('/api/approvals/:workspaceId/:batchId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

router.delete('/api/approvals/:workspaceId/:batchId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, batchId } = req.params;
  // Fetch batch before deleting so we can reset page edit states
  const batch = getBatch(workspaceId, batchId);
  if (batch) {
    for (const item of batch.items) {
      if (item.pageId) {
        // Reset any page still associated with this batch (in-review, approved, or rejected)
        const state = getPageState(workspaceId, item.pageId);
        if (
          (state?.status === 'in-review' || state?.status === 'approved' || state?.status === 'rejected') &&
          state.approvalBatchId === batchId
        ) {
          clearPageState(workspaceId, item.pageId);
        }
      }
    }
  }
  deleteBatch(workspaceId, batchId);
  broadcastToWorkspace(workspaceId, 'approval:update', { batchId, action: 'deleted' });
  res.json({ ok: true });
});

// --- Send Reminder (admin, authenticated) ---
router.post('/api/approvals/:workspaceId/:batchId/remind', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId, batchId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.clientEmail) return res.status(400).json({ error: 'No client email configured for this workspace' });

  const batch = getBatch(workspaceId, batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

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
  res.json(listBatches(req.params.workspaceId));
});

router.get('/api/public/approvals/:workspaceId/:batchId', requireClientPortalAuth(), (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

router.patch('/api/public/approvals/:workspaceId/:batchId/:itemId', requireClientPortalAuth(), validate(updateItemSchema), (req, res, next) => {
  // Only include fields that were actually sent — passing undefined would overwrite existing values
  const update: Partial<Pick<import('../../shared/types/approvals').ApprovalItem, 'status' | 'clientValue' | 'clientNote'>> = {};
  if (req.body.status !== undefined) update.status = req.body.status;
  if (req.body.clientValue !== undefined) update.clientValue = req.body.clientValue;
  if (req.body.clientNote !== undefined) update.clientNote = req.body.clientNote;
  const { status, clientNote } = req.body;
  let batch;
  try {
    batch = updateItem(req.params.workspaceId, req.params.batchId, req.params.itemId, update);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!batch) return res.status(404).json({ error: 'Item not found' });
  // Sync PageEditState when client approves or rejects
  if (status === 'approved' || status === 'rejected') {
    const item = batch.items.find(i => i.id === req.params.itemId);
    if (item) {
      // Aggregate across all items for this page to avoid last-write-wins on multi-field pages
      const pageStatus = derivePageStatus(batch, item.pageId);
      const pageStateResult = updatePageState(req.params.workspaceId, item.pageId, {
        status: pageStatus,
        updatedBy: 'client',
        ...(status === 'rejected' && clientNote ? { rejectionNote: clientNote } : {}),
      });
      if (!pageStateResult) {
        log.warn({ workspaceId: req.params.workspaceId, pageId: item.pageId, status }, 'updatePageState returned null — workspace may not exist in DB');
      } else {
        log.info({ workspaceId: req.params.workspaceId, pageId: item.pageId, status: pageStateResult.status }, 'synced page edit state from approval');
      }
      // Activity feed for client actions
      const actorInfo = getClientActor(req, req.params.workspaceId);
      const actorName = actorInfo?.name || 'Client';
      if (status === 'approved') {
        addActivity(req.params.workspaceId, 'approval_applied',
          `${actorName} approved ${item.field} change on ${item.pageId}`,
          item.proposedValue ? `New value: ${item.proposedValue.slice(0, 80)}` : undefined,
          { batchId: req.params.batchId, itemId: item.id, pageId: item.pageId },
          actorInfo);
      } else {
        addActivity(req.params.workspaceId, 'changes_requested',
          `${actorName} rejected ${item.field} change on ${item.pageId}`,
          clientNote || undefined,
          { batchId: req.params.batchId, itemId: item.id, pageId: item.pageId },
          actorInfo);
      }
    }
  }
  // Handle undo — client reverting their approve/reject decision back to pending
  if (status === 'pending') {
    const item = batch.items.find(i => i.id === req.params.itemId);
    if (item?.pageId) {
      // Aggregate across all items for this page — don't blindly reset to in-review
      const pageStatus = derivePageStatus(batch, item.pageId);
      updatePageState(req.params.workspaceId, item.pageId, {
        status: pageStatus,
        updatedBy: 'client',
        ...(pageStatus === 'in-review' ? { rejectionNote: '' } : {}),
      });
      const actorInfo = getClientActor(req, req.params.workspaceId);
      addActivity(req.params.workspaceId, 'approval_reverted',
        `${actorInfo?.name || 'Client'} reverted ${item.field} decision on ${item.pageTitle || item.pageId}`,
        undefined,
        { batchId: req.params.batchId, itemId: item.id, pageId: item.pageId },
        actorInfo);
    }
  }
  broadcastToWorkspace(req.params.workspaceId, 'approval:update', { batchId: req.params.batchId, itemId: req.params.itemId, status });
  res.json(batch);
});

// Apply approved items to Webflow
router.post('/api/public/approvals/:workspaceId/:batchId/apply', requireClientPortalAuth(), async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const token = getTokenForSite(ws.webflowSiteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No Webflow API token' });

  const approved = batch.items.filter(i => i.status === 'approved');
  if (!approved.length) return res.status(400).json({ error: 'No approved items to apply' });

  const results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }> = [];
  const appliedIds: string[] = [];

  for (const item of approved) {
    try {
      // Guard: synthetic CMS IDs (format 'cms-*') come from sitemap discovery and are
      // not real Webflow page or collection-item IDs. Attempting to write them via the
      // Webflow API produces a silent 404. Fail fast with a clear message so the
      // approval record correctly reflects 'not applied' rather than a phantom success.
      if (item.pageId.startsWith('cms-')) {
        throw new Error('CMS pages discovered via sitemap must be updated directly in Webflow — synthetic page ID cannot be written via the API');
      }
      const value = item.clientValue || item.proposedValue;
      if (item.field === 'schema') {
        // Schema item — publish JSON-LD to page via schema publisher
        const schema = parseJsonFallback(value, null);
        if (!schema) throw new Error('Invalid schema JSON');
        const result = await publishSchemaToPage(ws.webflowSiteId, item.pageId, schema, token);
        if (!result.success) throw new Error(result.error || 'Schema publish failed');
      } else if (item.collectionId) {
        // CMS item approval (from CmsEditor) — pageId here is a CMS item ID from the
        // CMS Items API, not a Webflow page ID. collectionId is the collection it belongs to.
        // This branch must NOT be triggered from SeoEditor: SeoEditor's pageId is a Webflow
        // page ID, and a page's collectionId means "renders this collection" — not "is an
        // item in this collection". SeoEditor omits collectionId from approval items to
        // ensure static pages always fall through to updatePageSeo below.
        const result = await updateCollectionItem(item.collectionId, item.pageId, { [item.field]: value }, token);
        if (!result.success) throw new Error(result.error || 'CMS update failed');
        const pubResult = await publishCollectionItems(item.collectionId, [item.pageId], token);
        if (!pubResult.success) log.warn(`CMS publish warning for ${item.pageId}: ${pubResult.error}`);
      } else {
        // Static page — update via page SEO API (SeoEditor approval flow)
        const fields = item.field === 'seoTitle'
          ? { seo: { title: value } }
          : { seo: { description: value } };
        const seoResult = await updatePageSeo(item.pageId, fields, token);
        if (!seoResult.success) throw new Error(seoResult.error || 'SEO update failed');
      }
      appliedIds.push(item.id);
      results.push({ itemId: item.id, pageId: item.pageId, success: true });
    } catch (err) {
      results.push({ itemId: item.id, pageId: item.pageId, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (appliedIds.length > 0) {
    markBatchApplied(req.params.workspaceId, req.params.batchId, appliedIds);
    // Mark applied pages as live in edit tracking + record SEO changes
    for (const r of results) {
      if (r.success) {
        updatePageState(req.params.workspaceId, r.pageId, { status: 'live', updatedBy: 'admin' });
        const appliedItem = approved.find(i => i.id === r.itemId);
        if (appliedItem && (appliedItem.field === 'seoTitle' || appliedItem.field === 'seoDescription' || appliedItem.field === 'schema')) {
          const fieldName = appliedItem.field === 'seoTitle' ? 'title' : appliedItem.field === 'seoDescription' ? 'description' : 'schema';
          recordSeoChange(req.params.workspaceId, r.pageId, appliedItem.pageSlug || '', appliedItem.pageTitle || '', [fieldName], 'approval');
        }
      }
    }
    // Log activity
    const batchData = getBatch(req.params.workspaceId, req.params.batchId);
    addActivity(req.params.workspaceId, 'approval_applied',
      `Applied ${appliedIds.length} approved SEO changes`,
      batchData ? `Batch: ${batchData.name}` : undefined,
      { batchId: req.params.batchId, appliedCount: appliedIds.length });
  }

  broadcastToWorkspace(req.params.workspaceId, 'approval:applied', { batchId: req.params.batchId, applied: appliedIds.length });

  // Record for outcome tracking — only successfully applied meta updates
  try {
    for (const item of approved.filter(i => appliedIds.includes(i.id))) {
      if (item.field === 'seoTitle' || item.field === 'seoDescription') {
        if (getActionBySource('approval', item.id)) continue;
        const action = recordAction({ // recordAction-ok — workspaceId is from route param, always valid
          workspaceId: req.params.workspaceId,
          actionType: 'meta_updated',
          sourceType: 'approval',
          sourceId: item.id,
          pageUrl: item.pageSlug ? `/${item.pageSlug}` : null,
          targetKeyword: null,
          baselineSnapshot: {
            captured_at: new Date().toISOString(),
          },
          attribution: 'platform_executed',
        });
        if (item.pageSlug) {
          void captureBaselineFromGsc(action.id, req.params.workspaceId, `/${item.pageSlug}`);
        }
      }
    }
  } catch (err) {
    log.warn({ err, batchId: req.params.batchId }, 'Failed to record outcome action for approval apply');
  }

  res.json({ results, applied: appliedIds.length, failed: results.length - appliedIds.length });
});

export default router;
