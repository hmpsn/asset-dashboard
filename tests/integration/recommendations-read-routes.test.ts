/**
 * Integration tests for recommendations read paths.
 * Covers GET list endpoint and status/filter validation.
 * Avoids calling generate (POST) since that calls AI services.
 *
 * Note: GET /api/public/recommendations/:workspaceId auto-generates on first call
 * when no cached set exists. For an unknown workspace, generateRecommendations
 * throws "Workspace not found" which the route handler catches as 500.
 *
 * Port: 13689 (assigned range 13688–13695 for wave-24-a12)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13689); // port-ok: assigned range 13688-13695
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Recommendations Read WS 13689').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Recommendations — GET list endpoint', () => {
  it('returns 200 with recommendations array for a fresh workspace', async () => {
    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recommendations');
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it('returns a workspaceId field matching the requested workspace', async () => {
    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workspaceId', wsId);
  });

  it('returns 200 with filtered recommendations when status query param is provided', async () => {
    const res = await api(`/api/public/recommendations/${wsId}?status=pending`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recommendations');
    expect(Array.isArray(body.recommendations)).toBe(true);
    // All returned items must match the requested status
    for (const rec of body.recommendations) {
      expect(rec.status).toBe('pending');
    }
  });

  it('returns 200 with filtered recommendations when priority query param is provided', async () => {
    const res = await api(`/api/public/recommendations/${wsId}?priority=high`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recommendations');
    expect(Array.isArray(body.recommendations)).toBe(true);
    // All returned items must match the requested priority
    for (const rec of body.recommendations) {
      expect(rec.priority).toBe('high');
    }
  });

  it('returns 500 for an unknown workspaceId (generateRecommendations throws)', async () => {
    const res = await api('/api/public/recommendations/ws_nonexistent_rec_99999');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Recommendations — PATCH status validation', () => {
  it('returns 404 when recId does not exist', async () => {
    // requireClientPortalAuth passes through in no-auth mode (empty password env)
    const res = await ctx.patchJson(`/api/public/recommendations/${wsId}/rec_nonexistent_99999`, {
      status: 'completed',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when status value is invalid', async () => {
    const res = await ctx.patchJson(`/api/public/recommendations/${wsId}/rec_nonexistent_99999`, {
      status: 'invalid_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
