// tests/contract/approval-batch-status.test.ts
//
// CONTRACT: recalcBatchStatus() derives correct batch status from all
// possible item status combinations. Tested indirectly via updateItem()
// and markBatchApplied(), verified via getBatch().
//
// State machine (from server/state-machines.ts):
//   pending  → approved | rejected
//   approved → pending (undo) | applied
//   rejected → pending (undo)
//   applied  → (terminal)
//
// recalcBatchStatus rules:
//   1. All applied                        → batch 'applied'
//   2. All approved or applied            → batch 'approved'
//   3. All rejected                       → batch 'rejected'
//   4. Some approved/rejected/applied     → batch 'partial'
//   5. Otherwise (all pending)            → batch 'pending'

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { seedApprovalData } from '../fixtures/approval-seed.js';
import { getBatch, updateItem, markBatchApplied } from '../../server/approvals.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Approve all listed items via updateItem(). */
function approveItems(workspaceId: string, batchId: string, itemIds: string[]): void {
  for (const itemId of itemIds) {
    updateItem(workspaceId, batchId, itemId, { status: 'approved' });
  }
}

/** Reject all listed items via updateItem(). */
function rejectItems(workspaceId: string, batchId: string, itemIds: string[]): void {
  for (const itemId of itemIds) {
    updateItem(workspaceId, batchId, itemId, { status: 'rejected' });
  }
}

