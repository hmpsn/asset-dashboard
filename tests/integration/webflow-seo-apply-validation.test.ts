/**
 * Integration tests for /api/webflow/seo-bulk-fix and /api/webflow/seo-pattern-apply routes.
 *
 * Focuses on validation: missing workspaceId → 403, missing body fields → 400.
 * Does not reach the Webflow API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13472); // port-ok: assigned range 13470-13484
const { postJson } = ctx;

let workspaceId = '';
const FAKE_SITE_ID = 'site-test-13472-bbb';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Webflow SEO Apply Validation 13472');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { webflowSiteId: FAKE_SITE_ID });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// POST /api/webflow/seo-bulk-fix/:siteId
// ---------------------------------------------------------------------------
describe('POST /api/webflow/seo-bulk-fix/:siteId', () => {
  it('returns 409 (retired) when workspaceId is missing from body (middleware passes in no-JWT env)', async () => {
    // In the test environment (APP_PASSWORD='', no JWT user), requireWorkspaceSiteAccess
    // passes through when workspaceId is absent because requestUserCanOmitWorkspaceScope
    // returns true. The route body is hit immediately and returns 409 (retired endpoint).
    const res = await postJson(`/api/webflow/seo-bulk-fix/${FAKE_SITE_ID}`, {});
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 403 when workspaceId does not own the site', async () => {
    const other = createWorkspace('Other WS Bulk Fix 13472');
    try {
      const res = await postJson(`/api/webflow/seo-bulk-fix/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });

  it('returns 409 when workspaceId is valid (route is retired)', async () => {
    // The seo-bulk-fix route is retired and always returns 409 with a message
    // pointing to the background job API
    const res = await postJson(`/api/webflow/seo-bulk-fix/${FAKE_SITE_ID}`, {
      workspaceId,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; supportedJobType: string };
    expect(body.error).toMatch(/retired/i);
    expect(body.supportedJobType).toBe('bulk-seo-fix');
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/seo-pattern-apply/:siteId
// ---------------------------------------------------------------------------
describe('POST /api/webflow/seo-pattern-apply/:siteId', () => {
  it('returns 400 when workspaceId is missing from body (route validation fires before workspace check)', async () => {
    // In the test environment (APP_PASSWORD='', no JWT user), requireWorkspaceSiteAccess
    // passes through when workspaceId is absent. The route then validates body fields:
    // workspaceId is undefined → 400 "required fields" error.
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
      field: 'title',
      action: 'append',
      text: '| Agency',
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when workspaceId does not own the site', async () => {
    const other = createWorkspace('Other WS Pattern Apply 13472');
    try {
      const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
        pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
        field: 'title',
        action: 'append',
        text: '| Agency',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });

  it('returns 400 when pages array is missing', async () => {
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      field: 'title',
      action: 'append',
      text: '| Agency',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspaceId, pages, field, action, text required/i);
  });

  it('returns 400 when field is missing', async () => {
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
      action: 'append',
      text: '| Agency',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when action is missing', async () => {
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
      field: 'title',
      text: '| Agency',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when text is missing', async () => {
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
      field: 'title',
      action: 'prepend',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when pages array is empty', async () => {
    // Empty pages array → after filtering cms- IDs → pages.length = 0 → 400
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [],
      field: 'title',
      action: 'append',
      text: '| Agency',
    });
    expect(res.status).toBe(400);
  });

  it('filters out CMS synthetic IDs before the empty-pages check', async () => {
    // All pages have synthetic cms- IDs → stripped → pages.length = 0 → 400
    const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [
        { pageId: 'cms-collection-1', title: 'Blog Post', currentValue: 'Old' },
        { pageId: 'cms-collection-2', title: 'Case Study', currentValue: 'Old' },
      ],
      field: 'description',
      action: 'replace',
      text: 'New description',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 403 when workspace does not match site even with all fields present', async () => {
    // workspaceId exists but its webflowSiteId does not match the route :siteId
    const other = createWorkspace('Wrong Site WS 13472');
    updateWorkspace(other.id, { webflowSiteId: 'completely-different-site' });
    try {
      const res = await postJson(`/api/webflow/seo-pattern-apply/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
        pages: [{ pageId: 'p1', title: 'Home', currentValue: 'Old title' }],
        field: 'title',
        action: 'append',
        text: '| Agency',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });
});
