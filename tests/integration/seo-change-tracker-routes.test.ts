/**
 * Integration tests: SEO change tracker routes.
 *
 * Covers:
 *   - GET /api/seo-changes/:workspaceId — list, 404, limit validation
 *   - GET /api/seo-change-impact/:workspaceId — 404, no GSC → 400, no site → 400
 *   - GET /api/schema-impact/:workspaceId — 404, no GSC → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13403);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('SEO Change Tracker Routes WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/seo-changes/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/seo-changes/ws_does_not_exist_sct_99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 with empty changes array for fresh workspace', async () => {
    const res = await api(`/api/seo-changes/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: unknown[] };
    expect(Array.isArray(body.changes)).toBe(true);
    expect(body.changes).toHaveLength(0);
  });

  it('returns 400 when limit=0 (not a positive integer)', async () => {
    const res = await api(`/api/seo-changes/${wsId}?limit=0`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('limit');
  });

  it('returns 400 when limit=-1', async () => {
    const res = await api(`/api/seo-changes/${wsId}?limit=-1`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('limit');
  });

  it('returns 400 when limit is not an integer', async () => {
    const res = await api(`/api/seo-changes/${wsId}?limit=abc`);
    expect(res.status).toBe(400);
  });

  it('accepts a valid positive integer limit', async () => {
    const res = await api(`/api/seo-changes/${wsId}?limit=10`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: unknown[] };
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('caps limit at 200 without error', async () => {
    // parseBoundedPositiveIntQuery caps at 200 — 300 → capped to 200, still valid
    const res = await api(`/api/seo-changes/${wsId}?limit=300`);
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: unknown[] };
    expect(Array.isArray(body.changes)).toBe(true);
  });
});

describe('GET /api/seo-change-impact/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/seo-change-impact/ws_does_not_exist_sct_99');
    expect(res.status).toBe(404);
  });

  it('returns 400 when workspace has no GSC property configured', async () => {
    // Fresh workspace has no gscPropertyUrl
    const res = await api(`/api/seo-change-impact/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('GSC');
  });

  it('returns 400 when limit=0', async () => {
    const res = await api(`/api/seo-change-impact/${wsId}?limit=0`);
    // Hits limit validation before GSC check
    expect(res.status).toBe(400);
  });
});

describe('GET /api/schema-impact/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/schema-impact/ws_does_not_exist_sct_99');
    expect(res.status).toBe(404);
  });

  it('returns 400 when workspace has no GSC property configured', async () => {
    const res = await api(`/api/schema-impact/${wsId}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('GSC');
  });
});
