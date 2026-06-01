import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the PR-1fg work_order adapter (+ the others).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mapWorkOrderStatusToDeliverableStatus } from '../../server/domains/inbox/deliverable-adapters/work-order.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import type { WorkOrder } from '../../shared/types/payments.js';

const WS = 'work-order-adapter-test';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

function makeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: `wo_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    paymentId: 'pay_123',
    productType: 'fix_meta',
    status: 'pending',
    pageIds: ['page-a', 'page-b'],
    issueChecks: ['missing_meta'],
    quantity: 1,
    createdAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('work_order adapter — registration', () => {
  it('is registered via the barrel as an order artifact with apply disabled (D-apply)', () => {
    const adapter = getAdapter('work_order');
    expect(adapter.type).toBe('work_order');
    expect(adapter.appliesOnApprove).toBeFalsy();
  });
});

describe('work_order adapter — status map (legacy → canonical ORDER lifecycle)', () => {
  it('pending → ordered (open-Q#4 absorb)', () => {
    expect(mapWorkOrderStatusToDeliverableStatus('pending')).toBe('ordered');
  });
  it('in_progress → in_progress', () => {
    expect(mapWorkOrderStatusToDeliverableStatus('in_progress')).toBe('in_progress');
  });
  it('completed → completed', () => {
    expect(mapWorkOrderStatusToDeliverableStatus('completed')).toBe('completed');
  });
  it('cancelled → cancelled', () => {
    expect(mapWorkOrderStatusToDeliverableStatus('cancelled')).toBe('cancelled');
  });
});

describe('work_order adapter — round-trip (build → store → parse → assert-no-fallback)', () => {
  it('round-trips a paid order as an ORDER deliverable, no fallback', () => {
    const adapter = getAdapter('work_order');
    const order = makeOrder();

    expect(adapter.validateSendable(order)).toEqual({ ok: true });

    const built = adapter.buildPayload(order);
    const sourceRef = adapter.sourceRef(order);
    expect(built.kind).toBe('order'); // a work order is an ORDER
    expect(built.externalRef).toBe('pay_123'); // externalRef = payment id
    expect(built.items).toBeUndefined(); // no per-item review rows

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: 'work_order',
      kind: built.kind,
      status: mapWorkOrderStatusToDeliverableStatus(order.status),
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      sourceRef,
      sentAt: order.createdAt,
      generatedAt: order.createdAt,
    });

    const got = getDeliverable(stored.id)!;
    expect(got.type).toBe('work_order');
    expect(got.kind).toBe('order');
    expect(got.status).toBe('ordered'); // pending → ordered
    expect(got.externalRef).toBe('pay_123');
    // assert-no-fallback: the payload round-trips the real content, not {}.
    expect(got.payload).not.toEqual({});
    expect(got.payload.family).toBe('work_order');
    // raw legacy status is ALWAYS carried so `pending` is never lost.
    expect(got.payload.workOrderStatus).toBe('pending');
    expect(got.payload.productType).toBe('fix_meta');
    expect(got.payload.paymentId).toBe('pay_123');
    expect(Array.isArray(got.payload.pageIds)).toBe(true);
    expect((got.payload.pageIds as unknown[]).length).toBe(2);
    expect(got.payload.quantity).toBe(1);
    expect(got.items ?? []).toHaveLength(0);
  });
});

describe('work_order adapter — sourceRef (stable per-order)', () => {
  it('sourceRef → work_order:<id>', () => {
    const order = makeOrder({ id: 'wo_fixed' });
    expect(getAdapter('work_order').sourceRef(order)).toBe('work_order:wo_fixed');
  });

  it('sourceRef is null when the order has no id', () => {
    expect(getAdapter('work_order').sourceRef(makeOrder({ id: '' }))).toBeNull();
  });

  it('sourceRef is STABLE across two mirrors of the same order → dedupes to one row', () => {
    const adapter = getAdapter('work_order');
    const o1 = makeOrder({ id: 'wo_same', status: 'pending' });
    const o2 = makeOrder({ id: 'wo_same', status: 'in_progress' }); // later lifecycle state
    expect(adapter.sourceRef(o1)).toBe(adapter.sourceRef(o2));

    const store = (order: WorkOrder) => {
      const built = adapter.buildPayload(order);
      return upsertDeliverable({
        workspaceId: WS,
        type: 'work_order',
        kind: built.kind,
        status: mapWorkOrderStatusToDeliverableStatus(order.status),
        title: built.title,
        summary: built.summary ?? null,
        payload: built.payload,
        externalRef: built.externalRef ?? null,
        sourceRef: adapter.sourceRef(order),
      });
    };
    const first = store(o1);
    const second = store(o2);
    expect(second.id).toBe(first.id); // deduped onto one row
    // status reflects lifecycle progress in place: pending→ordered, then in_progress.
    expect(getDeliverable(second.id)!.status).toBe('in_progress');
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM client_deliverable WHERE workspace_id = ? AND type = ?')
      .get(WS, 'work_order') as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('work_order adapter — validateSendable', () => {
  it('a paid order (with payment id) IS sendable', () => {
    expect(getAdapter('work_order').validateSendable(makeOrder())).toEqual({ ok: true });
  });

  it('rejects a paymentless order', () => {
    expect(getAdapter('work_order').validateSendable(makeOrder({ paymentId: '' }))).toEqual({
      ok: false,
      reason: 'work order has no payment id (not a paid, sendable order)',
    });
  });
});

describe('work_order adapter — apply stays disabled (D-apply)', () => {
  it('apply stub throws (a work order is not applied by a client approve)', async () => {
    const adapter = getAdapter('work_order');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(
      /disabled|D-apply|fulfillment side-effects/i,
    );
  });
});
