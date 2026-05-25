/**
 * Integration tests for POST /api/webflow/seo-bulk-rewrite/:siteId.
 *
 * Tests focus on input validation — missing/invalid input → 400 or 403.
 * External API calls (OpenAI, Webflow) are never triggered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13473, { env: { OPENAI_API_KEY: '' } }); // port-ok: assigned range 13470-13484
const { postJson } = ctx;

let workspaceId = '';
const FAKE_SITE_ID = 'site-test-13473-ccc';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Webflow SEO Bulk Rewrite Validation 13473');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { webflowSiteId: FAKE_SITE_ID });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// POST /api/webflow/seo-bulk-rewrite/:siteId
// ---------------------------------------------------------------------------
describe('POST /api/webflow/seo-bulk-rewrite/:siteId', () => {
  it('reaches OPENAI_API_KEY check when workspaceId is missing (or succeeds when key is available)', async () => {
    // In the test environment (APP_PASSWORD='', no JWT user), requireWorkspaceSiteAccess
    // calls next() even without workspaceId. Pages and field are present, so the
    // route proceeds to the OPENAI_API_KEY check → 500 (key not configured in test env).
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      pages: [{ pageId: 'p1', title: 'Home' }],
      field: 'title',
    });
    // Validation passes and auth passes through in no-JWT env.
    expect([200, 500]).toContain(res.status);
    if (res.status === 500) {
      const body = await res.json() as { error: string };
      expect(typeof body.error).toBe('string');
      return;
    }
    const body = await res.json() as { suggestions?: unknown[]; generated?: number };
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(typeof body.generated).toBe('number');
  });

  it('returns 403 when workspaceId is present but does not own the site', async () => {
    const other = createWorkspace('Other WS Bulk Rewrite 13473');
    try {
      const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
        pages: [{ pageId: 'p1', title: 'Home' }],
        field: 'title',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });

  it('returns 400 when pages array is missing', async () => {
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      workspaceId,
      field: 'title',
    });
    // Route: `if (!pages?.length || !field)` → 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pages, field required/i);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [],
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pages, field required/i);
  });

  it('returns 400 when field is missing', async () => {
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pages, field required/i);
  });

  it('returns 400 when field is empty string (falsy)', async () => {
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home' }],
      field: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pages, field required/i);
  });

  it('returns key error when OPENAI_API_KEY is unavailable (or succeeds when key is available)', async () => {
    // Auth passes, validation passes (pages + field present), but no AI key
    const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
      workspaceId,
      pages: [{ pageId: 'p1', title: 'Home', slug: '/home' }],
      field: 'title',
    });
    expect([200, 500]).toContain(res.status);
    if (res.status === 500) {
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
      return;
    }
    const body = await res.json() as { suggestions?: unknown[]; generated?: number };
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(typeof body.generated).toBe('number');
  });

  it('returns 403 when workspace has a different site than the route siteId', async () => {
    const other = createWorkspace('Different Site WS 13473');
    updateWorkspace(other.id, { webflowSiteId: 'another-site-entirely' });
    try {
      const res = await postJson(`/api/webflow/seo-bulk-rewrite/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
        pages: [{ pageId: 'p1', title: 'Home' }],
        field: 'description',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });
});
