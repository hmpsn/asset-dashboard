/**
 * work-orders routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { listClientUsers } from '../client-users.js';
import { notifyClientFixesApplied } from '../email.js';
import { listPayments } from '../payments.js';
import { listWorkOrders, updateWorkOrder } from '../work-orders.js';
import { getWorkspace, updatePageState } from '../workspaces.js';

router.get('/api/public/fix-orders/:workspaceId', (req, res) => {
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

// --- Work Orders (admin + public) ---
router.get('/api/work-orders/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listWorkOrders(req.params.workspaceId));
});

router.patch('/api/work-orders/:workspaceId/:orderId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { status, assignedTo, notes } = req.body;
  const wsId = req.params.workspaceId;
  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (notes !== undefined) updates.notes = notes;
  if (status === 'completed') updates.completedAt = new Date().toISOString();
  const order = updateWorkOrder(wsId, req.params.orderId, updates as Parameters<typeof updateWorkOrder>[2]);
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

  broadcastToWorkspace(wsId, 'work-order:update', { id: order.id, status: order.status });
  res.json(order);
});

router.get('/api/public/work-orders/:workspaceId', (req, res) => {
  res.json(listWorkOrders(req.params.workspaceId));
});

export default router;
