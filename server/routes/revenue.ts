/**
 * revenue routes — admin-only revenue analytics dashboard
 */
import { Router } from 'express';
import { listAllPayments } from '../payments.js';
import { listWorkspaces } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('revenue');
const router = Router();

router.get('/api/revenue/summary', (_req, res) => {
  try {
    const payments = listAllPayments();
    const workspaces = listWorkspaces();
    const wsMap = new Map(workspaces.map(w => [w.id, w.name]));

    const paid = payments.filter(p => p.status === 'paid');

    // Total revenue
    const totalRevenue = paid.reduce((sum, p) => sum + p.amount, 0);

    // Revenue by month (last 12 months)
    const now = new Date();
    const months: { month: string; revenue: number; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const monthPayments = paid.filter(p => p.paidAt?.startsWith(key) || (!p.paidAt && p.createdAt.startsWith(key)));
      months.push({
        month: label,
        revenue: monthPayments.reduce((s, p) => s + p.amount, 0),
        count: monthPayments.length,
      });
    }

    // Revenue by workspace
    const byWorkspace: { workspaceId: string; name: string; revenue: number; count: number }[] = [];
    const wsGroups = new Map<string, { revenue: number; count: number }>();
    for (const p of paid) {
      const existing = wsGroups.get(p.workspaceId) || { revenue: 0, count: 0 };
      existing.revenue += p.amount;
      existing.count += 1;
      wsGroups.set(p.workspaceId, existing);
    }
    for (const [wsId, data] of wsGroups) {
      byWorkspace.push({ workspaceId: wsId, name: wsMap.get(wsId) || wsId, ...data });
    }
    byWorkspace.sort((a, b) => b.revenue - a.revenue);

    // Revenue by product type
    const byProduct: { productType: string; revenue: number; count: number }[] = [];
    const prodGroups = new Map<string, { revenue: number; count: number }>();
    for (const p of paid) {
      const existing = prodGroups.get(p.productType) || { revenue: 0, count: 0 };
      existing.revenue += p.amount;
      existing.count += 1;
      prodGroups.set(p.productType, existing);
    }
    for (const [pt, data] of prodGroups) {
      byProduct.push({ productType: pt, ...data });
    }
    byProduct.sort((a, b) => b.revenue - a.revenue);

    // Recent payments (last 20)
    const recent = paid.slice(0, 20).map(p => ({
      id: p.id,
      workspaceName: wsMap.get(p.workspaceId) || p.workspaceId,
      productType: p.productType,
      amount: p.amount,
      currency: p.currency,
      paidAt: p.paidAt || p.createdAt,
    }));

    // Current month revenue (MRR proxy)
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthRevenue = paid
      .filter(p => (p.paidAt || p.createdAt).startsWith(currentMonth))
      .reduce((s, p) => s + p.amount, 0);

    // Previous month for comparison
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthRevenue = paid
      .filter(p => (p.paidAt || p.createdAt).startsWith(prevMonth))
      .reduce((s, p) => s + p.amount, 0);

    log.info(`Revenue summary: ${paid.length} paid, $${(totalRevenue / 100).toFixed(2)} total`);

    res.json({
      totalRevenue,
      totalTransactions: paid.length,
      currentMonthRevenue,
      prevMonthRevenue,
      months,
      byWorkspace,
      byProduct,
      recent,
    });
  } catch (err) {
    log.error({ err }, 'Failed to generate revenue summary');
    res.status(500).json({ error: 'Failed to generate revenue summary' });
  }
});

export default router;
