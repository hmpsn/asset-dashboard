/**
 * work-orders routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { listClientUsers } from '../client-users.js';
import { notifyClientFixesApplied, notifyClientWorkOrderComment } from '../email.js';
import { sanitizeString } from '../helpers.js';
import { listPayments } from '../payments.js';
import { listWorkOrders, getWorkOrder, updateWorkOrder } from '../work-orders.js';
import { addWorkOrderComment, listWorkOrderComments } from '../work-order-comments.js';
import { getWorkspace, updatePageState } from '../workspaces.js';
import { validate, z } from '../middleware/validate.js';
import { workOrderCommentSchema } from '../schemas/work-orders.js';
import { WS_EVENTS } from '../ws-events.js';

router.get('/api/public/fix-orders/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const payments = listPayments(req.params.workspaceId);
  const fixOrders = payments
    .filter(p => p.productType.startsWith('fix_') || p.productType.startsWith('schema_'))
    .map(p => ({
      id: p.id,
      productType: p.productType,
      status: p.status,
      amount: p.amount,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  res.json(fixOrders);
});

const updateWorkOrderSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'closed', 'cancelled']).optional(),
  assignedTo: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional(),
});

// --- Work Orders (admin + public) ---
router.get('/api/work-orders/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listWorkOrders(req.params.workspaceId));
});

// rec-resolve for a completed work order happens inside updateWorkOrder()
// (server/work-orders.ts) — it resolves recommendations covering the order's
// pages. The updatePageState({ status: 'live' }) calls below only mirror that
// state for the UI, so no rec-refresh is needed at the route layer.
// rec-refresh-ok
router.patch('/api/work-orders/:workspaceId/:orderId', requireWorkspaceAccess('workspaceId'), validate(updateWorkOrderSchema), (req, res, next) => {
  const { status, assignedTo, notes } = req.body;
  const wsId = req.params.workspaceId;
  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (notes !== undefined) updates.notes = notes;
  if (status === 'completed') updates.completedAt = new Date().toISOString();
  if (status === 'closed') updates.closedAt = new Date().toISOString();
  let order;
  try {
    order = updateWorkOrder(wsId, req.params.orderId, updates as Parameters<typeof updateWorkOrder>[2]);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!order) return res.status(404).json({ error: 'Work order not found' });

  // When work order is completed, update page states + log activity + email client
  if (status === 'completed') {
    for (const pageId of order.pageIds) {
      updatePageState(wsId, pageId, { status: 'live', source: 'cart-fix', workOrderId: order.id, updatedBy: 'admin' });
    }
    const ws = getWorkspace(wsId);
    addActivity(wsId, 'fix_completed',
      `Fix completed: ${order.productType.replace(/_/g, ' ')}`,
      `${order.pageIds.length} page${order.pageIds.length !== 1 ? 's' : ''} updated`,
      { workOrderId: order.id, productType: order.productType });
    // Email client
    if (ws) {
      const clientUsers = listClientUsers(wsId);
      for (const cu of clientUsers) {
        if (cu.email) {
          notifyClientFixesApplied({
            clientEmail: cu.email,
            workspaceName: ws.name,
            workspaceId: wsId,
            productType: order.productType.replace(/_/g, ' '),
            pageCount: order.pageIds.length,
          });
        }
      }
    }
  }

  // Operator-only close-out (completed → closed). Deliberately does NOT re-enter the
  // `completed` block above (no page-state flips, no fixes-applied email) — closing just
  // takes a fulfilled order out of the conversation lane (the mirror flips it to
  // `cancelled` → out of CLIENT_FACING_ORDER_STATUSES). Client-visible activity.
  if (status === 'closed') {
    addActivity(wsId, 'order_closed',
      `Order closed: ${order.productType.replace(/_/g, ' ')}`,
      '',
      { workOrderId: order.id, productType: order.productType });
  }

  broadcastToWorkspace(wsId, WS_EVENTS.WORK_ORDER_UPDATE, { id: order.id, status: order.status });
  res.json(order);
});

// --- Admin work-order conversation (client ↔ team) ---
router.get('/api/work-orders/:workspaceId/:orderId/comments', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listWorkOrderComments(req.params.workspaceId, req.params.orderId));
});

// Admin (team) posts a reply on a work-order conversation. Author HARDCODED 'team'.
router.post('/api/work-orders/:workspaceId/:orderId/comment', requireWorkspaceAccess('workspaceId'), validate(workOrderCommentSchema), (req, res) => {
  const wsId = req.params.workspaceId;
  const orderId = req.params.orderId;
  const content = sanitizeString(req.body.content, 2000);
  if (!content) return res.status(400).json({ error: 'content is required' });

  // Symmetric close-out enforcement (mirrors the client route): once an order is closed
  // the conversation lane is over — commenting would email the client about an order that
  // has already left their lane (a dead-end). Reject before writing.
  const order = getWorkOrder(wsId, orderId);
  if (!order) return res.status(404).json({ error: 'Work order not found' });
  if (order.status === 'closed') return res.status(409).json({ error: 'This work order is closed' });

  const comment = addWorkOrderComment(wsId, orderId, 'team', content);
  if (!comment) return res.status(404).json({ error: 'Work order not found' });

  const orderTitle = order.productType.replace(/_/g, ' ');
  addActivity(wsId, 'work_order_commented',
    `Team commented on "${orderTitle}"`,
    content.length > 200 ? `${content.slice(0, 197)}...` : content,
    { workOrderId: orderId });
  broadcastToWorkspace(wsId, WS_EVENTS.WORK_ORDER_COMMENT, { id: orderId });

  // Best-effort team → client notification (never blocks the write).
  const ws = getWorkspace(wsId);
  if (ws) {
    for (const cu of listClientUsers(wsId)) {
      if (cu.email) {
        notifyClientWorkOrderComment({
          clientEmail: cu.email,
          workspaceName: ws.name,
          workspaceId: wsId,
          orderTitle,
          message: content,
        });
      }
    }
  }

  res.json(comment);
});

router.get('/api/public/work-orders/:workspaceId', requireClientPortalAuth(), (req, res) => {
  res.json(listWorkOrders(req.params.workspaceId));
});

export default router;
