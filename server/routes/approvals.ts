/**
 * approvals routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
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
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('approvals');

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
    const { renderApprovalReminder } = await import('../email-templates.js');
    const { isEmailConfigured, sendEmail } = await import('../email.js');
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

router.patch('/api/public/approvals/:workspaceId/:batchId/:itemId', requireClientPortalAuth(), validate(updateItemSchema), (req, res) => {
  // Only include fields that were actually sent — passing undefined would overwrite existing values
  const update: Partial<Pick<import('../../shared/types/approvals').ApprovalItem, 'status' | 'clientValue' | 'clientNote'>> = {};
  if (req.body.status !== undefined) update.status = req.body.status;
  if (req.body.clientValue !== undefined) update.clientValue = req.body.clientValue;
  if (req.body.clientNote !== undefined) update.clientNote = req.body.clientNote;
  const { status, clientValue, clientNote } = req.body;
  const batch = updateItem(req.params.workspaceId, req.params.batchId, req.params.itemId, update);
  if (!batch) return res.status(404).json({ error: 'Item not found' });
  // Sync PageEditState when client approves or rejects
  if (status === 'approved' || status === 'rejected') {
    const item = batch.items.find(i => i.id === req.params.itemId);
    if (item) {
      const pageStateResult = updatePageState(req.params.workspaceId, item.pageId, {
        status: status === 'approved' ? 'approved' : 'rejected',
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
      updatePageState(req.params.workspaceId, item.pageId, {
        status: 'in-review',
        updatedBy: 'client',
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
      const value = item.clientValue || item.proposedValue;
      if (item.field === 'schema') {
        // Schema item — publish JSON-LD to page via schema publisher
        const schema = JSON.parse(value);
        const result = await publishSchemaToPage(ws.webflowSiteId, item.pageId, schema, token);
        if (!result.success) throw new Error(result.error || 'Schema publish failed');
      } else if (item.collectionId) {
        // CMS item — update via collection API (updates draft)
        const result = await updateCollectionItem(item.collectionId, item.pageId, { [item.field]: value }, token);
        if (!result.success) throw new Error(result.error || 'CMS update failed');
        // Publish the CMS item so draft changes go live
        const pubResult = await publishCollectionItems(item.collectionId, [item.pageId], token);
        if (!pubResult.success) log.warn(`CMS publish warning for ${item.pageId}: ${pubResult.error}`);
      } else {
        // Static page — update via page SEO API
        const fields = item.field === 'seoTitle'
          ? { seo: { title: value } }
          : { seo: { description: value } };
        await updatePageSeo(item.pageId, fields, token);
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
  res.json({ results, applied: appliedIds.length, failed: results.length - appliedIds.length });
});

export default router;
