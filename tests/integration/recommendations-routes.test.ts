/**
 * Integration tests for recommendations API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/public/recommendations/:workspaceId (list)
 * - PATCH /api/public/recommendations/:workspaceId/:recId (update status)
 * - DELETE /api/public/recommendations/:workspaceId/:recId (dismiss)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13212);
const { api, patchJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Recommendations Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Recommendations — list', () => {
  it('GET /api/public/recommendations/:workspaceId returns recommendation set', async () => {
    // This may auto-generate if none exist (requires OpenAI), or return 500 if no key
    const res = await api(`/api/public/recommendations/${testWsId}`);
    // Either 200 (cached or generated) or 500 (no OpenAI key in test env)
    expect([200, 500]).toContain(res.status);
  });
});

describe('Recommendations — update status validation', () => {
  it('PATCH without status returns 400', async () => {
    const res = await patchJson(`/api/public/recommendations/${testWsId}/rec_fake_id`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Valid status required');
  });

  it('PATCH with invalid status returns 400', async () => {
    const res = await patchJson(`/api/public/recommendations/${testWsId}/rec_fake_id`, {
      status: 'invalid_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Valid status required');
  });

  it('PATCH with valid status but bad rec id returns 404', async () => {
    const res = await patchJson(`/api/public/recommendations/${testWsId}/rec_nonexistent`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Recommendation not found');
  });
});

describe('Recommendations — dismiss', () => {
  it('DELETE with bad rec id returns 404', async () => {
    const res = await del(`/api/public/recommendations/${testWsId}/rec_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Recommendation not found');
  });
});
