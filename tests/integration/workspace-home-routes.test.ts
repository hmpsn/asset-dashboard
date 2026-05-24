/**
 * Integration tests: GET /api/workspace-home/:id
 *
 * Covers:
 *   - 404 for unknown workspace
 *   - days=0 → 400
 *   - days=-1 → 400
 *   - days=foo → 400
 *   - Fresh workspace with no external data → 200 with expected shape
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13404);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Workspace Home Routes WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspace-home/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspace-home/ws_does_not_exist_home_99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when days=0', async () => {
    const res = await api(`/api/workspace-home/${wsId}?days=0`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('days');
  });

  it('returns 400 when days=-1', async () => {
    const res = await api(`/api/workspace-home/${wsId}?days=-1`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('days');
  });

  it('returns 400 when days=foo (non-integer)', async () => {
    const res = await api(`/api/workspace-home/${wsId}?days=foo`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('days');
  });

  it('returns 200 for a fresh workspace with default days', async () => {
    const res = await api(`/api/workspace-home/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('returns response with expected array fields for fresh workspace', async () => {
    const res = await api(`/api/workspace-home/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ranks: unknown[];
      requests: unknown[];
      contentRequests: unknown[];
      activity: unknown[];
      workOrders: unknown[];
    };
    // All array fields should be empty arrays for a fresh workspace
    expect(Array.isArray(body.ranks)).toBe(true);
    expect(Array.isArray(body.requests)).toBe(true);
    expect(Array.isArray(body.contentRequests)).toBe(true);
    expect(Array.isArray(body.activity)).toBe(true);
    expect(Array.isArray(body.workOrders)).toBe(true);
  });

  it('accepts a custom days value', async () => {
    const res = await api(`/api/workspace-home/${wsId}?days=7`);
    expect(res.status).toBe(200);
  });

  it('returns 400 when days is a float', async () => {
    const res = await api(`/api/workspace-home/${wsId}?days=7.5`);
    expect(res.status).toBe(400);
  });
});
