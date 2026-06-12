import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createPayment } from '../../server/payments.js';
import { createWorkOrder } from '../../server/work-orders.js';
import type { ProductType } from '../../shared/types/payments.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, patchJson } = ctx;

let wsA = '';
let wsB = '';

function seedOrder(workspaceId: string, productType: ProductType = 'fix_meta') {
  const payment = createPayment(workspaceId, {
    workspaceId,
    stripeSessionId: `sess_fixture_wo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    productType,
    amount: 1000,
    currency: 'usd',
    status: 'paid',
  });
  return createWorkOrder(workspaceId, {
    paymentId: payment.id,
    productType,
    pageIds: ['p1'],
    issueChecks: ['metadata'],
    quantity: 1,
  });
}

beforeAll(async () => {
  await ctx.startServer();
  wsA = createWorkspace('Fixture Work Orders A').id;
  wsB = createWorkspace('Fixture Work Orders B').id;
});

afterAll(async () => {
  db.prepare('DELETE FROM work_orders WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  db.prepare('DELETE FROM payments WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await ctx.stopServer();
});

describe('Fixture work-orders edge routes', () => {
  it('rejects invalid status patch', async () => {
    const order = seedOrder(wsA);
    const res = await patchJson(`/api/work-orders/${wsA}/${order.id}`, { status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('enforces workspace isolation on patch', async () => {
    const order = seedOrder(wsA);
    const res = await patchJson(`/api/work-orders/${wsB}/${order.id}`, { status: 'in_progress' });
    expect(res.status).toBe(404);
  });

  it('public fix-orders list returns array', async () => {
    const res = await api(`/api/public/fix-orders/${wsA}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.any(Array));
  });
});
