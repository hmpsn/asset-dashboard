/**
 * Retirement verification test for the feedback system.
 *
 * All feedback routes have been removed. This suite verifies that all
 * previously-existing admin and public feedback endpoints now return 404.
 *
 * Converted from it.fails() to plain it() after route retirement was complete.
 * Sentinel item IDs are now placeholders — routes return 404 regardless of
 * whether a real item exists, because no route handler matches the path.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setBroadcast } from '../../server/broadcast.js';

const ctx = createTestContext(13352); // port-ok: verified free as of 2026-05-10; retirement test extends range to 13352
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
// Placeholder UUIDs — routes return 404 regardless of whether real items exist.
const sentinelItemId = '00000000-0000-0000-0000-000000000001';
const deleteTargetItemId = '00000000-0000-0000-0000-000000000002';

beforeAll(async () => {
  await ctx.startServer();
  setBroadcast(vi.fn(), vi.fn());

  // Real workspace so public-route workspace-presence check passes.
  const ws = createWorkspace('Feedback Retirement Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  if (testWsId) deleteWorkspace(testWsId);
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
    const res = await patchJson(`/api/feedback/${testWsId}/${sentinelItemId}`, {
      status: 'acknowledged',
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/feedback/:wsId/:id/reply returns 404', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/${sentinelItemId}/reply`, {
      content: 'Retirement test reply',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/feedback/:wsId/:id returns 404', async () => {
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
    const res = await postJson(`/api/public/feedback/${testWsId}`, {
      type: 'general',
      title: 'Retirement test public feedback',
      description: 'This should 404 once the route is removed.',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/public/feedback/:wsId returns 404', async () => {
    const res = await api(`/api/public/feedback/${testWsId}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/public/feedback/:wsId/:id/reply returns 404', async () => {
    const res = await postJson(
      `/api/public/feedback/${testWsId}/${sentinelItemId}/reply`,
      { content: 'Retirement test client reply' },
    );
    expect(res.status).toBe(404);
  });
});
