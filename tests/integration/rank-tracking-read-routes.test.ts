/**
 * Integration tests for rank-tracking READ paths in server/routes/rank-tracking.ts.
 *
 * Tests:
 * - GET /api/rank-tracking/:workspaceId/keywords — fresh workspace → 200 with array
 * - GET /api/rank-tracking/:workspaceId/history — fresh workspace → 200 with array
 * - GET /api/rank-tracking/:workspaceId/latest — fresh workspace → 200 with array
 * - GET /api/public/rank-tracking/:workspaceId/history — fresh workspace → 200 with array
 * - Unknown workspace IDs → 200 with empty arrays (auth passes through, DB returns empty)
 *
 * Auth note: requireWorkspaceAccess passes through when req.user is unset
 * (no JWT) — the HMAC global gate is also disabled (APP_PASSWORD=''). The
 * rank-tracking storage functions return empty arrays for unknown workspace IDs
 * rather than 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13610);
const { api, postJson } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Rank Tracking Read WS 13610').id;
  // Public rank-tracking endpoints now require authenticated portal access
  // (sprint-platform-health-wave8 Plan A Task 1). Seed password + login.
  updateWorkspace(wsId, { clientPassword: 'test-password' });
  const authRes = await postJson(`/api/public/auth/${wsId}`, { password: 'test-password' });
  expect(authRes.status).toBe(200);
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Rank Tracking — keywords', () => {
  it('GET /api/rank-tracking/:workspaceId/keywords returns 200 with array for fresh workspace', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/keywords`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/rank-tracking/:workspaceId/keywords returns 200 with empty array for unknown workspace', async () => {
    const res = await api('/api/rank-tracking/ws_nonexistent_00000000/keywords');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('Rank Tracking — history', () => {
  it('GET /api/rank-tracking/:workspaceId/history returns 200 with array for fresh workspace', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/rank-tracking/:workspaceId/history with invalid limit returns 400', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=invalid`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Rank Tracking — latest', () => {
  it('GET /api/rank-tracking/:workspaceId/latest returns 200 for fresh workspace', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fresh workspace has no snapshots, so latest ranks is an empty array
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Public Rank Tracking — history', () => {
  it('GET /api/public/rank-tracking/:workspaceId/history returns 200 with array', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/rank-tracking/:workspaceId/history with invalid limit returns 400', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history?limit=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
