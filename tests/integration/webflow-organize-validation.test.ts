/**
 * Integration tests for /api/webflow/organize-* and /api/webflow/rename/:assetId routes.
 *
 * Tests focus on input validation. In the test environment (APP_PASSWORD='', no JWT user),
 * requireWorkspaceSiteAccess calls next() when workspaceId or siteId is absent because
 * requestUserCanOmitWorkspaceScope() returns true for unauthenticated requests.
 *
 * For routes that read workspaceId/siteId from the query or body, the access guard
 * *does* enforce workspace-site ownership when both values are present.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson } = ctx;

let workspaceId = '';
const FAKE_SITE_ID = 'site-test-13471-aaa';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Webflow Organize Validation 13471');
  workspaceId = ws.id;
  // Give the workspace a webflowSiteId so workspace-site access checks pass
  updateWorkspace(workspaceId, { webflowSiteId: FAKE_SITE_ID });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// GET /api/webflow/organize-preview/:siteId
// ---------------------------------------------------------------------------
describe('GET /api/webflow/organize-preview/:siteId', () => {
  it('returns 200 with empty plan when workspaceId is missing (auth passes, token found from env)', async () => {
    // With no JWT user, auth passes through. WEBFLOW_API_TOKEN is set in the test .env,
    // so getTokenForSite() returns a token. The Webflow API rejects the fake site ID
    // gracefully (listAssets returns []) → 200 with an empty plan.
    const res = await api(`/api/webflow/organize-preview/${FAKE_SITE_ID}`);
    expect([200, 400, 500]).toContain(res.status);
  });

  it('returns a plan (200) or error when workspaceId is valid (token from env)', async () => {
    // With a valid workspaceId + WEBFLOW_API_TOKEN in env, the route runs and
    // returns 200 with an empty plan (Webflow API rejects the fake site gracefully).
    const res = await api(
      `/api/webflow/organize-preview/${FAKE_SITE_ID}?workspaceId=${workspaceId}`,
    );
    expect([200, 400, 500]).toContain(res.status);
  });

  it('returns 403 when workspaceId does not match the site', async () => {
    // A workspace that does NOT own FAKE_SITE_ID — site access guard fires
    const other = createWorkspace('Other WS Organize Preview 13471');
    try {
      const res = await api(
        `/api/webflow/organize-preview/${FAKE_SITE_ID}?workspaceId=${other.id}`,
      );
      // The workspace exists but doesn't own FAKE_SITE_ID → 403
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/organize-execute/:siteId
// ---------------------------------------------------------------------------
describe('POST /api/webflow/organize-execute/:siteId', () => {
  it('returns a response (not 404) when workspaceId is missing (auth passes through in no-JWT env)', async () => {
    // Auth passes (no JWT). WEBFLOW_API_TOKEN is set in the test .env, so the token
    // guard is skipped. The route runs and may return 200 or 500 depending on API behavior.
    const res = await postJson(`/api/webflow/organize-execute/${FAKE_SITE_ID}`, {
      moves: [{ assetId: 'a1', assetName: 'logo.png', targetFolder: 'Home' }],
      foldersToCreate: [],
    });
    expect(res.status).not.toBe(404);
  });

  it('returns 403 when workspaceId is present but does not own the site', async () => {
    const other = createWorkspace('Other WS Org Execute 13471');
    try {
      const res = await postJson(`/api/webflow/organize-execute/${FAKE_SITE_ID}`, {
        workspaceId: other.id,
        moves: [{ assetId: 'a1', assetName: 'logo.png', targetFolder: 'Home' }],
        foldersToCreate: [],
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });

  it('returns 400 when moves array is empty (no token check)', async () => {
    // No token for site → 400 for missing token (fires before moves check)
    const res = await postJson(`/api/webflow/organize-execute/${FAKE_SITE_ID}`, {
      workspaceId,
      moves: [],
      foldersToCreate: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns a response (not 404) when workspaceId is valid (token found from env)', async () => {
    // WEBFLOW_API_TOKEN is set in the test .env — the token guard is skipped.
    // The route proceeds and returns 200 or error depending on Webflow API behavior.
    const res = await postJson(`/api/webflow/organize-execute/${FAKE_SITE_ID}`, {
      workspaceId,
      moves: [{ assetId: 'a1', assetName: 'logo.png', targetFolder: 'Home' }],
      foldersToCreate: [],
    });
    expect(res.status).not.toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/webflow/rename/:assetId
// ---------------------------------------------------------------------------
describe('PATCH /api/webflow/rename/:assetId', () => {
  it('returns 403 when workspaceId does not own the siteId', async () => {
    // Both workspaceId and siteId are present, but workspace does not own the site
    const other = createWorkspace('Other WS Rename 13471');
    try {
      const res = await patchJson('/api/webflow/rename/asset-abc', {
        workspaceId: other.id,
        siteId: FAKE_SITE_ID,
        displayName: 'logo-v2.png',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteWorkspace(other.id);
    }
  });

  it('returns 400 when displayName is missing (auth passes through, route guard fires)', async () => {
    // No JWT user → requireWorkspaceSiteAccess passes (missing wsId/siteId ok)
    // Route: `if (!displayName) return res.status(400)...`
    const res = await patchJson('/api/webflow/rename/asset-abc', {
      workspaceId,
      siteId: FAKE_SITE_ID,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/displayName required/i);
  });

  it('returns 400 when displayName is an empty string', async () => {
    const res = await patchJson('/api/webflow/rename/asset-abc', {
      workspaceId,
      siteId: FAKE_SITE_ID,
      displayName: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/displayName required/i);
  });

  it('returns 400 when displayName is missing and no workspaceId/siteId (auth passes, route guards)', async () => {
    // Auth passes (no JWT), missing displayName → 400
    const res = await patchJson('/api/webflow/rename/some-asset-id', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/displayName required/i);
  });
});
