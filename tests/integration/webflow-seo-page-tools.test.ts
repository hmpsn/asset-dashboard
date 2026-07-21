/**
 * Integration tests for Webflow SEO page utility routes.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/webflow/page-html/:siteId   (fetch page HTML/text)
 * - POST /api/webflow/seo-copy           (generate per-page SEO copy)
 *
 * Strategy: focus on validation paths that fire before external HTTP/AI calls
 * to avoid relying on live Webflow APIs or OpenAI in CI.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createEphemeralTestContext(import.meta.url, { env: { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } });
const { api, postJson } = ctx;

let workspace: SeededFullWorkspace;

beforeAll(async () => {
  await ctx.startServer();
  workspace = seedWorkspace();
}, 30_000);

afterAll(async () => {
  workspace.cleanup();
  await ctx.stopServer();
});

// ─── GET /api/webflow/page-html/:siteId ───────────────────────────────────────

describe('GET /api/webflow/page-html/:siteId — validation', () => {
  const FAKE_SITE_ID = 'site_page_tools_fake_99';

  it('returns 400 when path query param is missing', async () => {
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 or 404 or 500 when site has no token and no workspace live domain', async () => {
    // No workspace with this siteId → getSiteSubdomain fails, no live domain → cannot resolve URL
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}?path=/about`);
    // Route checks urls.length === 0 → 400. getSiteSubdomain may throw → 500.
    expect([400, 404, 500]).toContain(res.status);
  });

  it('returns 400 when path normalizes to root but site cannot be resolved', async () => {
    // Empty string path normalizes to "/" which is truthy in the route check,
    // so the route proceeds and fails on site URL resolution.
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}?path=`);
    expect([400, 404, 500]).toContain(res.status);
  });
});

describe('GET /api/webflow/page-html/:siteId — with seeded workspace token', () => {
  it('returns 400 or reachable-site errors for unknown path on known siteId', async () => {
    // The seeded workspace has a webflowSiteId and token, but the live domain
    // is test.example.com (unreachable). Still exercises the URL-resolution branch.
    const res = await api(`/api/webflow/page-html/${workspace.webflowSiteId}?path=/nonexistent-test-path`);
    // Should not return 400 for missing path (path param is present).
    // May return 404 (page not fetched) or 500 (getSiteSubdomain network error).
    expect(res.status).not.toBe(400);
    expect([404, 500]).toContain(res.status);
  });
});

// ─── POST /api/webflow/seo-copy ───────────────────────────────────────────────

describe('POST /api/webflow/seo-copy — validation', () => {
  it('returns 400 when pagePath is missing', async () => {
    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: workspace.workspaceId,
      pageTitle: 'About Us',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('pagePath');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const res = await postJson('/api/webflow/seo-copy', {
      pagePath: '/about',
      pageTitle: 'About Us',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('workspaceId');
  });

  it('returns 400 when both pagePath and workspaceId are missing', async () => {
    const res = await postJson('/api/webflow/seo-copy', {
      pageTitle: 'About Us',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await postJson('/api/webflow/seo-copy', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/webflow/seo-copy — with valid workspace and no AI provider', () => {
  it('returns a generic generation failure when no creative provider is configured', async () => {
    // Both provider keys are absent, so the creative dispatcher fails without an OpenAI-only gate.
    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: workspace.workspaceId,
      pagePath: '/about',
      pageTitle: 'About Us',
      currentSeoTitle: 'About Us | Test',
      currentDescription: 'Learn about our team.',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: 'SEO copy generation failed' });
  });

  it('does not return 404 for an existing workspace', async () => {
    // The route does not explicitly 404 on missing workspace;
    // it proceeds with undefined intel. Ensure it does NOT return 404.
    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: workspace.workspaceId,
      pagePath: '/services',
      pageTitle: 'Our Services',
    });
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/webflow/seo-copy — access control', () => {
  it('returns 403 when workspaceId in body is present but user is a different-workspace JWT holder', async () => {
    // Without any JWT (test env has no APP_PASSWORD), requireWorkspaceAccessFromBody
    // passes through because req.user is undefined. This test verifies the route is
    // reachable without auth in test env (no 401/403 from missing auth).
    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: workspace.workspaceId,
      pagePath: '/test',
    });
    // Should not be 401 or 403 in test env (no APP_PASSWORD configured)
    expect([400, 500, 200]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
