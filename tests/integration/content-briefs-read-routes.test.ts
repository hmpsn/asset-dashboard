/**
 * Integration tests for content-briefs read paths and basic validation.
 * Covers GET endpoints and POST validation-only routes (no AI calls).
 *
 * Port: 13648 (assigned range 13648–13655 for wave-24-a7)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13648); // port-ok: assigned range 13648-13655
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Content Briefs Read Routes WS 13648').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Content Briefs — list endpoint', () => {
  it('GET /api/content-briefs/:workspaceId returns 200 with empty array for a fresh workspace', async () => {
    const res = await api(`/api/content-briefs/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/content-briefs/:workspaceId with unknown workspaceId returns 200 with empty array (no workspace existence check)', async () => {
    // requireWorkspaceAccess passes through when no JWT user present (APP_PASSWORD auth).
    // listBriefs on a nonexistent workspace simply returns an empty array.
    const res = await api('/api/content-briefs/ws_nonexistent_cb_99999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Content Briefs — suggested endpoint', () => {
  it('GET /api/content-briefs/:workspaceId/suggested returns 200 with signals array', async () => {
    const res = await api(`/api/content-briefs/${wsId}/suggested`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('signals');
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('GET /api/content-briefs/:workspaceId/suggested with unknown workspaceId returns 200 with empty signals (no workspace existence check)', async () => {
    // getInsights on a nonexistent workspace returns an empty array; the route gracefully returns { signals: [] }.
    const res = await api('/api/content-briefs/ws_nonexistent_cb_99999/suggested');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('signals');
  });
});

describe('Content Briefs — template-crossref endpoint', () => {
  it('GET /api/content-briefs/:workspaceId/template-crossref returns 400 when keyword param is missing', async () => {
    const res = await api(`/api/content-briefs/${wsId}/template-crossref`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('keyword query param required');
  });

  it('GET /api/content-briefs/:workspaceId/template-crossref returns 200 with null for no-match keyword', async () => {
    const res = await api(`/api/content-briefs/${wsId}/template-crossref?keyword=no-such-keyword-xyz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('GET /api/content-briefs/:workspaceId/template-crossref with unknown workspaceId returns 200 null (no workspace existence check)', async () => {
    // listMatrices on a nonexistent workspace returns empty; resolveBriefTemplateCrossref returns null.
    const res = await api('/api/content-briefs/ws_nonexistent_cb_99999/template-crossref?keyword=test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('Content Briefs — get single endpoint', () => {
  it('GET /api/content-briefs/:workspaceId/:briefId with unknown briefId returns 404', async () => {
    const res = await api(`/api/content-briefs/${wsId}/brief_unknown_cb_99999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Brief not found');
  });

  it('GET /api/content-briefs/:workspaceId/:briefId with unknown workspaceId returns 404', async () => {
    const res = await api('/api/content-briefs/ws_nonexistent_cb_99999/brief_some_id');
    expect(res.status).toBe(404);
  });
});

describe('Content Briefs — validate-keyword endpoint', () => {
  it('POST /api/content-briefs/:workspaceId/validate-keyword with missing keyword returns 400', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/validate-keyword`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/keyword/i);
  });

  it('POST /api/content-briefs/:workspaceId/validate-keyword with keyword returns 200 stub (no SEO provider)', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/validate-keyword`, {
      keyword: 'local seo services',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('keyword', 'local seo services');
    expect(body).toHaveProperty('valid', true);
  });
});

describe('Content Briefs — validate-keywords (bulk) endpoint', () => {
  it('POST /api/content-briefs/:workspaceId/validate-keywords with missing keywords returns 400', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/validate-keywords`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/keywords/i);
  });

  it('POST /api/content-briefs/:workspaceId/validate-keywords with empty array returns 400', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/validate-keywords`, { keywords: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/keywords/i);
  });

  it('POST /api/content-briefs/:workspaceId/validate-keywords with keywords returns 200 stub (no SEO provider)', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/validate-keywords`, {
      keywords: ['seo services', 'local seo'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
  });
});
