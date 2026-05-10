/**
 * Retirement verification test for the feedback system.
 *
 * This test suite MUST FAIL until all feedback routes and table are removed.
 * It asserts that every feedback endpoint returns 404 (route does not exist),
 * proving the legacy `feedback` table and its surrounding code are gone.
 *
 * TDD workflow:
 *  - Before removal: tests fail (routes return 200/400, not 404) — EXPECTED
 *  - After removal:  tests pass (routes return 404)
 *
 * Design notes:
 * - A real workspace is created so public routes advance past the workspace-not-found
 *   middleware check (which returns 404 for the wrong reason before route removal).
 * - Real feedback items are created so PATCH/POST-reply/DELETE/public-reply routes
 *   advance past the "item not found" check (which also returns 404 for the wrong
 *   reason). Two sentinel items are used so the DELETE test cannot invalidate the
 *   item used by the public reply test.
 * - After route removal, all 8 endpoints return 404 because no route matches —
 *   the correct, load-bearing signal.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createFeedback } from '../../server/feedback.js';
import { setBroadcast } from '../../server/broadcast.js';

const ctx = createTestContext(13352); // port-ok: verified free as of 2026-05-10; retirement test extends range to 13352
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
/** Used for PATCH, POST reply (admin), and public POST reply tests. */
let sentinelItemId = '';
/** Used exclusively for the DELETE test to avoid consuming sentinelItemId. */
let deleteTargetItemId = '';

beforeAll(async () => {
  await ctx.startServer();
  setBroadcast(vi.fn(), vi.fn());

  // Real workspace so public-route workspace-presence check passes.
  const ws = createWorkspace('Feedback Retirement Test Workspace');
  testWsId = ws.id;

  // Sentinel item for PATCH / POST-reply / public-reply tests.
  const sentinel = createFeedback(testWsId, {
    type: 'general',
    title: 'Retirement sentinel item',
    description: 'Used to prove mutation endpoints return 200 before retirement.',
  });
  sentinelItemId = sentinel.id;

  // Separate item so DELETE test does not consume the sentinel.
  const deleteTarget = createFeedback(testWsId, {
    type: 'bug',
    title: 'Retirement delete target',
    description: 'Used only by the DELETE test.',
  });
  deleteTargetItemId = deleteTarget.id;
}, 25_000);

afterAll(async () => {
  if (testWsId) deleteWorkspace(testWsId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// Admin feedback endpoints
// ---------------------------------------------------------------------------

describe('Feedback retirement — admin endpoints must return 404', () => {
  it('GET /api/feedback returns 404', async () => {
    const res = await api('/api/feedback');
    expect(res.status).toBe(404);
  });

  it('GET /api/feedback/:wsId returns 404', async () => {
    const res = await api(`/api/feedback/${testWsId}`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/feedback/:wsId/:id returns 404', async () => {
    // Real item ID — currently returns 200 (item updated). 404 after retirement.
    const res = await patchJson(`/api/feedback/${testWsId}/${sentinelItemId}`, {
      status: 'acknowledged',
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/feedback/:wsId/:id/reply returns 404', async () => {
    // Real item ID — currently returns 200 (reply added). 404 after retirement.
    const res = await postJson(`/api/feedback/${testWsId}/${sentinelItemId}/reply`, {
      content: 'Retirement test reply',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/feedback/:wsId/:id returns 404', async () => {
    // Separate item so it does not affect public reply test. 404 after retirement.
    const res = await del(`/api/feedback/${testWsId}/${deleteTargetItemId}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Public feedback endpoints — uses a real workspace so the workspace-presence
// middleware passes and we test actual route existence, not workspace presence.
// ---------------------------------------------------------------------------

describe('Feedback retirement — public endpoints must return 404', () => {
  it('POST /api/public/feedback/:wsId returns 404', async () => {
    // Real workspace, no clientPassword → requireClientPortalAuth() passes.
    // Currently returns 200 (feedback created). 404 after retirement.
    const res = await postJson(`/api/public/feedback/${testWsId}`, {
      type: 'general',
      title: 'Retirement test public feedback',
      description: 'This should 404 once the route is removed.',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/public/feedback/:wsId returns 404', async () => {
    // Currently returns 200 (array of items). 404 after retirement.
    const res = await api(`/api/public/feedback/${testWsId}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/public/feedback/:wsId/:id/reply returns 404', async () => {
    // Real item ID (sentinel, not the delete target) — currently returns 200.
    // 404 after retirement.
    const res = await postJson(
      `/api/public/feedback/${testWsId}/${sentinelItemId}/reply`,
      { content: 'Retirement test client reply' },
    );
    expect(res.status).toBe(404);
  });
});
