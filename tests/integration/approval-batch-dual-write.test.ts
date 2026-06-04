import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the five family adapters the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorApprovalBatchToDeliverable } from '../../server/domains/inbox/approval-batch-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
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
