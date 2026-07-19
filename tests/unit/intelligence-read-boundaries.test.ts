import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createBatch } from '../../server/approvals.js';
import { dismissSignal } from '../../server/churn-signals.js';
import {
  buildWorkspaceIntelligence,
  invalidateIntelligenceCache,
} from '../../server/workspace-intelligence.js';
import {
  seedWorkspace,
  type SeededFullWorkspace,
} from '../fixtures/workspace-seed.js';

let workspace: SeededFullWorkspace | undefined;
const churnSignalIds: string[] = [];

afterEach(() => {
  if (churnSignalIds.length > 0) {
    const placeholders = churnSignalIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM churn_signals WHERE id IN (${placeholders})`).run(
      ...churnSignalIds,
    );
    churnSignalIds.length = 0;
  }
  if (workspace) {
    invalidateIntelligenceCache(workspace.workspaceId);
    workspace.cleanup();
    workspace = undefined;
  }
});

describe('workspace intelligence read boundaries', () => {
  it('normalizes legacy approval statuses without writing through either consuming slice', async () => {
    workspace = seedWorkspace();
    const batch = createBatch(
      workspace.workspaceId,
      'site-intelligence-readonly',
      'Legacy approval review',
      [{
        pageId: 'page-1',
        pageTitle: 'Service page',
        pageSlug: 'service-page',
        field: 'seoTitle',
        currentValue: 'Current title',
        proposedValue: 'Proposed title',
      }],
    );
    const stored = db.prepare(
      'SELECT items FROM approval_batches WHERE id = ? AND workspace_id = ?',
    ).get(batch.id, workspace.workspaceId) as { items: string };
    const items = JSON.parse(stored.items) as Array<Record<string, unknown>>;
    delete items[0]!.status;
    const legacyItems = JSON.stringify(items);
    const fixedUpdatedAt = '2026-07-01T00:00:00.000Z';
    db.prepare(
      'UPDATE approval_batches SET items = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    ).run(legacyItems, fixedUpdatedAt, batch.id, workspace.workspaceId);
    const before = db.prepare('SELECT total_changes() AS changes').get() as {
      changes: number;
    };

    const operational = await buildWorkspaceIntelligence(workspace.workspaceId, {
      slices: ['operational'],
    });
    const clientSignals = await buildWorkspaceIntelligence(workspace.workspaceId, {
      slices: ['clientSignals'],
    });

    const after = db.prepare('SELECT total_changes() AS changes').get() as {
      changes: number;
    };
    const persisted = db.prepare(
      'SELECT items, updated_at FROM approval_batches WHERE id = ? AND workspace_id = ?',
    ).get(batch.id, workspace.workspaceId) as {
      items: string;
      updated_at: string;
    };
    expect(operational.operational?.approvalQueue).toEqual({
      pending: 1,
      oldestAge: expect.any(Number),
    });
    expect(clientSignals.clientSignals?.approvalPatterns).toEqual({
      approvalRate: 0,
      avgResponseTime: null,
    });
    expect(after.changes).toBe(before.changes);
    expect(persisted).toEqual({ items: legacyItems, updated_at: fixedUpdatedAt });
  });

  it('invalidates the cached client-signals slice after a churn signal is dismissed', async () => {
    workspace = seedWorkspace();
    const signalId = `cs_intelligence_dismiss_${Date.now()}`;
    churnSignalIds.push(signalId);
    db.prepare(`
      INSERT INTO churn_signals
        (id, workspace_id, workspace_name, type, severity, title, description, detected_at, dismissed_at)
      VALUES (?, ?, ?, 'no_login_14d', 'warning', 'No recent login', 'Test signal', ?, NULL)
    `).run(
      signalId,
      workspace.workspaceId,
      'Intelligence cache test workspace',
      new Date().toISOString(),
    );

    const beforeDismissal = await buildWorkspaceIntelligence(
      workspace.workspaceId,
      { slices: ['clientSignals'] },
    );
    expect(beforeDismissal.clientSignals?.churnSignals).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: signalId })]),
    );

    expect(dismissSignal(workspace.workspaceId, signalId)).toBe(true);

    const afterDismissal = await buildWorkspaceIntelligence(
      workspace.workspaceId,
      { slices: ['clientSignals'] },
    );
    expect(afterDismissal.clientSignals?.churnSignals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: signalId })]),
    );
  });
});
