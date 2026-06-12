/**
 * Integration tests for workspace audit suppression endpoints.
 *
 * Covers (from server/routes/workspaces.ts):
 *  - GET /api/workspaces/:id/audit-suppressions — fresh workspace → 200 with empty array
 *  - POST /api/workspaces/:id/audit-suppressions — valid body (by pageSlug) → 200
 *  - POST /api/workspaces/:id/audit-suppressions — valid body (by pagePattern) → 200
 *  - POST /api/workspaces/:id/audit-suppressions — missing required `check` field → 400
 *  - POST /api/workspaces/:id/audit-suppressions — missing both pageSlug and pagePattern → 400
 *  - DELETE /api/workspaces/:id/audit-suppressions — existing suppression → 200 and removed
 *  - DELETE /api/workspaces/:id/audit-suppressions — non-existing suppression → 200 (idempotent)
 *
 * auditSuppressionSchema requires:
 *   check: string (min 1)
 *   pageSlug?: string   \_ at least one of these is required (refine guard)
 *   pagePattern?: string /
 *   reason?: string (max 500)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Workspace Audit Suppressions WS 13617').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspaces/:id/audit-suppressions', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 404 for an unknown workspace id', async () => {
    const res = await api('/api/workspaces/ws_nonexistent_supp_99/audit-suppressions');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/workspaces/:id/audit-suppressions — valid bodies', () => {
  it('adds a suppression by pageSlug and returns 200 with ok:true', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-meta-description',
      pageSlug: '/contact',
      reason: 'Not a priority page',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.suppressions)).toBe(true);
    const added = body.suppressions.find(
      (s: { check: string; pageSlug?: string }) =>
        s.check === 'missing-meta-description' && s.pageSlug === '/contact',
    );
    expect(added).toBeDefined();
  });

  it('adds a suppression by pagePattern and returns 200', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-h1',
      pagePattern: '^/blog/',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const patternEntry = body.suppressions.find(
      (s: { pagePattern?: string }) => s.pagePattern === '^/blog/',
    );
    expect(patternEntry).toBeDefined();
  });

  it('deduplicates same check + pageSlug — does not grow array on repeat', async () => {
    // Ensure it exists first
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'slow-lcp',
      pageSlug: '/products',
    });
    // Submit identical payload a second time
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'slow-lcp',
      pageSlug: '/products',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const matchCount = body.suppressions.filter(
      (s: { check: string; pageSlug?: string }) =>
        s.check === 'slow-lcp' && s.pageSlug === '/products',
    ).length;
    expect(matchCount).toBe(1);
  });

  it('persists suppression so GET reflects it', async () => {
    // Add a uniquely named suppression to verify persistence
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'broken-link',
      pageSlug: '/team',
    });
    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ check: string; pageSlug?: string }>;
    const found = body.find(s => s.check === 'broken-link' && s.pageSlug === '/team');
    expect(found).toBeDefined();
  });
});

describe('POST /api/workspaces/:id/audit-suppressions — validation failures', () => {
  it('returns 400 when `check` field is missing', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      pageSlug: '/about',
      reason: 'No check provided',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when both pageSlug and pagePattern are omitted', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-title',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when `check` is an empty string', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: '',
      pageSlug: '/about',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/workspaces/:id/audit-suppressions', () => {
  it('removes an existing suppression and returns 200 with ok:true', async () => {
    // Seed a suppression to delete
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'duplicate-content',
      pageSlug: '/services',
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'duplicate-content', pageSlug: '/services' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Confirm the entry is gone
    const removed = body.suppressions.find(
      (s: { check: string; pageSlug?: string }) =>
        s.check === 'duplicate-content' && s.pageSlug === '/services',
    );
    expect(removed).toBeUndefined();
  });

  it('is idempotent — returns 200 when suppression does not exist', async () => {
    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'nonexistent-check', pageSlug: '/nowhere' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('removes a pattern-based suppression correctly', async () => {
    // Seed a pattern suppression
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'thin-content',
      pagePattern: '^/tag/',
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'thin-content', pagePattern: '^/tag/' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const removed = body.suppressions.find(
      (s: { pagePattern?: string }) => s.pagePattern === '^/tag/',
    );
    expect(removed).toBeUndefined();
  });
});