/** Reset all listed items back to pending (from approved or rejected). */
function resetToPending(workspaceId: string, batchId: string, itemIds: string[]): void {
  // Read current statuses before resetting so we use the correct undo transition
  const batch = getBatch(workspaceId, batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);
  for (const item of batch.items) {
    if (itemIds.includes(item.id) && item.status !== 'pending') {
      updateItem(workspaceId, batchId, item.id, { status: 'pending' });
    }
  }
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe('recalcBatchStatus — exhaustive item combinations', () => {
  let workspaceId: string;
  let batchId: string;
  let itemIds: string[];   // [item0, item1, item2]
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedApprovalData(3);
    workspaceId = seed.workspaceId;
    batchId     = seed.batchId;
    itemIds     = seed.itemIds;
    cleanup     = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  // ── 1. [P, P, P] → pending ─────────────────────────────────────────────

  it('1. [P, P, P] — all pending → batch pending (initial state)', () => {
    const batch = getBatch(workspaceId, batchId);
    expect(batch).not.toBeUndefined();

    expect(batch!.status).toBe('pending');
    expect(batch!.items.length).toBeGreaterThan(0);
    expect(batch!.items.every(i => i.status === 'pending')).toBe(true);
  });

  // ── 2. [A, P, P] → partial ─────────────────────────────────────────────

  it('2. [A, P, P] — one approved → batch partial', () => {
    approveItems(workspaceId, batchId, [itemIds[0]]);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('partial');
    expect(batch.items.find(i => i.id === itemIds[0])!.status).toBe('approved');
    expect(batch.items.find(i => i.id === itemIds[1])!.status).toBe('pending');
    expect(batch.items.find(i => i.id === itemIds[2])!.status).toBe('pending');
  });

  // ── 3. [R, P, P] → partial ─────────────────────────────────────────────

  it('3. [R, P, P] — one rejected, others pending → batch partial', () => {
    // Reset item0 from approved → pending, then reject it
    resetToPending(workspaceId, batchId, [itemIds[0]]);
    rejectItems(workspaceId, batchId, [itemIds[0]]);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('partial');
    expect(batch.items.find(i => i.id === itemIds[0])!.status).toBe('rejected');
    expect(batch.items.find(i => i.id === itemIds[1])!.status).toBe('pending');
    expect(batch.items.find(i => i.id === itemIds[2])!.status).toBe('pending');
  });

  // ── 4. [A, R, P] → partial ─────────────────────────────────────────────

  it('4. [A, R, P] — mixed approved/rejected/pending → batch partial', () => {
    // item0: rejected → pending → approved
    resetToPending(workspaceId, batchId, [itemIds[0]]);
    approveItems(workspaceId, batchId, [itemIds[0]]);
    // item1: pending → rejected
    rejectItems(workspaceId, batchId, [itemIds[1]]);
    // item2 stays pending

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('partial');
    expect(batch.items.find(i => i.id === itemIds[0])!.status).toBe('approved');
    expect(batch.items.find(i => i.id === itemIds[1])!.status).toBe('rejected');
    expect(batch.items.find(i => i.id === itemIds[2])!.status).toBe('pending');
  });

  // ── 5. [A, A, A] → approved ────────────────────────────────────────────

  it('5. [A, A, A] — all approved → batch approved', () => {
    // item0: already approved; item1: rejected → pending → approved; item2: pending → approved
    resetToPending(workspaceId, batchId, [itemIds[1]]);
    approveItems(workspaceId, batchId, [itemIds[1], itemIds[2]]);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('approved');
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.every(i => i.status === 'approved')).toBe(true);
  });

  // ── 6. [R, R, R] → rejected ────────────────────────────────────────────

  it('6. [R, R, R] — all rejected → batch rejected', () => {
    // All items are currently approved; reset each to pending then reject
    resetToPending(workspaceId, batchId, itemIds);
    rejectItems(workspaceId, batchId, itemIds);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('rejected');
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.every(i => i.status === 'rejected')).toBe(true);
  });

  // ── 7. [A, R, R] → partial ─────────────────────────────────────────────

  it('7. [A, R, R] — one approved, rest rejected → batch partial', () => {
    // item0: rejected → pending → approved; item1 & item2 stay rejected
    resetToPending(workspaceId, batchId, [itemIds[0]]);
    approveItems(workspaceId, batchId, [itemIds[0]]);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('partial');
    expect(batch.items.find(i => i.id === itemIds[0])!.status).toBe('approved');
    expect(batch.items.find(i => i.id === itemIds[1])!.status).toBe('rejected');
    expect(batch.items.find(i => i.id === itemIds[2])!.status).toBe('rejected');
  });

  // ── 8. [App, App, App] → applied ───────────────────────────────────────

  it('8. [App, App, App] — all applied → batch applied', () => {
    // item0: approved → applied via markBatchApplied
    // item1 & item2: rejected → pending → approved → applied
    resetToPending(workspaceId, batchId, [itemIds[1], itemIds[2]]);
    approveItems(workspaceId, batchId, [itemIds[1], itemIds[2]]);
    // Now all 3 items are approved; mark them all applied
    markBatchApplied(workspaceId, batchId, itemIds);

    const batch = getBatch(workspaceId, batchId)!;
    expect(batch.status).toBe('applied');
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.every(i => i.status === 'applied')).toBe(true);
  });

  // ── 9. [A, App, P] → partial ───────────────────────────────────────────
  //
  // 'applied' is terminal — cannot be reversed. We need a fresh batch to get
  // a clean state with mixed approved/applied/pending.

  it('9. [A, App, P] — approved + applied + pending → batch partial', () => {
    // Seed a fresh 3-item batch so we are not blocked by applied terminal items
    const fresh = seedApprovalData(3);
    try {
      const { workspaceId: ws, batchId: bid, itemIds: iids } = fresh;

      // item0: pending → approved (leave as approved)
      approveItems(ws, bid, [iids[0]]);
      // item1: pending → approved → applied
      approveItems(ws, bid, [iids[1]]);
      markBatchApplied(ws, bid, [iids[1]]);
      // item2: stays pending

      const batch = getBatch(ws, bid)!;
      expect(batch.status).toBe('partial');
      expect(batch.items.find(i => i.id === iids[0])!.status).toBe('approved');
      expect(batch.items.find(i => i.id === iids[1])!.status).toBe('applied');
      expect(batch.items.find(i => i.id === iids[2])!.status).toBe('pending');
    } finally {
      fresh.cleanup();
    }
  });

  // ── 10. [A, App, App] → approved ───────────────────────────────────────
  //
  // Rule 2: all items are either 'approved' or 'applied' → batch 'approved'.
  // (Rule 1 only fires when ALL items are applied.)

  it('10. [A, App, App] — approved + applied + applied → batch approved (rule 2)', () => {
    // Seed a fresh 3-item batch
    const fresh = seedApprovalData(3);
    try {
      const { workspaceId: ws, batchId: bid, itemIds: iids } = fresh;

      // item0: pending → approved (remains approved)
      approveItems(ws, bid, [iids[0]]);
      // item1 & item2: pending → approved → applied
      approveItems(ws, bid, [iids[1], iids[2]]);
      markBatchApplied(ws, bid, [iids[1], iids[2]]);

      const batch = getBatch(ws, bid)!;
      expect(batch.status).toBe('approved');
      expect(batch.items.find(i => i.id === iids[0])!.status).toBe('approved');
      expect(batch.items.find(i => i.id === iids[1])!.status).toBe('applied');
      expect(batch.items.find(i => i.id === iids[2])!.status).toBe('applied');
    } finally {
      fresh.cleanup();
    }
  });
});
