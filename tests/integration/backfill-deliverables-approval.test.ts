import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { createBatch } from '../../server/approvals.js';
// The barrel self-registers the family adapters the backfill resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  backfillApprovalDeliverables,
  assertEveryBatchResolvesToOneType,
} from '../../scripts/backfill-deliverables-approval.js';
import { listDeliverables } from '../../server/client-deliverables.js';

const WS = 'backfill-approval-test';

function seedBatch(name: string, field: string) {
  return createBatch(WS, 'site-1', name, [
    { pageId: 'page-1', pageTitle: 'P1', pageSlug: 'p1', field, currentValue: 'a', proposedValue: 'b' },
  ]);
}

afterEach(() => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

describe('backfill-deliverables-approval', () => {
  it('classifies and backfills each legacy batch into exactly one type', () => {
    seedBatch('SEO Changes', 'seoTitle');
    seedBatch('[Review] Missing meta description', 'seoDescription');
    seedBatch('Schema Review — 3 pages', 'schema');
    seedBatch('Content Plan: Spring — Sample Review (1 page)', 'content_plan_sample');
    seedBatch('Content Plan: Spring — Template Review', 'content_plan_template');

    const result = backfillApprovalDeliverables();
    expect(result.total).toBe(5);
    expect(result.inserted).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.byType).toEqual({
      seo_edit: 1,
      audit_issue: 1,
      schema_item: 1,
      content_plan_sample: 1,
      content_plan_template: 1,
    });

    const rows = listDeliverables(WS);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(
      ['audit_issue', 'content_plan_sample', 'content_plan_template', 'schema_item', 'seo_edit'].sort(),
    );
  });

  it('is idempotent — a second run inserts nothing (DO-NOTHING on existing sourceRef)', () => {
    seedBatch('SEO Changes', 'seoTitle');
    const first = backfillApprovalDeliverables();
    expect(first.inserted).toBe(1);

    const second = backfillApprovalDeliverables();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('--dry-run classifies + counts but writes nothing', () => {
    seedBatch('SEO Changes', 'seoTitle');
    const result = backfillApprovalDeliverables({ dryRun: true });
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('parity assertion accepts a totally-classifiable set', () => {
    seedBatch('anything goes', 'seoTitle');
    seedBatch('[Review] x', 'seoDescription');
    const rows = db.prepare('SELECT * FROM approval_batches WHERE workspace_id = ?').all(WS);
    expect(rows).toHaveLength(2);
    // The classifier is total, so the parity assertion must not throw.
    expect(() =>
      assertEveryBatchResolvesToOneType([
        { id: 'b1', workspaceId: WS, siteId: 's', name: 'x', items: [], status: 'pending', createdAt: '', updatedAt: '' },
      ]),
    ).not.toThrow();
  });
});
