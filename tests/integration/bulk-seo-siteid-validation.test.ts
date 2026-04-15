/**
 * Integration tests: bulk SEO endpoint siteId workspace validation.
 *
 * bulk-rewrite and bulk-accept-fixes accept `siteId` from req.body.
 * Without a guard, an authenticated admin could pass a siteId belonging to
 * a different workspace and use Webflow tokens from the target workspace's
 * connection. The guard added in PR #1 Platform Health Sprint must return
 * 400 when siteId !== ws.webflowSiteId (and ws.webflowSiteId is set).
 *
 * Tested endpoints:
 *   POST /api/seo/:workspaceId/bulk-rewrite
 *   POST /api/seo/:workspaceId/bulk-accept-fixes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

// ── Unique port ──────────────────────────────────────────────────────────────
const ctx = createTestContext(13223);
const { postJson } = ctx;

const OWNED_SITE = 'site_owned_aabbcc';
const FOREIGN_SITE = 'site_foreign_xxyyzz';

let wsId = '';
const minimalPages = [{ pageId: 'p1', title: 'Home', slug: 'home' }];

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('SiteId Validation Test');
  wsId = ws.id;
  // Give the workspace a known Webflow site so the guard has a value to compare against
  updateWorkspace(wsId, { webflowSiteId: OWNED_SITE });
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

describe('bulk-rewrite — siteId workspace validation', () => {
  it('returns 400 when siteId does not belong to the workspace', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: FOREIGN_SITE,
      pages: minimalPages,
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/does not belong/i);
  });

  it('accepts a matching siteId (job created, not 400)', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: OWNED_SITE,
      pages: minimalPages,
      field: 'title',
    });
    // 200 (job started) or 409 (already running) — anything but 400
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
  });
});

describe('bulk-accept-fixes — siteId workspace validation', () => {
  it('returns 400 when siteId does not belong to the workspace', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: FOREIGN_SITE,
      fixes: [{ pageId: 'p1', check: 'missing-meta', suggestedFix: 'A description' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/does not belong/i);
  });

  it('accepts a matching siteId (job created, not 400)', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: OWNED_SITE,
      fixes: [{ pageId: 'p1', check: 'missing-meta', suggestedFix: 'A description' }],
    });
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
  });
});
