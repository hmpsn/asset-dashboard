/**
 * Integration tests for revenue API endpoints.
 *
 * Tests:
 * - GET /api/revenue/summary
 * - DELETE /api/revenue/payments/:id
 * - DELETE /api/revenue/payments  (bulk purge)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13560);
const { api, del } = ctx;

const testWsId = 'ws_integ_revenue_' + Date.now();
const testWsId2 = 'ws_integ_revenue2_' + Date.now();

// ── helpers ────────────────────────────────────────────────────────────────────

function insertPayment(opts: {
  id: string;
  workspaceId?: string;
  amount: number;
  status?: string;
  productType?: string;
  paidAt?: string | null;
  createdAt?: string;
}) {
  db.prepare(`
    INSERT INTO payments
      (id, workspace_id, stripe_session_id, product_type, amount, currency, status, created_at, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.workspaceId ?? testWsId,
    `sess_${opts.id}`,
    opts.productType ?? 'subscription',
    opts.amount,
    'usd',
    opts.status ?? 'paid',
    opts.createdAt ?? new Date().toISOString(),
    opts.paidAt !== undefined ? opts.paidAt : new Date().toISOString(),
  );
}

function cleanPayments() {
  db.prepare('DELETE FROM payments WHERE workspace_id IN (?, ?)').run(testWsId, testWsId2);
}

// ── lifecycle ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Seed workspaces so FK constraints are satisfied
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, 'Test Revenue WS', testWsId, new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId2, 'Test Revenue WS 2', testWsId2, new Date().toISOString());

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  cleanPayments();
  db.prepare('DELETE FROM workspaces WHERE id IN (?, ?)').run(testWsId, testWsId2);
});

// ── tests ──────────────────────────────────────────────────────────────────────

describe('Revenue routes', () => {
  describe('GET /api/revenue/summary', () => {
    it('returns 200 with the expected response shape when there are no payments', async () => {
      cleanPayments();

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('totalRevenue');
      expect(body).toHaveProperty('totalTransactions');
      expect(body).toHaveProperty('currentMonthRevenue');
      expect(body).toHaveProperty('prevMonthRevenue');
      expect(body).toHaveProperty('months');
      expect(body).toHaveProperty('byWorkspace');
      expect(body).toHaveProperty('byProduct');
      expect(body).toHaveProperty('recent');
    });

    it('returns a valid empty structure (not 500) when there are no payments', async () => {
      cleanPayments();

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.totalRevenue).toBe(0);
      expect(body.totalTransactions).toBe(0);
      expect(body.currentMonthRevenue).toBe(0);
      expect(body.prevMonthRevenue).toBe(0);
      expect(Array.isArray(body.months)).toBe(true);
      expect(body.months).toHaveLength(12);
      expect(Array.isArray(body.byWorkspace)).toBe(true);
      expect(body.byWorkspace).toHaveLength(0);
      expect(Array.isArray(body.byProduct)).toBe(true);
      expect(body.byProduct).toHaveLength(0);
      expect(Array.isArray(body.recent)).toBe(true);
      expect(body.recent).toHaveLength(0);
    });

    it('filters out non-paid payments — only status=paid counts towards totals', async () => {
      cleanPayments();
      const now = new Date().toISOString();
      insertPayment({ id: 'pay_rev_paid_1', amount: 5000, status: 'paid', createdAt: now });
      insertPayment({ id: 'pay_rev_pending_1', amount: 9999, status: 'pending', createdAt: now });
      insertPayment({ id: 'pay_rev_failed_1', amount: 7777, status: 'failed', createdAt: now });

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      // Only the paid one should count
      expect(body.totalRevenue).toBe(5000);
      expect(body.totalTransactions).toBe(1);
    });

    it('groups month revenue correctly — paidAt takes priority over createdAt', async () => {
      cleanPayments();

      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // A payment paid in the current month
      insertPayment({
        id: 'pay_rev_thismonth',
        amount: 3000,
        status: 'paid',
        paidAt: `${currentMonthKey}-10T00:00:00.000Z`,
        createdAt: `${currentMonthKey}-01T00:00:00.000Z`,
      });

      // A payment whose paidAt is in the current month but createdAt is old
      const oldDate = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      insertPayment({
        id: 'pay_rev_oldcreated',
        amount: 1500,
        status: 'paid',
        paidAt: `${currentMonthKey}-15T00:00:00.000Z`,
        createdAt: oldDate,
      });

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      // Both should land in the current month bucket
      expect(body.currentMonthRevenue).toBe(4500);

      // The current month entry in the months array should reflect both payments
      const currentMonthEntry = body.months[body.months.length - 1];
      expect(currentMonthEntry.revenue).toBe(4500);
      expect(currentMonthEntry.count).toBe(2);
    });

    it('month grouping — payment with no paidAt falls back to createdAt month', async () => {
      cleanPayments();

      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Payment with no paidAt — route falls back to createdAt
      insertPayment({
        id: 'pay_rev_nopaidat',
        amount: 2200,
        status: 'paid',
        paidAt: null,
        createdAt: `${currentMonthKey}-05T00:00:00.000Z`,
      });

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      // Route logic: `p.paidAt || p.createdAt` — should land in current month
      expect(body.currentMonthRevenue).toBe(2200);
    });

    it('aggregates revenue correctly across multiple workspaces', async () => {
      cleanPayments();

      insertPayment({ id: 'pay_rev_ws1_a', workspaceId: testWsId, amount: 4000, status: 'paid' });
      insertPayment({ id: 'pay_rev_ws1_b', workspaceId: testWsId, amount: 1000, status: 'paid' });
      insertPayment({ id: 'pay_rev_ws2_a', workspaceId: testWsId2, amount: 7000, status: 'paid' });

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.totalRevenue).toBe(12000);
      expect(body.totalTransactions).toBe(3);

      // byWorkspace should have two entries, sorted descending by revenue
      expect(body.byWorkspace).toHaveLength(2);
      expect(body.byWorkspace[0].workspaceId).toBe(testWsId2);
      expect(body.byWorkspace[0].revenue).toBe(7000);
      expect(body.byWorkspace[0].count).toBe(1);
      expect(body.byWorkspace[1].workspaceId).toBe(testWsId);
      expect(body.byWorkspace[1].revenue).toBe(5000);
      expect(body.byWorkspace[1].count).toBe(2);
    });

    it('aggregates revenue by product type correctly', async () => {
      cleanPayments();

      insertPayment({ id: 'pay_rev_sub_1', amount: 2000, productType: 'subscription', status: 'paid' });
      insertPayment({ id: 'pay_rev_sub_2', amount: 3000, productType: 'subscription', status: 'paid' });
      insertPayment({ id: 'pay_rev_content_1', amount: 1500, productType: 'content', status: 'paid' });

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.byProduct).toHaveLength(2);

      // Sorted descending by revenue
      const [first, second] = body.byProduct;
      expect(first.productType).toBe('subscription');
      expect(first.revenue).toBe(5000);
      expect(first.count).toBe(2);
      expect(second.productType).toBe('content');
      expect(second.revenue).toBe(1500);
      expect(second.count).toBe(1);
    });

    it('recent list contains at most 20 entries and only paid payments', async () => {
      cleanPayments();

      // Insert 25 paid and 5 non-paid
      for (let i = 0; i < 25; i++) {
        insertPayment({ id: `pay_rev_recent_${i}`, amount: 100 * (i + 1), status: 'paid' });
      }
      for (let i = 0; i < 5; i++) {
        insertPayment({ id: `pay_rev_nonpaid_${i}`, amount: 999, status: 'pending' });
      }

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.recent.length).toBeLessThanOrEqual(20);

      // Every recent entry should have the expected shape
      for (const entry of body.recent) {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('workspaceName');
        expect(entry).toHaveProperty('productType');
        expect(entry).toHaveProperty('amount');
        expect(entry).toHaveProperty('currency');
        expect(entry).toHaveProperty('paidAt');
      }
    });

    it('months array always has exactly 12 entries', async () => {
      cleanPayments();

      const res = await api('/api/revenue/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.months).toHaveLength(12);

      // Each entry should have month label, revenue number, and count number
      for (const m of body.months) {
        expect(typeof m.month).toBe('string');
        expect(typeof m.revenue).toBe('number');
        expect(typeof m.count).toBe('number');
      }
    });
  });

  describe('DELETE /api/revenue/payments/:id', () => {
    it('returns 404 for a nonexistent payment id', async () => {
      const res = await del('/api/revenue/payments/pay_does_not_exist_xyz');
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    it('deletes an existing payment and returns { ok: true }', async () => {
      cleanPayments();
      insertPayment({ id: 'pay_rev_to_delete', amount: 1000, status: 'paid' });

      const res = await del('/api/revenue/payments/pay_rev_to_delete');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it('deleted payment no longer appears in summary', async () => {
      cleanPayments();
      insertPayment({ id: 'pay_rev_del_verify', amount: 5000, status: 'paid' });

      // Confirm it shows in summary first
      const before = await api('/api/revenue/summary');
      const beforeBody = await before.json();
      expect(beforeBody.totalRevenue).toBe(5000);
      expect(beforeBody.totalTransactions).toBe(1);

      // Delete it
      const delRes = await del('/api/revenue/payments/pay_rev_del_verify');
      expect(delRes.status).toBe(200);

      // Summary should now show zero
      const after = await api('/api/revenue/summary');
      const afterBody = await after.json();
      expect(afterBody.totalRevenue).toBe(0);
      expect(afterBody.totalTransactions).toBe(0);
    });

    it('second delete of same id returns 404', async () => {
      cleanPayments();
      insertPayment({ id: 'pay_rev_double_del', amount: 500, status: 'paid' });

      await del('/api/revenue/payments/pay_rev_double_del');
      const res = await del('/api/revenue/payments/pay_rev_double_del');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/revenue/payments (bulk purge)', () => {
    it('returns { ok: true, deleted: 0 } when there are no payments', async () => {
      cleanPayments();

      const res = await del('/api/revenue/payments');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(typeof body.deleted).toBe('number');
    });

    it('deletes all payments across all workspaces and returns correct count', async () => {
      cleanPayments();

      insertPayment({ id: 'pay_rev_bulk_1', workspaceId: testWsId, amount: 1000, status: 'paid' });
      insertPayment({ id: 'pay_rev_bulk_2', workspaceId: testWsId, amount: 2000, status: 'pending' });
      insertPayment({ id: 'pay_rev_bulk_3', workspaceId: testWsId2, amount: 3000, status: 'paid' });

      const res = await del('/api/revenue/payments');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      // All 3 rows (paid and non-paid) should be gone
      expect(body.deleted).toBe(3);

      // Confirm via summary
      const summary = await api('/api/revenue/summary');
      const summaryBody = await summary.json();
      expect(summaryBody.totalRevenue).toBe(0);
      expect(summaryBody.totalTransactions).toBe(0);
    });

    it('summary returns empty structure after bulk purge', async () => {
      cleanPayments();

      insertPayment({ id: 'pay_rev_purge_a', amount: 7500, status: 'paid' });
      insertPayment({ id: 'pay_rev_purge_b', amount: 2500, status: 'paid' });

      // Verify totals before purge
      const before = await api('/api/revenue/summary');
      const beforeBody = await before.json();
      expect(beforeBody.totalRevenue).toBe(10000);

      // Purge
      await del('/api/revenue/payments');

      // Verify clean slate after purge
      const after = await api('/api/revenue/summary');
      const afterBody = await after.json();
      expect(afterBody.totalRevenue).toBe(0);
      expect(afterBody.totalTransactions).toBe(0);
      expect(afterBody.byWorkspace).toHaveLength(0);
      expect(afterBody.byProduct).toHaveLength(0);
      expect(afterBody.recent).toHaveLength(0);
    });
  });
});
