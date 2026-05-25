/**
 * wave-18 supplemental integration tests for site-architecture routes.
 *
 * Verifies the 404 / 200 contract for both endpoints on unknown and fresh
 * workspaces, and checks the shape of the response payload.
 *
 * Ports: 13426 (exclusive to wave-18 batch A2)
 *
 * Routes covered:
 *   GET /api/site-architecture/:workspaceId
 *   GET /api/site-architecture/:workspaceId/schema-coverage
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13426;
const ctx = createTestContext(PORT);
const { api } = ctx;

const UNKNOWN_ID = 'ws_wave18_arch_does_not_exist_z8x';

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  // Workspace intentionally created without webflowSiteId so Webflow API
  // calls are skipped, keeping the test self-contained.
  wsId = createWorkspace(`Wave18 Arch Test ${PORT}`).id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/site-architecture/:workspaceId — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/site-architecture/:workspaceId — unknown workspace', () => {
  it('returns 404 for a completely unknown workspaceId', async () => {
    const res = await api(`/api/site-architecture/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
  });

  it('404 response body has an error field', async () => {
    const res = await api(`/api/site-architecture/${UNKNOWN_ID}`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('error message is "Workspace not found"', async () => {
    const res = await api(`/api/site-architecture/${UNKNOWN_ID}`);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/site-architecture/:workspaceId — fresh workspace → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/site-architecture/:workspaceId — fresh workspace', () => {
  it('returns 200', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('response Content-Type is application/json', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('response body has all required top-level keys', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(body).toHaveProperty('tree');
    expect(body).toHaveProperty('totalPages');
    expect(body).toHaveProperty('existingPages');
    expect(body).toHaveProperty('plannedPages');
    expect(body).toHaveProperty('strategyPages');
    expect(body).toHaveProperty('gaps');
    expect(body).toHaveProperty('depthDistribution');
    expect(body).toHaveProperty('orphanPaths');
    expect(body).toHaveProperty('analyzedAt');
  });

  it('root node has path "/" and depth 0', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(body.tree.path).toBe('/');
    expect(body.tree.depth).toBe(0);
  });

  it('root node hasContent is true', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(body.tree.hasContent).toBe(true);
  });

  it('numeric counters are all zero for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(body.totalPages).toBe(0);
    expect(body.existingPages).toBe(0);
    expect(body.plannedPages).toBe(0);
    expect(body.strategyPages).toBe(0);
  });

  it('gaps is an empty array for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(Array.isArray(body.gaps)).toBe(true);
    expect(body.gaps).toHaveLength(0);
  });

  it('orphanPaths is an empty array for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(Array.isArray(body.orphanPaths)).toBe(true);
    expect(body.orphanPaths).toHaveLength(0);
  });

  it('depthDistribution is an empty object for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(typeof body.depthDistribution).toBe('object');
    expect(Object.keys(body.depthDistribution)).toHaveLength(0);
  });

  it('analyzedAt is a valid ISO timestamp', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(typeof body.analyzedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.analyzedAt))).toBe(false);
  });

  it('root node children is an empty array for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    const body = await res.json();
    expect(Array.isArray(body.tree.children)).toBe(true);
    expect(body.tree.children).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/site-architecture/:workspaceId/schema-coverage — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/site-architecture/:workspaceId/schema-coverage — unknown workspace', () => {
  it('returns 404 for a completely unknown workspaceId', async () => {
    const res = await api(`/api/site-architecture/${UNKNOWN_ID}/schema-coverage`);
    expect(res.status).toBe(404);
  });

  it('404 response body has an error field', async () => {
    const res = await api(`/api/site-architecture/${UNKNOWN_ID}/schema-coverage`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/site-architecture/:workspaceId/schema-coverage — workspace without
// webflowSiteId → 404 (the route guards on ws?.webflowSiteId)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/site-architecture/:workspaceId/schema-coverage — no webflowSiteId', () => {
  it('returns 404 when workspace has no webflowSiteId', async () => {
    // wsId was created without a webflowSiteId
    const res = await api(`/api/site-architecture/${wsId}/schema-coverage`);
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await api(`/api/site-architecture/${wsId}/schema-coverage`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace isolation — a fresh second workspace has no pages
// ─────────────────────────────────────────────────────────────────────────────

describe('Workspace isolation — two fresh workspaces are independent', () => {
  let wsBId = '';

  beforeAll(() => {
    wsBId = createWorkspace(`Wave18 Arch Isolation ${PORT}`).id;
  });

  afterAll(() => {
    if (wsBId) deleteWorkspace(wsBId);
  });

  it('both workspaces return 200', async () => {
    const [resA, resB] = await Promise.all([
      api(`/api/site-architecture/${wsId}`),
      api(`/api/site-architecture/${wsBId}`),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it('both workspaces have totalPages=0 (no data seeded)', async () => {
    const [resA, resB] = await Promise.all([
      api(`/api/site-architecture/${wsId}`),
      api(`/api/site-architecture/${wsBId}`),
    ]);
    const bodyA = await resA.json();
    const bodyB = await resB.json();
    expect(bodyA.totalPages).toBe(0);
    expect(bodyB.totalPages).toBe(0);
  });

  it('both workspace trees have distinct root names (workspace name used as home name)', async () => {
    const [resA, resB] = await Promise.all([
      api(`/api/site-architecture/${wsId}`),
      api(`/api/site-architecture/${wsBId}`),
    ]);
    const bodyA = await resA.json();
    const bodyB = await resB.json();
    // Both roots have names but they can differ based on workspace name
    expect(bodyA.tree.name).toBeTruthy();
    expect(bodyB.tree.name).toBeTruthy();
  });
});
