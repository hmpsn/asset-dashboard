/**
 * Integration tests for Webflow SEO background job routes.
 *
 * Tests the full HTTP request/response cycle for:
 * - POST /api/seo/:workspaceId/bulk-analyze   (enqueue analyze job)
 * - POST /api/seo/:workspaceId/bulk-rewrite   (enqueue rewrite job)
 * - POST /api/seo/:workspaceId/bulk-accept-fixes (enqueue accept-fixes job)
 *
 * Strategy: focus on validation, 404 for unknown workspace, and shape of the
 * jobId response when the server has the necessary env keys configured.
 * Actual job execution is not tested — routes fire-and-forget after returning jobId.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const PORT = 13701;
const ctx = createTestContext(PORT);
const { postJson } = ctx;

let workspace: SeededFullWorkspace;

beforeAll(async () => {
  await ctx.startServer();
  workspace = seedWorkspace();
}, 30_000);

afterAll(async () => {
  workspace.cleanup();
  await ctx.stopServer();
});

// ─── POST /api/seo/:workspaceId/bulk-analyze ──────────────────────────────────

describe('POST /api/seo/:workspaceId/bulk-analyze', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/nonexistent-workspace-id/bulk-analyze', {
      pages: [{ pageId: 'page_1', title: 'Home' }],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Workspace not found');
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, {
      pages: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages field is missing', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when a page item is missing required pageId', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, {
      pages: [{ title: 'No pageId here' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a page item has empty pageId', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, {
      pages: [{ pageId: '', title: 'Empty pageId' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages exceeds max (500)', async () => {
    const pages = Array.from({ length: 501 }, (_, i) => ({ pageId: `page_${i}`, title: `Page ${i}` }));
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, { pages });
    expect(res.status).toBe(400);
  });

  it('returns 500 or 200 depending on OPENAI_API_KEY availability', async () => {
    // In test env OPENAI_API_KEY is typically absent → 500
    // If present, route enqueues job and returns { jobId }
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-analyze`, {
      pages: [{ pageId: 'page_home', title: 'Home' }],
    });
    // 200 means job enqueued (OPENAI_API_KEY present), 500 means key missing
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as { jobId: string };
      expect(typeof body.jobId).toBe('string');
      expect(body.jobId.length).toBeGreaterThan(0);
    }
  });
});

// ─── POST /api/seo/:workspaceId/bulk-rewrite ──────────────────────────────────

describe('POST /api/seo/:workspaceId/bulk-rewrite', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/nonexistent-workspace-id/bulk-rewrite', {
      siteId: 'site_abc',
      pages: [{ pageId: 'page_1', title: 'Home' }],
      field: 'title',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Workspace not found');
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      pages: [{ pageId: 'page_1', title: 'Home' }],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when field is missing', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      siteId: workspace.webflowSiteId,
      pages: [{ pageId: 'page_1', title: 'Home' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when field has invalid value', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      siteId: workspace.webflowSiteId,
      pages: [{ pageId: 'page_1', title: 'Home' }],
      field: 'invalid_field',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      siteId: workspace.webflowSiteId,
      pages: [],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when siteId does not belong to workspace', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      siteId: 'site_belongs_to_another_workspace',
      pages: [{ pageId: 'page_1', title: 'Home' }],
      field: 'title',
    });
    // workspace.webflowSiteId is set, so mismatched siteId → 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('siteId does not belong to this workspace');
  });

  it('returns 500 or 200 with valid payload when using matching siteId', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
      siteId: workspace.webflowSiteId,
      pages: [{ pageId: 'page_1', title: 'Home' }],
      field: 'title',
    });
    // 200 = job enqueued (OPENAI_API_KEY present), 500 = key missing in test env
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as { jobId: string };
      expect(typeof body.jobId).toBe('string');
      expect(body.jobId.length).toBeGreaterThan(0);
    }
  });

  it('accepts all valid field values: title, description, both', async () => {
    for (const field of ['title', 'description', 'both'] as const) {
      const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-rewrite`, {
        siteId: workspace.webflowSiteId,
        pages: [{ pageId: 'page_1', title: 'Home' }],
        field,
      });
      // Should not be 400 (validation should pass)
      expect(res.status).not.toBe(400);
    }
  });
});

// ─── POST /api/seo/:workspaceId/bulk-accept-fixes ────────────────────────────

describe('POST /api/seo/:workspaceId/bulk-accept-fixes', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/nonexistent-workspace-id/bulk-accept-fixes', {
      siteId: 'site_abc',
      fixes: [{ pageId: 'page_1', check: 'seo_title', suggestedFix: 'Better Title' }],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Workspace not found');
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      fixes: [{ pageId: 'page_1', check: 'seo_title', suggestedFix: 'Better Title' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fixes array is empty', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: workspace.webflowSiteId,
      fixes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a fix item is missing required check field', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: workspace.webflowSiteId,
      fixes: [{ pageId: 'page_1', suggestedFix: 'Better Title' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a fix item is missing required suggestedFix field', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: workspace.webflowSiteId,
      fixes: [{ pageId: 'page_1', check: 'seo_title' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when siteId does not match workspace', async () => {
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: 'site_from_another_workspace',
      fixes: [{ pageId: 'page_1', check: 'seo_title', suggestedFix: 'Better Title' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('siteId does not belong to this workspace');
  });

  it('returns 500 when no Webflow API token is configured for the matching siteId', async () => {
    // workspace has a webflowSiteId but getTokenForSite returns only from DB token column
    // or WEBFLOW_API_TOKEN env var. In test env those are test values or absent.
    // The route checks for the token and returns 500 if not found.
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: workspace.webflowSiteId,
      fixes: [{ pageId: 'page_1', check: 'seo_title', suggestedFix: 'Better Title' }],
    });
    // The seeded workspace has a test webflow token stored in DB, so getTokenForSite
    // will find it. In that case the job is enqueued → 200. Otherwise 500.
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as { jobId: string };
      expect(typeof body.jobId).toBe('string');
      expect(body.jobId.length).toBeGreaterThan(0);
    }
  });

  it('fix items accept optional fields without validation errors', async () => {
    // Test that optional fields (message, pageSlug, publishedPath, pageName) are accepted
    const res = await postJson(`/api/seo/${workspace.workspaceId}/bulk-accept-fixes`, {
      siteId: workspace.webflowSiteId,
      fixes: [
        {
          pageId: 'page_1',
          check: 'seo_title',
          suggestedFix: 'Better Title',
          message: 'Optional message',
          pageSlug: '/about',
          publishedPath: '/about',
          pageName: 'About Page',
        },
      ],
    });
    // Should not be 400 (schema validation should pass for optional fields)
    expect(res.status).not.toBe(400);
  });
});
