/**
 * Legacy respond → deliverable mirror sync (2026-06-09 audit, PR 2 Task 3).
 *
 * The legacy public approve / per-item routes drive respondToApprovalBatch /
 * respondToApprovalBatchItem, which previously mutated ONLY the legacy batch — the
 * client_deliverable mirror stayed awaiting_client, so the unified Inbox kept nagging
 * the client about a batch they already decided. Both services must sync the mirror
 * after the source write, idempotently (the unified respondToDeliverable path calls the
 * SAME services after moving the mirror itself — the sync must then be a no-op).
 *
 * Real-DB integration: real approvals store + real deliverable store + real sync helper;
 * only email is implicitly inert (no SMTP in tests) and broadcast is captured via
 * setBroadcast. Port: none (no HTTP server booted).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { createBatch } from '../../server/approvals.js';
import {
  mirrorApprovalBatchToDeliverable,
  syncApprovalBatchDeliverableStatus,
} from '../../server/domains/inbox/approval-batch-dual-write.js';
import { respondToApprovalBatch } from '../../server/domains/inbox/approval-batch-respond.js';
import { respondToApprovalBatchItem } from '../../server/domains/inbox/approval-batch-item-respond.js';
import { findBySourceRef, upsertDeliverable } from '../../server/client-deliverables.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let workspace: SeededFullWorkspace;
let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  workspace = seedWorkspace();
  events = [];
  setBroadcast(
    () => {},
    (_workspaceId, event, data) => events.push({ event, data: data as Record<string, unknown> }),
  );
});

afterEach(() => {
  workspace.cleanup();
});

function sendMirroredBatch(items = 2) {
  const wsId = workspace.workspaceId;
  const batch = createBatch(
    wsId,
    'site-1',
    'SEO Changes',
    Array.from({ length: items }, (_, i) => ({
      pageId: `page-${i}`,
      pageTitle: `Page ${i}`,
      pageSlug: `/page-${i}`,
      field: 'seoTitle',
      currentValue: 'old',
      proposedValue: `new ${i}`,
    })),
  );
  const mirror = mirrorApprovalBatchToDeliverable(wsId, batch, { source: 'test' });
  expect(mirror).not.toBeNull();
  expect(mirror!.status).toBe('awaiting_client');
  return { wsId, batch, mirror: mirror! };
}

function readMirror(wsId: string, batchId: string) {
  return findBySourceRef(wsId, 'seo_edit', `seo_edit:${batchId}`);
}

describe('legacy respond paths sync the deliverable mirror', () => {
  it('whole-batch approve through respondToApprovalBatch moves the mirror to approved', () => {
    const { wsId, batch } = sendMirroredBatch();

    const result = respondToApprovalBatch(wsId, batch.id, 'approved', { note: 'looks great' });

    expect(result?.itemsUpdated).toBe(2);
    const mirror = readMirror(wsId, batch.id);
    expect(mirror?.status).toBe('approved');
    expect(mirror?.decidedAt).toBeTruthy();
    expect(events.filter(e => e.event === WS_EVENTS.DELIVERABLE_UPDATED)).toHaveLength(1);
  });

  it('whole-batch reject moves the mirror to changes_requested and carries the client note', () => {
    const { wsId, batch } = sendMirroredBatch();

    respondToApprovalBatch(wsId, batch.id, 'rejected', { note: 'please revise' });

    const mirror = readMirror(wsId, batch.id);
    expect(mirror?.status).toBe('changes_requested');
    expect(mirror?.clientResponseNote).toBe('please revise');
  });

  it('per-item respond projects a partial decision onto the mirror', () => {
    const { wsId, batch } = sendMirroredBatch(2);

    const result = respondToApprovalBatchItem({
      workspaceId: wsId,
      batchId: batch.id,
      itemId: batch.items[0].id,
      update: { status: 'approved' },
    });

    expect(result).not.toBeNull();
    // One of two items decided → legacy batch status 'partial' → mirror 'partial'.
    expect(result!.batch.status).toBe('partial');
    expect(readMirror(wsId, batch.id)?.status).toBe('partial');
  });

  it('is idempotent when the mirror was already moved (unified respond path)', () => {
    const { wsId, batch } = sendMirroredBatch();

    // Simulate the unified path having already moved the mirror.
    syncApprovalBatchDeliverableStatus(wsId, { ...batch, status: 'approved' });
    expect(readMirror(wsId, batch.id)?.status).toBe('approved');
    const decidedAt = readMirror(wsId, batch.id)?.decidedAt;
    events = [];

    respondToApprovalBatch(wsId, batch.id, 'approved');

    const mirror = readMirror(wsId, batch.id);
    expect(mirror?.status).toBe('approved');
    expect(mirror?.decidedAt).toBe(decidedAt);
    // No second DELIVERABLE_UPDATED churn from the sync (legacy APPROVAL_UPDATE still fires).
    expect(events.filter(e => e.event === WS_EVENTS.DELIVERABLE_UPDATED)).toHaveLength(0);
  });

  it('unified DECLINE echo: a declined mirror is left untouched when the batch recalcs to rejected', () => {
    // respondToDeliverable moves the mirror to 'declined' (terminal) FIRST, then drives
    // this same respond service with decision 'rejected' (target changes_requested). The
    // sync must leave the mirror declined — silently (debug, not warn), no broadcast.
    const { wsId, batch, mirror } = sendMirroredBatch();
    syncApprovalBatchDeliverableStatus(wsId, batch); // no-op warm-up (pending)
    // Simulate the unified path: force the mirror terminal via the store.
    upsertDeliverable({
      id: mirror.id, workspaceId: wsId, type: mirror.type, kind: mirror.kind,
      status: 'declined', title: mirror.title, payload: mirror.payload, sourceRef: mirror.sourceRef,
    });
    events = [];

    respondToApprovalBatch(wsId, batch.id, 'rejected', { note: 'no thanks' });

    expect(readMirror(wsId, batch.id)?.status).toBe('declined');
    expect(events.filter(e => e.event === WS_EVENTS.DELIVERABLE_UPDATED)).toHaveLength(0);
  });

  it('R3 subset-approve echo: an approved mirror is left untouched when the batch recalcs to partial', () => {
    const { wsId, batch } = sendMirroredBatch(2);
    // Unified path approves the deliverable (mirror → approved) with one flagged item,
    // so the legacy batch recalcs to 'partial' via the per-item decisions.
    syncApprovalBatchDeliverableStatus(wsId, { ...batch, status: 'approved' });
    events = [];

    respondToApprovalBatch(wsId, batch.id, 'approved', {
      itemDecisions: [
        { legacyItemId: batch.items[0].id, status: 'approved' },
        { legacyItemId: batch.items[1].id, status: 'rejected', note: 'hold this one' },
      ],
    });

    expect(readMirror(wsId, batch.id)?.status).toBe('approved');
    expect(events.filter(e => e.event === WS_EVENTS.DELIVERABLE_UPDATED)).toHaveLength(0);
  });

  it('respond on an unmirrored batch still succeeds (sync is best-effort)', () => {
    const wsId = workspace.workspaceId;
    const batch = createBatch(wsId, 'site-1', 'Unmirrored', [{
      pageId: 'p', pageTitle: 'P', pageSlug: '/p', field: 'seoTitle', currentValue: 'a', proposedValue: 'b',
    }]);

    const result = respondToApprovalBatch(wsId, batch.id, 'approved');

    expect(result?.itemsUpdated).toBe(1);
    expect(readMirror(wsId, batch.id)).toBeNull();
  });
});
