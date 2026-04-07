// tests/fixtures/approval-seed.ts
// Shared approval fixture for integration tests.
// Creates a workspace + approval batch with items for approval workflow testing.

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededApprovals {
  workspaceId: string;
  batchId: string;
  itemIds: string[];
  cleanup: () => void;
}

/**
 * Creates a workspace with a pending approval batch containing items.
 *
 * Approval items are stored as a JSON array in the `items` TEXT column of
 * `approval_batches` (see server/approvals.ts). Each item conforms to the
 * ApprovalItem interface from shared/types/approvals.ts.
 *
 * @param itemCount Number of approval items to create (default: 3)
 * @param itemType  The field type for items (default: 'seo_title')
 */
export function seedApprovalData(itemCount = 3, itemType = 'seo_title'): SeededApprovals {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-appr-${suffix}`;
  const batchId = `batch-${suffix}`;
  const siteId = `test-site-${suffix}`;
  const now = new Date().toISOString();

  // Insert workspace
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, tier, created_at)
    VALUES (?, ?, ?, ?, 'free', ?)
  `).run(workspaceId, `Approval Test ${suffix}`, `approval-test-${suffix}`, siteId, now);

  // Build approval items as JSON array (stored in items TEXT column)
  const itemIds: string[] = [];
  const items = [];
  for (let i = 0; i < itemCount; i++) {
    const itemId = `item-${suffix}-${i}`;
    itemIds.push(itemId);
    items.push({
      id: itemId,
      pageId: `/page-${i}`,
      pageTitle: `Test Page ${i}`,
      pageSlug: `test-page-${i}`,
      field: itemType,
      currentValue: `Current ${itemType} ${i}`,
      proposedValue: `Proposed ${itemType} ${i}`,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  // Insert approval batch with items JSON
  db.prepare(`
    INSERT INTO approval_batches (id, workspace_id, site_id, name, items, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(batchId, workspaceId, siteId, `Test Batch ${suffix}`, JSON.stringify(items), now, now);

  const cleanup = () => {
    db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, batchId, itemIds, cleanup };
}
