import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the five family adapters the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  cancelApprovalBatchDeliverable,
  mirrorApprovalBatchToDeliverable,
  syncApprovalBatchDeliverableStatus,
} from '../../server/domains/inbox/approval-batch-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals.js';

const WS = 'approval-dualwrite-test';

function item(over: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: `ai_${Math.random().toString(36).slice(2, 8)}`,
    pageId: 'page-1',
    pageTitle: 'Home',
    pageSlug: 'home',
    field: 'seoTitle',
    currentValue: 'old',
    proposedValue: 'new',
    status: 'pending',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function batch(over: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: `ab_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: WS,
    siteId: 'site-1',
    name: 'SEO Changes',
    items: [item()],
    status: 'pending',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

describe('approval-batch dual-write mirror', () => {
  it('mirrors a client_deliverable row with the correct type + items', () => {
    const b = batch({
      name: 'SEO Editor — 2 pages',
      items: [
        item({ field: 'seoTitle', proposedValue: 'T' }),
        item({ pageId: 'page-2', field: 'seoDescription', proposedValue: 'D' }),
      ],
    });
    const mirrored = mirrorApprovalBatchToDeliverable(WS, b, { note: 'please review' });
    expect(mirrored).not.toBeNull();
    expect(mirrored!.type).toBe('seo_edit'); // classifier resolves the default sub-type
    expect(mirrored!.kind).toBe('batch');
    expect(mirrored!.status).toBe('awaiting_client');
    expect(mirrored!.note).toBe('please review');
    expect(mirrored!.sourceRef).toBe(`seo_edit:${b.id}`);

    const rows = listDeliverables(WS);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(mirrored!.id);
  });

  it('respects an explicit content_plan type (content-plan seams)', () => {
    const b = batch({
      name: 'Content Plan: Spring — Sample Review (2 pages)',
      items: [item({ field: 'content_plan_sample' }), item({ pageId: 'p2', field: 'content_plan_sample' })],
    });
    const mirrored = mirrorApprovalBatchToDeliverable(WS, b, { type: 'content_plan_sample' });
    expect(mirrored!.type).toBe('content_plan_sample');
    expect(mirrored!.sourceRef).toBe(`content_plan_sample:${b.id}`);
  });

  it('is idempotent (re-mirroring the same batch updates one row)', () => {
    const b = batch();
    const first = mirrorApprovalBatchToDeliverable(WS, b);
    const second = mirrorApprovalBatchToDeliverable(WS, b);
    expect(second!.id).toBe(first!.id);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('rejects an empty batch via validateSendable (no row, no throw)', () => {
    const result = mirrorApprovalBatchToDeliverable(WS, batch({ items: [] }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });
});

// ── Mirror lifecycle — status sync, cancel, DELIVERABLE_SENT (2026-06-09 audit, PR 2) ──
// The send-time mirror previously never broadcast (clients with the Inbox open saw no new
// Decisions), and NOTHING moved the mirror on legacy respond or batch delete (permanent
// ghost cards). These tests pin the lifecycle helpers + broadcasts.
describe('approval-batch mirror lifecycle (sync / cancel / DELIVERABLE_SENT)', () => {
  let events: Array<{ workspaceId: string; event: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    events = [];
    setBroadcast(
      () => {},
      (workspaceId, event, data) => events.push({ workspaceId, event, data: data as Record<string, unknown> }),
    );
  });

  function eventsOf(name: string) {
    return events.filter(e => e.event === name);
  }

  it('broadcasts DELIVERABLE_SENT exactly once on successful mirror creation', () => {
    const mirrored = mirrorApprovalBatchToDeliverable(WS, batch(), { note: 'please review' });
    expect(mirrored).not.toBeNull();
    const sent = eventsOf(WS_EVENTS.DELIVERABLE_SENT);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.deliverableId).toBe(mirrored!.id);
    expect(sent[0].workspaceId).toBe(WS);
  });

  it('does not broadcast when the adapter rejects the batch', () => {
    expect(mirrorApprovalBatchToDeliverable(WS, batch({ items: [] }))).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("syncs the mirror to an 'approved' batch decision and broadcasts DELIVERABLE_UPDATED", () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    events = [];

    const synced = syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'approved' });

    expect(synced?.status).toBe('approved');
    expect(synced?.decidedAt).toBeTruthy();
    const updated = eventsOf(WS_EVENTS.DELIVERABLE_UPDATED);
    expect(updated).toHaveLength(1);
    expect(updated[0].data.status).toBe('approved');
  });

  it("maps a 'rejected' batch to deliverable 'changes_requested'", () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    const synced = syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'rejected' });
    expect(synced?.status).toBe('changes_requested');
  });

  it("maps a 'partial' batch to deliverable 'partial'", () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    const synced = syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'partial' });
    expect(synced?.status).toBe('partial');
  });

  it('is a no-op without a broadcast when the mirror already has the target status (unified-path idempotency)', () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'approved' });
    events = [];

    const again = syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'approved' });

    expect(again?.status).toBe('approved');
    expect(events).toHaveLength(0);
  });

  it('skips an illegal transition instead of throwing (cancelled is terminal)', () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    cancelApprovalBatchDeliverable(WS, b);
    events = [];

    const result = syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'approved' });

    expect(result?.status).toBe('cancelled');
    expect(events).toHaveLength(0);
  });

  it('cancelApprovalBatchDeliverable moves the mirror to cancelled and broadcasts DELIVERABLE_UPDATED', () => {
    const b = batch();
    const mirrored = mirrorApprovalBatchToDeliverable(WS, b);
    events = [];

    const cancelled = cancelApprovalBatchDeliverable(WS, b);

    expect(cancelled?.id).toBe(mirrored!.id);
    expect(cancelled?.status).toBe('cancelled');
    const updated = eventsOf(WS_EVENTS.DELIVERABLE_UPDATED);
    expect(updated).toHaveLength(1);
    expect(updated[0].data.status).toBe('cancelled');
  });

  it('sync and cancel return null without throwing when no mirror exists', () => {
    const b = batch();
    expect(syncApprovalBatchDeliverableStatus(WS, { ...b, status: 'approved' })).toBeNull();
    expect(cancelApprovalBatchDeliverable(WS, b)).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("sync is a no-op for a still-'pending' batch (nothing to project)", () => {
    const b = batch();
    mirrorApprovalBatchToDeliverable(WS, b);
    events = [];
    expect(syncApprovalBatchDeliverableStatus(WS, b)).toBeNull();
    expect(events).toHaveLength(0);
  });
});
