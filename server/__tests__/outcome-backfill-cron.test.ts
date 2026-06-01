/**
 * Task 2.7 — outcome-backfill-cron.test.ts
 *
 * Verifies that a published content_post with NO existing tracked action
 * gets one after runBackfill() is called, and that re-running runBackfill()
 * does NOT create a duplicate (idempotency contract).
 *
 * This test exercises the same code path that the weekly cron triggers.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { runBackfill } from '../../server/outcome-backfill.js';
import { getActionBySource } from '../../server/outcome-tracking.js';

const WS_BASE = 'backfill-cron-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Backfill Cron Test WS', 'test-folder', new Date().toISOString());
}

function seedPublishedPost(workspaceId: string, postId: string): string {
  db.prepare(`
    INSERT OR IGNORE INTO content_posts
      (id, workspace_id, brief_id, target_keyword, title,
       meta_description, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    postId,
    workspaceId,
    `brief-${postId}`,
    'test backfill keyword',
    'Test Backfill Post',
    'Test meta description',
    new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
    new Date().toISOString(),
    new Date().toISOString(),
  );
  return postId;
}

afterAll(() => {
  // Clean up in reverse FK order
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (
      SELECT id FROM tracked_actions WHERE workspace_id LIKE ?
    )
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`
    DELETE FROM content_posts WHERE workspace_id LIKE ?
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

describe('runBackfill — published post with no tracked action', () => {
  it('creates a tracked action for a published post that has none', () => {
    const ws = `${WS_BASE}-creates`;
    seedWorkspace(ws);
    const postId = `post-backfill-cron-${Date.now()}`;
    seedPublishedPost(ws, postId);

    // Confirm no tracked action exists yet
    const before = getActionBySource('post', postId);
    expect(before).toBeNull();

    // Run backfill scoped to this workspace
    const result = runBackfill(ws); // ws-scope-ok

    expect(result.backfilledCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    // Confirm a tracked action now exists
    const after = getActionBySource('post', postId);
    expect(after).not.toBeNull();
    expect(after!.sourceType).toBe('post');
    expect(after!.sourceId).toBe(postId);
    expect(after!.actionType).toBe('content_published');
  });
});

describe('runBackfill — idempotency contract', () => {
  it('does not create a duplicate action when backfill is run twice', () => {
    const ws = `${WS_BASE}-idempotent`;
    seedWorkspace(ws);
    const postId = `post-idempotent-${Date.now()}`;
    seedPublishedPost(ws, postId);

    // First run — should backfill
    const first = runBackfill(ws); // ws-scope-ok
    expect(first.backfilledCount).toBeGreaterThanOrEqual(1);

    // Count actions after first run
    const countAfterFirst = (
      db.prepare(`SELECT COUNT(*) as n FROM tracked_actions WHERE source_type = 'post' AND source_id = ?`)
        .get(postId) as { n: number }
    ).n;
    expect(countAfterFirst).toBe(1);

    // Second run — should be a no-op (idempotent)
    const second = runBackfill(ws); // ws-scope-ok
    expect(second.backfilledCount).toBe(0);
    expect(second.errors).toBe(0);

    // Count must still be 1
    const countAfterSecond = (
      db.prepare(`SELECT COUNT(*) as n FROM tracked_actions WHERE source_type = 'post' AND source_id = ?`)
        .get(postId) as { n: number }
    ).n;
    expect(countAfterSecond).toBe(1);
  });
});
