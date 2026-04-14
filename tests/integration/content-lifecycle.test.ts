/**
 * Integration tests for the content pipeline state machine.
 *
 * Tests the Request → Brief → Post lifecycle with transition guards from
 * server/state-machines.ts (CONTENT_REQUEST_TRANSITIONS, POST_STATUS_TRANSITIONS).
 *
 * Uses in-process DB calls (no HTTP server) to verify guard behaviour directly
 * against createContentRequest(), updateContentRequest(), updatePostField().
 *
 * Groups:
 * 1. Content Request — happy path (requested → … → published)
 * 2. Content Request — admin fast-track (skip brief/review steps)
 * 3. Content Request — declined from various states
 * 4. Content Request — invalid transitions blocked (terminal + backward)
 * 5. Content Request — changes_requested loop
 * 6. Generated Post   — happy path (draft → review → approved)
 * 7. Generated Post   — send back for edits (review → draft → review → approved)
 * 8. Generated Post   — invalid transitions blocked
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { seedContentData } from '../fixtures/content-seed.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  createContentRequest,
  getContentRequest,
  updateContentRequest,
} from '../../server/content-requests.js';
import { getPost, updatePostField, listPosts } from '../../server/content-posts-db.js';
import { InvalidTransitionError } from '../../server/state-machines.js';
import db from '../../server/db/index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh content request in 'requested' status on the given workspace. */
function makeRequest(workspaceId: string, suffix: string) {
  return createContentRequest(workspaceId, {
    topic: `Test Topic ${suffix}`,
    targetKeyword: `test-keyword-${suffix}-${Date.now()}`,
    intent: 'informational',
    priority: 'medium',
    rationale: 'Integration test rationale',
    source: 'strategy',
    serviceType: 'full_post',
    pageType: 'blog',
  });
}

