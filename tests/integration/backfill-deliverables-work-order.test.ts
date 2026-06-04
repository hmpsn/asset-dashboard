import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the work_order adapter the backfill resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { backfillWorkOrderDeliverables } from '../../scripts/backfill-deliverables-work-order.js';
import { createWorkOrder } from '../../server/work-orders.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { mirrorWorkOrderToDeliverable } from '../../server/domains/inbox/work-order-dual-write.js';

const wsA = createWorkspace('backfill-work-order-A', 'site-bwo-a');
const WS_A = wsA.id;

beforeEach(() => {
  // The backfill scans the WHOLE work_orders table. Start clean so counts reflect only this
  // test's seeded orders (the worker DB is isolated, so this never affects other workers).
  db.prepare('DELETE FROM work_orders').run();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
});

afterEach(() => {
  db.prepare('DELETE FROM work_orders').run();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
});

afterAll(() => {
  db.prepare('DELETE FROM work_orders').run();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
  deleteWorkspace(WS_A);
});

describe('backfill-deliverables-work-order', () => {
  it('backfills an order into a work_order deliverable with the stable sourceRef', () => {
    const order = createWorkOrder(WS_A, { paymentId: 'pay_1', productType: 'fix_meta', pageIds: ['p1'] });
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
    expect(listDeliverables(WS_A)).toHaveLength(0);

    const result = backfillWorkOrderDeliverables();
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1);

    const rows = listDeliverables(WS_A).filter((r) => r.type === 'work_order');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRef).toBe(`work_order:${order.id}`);
    expect(rows[0].kind).toBe('order');
    expect(rows[0].status).toBe('ordered'); // pending → ordered
    expect(rows[0].externalRef).toBe('pay_1');
  });

  it('is idempotent — re-running the backfill inserts nothing new', () => {
    createWorkOrder(WS_A, { paymentId: 'pay_2', productType: 'fix_alt', pageIds: [] });
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
    const first = backfillWorkOrderDeliverables();
    expect(first.inserted).toBe(1);

    const second = backfillWorkOrderDeliverables();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'work_order')).toHaveLength(1);
  });

  it('--dry-run counts but writes nothing', () => {
    createWorkOrder(WS_A, { paymentId: 'pay_3', productType: 'fix_redirect', pageIds: [] });
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
    const result = backfillWorkOrderDeliverables({ dryRun: true });
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1); // would-insert count
    expect(listDeliverables(WS_A)).toHaveLength(0); // but nothing written
  });

  it('reflects the order lifecycle status (in_progress) at backfill time', () => {
    const order = createWorkOrder(WS_A, { paymentId: 'pay_4', productType: 'fix_meta', status: 'in_progress', pageIds: [] });
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
    backfillWorkOrderDeliverables();
    const row = listDeliverables(WS_A).find((r) => r.sourceRef === `work_order:${order.id}`)!;
    expect(row.status).toBe('in_progress');
  });

  it('CROSS-PATH: a dual-written deliverable + a backfill of the same order collapse to ONE', () => {
    // A fresh order mirror via dual-write → one work_order:<id> deliverable.
    const order = createWorkOrder(WS_A, { paymentId: 'pay_5', productType: 'fix_meta', pageIds: [] });
    // createWorkOrder already mirrored it (flag on); confirm.
    expect(listDeliverables(WS_A).filter((r) => r.type === 'work_order')).toHaveLength(1);

    // Belt-and-suspenders: an explicit re-mirror still collapses to the same row.
    mirrorWorkOrderToDeliverable(order);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'work_order')).toHaveLength(1);

    // The backfill normalizes to work_order:<id>, which already exists → no new row.
    const result = backfillWorkOrderDeliverables();
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'work_order')).toHaveLength(1);
  });
});
