/**
 * Integration tests for content-decay read endpoints (wave-24-a11).
 *
 * Focused on:
 * - GET /api/content-decay/:workspaceId  → 200 with null for fresh workspace
 * - GET /api/public/content-decay/:workspaceId → 200 with null for fresh workspace
 * - Unknown workspaceId → 403 (workspace access guard)
 * - POST analyze with unknown workspace → 404
 * - POST recommendations with unknown workspace → 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13681);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Content Decay Read WS 13681').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/content-decay/:workspaceId — cached analysis retrieval', () => {
  it('returns 200 with null for fresh workspace (no analysis run yet)', async () => {
    const res = await api(`/api/content-decay/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns 403 for unknown workspaceId', async () => {
    const res = await api('/api/content-decay/ws_does_not_exist_xyz');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/public/content-decay/:workspaceId — client portal read', () => {
  it('returns 200 with null for fresh workspace', async () => {
    const res = await api(`/api/public/content-decay/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('POST /api/content-decay/:workspaceId/analyze', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/content-decay/ws_does_not_exist_xyz/analyze', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('POST /api/content-decay/:workspaceId/recommendations', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/content-decay/ws_does_not_exist_xyz/recommendations', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when no cached analysis exists for valid workspace', async () => {
    const res = await postJson(`/api/content-decay/${wsId}/recommendations`, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Run decay analysis first');
  });
});
