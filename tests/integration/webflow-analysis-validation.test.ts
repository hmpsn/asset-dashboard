/**
 * Wave 18 — Integration tests for webflow-analysis routes (validation paths)
 *
 * Routes tested (server/routes/webflow-analysis.ts):
 *   POST /api/competitor-compare               — requires myUrl + competitorUrl
 *   GET  /api/competitor-compare-snapshot      — pure DB read; no params → null
 *   GET  /api/competitor-compare-latest        — pure DB read; no param → null
 *   GET  /api/webflow/link-check/:siteId       — requireWorkspaceSiteAccessFromQuery
 *   GET  /api/webflow/link-check-snapshot/:siteId
 *   GET  /api/webflow/redirect-scan/:siteId
 *   GET  /api/webflow/redirect-snapshot/:siteId
 *   GET  /api/webflow/internal-links/:siteId
 *   GET  /api/webflow/internal-links-snapshot/:siteId
 *
 * Strategy: only validation paths, missing-param, and DB-null reads.
 * No AI calls, no external HTTP calls. requireWorkspaceSiteAccessFromQuery
 * passes through when no JWT user is present (APP_PASSWORD='').
 * Without a valid workspaceId+siteId that owns the site, the middleware
 * passes through; the underlying implementations then run/fail on their own.
 *
 * NOTE: The full happy-path and 403 tests live in webflow-analysis.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Webflow Analysis Validation Test 13442').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ─── POST /api/competitor-compare ────────────────────────────────────────────

describe('POST /api/competitor-compare — validation', () => {
  it('returns 400 when myUrl is missing', async () => {
    const res = await postJson('/api/competitor-compare', {
      competitorUrl: 'https://competitor.example.com',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('myUrl');
  });

  it('returns 400 when competitorUrl is missing', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.example.com',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('competitorUrl');
  });

  it('returns 400 when both urls are missing', async () => {
    const res = await postJson('/api/competitor-compare', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when maxPages is zero', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.example.com',
      competitorUrl: 'https://competitor.example.com',
      maxPages: 0,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/);
  });

  it('returns 400 when maxPages is negative', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.example.com',
      competitorUrl: 'https://competitor.example.com',
      maxPages: -5,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/);
  });

  it('returns 400 when maxPages exceeds 30', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.example.com',
      competitorUrl: 'https://competitor.example.com',
      maxPages: 31,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('30');
  });

  it('returns 400 when maxPages is a non-integer (float)', async () => {
    const res = await postJson('/api/competitor-compare', {
      myUrl: 'https://mysite.example.com',
      competitorUrl: 'https://competitor.example.com',
      maxPages: 2.5,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/);
  });
});

// ─── GET /api/competitor-compare-snapshot ────────────────────────────────────

describe('GET /api/competitor-compare-snapshot — empty state', () => {
  it('returns null when no query params are provided', async () => {
    const res = await api('/api/competitor-compare-snapshot');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when only myUrl is provided (no competitorUrl)', async () => {
    const res = await api('/api/competitor-compare-snapshot?myUrl=https%3A%2F%2Fexample.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when snapshot does not exist for the given pair', async () => {
    const res = await api(
      '/api/competitor-compare-snapshot?myUrl=https%3A%2F%2Fnobody.example.com&competitorUrl=https%3A%2F%2Fnobody2.example.com',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ─── GET /api/competitor-compare-latest ──────────────────────────────────────

describe('GET /api/competitor-compare-latest — empty state', () => {
  it('returns null when myUrl param is missing', async () => {
    const res = await api('/api/competitor-compare-latest');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when no comparison has been saved for the given myUrl', async () => {
    const res = await api('/api/competitor-compare-latest?myUrl=https%3A%2F%2Fno-such-entry.example.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ─── Site-scoped routes — middleware behavior ─────────────────────────────────
//
// requireWorkspaceSiteAccessFromQuery behavior:
// - No workspaceId param + no JWT user → middleware passes through (no wsId to check)
// - workspaceId provided but doesn't own the siteId → 403 (workspace/site ownership check fails)
// - Valid workspaceId + siteId ownership match → passes through to route handler

describe('GET /api/webflow/link-check-snapshot/:siteId', () => {
  it('returns null for an unknown siteId when no workspaceId is provided', async () => {
    // No workspaceId query param + no JWT → middleware passes through, snapshot is null
    const res = await api('/api/webflow/link-check-snapshot/unknown-site-id-zzz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns 403 when workspaceId is provided but does not own the siteId', async () => {
    // Workspace exists but doesn't own 'unknown-site-id-zzz' → 403
    const res = await api(
      `/api/webflow/link-check-snapshot/unknown-site-id-zzz?workspaceId=${workspaceId}`,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/webflow/redirect-snapshot/:siteId', () => {
  it('returns null for an unknown siteId (no snapshot exists)', async () => {
    const res = await api('/api/webflow/redirect-snapshot/unknown-site-id-zzz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /api/webflow/internal-links-snapshot/:siteId', () => {
  it('returns null for an unknown siteId (no snapshot exists)', async () => {
    const res = await api('/api/webflow/internal-links-snapshot/unknown-site-id-zzz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
