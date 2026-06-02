/**
 * Unit tests for server/work-order-comments.ts — the dedicated work-order
 * conversation store (out-of-band from the work-order deliverable payload).
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createWorkOrder, updateWorkOrder, getWorkOrder } from '../../server/work-orders.js';
import { addWorkOrderComment, listWorkOrderComments } from '../../server/work-order-comments.js';

let wsId = '';
// A second workspace used only by the tenant-isolation test below.
let wsBId = '';

beforeAll(() => {
  wsId = createWorkspace('Work Order Comments Test').id;
  wsBId = createWorkspace('Work Order Comments Test B').id;
});

afterAll(() => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsBId);
});

beforeEach(() => {
  db.prepare('DELETE FROM work_order_comments WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM work_order_comments WHERE workspace_id = ?').run(wsBId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(wsBId);
});

function makeOrder() {
  return createWorkOrder(wsId, {
    paymentId: `pay_${Math.random().toString(36).slice(2, 6)}`,
    productType: 'fix_meta',
    pageIds: ['/page'],
  });
}

describe('addWorkOrderComment', () => {
  it('inserts and returns the comment (BEGIN IMMEDIATE txn)', () => {
    const order = makeOrder();
    const comment = addWorkOrderComment(wsId, order.id, 'team', 'Hello from the team');
    expect(comment).not.toBeNull();
    expect(comment!.author).toBe('team');
    expect(comment!.content).toBe('Hello from the team');
    expect(comment!.workOrderId).toBe(order.id);
    expect(comment!.id).toMatch(/^wocmt_/);
    expect(comment!.readAt).toBeUndefined(); // three-state read_at: NULL → undefined
  });

  it('returns null for a missing parent order', () => {
    const result = addWorkOrderComment(wsId, 'wo_does_not_exist', 'client', 'orphan');
    expect(result).toBeNull();
    expect(listWorkOrderComments(wsId, 'wo_does_not_exist')).toEqual([]);
  });

  it('bumps the parent order updated_at', () => {
    const order = makeOrder();
    const before = getWorkOrder(wsId, order.id)!.updatedAt;
    // Small delay so the timestamp differs.
    const comment = addWorkOrderComment(wsId, order.id, 'client', 'a question');
    expect(comment).not.toBeNull();
    const after = getWorkOrder(wsId, order.id)!.updatedAt;
    expect(after >= before).toBe(true);
  });

  it('accepts both client and team authors', () => {
    const order = makeOrder();
    addWorkOrderComment(wsId, order.id, 'client', 'client msg');
    addWorkOrderComment(wsId, order.id, 'team', 'team reply');
    const thread = listWorkOrderComments(wsId, order.id);
    expect(thread.map(c => c.author)).toEqual(['client', 'team']);
  });

  it('refuses to comment cross-workspace: returns null and writes zero rows (tenant isolation)', () => {
    // Order belongs to workspace A; the call passes workspace B's id.
    const orderInA = makeOrder();
    const result = addWorkOrderComment(wsBId, orderInA.id, 'team', 'cross-tenant attempt');
    expect(result).toBeNull();
    // Zero rows persisted under EITHER workspace (the WHERE id=? AND workspace_id=? guard
    // never matched, so the parent-exists check returned null before any insert).
    const rowsForOrder = db
      .prepare('SELECT COUNT(*) AS n FROM work_order_comments WHERE work_order_id = ?')
      .get(orderInA.id) as { n: number };
    expect(rowsForOrder.n).toBe(0);
    const rowsForWsB = db
      .prepare('SELECT COUNT(*) AS n FROM work_order_comments WHERE workspace_id = ?')
      .get(wsBId) as { n: number };
    expect(rowsForWsB.n).toBe(0);
    // The order's own thread (read under its true workspace) is still empty.
    expect(listWorkOrderComments(wsId, orderInA.id)).toEqual([]);
  });
});

describe('listWorkOrderComments', () => {
  it('returns comments oldest-first', () => {
    const order = makeOrder();
    addWorkOrderComment(wsId, order.id, 'client', 'first');
    addWorkOrderComment(wsId, order.id, 'team', 'second');
    addWorkOrderComment(wsId, order.id, 'client', 'third');
    const thread = listWorkOrderComments(wsId, order.id);
    expect(thread.map(c => c.content)).toEqual(['first', 'second', 'third']);
  });

  it('returns an empty array for an order with no comments', () => {
    const order = makeOrder();
    expect(listWorkOrderComments(wsId, order.id)).toEqual([]);
  });

  it('scopes comments to the order (does not leak across orders)', () => {
    const a = makeOrder();
    const b = makeOrder();
    addWorkOrderComment(wsId, a.id, 'team', 'for A');
    addWorkOrderComment(wsId, b.id, 'team', 'for B');
    expect(listWorkOrderComments(wsId, a.id).map(c => c.content)).toEqual(['for A']);
    expect(listWorkOrderComments(wsId, b.id).map(c => c.content)).toEqual(['for B']);
  });
});

describe('updateWorkOrder closedAt lockstep', () => {
  it('completed → closed sets closedAt', () => {
    const order = makeOrder();
    updateWorkOrder(wsId, order.id, { status: 'in_progress' });
    updateWorkOrder(wsId, order.id, { status: 'completed', completedAt: new Date().toISOString() });
    const closed = updateWorkOrder(wsId, order.id, { status: 'closed', closedAt: new Date().toISOString() });
    expect(closed).not.toBeNull();
    expect(closed!.status).toBe('closed');
    expect(closed!.closedAt).toBeTruthy();
    // Persists through a re-read.
    expect(getWorkOrder(wsId, order.id)!.closedAt).toBeTruthy();
  });
});
