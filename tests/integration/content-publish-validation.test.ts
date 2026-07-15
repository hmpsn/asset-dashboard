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
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
} from '../../shared/types/background-jobs.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, authPostJson, authApi } = ctx;

const UNKNOWN_WORKSPACE_ID = 'ws_pubvalid_unknown_zzz9999';
const UNKNOWN_POST_ID = 'post_does_not_exist_zzz9999';
const FAKE_SITE_ID = 'site_fake_no_token_zzz';
const FAKE_COLLECTION_ID = 'collection_fake_no_token_zzz';

let wsId = '';

function publishAcceptanceRows(workspaceId: string): { jobs: number; claims: number } {
  const jobRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE workspace_id = ? AND type = ?
  `).get(workspaceId, BACKGROUND_JOB_TYPES.CONTENT_PUBLISH) as { count: number };
  const claimRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM job_resource_claims
    WHERE workspace_id = ? AND resource_type = ?
  `).get(workspaceId, JOB_RESOURCE_TYPES.CONTENT_POST) as { count: number };
  return { jobs: jobRow.count, claims: claimRow.count };
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`ContentPublish Validation ${ctx.PORT}`).id;
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
    const before = publishAcceptanceRows(UNKNOWN_WORKSPACE_ID);
    const res = await authPostJson(
      `/api/content-posts/${UNKNOWN_WORKSPACE_ID}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { expectedRevision: 0 },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Workspace not found',
      code: 'workspace_not_found',
    });
    expect(publishAcceptanceRows(UNKNOWN_WORKSPACE_ID)).toEqual(before);
  });

  it('returns 400 when workspace has no publish target configured', async () => {
    // wsId exists but has no publishTarget set
    const before = publishAcceptanceRows(wsId);
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { expectedRevision: 0 },
    );
    // No webflowSiteId and no publishTarget on the workspace → 400
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'No publish target configured. Set up Publish Settings first.',
      code: 'no_publish_target',
    });
    expect(publishAcceptanceRows(wsId)).toEqual(before);
  });

  it('returns 400 when body has invalid field type (Zod validation)', async () => {
    // publishContentPostSchema: { generateImage?: boolean }.strict()
    // Sending a non-boolean generateImage should fail Zod
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { expectedRevision: 0, generateImage: 'yes-please' },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when body has unknown extra fields (strict schema)', async () => {
    const res = await authPostJson(
      `/api/content-posts/${wsId}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      { expectedRevision: 0, unknownField: true },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('requires an expected revision token', async () => {
    const res = await authPostJson(
      `/api/content-posts/${UNKNOWN_WORKSPACE_ID}/${UNKNOWN_POST_ID}/publish-to-webflow`,
      {},
    );
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/webflow/publish-collections/:siteId
// ─────────────────────────────────────────────────────────────────────────────
// Tests verify the auth middleware behavior, not the Webflow API outcome.
// WEBFLOW_API_TOKEN may or may not be set in the test environment.

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

  it('does not 403 when workspaceId query param is absent (auth passes through for unauthenticated)', async () => {
    // requireWorkspaceSiteAccessFromQuery: when workspaceId absent + no JWT user,
    // requestUserCanOmitWorkspaceScope = true → passes through to route handler.
    // Status depends on WEBFLOW_API_TOKEN: 200 (token set) or 400 (no token).
    // The key assertion is that auth didn't block the request.
    const res = await authApi(`/api/webflow/publish-collections/${FAKE_SITE_ID}`);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/webflow/publish-schema/:collectionId
// ─────────────────────────────────────────────────────────────────────────────
// Tests verify the auth middleware behavior. The downstream status depends on
// whether WEBFLOW_API_TOKEN is set: 200 (token → degrades to {fields:[]}) or
// 500 (no token → webflowFetch throws). The 403/401 codes verify auth gates.

describe('GET /api/webflow/publish-schema/:collectionId', () => {
  it('does not 403 when siteId is absent (auth passes through for unauthenticated)', async () => {
    // requireWorkspaceSiteAccess: workspace and site both absent + no JWT user →
    // requestUserCanOmitWorkspaceScope = true → passes. Downstream status varies by env.
    const res = await authApi(`/api/webflow/publish-schema/${FAKE_COLLECTION_ID}`);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('does not 403 when workspaceId provided but siteId absent', async () => {
    // siteId absent → no site token override; downstream varies by WEBFLOW_API_TOKEN.
    const res = await authApi(`/api/webflow/publish-schema/${FAKE_COLLECTION_ID}?workspaceId=${wsId}`);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
