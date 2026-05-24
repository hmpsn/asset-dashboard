/**
 * Integration tests for content-publish validation paths.
 *
 * Routes covered (server/routes/content-publish.ts):
 *   POST /api/content-posts/:workspaceId/:postId/publish-to-webflow
 *     — unknown workspace → 404
 *     — invalid body fields → 400 (Zod schema)
 *     — no publish target configured → 400
 *   GET  /api/webflow/publish-collections/:siteId
 *     — no workspaceId query param → passes auth (no JWT), no token → 400
 *     — unknown siteId with no token → 400
 *   GET  /api/webflow/publish-schema/:collectionId
 *     — no workspaceId/siteId → passes auth (no JWT), token lookup returns undefined → proceeds
 *
 * Strategy: validate error paths only — no actual Webflow API calls are made.
 * Port: 13517 (exclusive to this file)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13517;
const ctx = createTestContext(PORT);
const { api, authPostJson, authApi } = ctx;

const UNKNOWN_WORKSPACE_ID = 'ws_pubvalid_unknown_zzz9999';
const UNKNOWN_POST_ID = 'post_does_not_exist_zzz9999';
const FAKE_SITE_ID = 'site_fake_no_token_zzz';
const FAKE_COLLECTION_ID = 'collection_fake_no_token_zzz';

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`ContentPublish Validation ${PORT}`).id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/content-posts/:workspaceId/:postId/publish-to-webflow
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/content-posts/:workspaceId/:postId/publish-to-webflow', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await authPostJson(
      `/api/content-posts/${UNKNOWN_WORKSPACE_ID}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      {},
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 400 when workspace has no publish target configured', async () => {
    // wsId exists but has no publishTarget set
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      {},
    );
    // No webflowSiteId and no publishTarget on the workspace → 400
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    // The first check: no publishTarget
    expect(body.error).toMatch(/publish|target|webflow/i);
  });

  it('returns 400 when body has invalid field type (Zod validation)', async () => {
    // publishContentPostSchema: { generateImage?: boolean }.strict()
    // Sending a non-boolean generateImage should fail Zod
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { generateImage: 'yes-please' },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when body has unknown extra fields (strict schema)', async () => {
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { unknownField: true },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('accepts empty body (schema defaults to {})', async () => {
    // Empty body {} passes Zod (.default({}) makes it optional)
    // Will fail at workspace check or publish target, but NOT at Zod validation
    const res = await authPostJson(
      `/api/content-posts/${UNKNOWN_WORKSPACE_ID}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      {},
    );
    // Should be 404 (workspace not found), not 400 (validation error)
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/webflow/publish-collections/:siteId
// ─────────────────────────────────────────────────────────────────────────────
// Note: the test environment sets WEBFLOW_API_TOKEN as a fallback, so
// getTokenForSite() never returns null. The route proceeds to call listCollections()
// which fails gracefully (fake siteId → empty array) and returns 200 [].
// Tests here verify the route is reachable and returns an array shape.

describe('GET /api/webflow/publish-collections/:siteId', () => {
  it('returns 403 when workspace does not own the siteId', async () => {
    // requireWorkspaceSiteAccessFromQuery: workspace found but FAKE_SITE_ID is not
    // owned by wsId → workspaceOwnsWebflowSite returns false → 403
    const res = await authApi(
      `/api/webflow/publish-collections/${FAKE_SITE_ID}?workspaceId=${wsId}`,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 array when workspaceId query param is absent (auth passes through for unauthenticated)', async () => {
    // requireWorkspaceSiteAccessFromQuery: when workspaceId absent + no JWT user,
    // requestUserCanOmitWorkspaceScope = true → passes through to route handler.
    // WEBFLOW_API_TOKEN fallback is set in test env; listCollections degrades gracefully → []
    const res = await authApi(`/api/webflow/publish-collections/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/webflow/publish-schema/:collectionId
// ─────────────────────────────────────────────────────────────────────────────
// Note: getCollectionSchema degrades gracefully — a failed Webflow fetch returns
// { fields: [] } (200), so tests verify the route shape, not a hard error code.

describe('GET /api/webflow/publish-schema/:collectionId', () => {
  it('returns 200 with fields array when siteId is absent (uses WEBFLOW_API_TOKEN fallback)', async () => {
    // requireWorkspaceSiteAccess: workspace from query, site from query.
    // When both absent + no JWT user → requestUserCanOmitWorkspaceScope = true → passes.
    // getCollectionSchema degrades → { fields: [] }
    const res = await authApi(`/api/webflow/publish-schema/${FAKE_COLLECTION_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { fields: unknown[] };
    expect(body).toHaveProperty('fields');
    expect(Array.isArray(body.fields)).toBe(true);
  });

  it('returns 200 with fields array when workspaceId provided but siteId absent', async () => {
    // siteId absent from query → no site token override → WEBFLOW_API_TOKEN fallback
    // getCollectionSchema for fake collectionId → { fields: [] }
    const res = await authApi(`/api/webflow/publish-schema/${FAKE_COLLECTION_ID}?workspaceId=${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { fields: unknown[] };
    expect(body).toHaveProperty('fields');
    expect(Array.isArray(body.fields)).toBe(true);
  });
});
