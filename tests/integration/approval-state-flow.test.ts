// tests/integration/approval-state-flow.test.ts
// Integration tests for the full approval lifecycle with state machine guards.
// Covers: create → review → apply, guard enforcement, batch status derivation,
// markBatchApplied transitions, and concurrent batch isolation.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// vi.mock must be at module level for hoisting
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { seedApprovalData } from '../fixtures/approval-seed.js';
import {
  createBatch,
  getBatch,
  updateItem,
  markBatchApplied,
  listBatches,
} from '../../server/approvals.js';
import { InvalidTransitionError } from '../../server/state-machines.js';

// ---------------------------------------------------------------------------
// Group 1: Full lifecycle — create → review → apply
// ---------------------------------------------------------------------------

describe('approval state flow — full lifecycle', () => {
  let workspaceId: string;
  let batchId: string;
  let itemIds: string[];
  let cleanup: () => void;

  beforeAll(() => {
    ({ workspaceId, batchId, itemIds, cleanup } = seedApprovalData(3));
  });

  afterAll(() => {
    cleanup();
  });

  it('all items start as pending, batch status is pending', () => {
    const batch = getBatch(workspaceId, batchId);
    expect(batch).not.toBeNull();
    expect(batch!.status).toBe('pending');
    expect(batch!.items.length).toBeGreaterThan(0);
    expect(batch!.items.every(i => i.status === 'pending')).toBe(true);
  });

  it('approving item 1 sets its status to approved, batch becomes partial', () => {
    const updated = updateItem(workspaceId, batchId, itemIds[0], { status: 'approved' });
    expect(updated).not.toBeNull();
    const item = updated!.items.find(i => i.id === itemIds[0]);
    expect(item!.status).toBe('approved');
    expect(updated!.status).toBe('partial');
  });

  it('rejecting item 2 sets its status to rejected, batch stays partial', () => {
    const updated = updateItem(workspaceId, batchId, itemIds[1], { status: 'rejected' });
    expect(updated).not.toBeNull();
    const item = updated!.items.find(i => i.id === itemIds[1]);
    expect(item!.status).toBe('rejected');
    expect(updated!.status).toBe('partial');
  });

  it('approving item 3 keeps batch partial (item 2 still rejected)', () => {
    const updated = updateItem(workspaceId, batchId, itemIds[2], { status: 'approved' });
    expect(updated).not.toBeNull();
    const item = updated!.items.find(i => i.id === itemIds[2]);
    expect(item!.status).toBe('approved');
    // item 2 is rejected, so batch cannot be 'approved'
    expect(updated!.status).toBe('partial');
  });

  it('undoing rejection on item 2 (rejected → pending) then approving it sets batch to approved', () => {
    // undo rejection: rejected → pending
    const undone = updateItem(workspaceId, batchId, itemIds[1], { status: 'pending' });
    expect(undone).not.toBeNull();
    const itemAfterUndo = undone!.items.find(i => i.id === itemIds[1]);
    expect(itemAfterUndo!.status).toBe('pending');

    // now approve
    const approved = updateItem(workspaceId, batchId, itemIds[1], { status: 'approved' });
    expect(approved).not.toBeNull();
    const itemAfterApprove = approved!.items.find(i => i.id === itemIds[1]);
    expect(itemAfterApprove!.status).toBe('approved');
    // all items are now approved → batch should be 'approved'
    expect(approved!.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Group 2: State guard enforcement
// ---------------------------------------------------------------------------

describe('approval state flow — state guard enforcement', () => {
  let workspaceId: string;
  let batchId: string;
  let itemIds: string[];
  let cleanup: () => void;

  beforeAll(() => {
    ({ workspaceId, batchId, itemIds, cleanup } = seedApprovalData(3));
  });

  afterAll(() => {
    cleanup();
  });

  it('cannot transition pending → applied directly', () => {
    expect(() =>
      updateItem(workspaceId, batchId, itemIds[0], { status: 'applied' }),
    ).toThrow(InvalidTransitionError);
  });

  it('cannot transition rejected → approved directly (must undo to pending first)', () => {
    // First, reject an item
    updateItem(workspaceId, batchId, itemIds[1], { status: 'rejected' });
    // Attempt direct rejected → approved
    expect(() =>
      updateItem(workspaceId, batchId, itemIds[1], { status: 'approved' }),
    ).toThrow(InvalidTransitionError);
  });

  it('cannot transition applied → pending (terminal state)', () => {
    // Get item to applied state: pending → approved → applied
    updateItem(workspaceId, batchId, itemIds[2], { status: 'approved' });
    markBatchApplied(workspaceId, batchId, [itemIds[2]]);

    // Verify item is applied
    const batch = getBatch(workspaceId, batchId);
    const item = batch!.items.find(i => i.id === itemIds[2]);
    expect(item!.status).toBe('applied');

    // Attempt to move back to pending — should throw
    expect(() =>
      updateItem(workspaceId, batchId, itemIds[2], { status: 'pending' }),
    ).toThrow(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Batch status derivation (recalcBatchStatus)
// ---------------------------------------------------------------------------

describe('approval state flow — batch status derivation', () => {
  // Each sub-test creates its own isolated batch via createBatch for precision

  let workspaceId: string;
  let batchId: string;
  let itemIds: string[];
  let cleanup: () => void;

  beforeAll(() => {
    ({ workspaceId, batchId, itemIds, cleanup } = seedApprovalData(3));
  });

  afterAll(() => {
    cleanup();
  });

  it('all pending → batch status is pending', () => {
    const batch = getBatch(workspaceId, batchId);
    expect(batch).not.toBeNull();
    expect(batch!.items.length).toBeGreaterThan(0);
    expect(batch!.items.every(i => i.status === 'pending')).toBe(true);
    expect(batch!.status).toBe('pending');
  });

  it('all approved → batch status is approved', () => {
    let updated = updateItem(workspaceId, batchId, itemIds[0], { status: 'approved' });
    updated = updateItem(workspaceId, batchId, itemIds[1], { status: 'approved' });
    updated = updateItem(workspaceId, batchId, itemIds[2], { status: 'approved' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('approved');
  });

  it('all rejected → batch status is rejected', () => {
    // Undo approvals first (approved → pending)
    updateItem(workspaceId, batchId, itemIds[0], { status: 'pending' });
    updateItem(workspaceId, batchId, itemIds[1], { status: 'pending' });
    updateItem(workspaceId, batchId, itemIds[2], { status: 'pending' });

    // Reject all
    let updated = updateItem(workspaceId, batchId, itemIds[0], { status: 'rejected' });
    updated = updateItem(workspaceId, batchId, itemIds[1], { status: 'rejected' });
    updated = updateItem(workspaceId, batchId, itemIds[2], { status: 'rejected' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('rejected');
  });

  it('mix of approved + pending → batch status is partial', () => {
    // Undo rejections (rejected → pending)
    updateItem(workspaceId, batchId, itemIds[0], { status: 'pending' });
    updateItem(workspaceId, batchId, itemIds[1], { status: 'pending' });
    updateItem(workspaceId, batchId, itemIds[2], { status: 'pending' });

    // Approve only the first item, leave others pending
    const updated = updateItem(workspaceId, batchId, itemIds[0], { status: 'approved' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('partial');
  });

  it('all applied → batch status is applied', () => {
    // Approve remaining items first
    updateItem(workspaceId, batchId, itemIds[1], { status: 'approved' });
    updateItem(workspaceId, batchId, itemIds[2], { status: 'approved' });

    // Mark all applied
    const updated = markBatchApplied(workspaceId, batchId, itemIds);
    expect(updated).not.toBeNull();
    expect(updated!.items.length).toBeGreaterThan(0);
    expect(updated!.items.every(i => i.status === 'applied')).toBe(true);
    expect(updated!.status).toBe('applied');
  });

  it('mix of approved + applied → batch status is approved', () => {
    // Create a fresh batch for this edge case to have clean state
    const siteId = `site-mix-${Date.now()}`;
    const freshBatch = createBatch(workspaceId, siteId, 'Mix Test Batch', [
      { pageId: '/p0', pageTitle: 'Page 0', pageSlug: 'p0', field: 'seo_title', currentValue: 'curr0', proposedValue: 'prop0' },
      { pageId: '/p1', pageTitle: 'Page 1', pageSlug: 'p1', field: 'seo_title', currentValue: 'curr1', proposedValue: 'prop1' },
    ]);
    const freshIds = freshBatch.items.map(i => i.id);

    // Approve both, then apply only item 0
    updateItem(workspaceId, freshBatch.id, freshIds[0], { status: 'approved' });
    updateItem(workspaceId, freshBatch.id, freshIds[1], { status: 'approved' });
    const updated = markBatchApplied(workspaceId, freshBatch.id, [freshIds[0]]);
    expect(updated).not.toBeNull();

    const item0 = updated!.items.find(i => i.id === freshIds[0]);
    const item1 = updated!.items.find(i => i.id === freshIds[1]);
    expect(item0!.status).toBe('applied');
    expect(item1!.status).toBe('approved');
    // approved + applied → batch should be 'approved'
    expect(updated!.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Group 4: markBatchApplied transitions
// ---------------------------------------------------------------------------

describe('approval state flow — markBatchApplied', () => {
  let workspaceId: string;
  let batchId: string;
  let itemIds: string[];
  let cleanup: () => void;

  beforeAll(() => {
    ({ workspaceId, batchId, itemIds, cleanup } = seedApprovalData(3));
    // Approve all items so they are eligible for markBatchApplied
    updateItem(workspaceId, batchId, itemIds[0], { status: 'approved' });
    updateItem(workspaceId, batchId, itemIds[1], { status: 'approved' });
    updateItem(workspaceId, batchId, itemIds[2], { status: 'approved' });
  });

  afterAll(() => {
    cleanup();
  });

  it('marks only the specified items as applied, others remain unchanged', () => {
    // Mark only items 0 and 1 applied; item 2 should stay approved
    const updated = markBatchApplied(workspaceId, batchId, [itemIds[0], itemIds[1]]);
    expect(updated).not.toBeNull();

    const item0 = updated!.items.find(i => i.id === itemIds[0]);
    const item1 = updated!.items.find(i => i.id === itemIds[1]);
    const item2 = updated!.items.find(i => i.id === itemIds[2]);

    expect(item0!.status).toBe('applied');
    expect(item1!.status).toBe('applied');
    expect(item2!.status).toBe('approved');
  });

  it('batch recalculates to applied when all items are applied', () => {
    const updated = markBatchApplied(workspaceId, batchId, [itemIds[2]]);
    expect(updated).not.toBeNull();
    expect(updated!.items.length).toBeGreaterThan(0);
    expect(updated!.items.every(i => i.status === 'applied')).toBe(true);
    expect(updated!.status).toBe('applied');
  });

  it('changes persist across getBatch reads', () => {
    const fresh = getBatch(workspaceId, batchId);
    expect(fresh).not.toBeNull();
    expect(fresh!.items.length).toBeGreaterThan(0);
    expect(fresh!.items.every(i => i.status === 'applied')).toBe(true);
    expect(fresh!.status).toBe('applied');
  });
});

// ---------------------------------------------------------------------------
// Group 5: Concurrent batch isolation
// ---------------------------------------------------------------------------

describe('approval state flow — concurrent batch isolation', () => {
  let workspaceId: string;
  let batchIdA: string;
  let batchIdB: string;
  let itemIdsA: string[];
  let itemIdsB: string[];
  let cleanupA: () => void;
  let cleanupB: () => void;

  beforeAll(() => {
    // Seed batch A
    const seedA = seedApprovalData(2);
    workspaceId = seedA.workspaceId;
    batchIdA = seedA.batchId;
    itemIdsA = seedA.itemIds;
    cleanupA = seedA.cleanup;

    // Seed batch B under the same workspace by creating it directly
    const batchB = createBatch(
      workspaceId,
      `site-b-${Date.now()}`,
      'Batch B',
      [
        { pageId: '/b0', pageTitle: 'B Page 0', pageSlug: 'b0', field: 'seo_title', currentValue: 'curr0', proposedValue: 'prop0' },
        { pageId: '/b1', pageTitle: 'B Page 1', pageSlug: 'b1', field: 'seo_title', currentValue: 'curr1', proposedValue: 'prop1' },
      ],
    );
    batchIdB = batchB.id;
    itemIdsB = batchB.items.map(i => i.id);

    // cleanupB only needs to clean the extra batch; cleanupA handles the workspace row
    cleanupB = () => {
      // Batch B rows cleaned up when cleanupA removes workspace rows
    };
  });

  afterAll(() => {
    cleanupA(); // also removes all approval_batches for this workspaceId (including batch B)
  });

  it('both batches exist and start as pending', () => {
    const batches = listBatches(workspaceId);
    const a = batches.find(b => b.id === batchIdA);
    const batchB = batches.find(b => b.id === batchIdB);
    expect(a).not.toBeUndefined();
    expect(batchB).not.toBeUndefined();
    expect(a!.status).toBe('pending');
    expect(batchB!.status).toBe('pending');
  });

  it('approving an item in batch A does not affect batch B', () => {
    updateItem(workspaceId, batchIdA, itemIdsA[0], { status: 'approved' });

    const batchA = getBatch(workspaceId, batchIdA);
    const batchB = getBatch(workspaceId, batchIdB);

    // Batch A should be partial
    expect(batchA!.status).toBe('partial');
    // Batch B should be untouched
    expect(batchB!.status).toBe('pending');
    expect(batchB!.items.length).toBeGreaterThan(0);
    expect(batchB!.items.every(i => i.status === 'pending')).toBe(true);
  });

  it('marking batch A applied does not affect batch B', () => {
    // Approve remaining item in A then apply all
    updateItem(workspaceId, batchIdA, itemIdsA[1], { status: 'approved' });
    markBatchApplied(workspaceId, batchIdA, itemIdsA);

    const batchA = getBatch(workspaceId, batchIdA);
    const batchB = getBatch(workspaceId, batchIdB);

    expect(batchA!.status).toBe('applied');
    // Batch B must remain untouched
    expect(batchB!.status).toBe('pending');
    expect(batchB!.items.length).toBeGreaterThan(0);
    expect(batchB!.items.every(i => i.status === 'pending')).toBe(true);
  });

  it('item IDs from batch A cannot be used to mutate batch B', () => {
    // Attempt to use itemIdsA[0] against batchIdB — should return null (item not found)
    const result = updateItem(workspaceId, batchIdB, itemIdsA[0], { status: 'approved' });
    expect(result).toBeNull();

    // Batch B items remain pending
    const batchB = getBatch(workspaceId, batchIdB);
    expect(batchB!.items.length).toBeGreaterThan(0);
    expect(batchB!.items.every(i => i.status === 'pending')).toBe(true);
  });
});