/** Move a request through a sequence of statuses, asserting each step. */
function walkStatuses(
  workspaceId: string,
  requestId: string,
  statuses: string[],
): void {
  for (const status of statuses) {
    const updated = updateContentRequest(workspaceId, requestId, {
      status: status as Parameters<typeof updateContentRequest>[2]['status'],
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(status);

    // Cross-check via a fresh read
    const fresh = getContentRequest(workspaceId, requestId);
    expect(fresh).toBeDefined();
    expect(fresh!.status).toBe(status);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Content Request — Happy path lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe('Content Request — happy path lifecycle', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('creates a new request with status "requested"', () => {
    const req = makeRequest(workspaceId, 'happy-1');
    expect(req.status).toBe('requested');
    expect(req.id).toBeTruthy();
    expect(req.workspaceId).toBe(workspaceId);
  });

  it('transitions requested → brief_generated', () => {
    const req = makeRequest(workspaceId, 'happy-2');
    const updated = updateContentRequest(workspaceId, req.id, { status: 'brief_generated' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('brief_generated');
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('walks the full happy path: requested → … → published', () => {
    const req = makeRequest(workspaceId, 'happy-3');
    walkStatuses(workspaceId, req.id, [
      'brief_generated',
      'client_review',
      'approved',
      'in_progress',
      'delivered',
      'published',
    ]);
  });

  it('verifies each intermediate state is persisted correctly', () => {
    const req = makeRequest(workspaceId, 'happy-4');
    const statuses = [
      'brief_generated',
      'client_review',
      'approved',
      'in_progress',
      'delivered',
      'published',
    ] as const;

    let previous = req.status;
    for (const status of statuses) {
      const updated = updateContentRequest(workspaceId, req.id, { status });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(status);
      expect(updated!.status).not.toBe(previous);
      previous = status;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Content Request — Admin fast-track
// ══════════════════════════════════════════════════════════════════════════════

describe('Content Request — admin fast-track', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('fast-tracks requested → in_progress (skipping brief/review)', () => {
    const req = makeRequest(workspaceId, 'fast-1');
    expect(req.status).toBe('requested');

    const updated = updateContentRequest(workspaceId, req.id, { status: 'in_progress' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('in_progress');
  });

  it('fast-tracks requested → delivered (skipping everything)', () => {
    const req = makeRequest(workspaceId, 'fast-2');
    expect(req.status).toBe('requested');

    const updated = updateContentRequest(workspaceId, req.id, { status: 'delivered' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('delivered');
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('fast-tracks requested → brief_generated → in_progress', () => {
    const req = makeRequest(workspaceId, 'fast-3');
    walkStatuses(workspaceId, req.id, ['brief_generated', 'in_progress']);
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('fast-tracks requested → client_review → approved → published', () => {
    const req = makeRequest(workspaceId, 'fast-4');
    walkStatuses(workspaceId, req.id, ['client_review', 'approved', 'published']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Content Request — Declined from various states
// ══════════════════════════════════════════════════════════════════════════════

describe('Content Request — declined from various states', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('allows requested → declined', () => {
    const req = makeRequest(workspaceId, 'decline-1');
    const updated = updateContentRequest(workspaceId, req.id, { status: 'declined' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('declined');
  });

  it('allows client_review → declined', () => {
    const req = makeRequest(workspaceId, 'decline-2');
    walkStatuses(workspaceId, req.id, ['client_review']);

    const updated = updateContentRequest(workspaceId, req.id, { status: 'declined' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('declined');
  });

  it('allows in_progress → declined', () => {
    const req = makeRequest(workspaceId, 'decline-3');
    walkStatuses(workspaceId, req.id, ['in_progress']);

    const updated = updateContentRequest(workspaceId, req.id, { status: 'declined' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('declined');
  });

  it('allows brief_generated → declined', () => {
    const req = makeRequest(workspaceId, 'decline-4');
    walkStatuses(workspaceId, req.id, ['brief_generated']);

    const updated = updateContentRequest(workspaceId, req.id, { status: 'declined' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('declined');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Content Request — Invalid transitions blocked
// ══════════════════════════════════════════════════════════════════════════════

describe('Content Request — invalid transitions blocked', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('blocks published → requested (terminal state)', () => {
    const req = makeRequest(workspaceId, 'invalid-1');
    walkStatuses(workspaceId, req.id, ['published']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'requested' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks published → brief_generated (terminal state)', () => {
    const req = makeRequest(workspaceId, 'invalid-2');
    walkStatuses(workspaceId, req.id, ['published']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'brief_generated' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks published → in_progress (terminal state)', () => {
    const req = makeRequest(workspaceId, 'invalid-3');
    walkStatuses(workspaceId, req.id, ['published']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'in_progress' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks declined → requested (terminal state)', () => {
    const req = makeRequest(workspaceId, 'invalid-4');
    walkStatuses(workspaceId, req.id, ['declined']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'requested' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks declined → in_progress (terminal state)', () => {
    const req = makeRequest(workspaceId, 'invalid-5');
    walkStatuses(workspaceId, req.id, ['declined']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'in_progress' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks delivered → requested (backward transition)', () => {
    const req = makeRequest(workspaceId, 'invalid-6');
    walkStatuses(workspaceId, req.id, ['delivered']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'requested' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks delivered → in_progress (backward transition)', () => {
    const req = makeRequest(workspaceId, 'invalid-7');
    walkStatuses(workspaceId, req.id, ['delivered']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'in_progress' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks in_progress → requested (backward transition)', () => {
    const req = makeRequest(workspaceId, 'invalid-8');
    walkStatuses(workspaceId, req.id, ['in_progress']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'requested' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks in_progress → brief_generated (backward transition)', () => {
    const req = makeRequest(workspaceId, 'invalid-9');
    walkStatuses(workspaceId, req.id, ['in_progress']);

    expect(() =>
      updateContentRequest(workspaceId, req.id, { status: 'brief_generated' }),
    ).toThrow(InvalidTransitionError);
  });

  it('error message identifies entity, from, and to states', () => {
    const req = makeRequest(workspaceId, 'invalid-err');
    walkStatuses(workspaceId, req.id, ['published']);

    let caught: unknown;
    try {
      updateContentRequest(workspaceId, req.id, { status: 'requested' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InvalidTransitionError);
    const err = caught as InvalidTransitionError;
    expect(err.from).toBe('published');
    expect(err.to).toBe('requested');
    expect(err.entity).toBe('content_request');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Content Request — changes_requested loop
// ══════════════════════════════════════════════════════════════════════════════

describe('Content Request — changes_requested loop', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('allows client_review → changes_requested → brief_generated → client_review', () => {
    const req = makeRequest(workspaceId, 'loop-1');
    walkStatuses(workspaceId, req.id, [
      'brief_generated',
      'client_review',
      'changes_requested',
      'brief_generated',
      'client_review',
    ]);
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('allows multiple loops before final approval', () => {
    const req = makeRequest(workspaceId, 'loop-2');
    walkStatuses(workspaceId, req.id, [
      'brief_generated',
      'client_review',
      'changes_requested',
      'brief_generated',
      'client_review',
      'changes_requested',
      'brief_generated',
      'client_review',
      'approved',
    ]);
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('allows changes_requested → client_review directly (re-review after changes)', () => {
    const req = makeRequest(workspaceId, 'loop-3');
    walkStatuses(workspaceId, req.id, [
      'client_review',
      'changes_requested',
      'client_review',
    ]);
  });

  // no-assertion-ok — walkStatuses() asserts each transition via 4 expect() calls per step
  it('allows exiting the loop to in_progress from changes_requested', () => {
    const req = makeRequest(workspaceId, 'loop-4');
    walkStatuses(workspaceId, req.id, [
      'client_review',
      'changes_requested',
      'in_progress',
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Generated Post — Happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('Generated Post — happy path', () => {
  let workspaceId: string;
  let postId: string;
  let cleanup: () => void;

  beforeAll(() => {
    // seedContentData creates the post with status 'draft'
    const seed = seedContentData();
    workspaceId = seed.workspaceId;
    postId = seed.postId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('seeded post exists with status "draft"', () => {
    const post = getPost(workspaceId, postId);
    expect(post).toBeDefined();
    expect(post!.status).toBe('draft');
  });

  it('transitions draft → review', () => {
    const updated = updatePostField(workspaceId, postId, { status: 'review' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('review');

    const fresh = getPost(workspaceId, postId);
    expect(fresh!.status).toBe('review');
  });

  it('transitions review → approved', () => {
    const updated = updatePostField(workspaceId, postId, { status: 'approved' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('approved');

    const fresh = getPost(workspaceId, postId);
    expect(fresh!.status).toBe('approved');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Generated Post — generating → draft → review → approved (full path)
// ══════════════════════════════════════════════════════════════════════════════

describe('Generated Post — full path from generating state', () => {
  let workspaceId: string;
  let postId: string;
  let cleanup: () => void;
  let wsCleanup: () => void;

  beforeAll(() => {
    const wsSeed = seedWorkspace();
    workspaceId = wsSeed.workspaceId;
    wsCleanup = wsSeed.cleanup;

    // Seed a post directly in 'generating' status
    const suffix = `gen-${Date.now()}`;
    postId = `post-gen-${suffix}`;
    const briefId = `brief-gen-${suffix}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO content_briefs
        (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
         suggested_meta_desc, outline, word_count_target, intent, audience,
         competitor_insights, internal_link_suggestions, created_at)
      VALUES (?, ?, ?, '[]', ?, ?, '[]', ?, ?, ?, '', '[]', ?)
    `).run(briefId, workspaceId, `gen-kw-${suffix}`, `How to gen-kw-${suffix}`, 'Meta desc.', 1500, 'informational', 'general', now);

    db.prepare(`
      INSERT INTO content_posts
        (id, workspace_id, brief_id, target_keyword, title, meta_description,
         introduction, sections, conclusion, total_word_count, target_word_count,
         status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 'generating', ?, ?)
    `).run(postId, workspaceId, briefId, `gen-kw-${suffix}`, `Post ${suffix}`, 'Meta.', 'Intro.', 'Concl.', 0, 1500, now, now);

    cleanup = () => {
      db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
      wsCleanup();
    };
  });

  afterAll(() => {
    cleanup();
  });

  it('seeded post has status "generating"', () => {
    const post = getPost(workspaceId, postId);
    expect(post).toBeDefined();
    expect(post!.status).toBe('generating');
  });

  it('transitions generating → draft', () => {
    const updated = updatePostField(workspaceId, postId, { status: 'draft' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('draft');
  });

  it('transitions draft → review', () => {
    const updated = updatePostField(workspaceId, postId, { status: 'review' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('review');
  });

  it('transitions review → approved', () => {
    const updated = updatePostField(workspaceId, postId, { status: 'approved' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('approved');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Generated Post — Send back for edits
// ══════════════════════════════════════════════════════════════════════════════

describe('Generated Post — send back for edits', () => {
  let workspaceId: string;
  let postId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedContentData();
    workspaceId = seed.workspaceId;
    postId = seed.postId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('transitions draft → review → draft (send back) → review → approved', () => {
    // draft → review
    let updated = updatePostField(workspaceId, postId, { status: 'review' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('review');

    // review → draft (send back for edits)
    updated = updatePostField(workspaceId, postId, { status: 'draft' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('draft');

    // draft → review (re-submit)
    updated = updatePostField(workspaceId, postId, { status: 'review' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('review');

    // review → approved
    updated = updatePostField(workspaceId, postId, { status: 'approved' });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('approved');

    // Final persisted state
    const fresh = getPost(workspaceId, postId);
    expect(fresh!.status).toBe('approved');
  });

  it('allows multiple send-back cycles', () => {
    // Re-seed by fetching a new post — use a second seedContentData
    const seed2 = seedContentData();
    const postId2 = seed2.postId;
    const ws2 = seed2.workspaceId;

    try {
      // cycle 1
      updatePostField(ws2, postId2, { status: 'review' });
      updatePostField(ws2, postId2, { status: 'draft' });

      // cycle 2
      updatePostField(ws2, postId2, { status: 'review' });
      updatePostField(ws2, postId2, { status: 'draft' });

      // final approval
      updatePostField(ws2, postId2, { status: 'review' });
      const final = updatePostField(ws2, postId2, { status: 'approved' });
      expect(final!.status).toBe('approved');
    } finally {
      seed2.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Generated Post — Invalid transitions blocked
// ══════════════════════════════════════════════════════════════════════════════

describe('Generated Post — invalid transitions blocked', () => {
  // Each sub-test needs a fresh post to avoid state pollution across assertions.
  // We seed a workspace once and insert posts directly.
  let workspaceId: string;
  let briefId: string;
  let wsCleanup: () => void;

  beforeAll(() => {
    const wsSeed = seedWorkspace();
    workspaceId = wsSeed.workspaceId;
    wsCleanup = wsSeed.cleanup;

    const suffix = `invalid-post-${Date.now()}`;
    briefId = `brief-inv-${suffix}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO content_briefs
        (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
         suggested_meta_desc, outline, word_count_target, intent, audience,
         competitor_insights, internal_link_suggestions, created_at)
      VALUES (?, ?, ?, '[]', ?, ?, '[]', ?, ?, ?, '', '[]', ?)
    `).run(briefId, workspaceId, `inv-kw-${suffix}`, `Invalid test post`, 'Meta.', 1500, 'informational', 'general', now);
  });

  afterAll(() => {
    db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
    wsCleanup();
  });

  /** Insert a fresh post at a given starting status. */
  function seedPost(suffix: string, status: 'generating' | 'draft' | 'review' | 'approved'): string {
    const postId = `post-inv-${suffix}-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO content_posts
        (id, workspace_id, brief_id, target_keyword, title, meta_description,
         introduction, sections, conclusion, total_word_count, target_word_count,
         status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
    `).run(postId, workspaceId, briefId, `kw-${suffix}`, `Post ${suffix}`, 'Meta.', 'Intro.', 'Concl.', 0, 1500, status, now, now);
    return postId;
  }

  it('blocks generating → approved (must go through draft)', () => {
    const postId = seedPost('gen-to-approved', 'generating');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'approved' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks generating → review (must go through draft first)', () => {
    const postId = seedPost('gen-to-review', 'generating');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'review' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks draft → approved (must go through review)', () => {
    const postId = seedPost('draft-to-approved', 'draft');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'approved' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks approved → draft (terminal state)', () => {
    const postId = seedPost('approved-to-draft', 'approved');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'draft' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks approved → review (terminal state)', () => {
    const postId = seedPost('approved-to-review', 'approved');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'review' }),
    ).toThrow(InvalidTransitionError);
  });

  it('blocks approved → generating (terminal state)', () => {
    const postId = seedPost('approved-to-gen', 'approved');
    expect(() =>
      updatePostField(workspaceId, postId, { status: 'generating' }),
    ).toThrow(InvalidTransitionError);
  });

  it('error message identifies entity, from, and to states', () => {
    const postId = seedPost('err-msg', 'draft');

    let caught: unknown;
    try {
      updatePostField(workspaceId, postId, { status: 'approved' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InvalidTransitionError);
    const err = caught as InvalidTransitionError;
    expect(err.from).toBe('draft');
    expect(err.to).toBe('approved');
    expect(err.entity).toBe('post');
  });

  it('state is unchanged after a blocked transition attempt', () => {
    const postId = seedPost('no-mutation', 'draft');

    expect(() =>
      updatePostField(workspaceId, postId, { status: 'approved' }),
    ).toThrow(InvalidTransitionError);

    // Post must still be in draft
    const post = getPost(workspaceId, postId);
    expect(post).toBeDefined();
    expect(post!.status).toBe('draft');
  });

  it('listable posts in workspace all have valid statuses', () => {
    const posts = listPosts(workspaceId);
    const validStatuses = new Set(['generating', 'draft', 'review', 'approved']);
    expect(posts.length > 0 && posts.every(p => validStatuses.has(p.status))).toBe(true);
  });
});
