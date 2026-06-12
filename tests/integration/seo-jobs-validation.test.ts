/**
 * Integration tests: SEO background job routes validation.
 *
 * Tests the Zod validation and workspace-existence guards in webflow-seo-jobs.ts.
 * All tests target 400/404 paths that fire before any AI/Webflow API calls.
 *
 * Routes under test:
 *   - POST /api/seo/:workspaceId/bulk-analyze
 *   - POST /api/seo/:workspaceId/bulk-rewrite
 *   - POST /api/seo/:workspaceId/bulk-accept-fixes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { postJson } = ctx;

let wsId = '';
let wsWithSiteId = '';
const FAKE_SITE_ID = 'site_seo_jobs_test_99';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('SEO Jobs Validation WS').id;
  wsWithSiteId = createWorkspace('SEO Jobs WS With Site').id;
  updateWorkspace(wsWithSiteId, { webflowSiteId: FAKE_SITE_ID });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsWithSiteId);
  await ctx.stopServer();
});

describe('POST /api/seo/:workspaceId/bulk-analyze — validation', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_jobs_99/bulk-analyze', {
      pages: [{ pageId: 'pg_1', title: 'Test' }],
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, { pages: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when a page item is missing pageId', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [{ title: 'No ID page' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/seo/:workspaceId/bulk-rewrite — validation', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_jobs_99/bulk-rewrite', {
      siteId: FAKE_SITE_ID,
      pages: [{ pageId: 'pg_1', title: 'Test' }],
      field: 'title',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: FAKE_SITE_ID,
      pages: [],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      pages: [{ pageId: 'pg_1', title: 'Test' }],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when field is an invalid value', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: FAKE_SITE_ID,
      pages: [{ pageId: 'pg_1', title: 'Test' }],
      field: 'invalid_field',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when siteId does not match workspace webflowSiteId', async () => {
    const res = await postJson(`/api/seo/${wsWithSiteId}/bulk-rewrite`, {
      siteId: 'wrong_site_id_9999',
      pages: [{ pageId: 'pg_1', title: 'Test' }],
      field: 'title',
    });
    // ws.webflowSiteId is set to FAKE_SITE_ID, so wrong_site_id_9999 mismatches → 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('siteId');
  });
});

describe('POST /api/seo/:workspaceId/bulk-accept-fixes — validation', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_jobs_99/bulk-accept-fixes', {
      siteId: FAKE_SITE_ID,
      fixes: [{ pageId: 'pg_1', check: 'title-length', suggestedFix: 'Short title' }],
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when fixes array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: FAKE_SITE_ID,
      fixes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      fixes: [{ pageId: 'pg_1', check: 'title-length', suggestedFix: 'Short title' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a fix item is missing required fields', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: FAKE_SITE_ID,
      fixes: [{ pageId: 'pg_1' }], // missing check and suggestedFix
    });
    expect(res.status).toBe(400);
  });
});
