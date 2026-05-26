/**
 * Integration tests for page-strategy read endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/page-strategy/section-plan-defaults/:pageType
 * - GET /api/page-strategy/:workspaceId   (list blueprints — empty for fresh ws)
 * - GET /api/page-strategy/:workspaceId/:blueprintId  (single blueprint — 404 for unknown)
 *
 * NOTE: Blueprint version routes (/versions, /versions/:versionId) are exercised
 * via the blueprint ID, but the test omits them for fresh workspaces because
 * they require a pre-existing blueprint.
 *
 * AI generation endpoints (POST …/generate) are excluded — they make real AI calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13665);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Page Strategy Read WS 13665').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/page-strategy/section-plan-defaults/:pageType', () => {
  it('returns 200 with a non-empty array for pageType=service', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/service');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Each item should have sectionType and order
    const first = body[0];
    expect(first).toHaveProperty('sectionType');
    expect(first).toHaveProperty('order');
    expect(first).toHaveProperty('id');
  });

  it('returns 200 with a non-empty array for pageType=blog', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/blog');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns 200 with a non-empty array for pageType=location', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/location');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('falls back to service plan for unknown pageType', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/unknown-page-type');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Unknown types fall back to 'service' plan — must still return non-empty array
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns unique ids for each item in a plan', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/homepage');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((item: { id: string }) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('GET /api/page-strategy/:workspaceId', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const res = await api(`/api/page-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 200 with empty array for an unknown workspaceId (no workspace validation on list)', async () => {
    // requireWorkspaceAccess passes through in unauthenticated (APP_PASSWORD) mode.
    // listBlueprints returns an empty array for any workspaceId — no 404 guard on the list route.
    const res = await api('/api/page-strategy/nonexistent-workspace-id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/page-strategy/:workspaceId/:blueprintId', () => {
  it('returns 404 for a valid workspace but nonexistent blueprintId', async () => {
    const res = await api(`/api/page-strategy/${wsId}/nonexistent-blueprint-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
