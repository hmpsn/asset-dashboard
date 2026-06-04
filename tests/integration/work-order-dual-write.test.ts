import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the work_order adapter the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorWorkOrderToDeliverable } from '../../server/domains/inbox/work-order-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { WorkOrder } from '../../shared/types/payments.js';

const ws = createWorkspace('work-order-dualwrite-test', 'site-wo-dw');
const WS = ws.id;

function makeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: `wo_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    paymentId: 'pay_dw',
    productType: 'fix_meta',
    status: 'pending',
    pageIds: ['p1'],
    quantity: 1,
    createdAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

describe('work-order dual-write mirror', () => {
  it('mirrors one work_order deliverable (kind order, status ordered, externalRef = paymentId)', () => {
    const mirrored = mirrorWorkOrderToDeliverable(makeOrder({ id: 'wo_x' }));
    expect(mirrored).not.toBeNull();
    expect(mirrored!.type).toBe('work_order');
    expect(mirrored!.kind).toBe('order');
    expect(mirrored!.status).toBe('ordered'); // pending → ordered (open-Q#4)
    expect(mirrored!.externalRef).toBe('pay_dw');
    expect(mirrored!.sourceRef).toBe('work_order:wo_x');
    expect(mirrored!.payload.workOrderStatus).toBe('pending'); // raw status carried
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('re-mirror on status change updates the same row in place (lifecycle progress)', () => {
    const created = mirrorWorkOrderToDeliverable(makeOrder({ id: 'wo_life', status: 'pending' }));
    expect(created!.status).toBe('ordered');

    const progressed = mirrorWorkOrderToDeliverable(makeOrder({ id: 'wo_life', status: 'in_progress' }));
    expect(progressed!.id).toBe(created!.id); // same row
    expect(progressed!.status).toBe('in_progress');

    const done = mirrorWorkOrderToDeliverable(
      makeOrder({ id: 'wo_life', status: 'completed', completedAt: '2026-06-02T00:00:00.000Z' }),
    );
    expect(done!.id).toBe(created!.id);
    expect(done!.status).toBe('completed');
    expect(done!.appliedAt).toBe('2026-06-02T00:00:00.000Z');
    expect(listDeliverables(WS)).toHaveLength(1); // still ONE row
  });

  it('rejects a paymentless order via validateSendable (no row, no throw)', () => {
    const result = mirrorWorkOrderToDeliverable(makeOrder({ paymentId: '' }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });
});
