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
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
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

  // Regression: Express's `qs` parser converts a repeated `query` param with more
  // than its arrayLimit (default 20) values into a numeric-keyed OBJECT, not an
  // array. A full keyword page batches up to 100 rows, so /history/rows must parse
  // >20 queries instead of silently collapsing to zero and 400-ing. (W4.2a smoke
  // caught this: 20 queries → 200, 21 → 400.)
  it('GET /api/rank-tracking/:workspaceId/history/rows accepts a batch above the qs arrayLimit (25 queries → 200)', async () => {
    const queries = Array.from({ length: 25 }, (_, i) => `query=k${i}`).join('&');
    const res = await api(`/api/rank-tracking/${wsId}/history/rows?${queries}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // getRankHistoryRows returns { windowDays, series: [...] } — the batch parsed,
    // so the request did not collapse to zero queries (which would 400).
    expect(Array.isArray(body.series)).toBe(true);
    expect(typeof body.windowDays).toBe('number');
  });

  it('GET /api/rank-tracking/:workspaceId/history/rows rejects more than the max batch size (101 queries → 400)', async () => {
    const queries = Array.from({ length: 101 }, (_, i) => `query=k${i}`).join('&');
    const res = await api(`/api/rank-tracking/${wsId}/history/rows?${queries}`);
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

  it('GET /api/public/rank-tracking/:workspaceId/history supports repeated query filters with commas', async () => {
    storeRankSnapshot(wsId, '2026-06-03', [
      { query: 'dentist, chicago', position: 5, clicks: 2, impressions: 40, ctr: 5 },
      { query: 'braces chicago', position: 9, clicks: 1, impressions: 20, ctr: 5 },
    ]);

    const res = await api(
      `/api/public/rank-tracking/${wsId}/history?query=${encodeURIComponent('dentist, chicago')}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ date: string; positions: Record<string, number> }>;
    expect(body).toEqual([
      { date: '2026-06-03', positions: { 'dentist, chicago': 5 } },
    ]);
  });

  it('GET /api/public/rank-tracking/:workspaceId/history with invalid limit returns 400', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history?limit=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
