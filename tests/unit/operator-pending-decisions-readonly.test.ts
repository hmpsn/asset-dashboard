import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createBatch } from '../../server/approvals.js';
import { MCP_OPERATOR_BRIEF_LIMITS } from '../../shared/types/mcp-operator-briefs.js';
import {
  readAllOperatorPendingDecisions,
  readOperatorPendingDecisions,
} from '../../server/domains/analytics-intelligence/operator-pending-decisions.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let workspace: SeededFullWorkspace | undefined;
let additionalWorkspaces: SeededFullWorkspace[] = [];

afterEach(() => {
  for (const additionalWorkspace of additionalWorkspaces) additionalWorkspace.cleanup();
  additionalWorkspaces = [];
  workspace?.cleanup();
  workspace = undefined;
});

function insertPendingRequest(
  workspaceId: string,
  id: string,
  priority: string,
  createdAt: string,
): void {
  db.prepare(`
    INSERT INTO requests (
      id, workspace_id, title, description, category, priority, status, attachments, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, '', 'other', ?, 'new', '[]', '[]', ?, ?)
  `).run(id, workspaceId, `Request ${id}`, priority, createdAt, createdAt);
}

function insertPendingClientAction(
  workspaceId: string,
  id: string,
  priority: string,
  createdAt: string,
): void {
  db.prepare(`
    INSERT INTO client_actions (
      id, workspace_id, source_type, title, summary, payload, status, priority, created_at, updated_at
    ) VALUES (?, ?, 'aeo_change', ?, '', '{}', 'pending', ?, ?, ?)
  `).run(id, workspaceId, `Action ${id}`, priority, createdAt, createdAt);
}

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

  it('orders the SQL-limited projection by priority, creation time, source type, then source id', () => {
    workspace = seedWorkspace();
    insertPendingRequest(workspace.workspaceId, 'low-old', 'low', '2020-01-01T00:00:00.000Z');
    insertPendingRequest(workspace.workspaceId, 'urgent-late', 'urgent', '2026-01-01T00:00:00.000Z');
    insertPendingRequest(workspace.workspaceId, 'high-later', 'high', '2026-02-01T00:00:00.000Z');
    insertPendingRequest(workspace.workspaceId, 'high-earlier', 'high', '2026-01-01T00:00:00.000Z');
    insertPendingRequest(workspace.workspaceId, 'tie-request-b', 'medium', '2026-03-01T00:00:00.000Z');
    insertPendingRequest(workspace.workspaceId, 'tie-request-a', 'medium', '2026-03-01T00:00:00.000Z');
    insertPendingClientAction(
      workspace.workspaceId,
      'tie-action',
      'medium',
      '2026-03-01T00:00:00.000Z',
    );
    db.prepare(`
      INSERT INTO approval_batches (
        id, workspace_id, site_id, name, items, status, created_at, updated_at
      ) VALUES (?, ?, 'site-order', 'Order review', ?, 'pending', ?, ?)
    `).run(
      'tie-batch',
      workspace.workspaceId,
      JSON.stringify([{
        id: 'tie-approval',
        status: 'pending',
        pageTitle: 'Page',
        field: 'seoTitle',
        createdAt: '2026-03-01T00:00:00.000Z',
      }]),
      '2026-03-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );

    const projection = readOperatorPendingDecisions(workspace.workspaceId);

    expect(projection.items.map((item) => item.sourceId)).toEqual([
      'urgent-late',
      'high-earlier',
      'high-later',
      'tie-approval',
      'tie-action',
      'tie-request-a',
      'tie-request-b',
      'low-old',
    ]);
  });

  it('keeps exact counts while SQL caps per-workspace and portfolio drill-down rows', () => {
    workspace = seedWorkspace();
    const actionWorkspace = seedWorkspace();
    const archivedWorkspace = seedWorkspace();
    additionalWorkspaces = [actionWorkspace, archivedWorkspace];
    const tiedAt = '2026-04-01T00:00:00.000Z';

    for (let index = 31; index >= 0; index -= 1) {
      insertPendingRequest(
        workspace.workspaceId,
        `bounded-request-${String(index).padStart(2, '0')}`,
        'urgent',
        tiedAt,
      );
    }
    for (let index = 28; index >= 0; index -= 1) {
      insertPendingClientAction(
        actionWorkspace.workspaceId,
        `bounded-action-${String(index).padStart(2, '0')}`,
        'high',
        tiedAt,
      );
    }
    insertPendingRequest(archivedWorkspace.workspaceId, 'archived-request', 'urgent', tiedAt);
    db.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?')
      .run(tiedAt, archivedWorkspace.workspaceId);

    const workspaceProjection = readOperatorPendingDecisions(workspace.workspaceId);
    const portfolioProjection = readAllOperatorPendingDecisions();
    const requestPortfolio = portfolioProjection.get(workspace.workspaceId);
    const actionPortfolio = portfolioProjection.get(actionWorkspace.workspaceId);

    expect(workspaceProjection).toMatchObject({
      total: 32,
      counts: { approvals: 0, requests: 32, clientActions: 0 },
    });
    expect(workspaceProjection.items).toHaveLength(25);
    expect(workspaceProjection.items.map((item) => item.sourceId)).toEqual(
      Array.from({ length: 25 }, (_, index) => `bounded-request-${String(index).padStart(2, '0')}`),
    );
    expect(requestPortfolio).toMatchObject({
      total: 32,
      counts: { approvals: 0, requests: 32, clientActions: 0 },
    });
    expect(requestPortfolio?.items).toHaveLength(
      MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace,
    );
    expect(requestPortfolio?.items.map((item) => item.sourceId)).toEqual(
      Array.from(
        { length: MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace },
        (_, index) => `bounded-request-${String(index).padStart(2, '0')}`,
      ),
    );
    expect(actionPortfolio).toMatchObject({
      total: 29,
      counts: { approvals: 0, requests: 0, clientActions: 29 },
    });
    expect(actionPortfolio?.items).toHaveLength(
      MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace,
    );
    expect(actionPortfolio?.items.map((item) => item.sourceId)).toEqual(
      Array.from(
        { length: MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace },
        (_, index) => `bounded-action-${String(index).padStart(2, '0')}`,
      ),
    );
    expect(portfolioProjection.has(archivedWorkspace.workspaceId)).toBe(false);
  });
});
