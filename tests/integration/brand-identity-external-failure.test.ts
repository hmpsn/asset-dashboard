import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createTestContext } from './helpers.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13228);
const { postJson } = ctx;

let workspace: SeededFullWorkspace;
let originalOpenAiKey: string | undefined;
let originalAnthropicKey: string | undefined;

function countDeliverables(workspaceId: string): number {
  const row = db.prepare('SELECT COALESCE(COUNT(*), 0) AS count FROM brand_identity_deliverables WHERE workspace_id = ?').get(workspaceId) as { count: number };
  return row.count;
}

function countVersions(workspaceId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM brand_identity_versions v
    INNER JOIN brand_identity_deliverables d ON d.id = v.deliverable_id
    WHERE d.workspace_id = ?
  `).get(workspaceId) as { count: number };
  return row.count;
}

function countActivity(workspaceId: string, type: string): number {
  const row = db.prepare('SELECT COALESCE(COUNT(*), 0) AS count FROM activity_log WHERE workspace_id = ? AND type = ?').get(workspaceId, type) as { count: number };
  return row.count;
}

function cleanupWorkspaceRows(workspaceId: string): void {
  db.prepare(`
    DELETE FROM brand_identity_versions
    WHERE deliverable_id IN (
      SELECT id FROM brand_identity_deliverables WHERE workspace_id = ?
    )
  `).run(workspaceId);
  db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ? AND feature = ?').run(workspaceId, 'brandscript_generations');
}

beforeAll(async () => {
  originalOpenAiKey = process.env.OPENAI_API_KEY;
  originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = '';
  process.env.ANTHROPIC_API_KEY = '';
  await ctx.startServer();
}, 30_000);

beforeEach(() => {
  workspace = seedWorkspace({ tier: 'growth' });
  cleanupWorkspaceRows(workspace.workspaceId);
});

afterEach(() => {
  cleanupWorkspaceRows(workspace.workspaceId);
  workspace.cleanup();
});

afterAll(async () => {
  await ctx.stopServer();
});

describe('brand identity external provider failure contracts', () => {
  it('generate failure does not create deliverables, success activity, or net usage increments', async () => {
    const beforeDeliverables = countDeliverables(workspace.workspaceId);
    const beforeSuccessActivity = countActivity(workspace.workspaceId, 'brand_deliverable_generated');
    const beforeUsage = getUsageCount(workspace.workspaceId, 'brandscript_generations');

    const response = await postJson(`/api/brand-identity/${workspace.workspaceId}/generate`, {
      deliverableType: 'mission',
    });

    expect([500, 503]).toContain(response.status);

    const afterDeliverables = countDeliverables(workspace.workspaceId);
    const afterSuccessActivity = countActivity(workspace.workspaceId, 'brand_deliverable_generated');
    const afterUsage = getUsageCount(workspace.workspaceId, 'brandscript_generations');

    expect(afterDeliverables).toBe(beforeDeliverables);
    expect(afterSuccessActivity).toBe(beforeSuccessActivity);
    expect(afterUsage).toBe(beforeUsage);
  });

  it('refine failure does not write new versions, success activity, or net usage increments', async () => {
    const now = new Date().toISOString();
    const deliverableId = `bid_test_${Date.now()}`;
    db.prepare(`
      INSERT INTO brand_identity_deliverables
      (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deliverableId,
      workspace.workspaceId,
      'mission',
      'Existing mission draft.',
      'draft',
      1,
      'professional',
      now,
      now,
    );

    const beforeVersions = countVersions(workspace.workspaceId);
    const beforeRefineActivity = countActivity(workspace.workspaceId, 'brand_deliverable_refined');
    const beforeUsage = getUsageCount(workspace.workspaceId, 'brandscript_generations');

    const response = await postJson(`/api/brand-identity/${workspace.workspaceId}/${deliverableId}/refine`, {
      direction: 'Make it sharper.',
    });

    expect([500, 503]).toContain(response.status);

    const row = db.prepare('SELECT content, version FROM brand_identity_deliverables WHERE id = ?').get(deliverableId) as { content: string; version: number };
    expect(row.content).toBe('Existing mission draft.');
    expect(row.version).toBe(1);
    expect(countVersions(workspace.workspaceId)).toBe(beforeVersions);
    expect(countActivity(workspace.workspaceId, 'brand_deliverable_refined')).toBe(beforeRefineActivity);
    expect(getUsageCount(workspace.workspaceId, 'brandscript_generations')).toBe(beforeUsage);
  });
});
