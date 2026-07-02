/**
 * W5.1 — outcome-readback-posts.test.ts
 *
 * Verifies enrichPostsWithOutcomes badges PUBLISHED posts with their scored
 * outcome (joined by source id 'post::<postId>' first, keyword fallback second)
 * and leaves unpublished posts and posts with no scored action untouched.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { enrichPostsWithOutcomes } from '../../server/content-posts-db.js';
import type { GeneratedPost } from '../../shared/types/content.js';

const WS_BASE = 'orbp-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS ORBP', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE ?)
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

function makePost(over: Partial<GeneratedPost>): GeneratedPost {
  return {
    id: 'post-1', workspaceId: 'ws', briefId: 'brief-1', targetKeyword: 'kw',
    title: 'T', metaDescription: '', introduction: '', sections: [], conclusion: '',
    totalWordCount: 100, targetWordCount: 100, status: 'approved',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe('enrichPostsWithOutcomes', () => {
  it('badges a published post with its scored outcome via source id', () => {
    const ws = `${WS_BASE}-pub`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'post',
      sourceId: 'post-pub-1',
      pageUrl: '/blog/guide',
      targetKeyword: 'best guide',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 18, clicks: 3 },
    });
    recordOutcome({
      actionId: action.id, checkpointDays: 90,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 7, clicks: 25 },
      score: 'win',
      deltaSummary: { primary_metric: 'position', baseline_value: 18, current_value: 7, delta_absolute: -11, delta_percent: -61, direction: 'improved' },
    });

    const posts = [
      makePost({ id: 'post-pub-1', workspaceId: ws, targetKeyword: 'best guide', publishedAt: new Date().toISOString() }),
      makePost({ id: 'post-draft', workspaceId: ws, targetKeyword: 'best guide', status: 'draft' }), // no publishedAt
    ];

    const enriched = enrichPostsWithOutcomes(ws, posts);
    const pub = enriched.find(p => p.id === 'post-pub-1')!;
    expect(pub.outcome).toBeDefined();
    expect(pub.outcome!.score).toBe('win');
    expect(pub.outcome!.currentClicks).toBe(25);
    expect(pub.outcome!.baselinePosition).toBe(18);
    expect(pub.outcome!.currentPosition).toBe(7);

    // unpublished post must NOT be badged
    const draft = enriched.find(p => p.id === 'post-draft')!;
    expect(draft.outcome).toBeUndefined();
  });

  it('leaves published posts with no scored action unbadged', () => {
    const ws = `${WS_BASE}-none`;
    seedWorkspace(ws);
    const posts = [makePost({ id: 'p-none', workspaceId: ws, targetKeyword: 'unscored', publishedAt: new Date().toISOString() })];
    const enriched = enrichPostsWithOutcomes(ws, posts);
    expect(enriched[0].outcome).toBeUndefined();
  });
});
