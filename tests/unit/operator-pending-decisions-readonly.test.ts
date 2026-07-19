import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createBatch } from '../../server/approvals.js';
import {
  readOperatorPendingDecisions,
} from '../../server/domains/analytics-intelligence/operator-pending-decisions.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let workspace: SeededFullWorkspace | undefined;

afterEach(() => {
  workspace?.cleanup();
  workspace = undefined;
});

describe('operator pending-decision read boundary', () => {
  it('projects a legacy approval item without healing or updating its stored row', () => {
    workspace = seedWorkspace();
    const batch = createBatch(workspace.workspaceId, 'site-readonly', 'SEO review', [{
      pageId: 'page-1',
      pageTitle: 'Service page',
      pageSlug: 'service-page',
      field: 'seoTitle',
      currentValue: 'Current title',
      proposedValue: 'Proposed title',
    }]);
    const stored = db.prepare(
      'SELECT items, updated_at FROM approval_batches WHERE id = ? AND workspace_id = ?',
    ).get(batch.id, workspace.workspaceId) as { items: string; updated_at: string };
    const items = JSON.parse(stored.items) as Array<Record<string, unknown>>;
    delete items[0]!.status;
    const legacyItems = JSON.stringify(items);
    const fixedUpdatedAt = '2026-07-01T00:00:00.000Z';
    db.prepare(
      'UPDATE approval_batches SET items = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    ).run(legacyItems, fixedUpdatedAt, batch.id, workspace.workspaceId);
    const before = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };

    const projection = readOperatorPendingDecisions(workspace.workspaceId);

    const after = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    const persisted = db.prepare(
      'SELECT items, updated_at FROM approval_batches WHERE id = ? AND workspace_id = ?',
    ).get(batch.id, workspace.workspaceId) as { items: string; updated_at: string };
    expect(projection.counts.approvals).toBe(1);
    expect(projection.items[0]).toMatchObject({
      sourceType: 'approval_item',
      sourceId: batch.items[0]!.id,
      parentId: batch.id,
    });
    expect(after.changes).toBe(before.changes);
    expect(persisted).toEqual({ items: legacyItems, updated_at: fixedUpdatedAt });
  });
});
