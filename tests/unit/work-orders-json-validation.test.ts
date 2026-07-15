import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';

const mockInvalidateMonthlyDigestCache = vi.hoisted(() => vi.fn());
vi.mock('../../server/monthly-digest-cache.js', () => ({
  invalidateMonthlyDigestCache: mockInvalidateMonthlyDigestCache,
}));

import { createWorkOrder, listWorkOrders, updateWorkOrder } from '../../server/work-orders.js';

const WS_ID = 'work-order-json-validation-ws';

describe('work-orders JSON validation', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM work_orders WHERE workspace_id = ?").run(WS_ID);
    mockInvalidateMonthlyDigestCache.mockClear();
  });

  it('invalidates the monthly digest when an order becomes completed', () => {
    const created = createWorkOrder(WS_ID, {
      paymentId: 'pay_digest',
      productType: 'fix_meta',
      pageIds: ['/one'],
      issueChecks: ['title'],
    });

    updateWorkOrder(WS_ID, created.id, { status: 'in_progress' });
    expect(mockInvalidateMonthlyDigestCache).not.toHaveBeenCalled();

    updateWorkOrder(WS_ID, created.id, { status: 'completed' });
    expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledOnce();
    expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledWith(WS_ID);
  });

  it('falls back safely when stored page_ids and issue_checks are malformed JSON', () => {
    const created = createWorkOrder(WS_ID, {
      paymentId: 'pay_1',
      productType: 'fix_meta',
      pageIds: ['/one'],
      issueChecks: ['title'],
    });

    db.prepare('UPDATE work_orders SET page_ids = ?, issue_checks = ? WHERE id = ? AND workspace_id = ?')
      .run('{"oops":true}', '{"not":"an-array"}', created.id, WS_ID);

    const [order] = listWorkOrders(WS_ID);
    expect(order.pageIds).toEqual([]);
    expect(order.issueChecks).toEqual([]);
  });

  it('filters mixed-type arrays to strings only', () => {
    const created = createWorkOrder(WS_ID, {
      paymentId: 'pay_2',
      productType: 'fix_meta',
      pageIds: ['/one'],
      issueChecks: ['title'],
    });

    db.prepare('UPDATE work_orders SET page_ids = ?, issue_checks = ? WHERE id = ? AND workspace_id = ?')
      .run('["/good", 42, null, "/also-good"]', '["title", {"bad":1}, "meta"]', created.id, WS_ID);

    const [order] = listWorkOrders(WS_ID);
    expect(order.pageIds).toEqual(['/good', '/also-good']);
    expect(order.issueChecks).toEqual(['title', 'meta']);
  });
});
